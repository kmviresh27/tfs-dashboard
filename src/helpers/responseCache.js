'use strict';

/**
 * In-memory TTL response cache for expensive TFS-backed GET endpoints.
 *
 * Design decisions:
 * - Whitelist-based: only applied to explicitly listed analytics paths.
 * - Dept-isolated: cache key includes deptId so dept A never sees dept B data.
 * - Auth-aware: middleware must run AFTER requireAuth / deptIdMiddleware.
 * - Bounded: max 1000 entries, oldest 10% evicted on overflow.
 * - Bypass: add ?_fresh=1 or header X-Cache-Bypass: 1 to skip cache.
 * - Single-process: do NOT run multiple Node instances (PM2 instances: 1).
 */

const MAX_ENTRIES = 1000;
const _cache = new Map(); // key → { data, expiresAt }
let _hits   = 0;
let _misses = 0;

// ── Exact paths and prefix patterns that are safe to cache ────────────────────
const EXACT_CACHE_PATHS = new Set([
  '/dashboard', '/features', '/defects', '/teams',
  '/velocity', '/pi-story-velocity',
  '/sprint-trend', '/sprint-burndown',
  '/cycle-time-distribution',
  '/roadmap', '/pi-delivery', '/progress',
  '/predictability',
  '/pi-checks', '/pi-comparison', '/pi-list', '/pi-readiness',
  '/test-coverage',
  '/release-health',
  '/scope-change/compare', '/scope-change/report',
  '/objectives', '/objectives-plan',
  '/story-metrics',
  '/dependencies', '/dependencies/matrix',
  '/team-capacities', '/sprint-capacity',
  '/risks',
  '/kpi',
  '/defect-field-stats', '/defect-density-trend',
  '/defect-version-stats', '/defect-escape-by-quarter',
  '/blockers',
]);

/** Paths under these prefixes are all cacheable (e.g. /reports/*, /insights/*) */
const CACHE_PREFIXES = ['/reports/', '/insights/'];

function isCacheablePath(effectivePath) {
  return EXACT_CACHE_PATHS.has(effectivePath)
    || CACHE_PREFIXES.some(p => effectivePath.startsWith(p));
}

/**
 * Strip /d/:deptId prefix from req.path so dept-scoped and legacy paths
 * resolve to the same effective route name.
 *   /dashboard         → /dashboard
 *   /d/dept1/dashboard → /dashboard
 *   /insights/flow     → /insights/flow
 */
function getEffectivePath(reqPath) {
  return reqPath.replace(/^\/d\/[^/]+/, '') || '/';
}

function isBypass(req) {
  return req.query._fresh === '1'
    || (req.headers['x-cache-bypass'] || '') === '1';
}

function _buildKey(req) {
  const deptId = req.deptId || 'default';
  const qs = Object.keys(req.query)
    .filter(k => k !== '_fresh')
    .sort()
    .flatMap(k => {
      const v = req.query[k];
      return Array.isArray(v)
        ? [...v].sort().map(i => `${k}[]=${i}`)
        : [`${k}=${v}`];
    })
    .join('&');
  return `${deptId}:${getEffectivePath(req.path)}:${qs}`;
}

function _evict() {
  const toDelete = Math.ceil(MAX_ENTRIES * 0.1);
  let i = 0;
  for (const key of _cache.keys()) {
    if (i++ >= toDelete) break;
    _cache.delete(key);
  }
}

/**
 * Express middleware factory.
 * @param {number}   ttlSeconds            Cache TTL in seconds (default 300 = 5 min).
 * @param {string[]} onlyPaths             Optional: only apply this TTL to these exact effective paths.
 * @param {number}   staleWhileRevalidate  Optional: extra seconds to serve stale data while background recompute runs.
 *                                         Pass > 0 to enable stale-while-revalidate. Route must call putCacheEntry()
 *                                         after recomputing to refresh the cache.
 */
function cacheMiddleware(ttlSeconds = 300, onlyPaths, staleWhileRevalidate = 0) {
  const pathSet = onlyPaths ? new Set(onlyPaths) : null;

  return (req, res, next) => {
    if (req.method !== 'GET') return next();

    const effectivePath = getEffectivePath(req.path);
    if (!isCacheablePath(effectivePath)) return next();

    if (pathSet && !pathSet.has(effectivePath)) return next();

    if (isBypass(req)) {
      res.set('X-Cache', 'BYPASS');
      return next();
    }

    const key = _buildKey(req);
    const hit = _cache.get(key);
    const now = Date.now();

    if (hit) {
      const fresh = hit.expiresAt > now;
      const staleOk = staleWhileRevalidate > 0 && (hit.expiresAt + staleWhileRevalidate * 1000) > now;

      if (fresh) {
        _hits++;
        res.set('X-Cache', 'HIT');
        return res.json(hit.data);
      }
      if (staleOk) {
        _hits++;
        // Attach stale flag so route can trigger background refresh
        res.locals._cacheStale = true;
        res.locals._cacheKey   = key;
        res.set('X-Cache', 'STALE');
        return res.json(hit.data);
      }
    }

    _misses++;

    const originalJson = res.json.bind(res);
    res.json = function (data) {
      res.json = originalJson;
      if (res.statusCode === 200 && data != null) {
        if (_cache.size >= MAX_ENTRIES) _evict();
        try {
          _cache.set(key, {
            data: JSON.parse(JSON.stringify(data)),
            expiresAt: Date.now() + ttlSeconds * 1000,
          });
        } catch { /* non-fatal */ }
      }
      res.set('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  };
}

/**
 * Read a cached value directly by key (returns null if missing or expired).
 * Use this to share cached data between routes without an HTTP round-trip.
 */
function getCacheEntry(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  return hit; // caller can check hit.expiresAt vs Date.now() if needed
}

/**
 * Directly write a computed value into the cache.
 * Use this from background recompute functions (stale-while-revalidate pattern).
 */
function putCacheEntry(key, data, ttlSeconds) {
  try {
    if (_cache.size >= MAX_ENTRIES) _evict();
    _cache.set(key, {
      data: JSON.parse(JSON.stringify(data)),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  } catch { /* non-fatal */ }
}

/**
 * Build the same cache key that cacheMiddleware would use for a given path+query+deptId.
 * Use this to put entries from background jobs.
 */
function buildCacheKey(deptId, path, query = {}) {
  const qs = Object.keys(query).sort().map(k => `${k}=${query[k]}`).join('&');
  return `${deptId}:${path}:${qs}`;
}

/** Invalidate all cache entries for a given department. */
function bustCache(deptId) {
  const prefix = `${deptId || 'default'}:`;
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

/** Wipe the entire cache (e.g. on config reload). */
function bustAllCache() {
  _cache.clear();
}

function getCacheStats() {
  const now = Date.now();
  let active = 0;
  for (const entry of _cache.values()) {
    if (entry.expiresAt > now) active++;
  }
  return {
    entries: _cache.size,
    activeEntries: active,
    hits: _hits,
    misses: _misses,
    hitRate: (_hits + _misses) > 0
      ? `${Math.round(_hits / (_hits + _misses) * 100)}%`
      : '0%',
  };
}

module.exports = { cacheMiddleware, putCacheEntry, getCacheEntry, buildCacheKey, bustCache, bustAllCache, getCacheStats, isCacheablePath };
