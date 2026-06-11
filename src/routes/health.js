'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet }     = require('../tfsClient');
const { getCacheStats } = require('../helpers/responseCache');
const { getCircuitStats } = require('../helpers/circuitBreaker');
const { getSlowQueryLog } = require('../tfsClient');
const { getDepartments } = require('../helpers/deptPaths');

const router = express.Router();

function formatUptime(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function memStats() {
  const m = process.memoryUsage();
  return {
    rss:       `${Math.round(m.rss       / 1024 / 1024)}MB`,
    heapUsed:  `${Math.round(m.heapUsed  / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(m.heapTotal / 1024 / 1024)}MB`,
  };
}

// ── GET /api/health — liveness probe (no external calls, no auth) ─────────────
router.get('/health', (_req, res) => {
  const uptime = process.uptime();
  res.json({
    status:      'ok',
    uptime:      Math.floor(uptime),
    uptimeHuman: formatUptime(uptime),
    memory:      memStats(),
    cache:       getCacheStats(),
    circuits:    getCircuitStats(),
    timestamp:   new Date().toISOString(),
  });
});

// ── GET /api/health/ready — readiness probe (TFS ping for all depts, cached 30s)
let _readinessCache   = null;
let _readinessCacheAt = 0;
const READINESS_TTL   = 30 * 1000; // 30 seconds

router.get('/health/ready', async (_req, res) => {
  const uptime = process.uptime();

  let deptChecks = _readinessCache;
  if (!deptChecks || (Date.now() - _readinessCacheAt) > READINESS_TTL) {
    // Collect all dept IDs to check
    const depts = getDepartments().map(d => d.id);
    if (!depts.includes('default')) depts.unshift('default');

    deptChecks = await Promise.all(depts.map(async deptId => {
      try {
          const cfg = loadConfig(deptId);
          if (!cfg.tfs.pat || !cfg.tfs.baseUrl) {
            return { deptId, ok: false, latencyMs: null, error: 'PAT not configured' };
          }
          const t = Date.now();
          await tfsGet(
            `${cfg.tfs.baseUrl}/_apis/wit/fields?api-version=${cfg.tfs.apiVersion || '5.0'}&$top=1`,
            cfg.tfs.pat
          );
          return { deptId, ok: true, latencyMs: Date.now() - t };
      } catch (e) {
          return { deptId, ok: false, latencyMs: null, error: e.message.slice(0, 120) };
      }
    }));

    _readinessCache   = deptChecks;
    _readinessCacheAt = Date.now();
  }

  const allOk = deptChecks.every(d => d.ok);

  res.status(allOk ? 200 : 503).json({
    status:      allOk ? 'ready' : 'degraded',
    uptime:      Math.floor(uptime),
    uptimeHuman: formatUptime(uptime),
    memory:      memStats(),
    departments: deptChecks,
    cache:       getCacheStats(),
    circuits:    getCircuitStats(),
    timestamp:   new Date().toISOString(),
  });
});

// ── GET /api/health/metrics — admin-only: cache stats, circuit states, slow queries
router.get('/health/metrics', (req, res) => {
  // Require authentication (session must be active)
  if (!req.session?.user) return res.status(401).json({ error: 'Authentication required' });
  res.json({
    cache:       getCacheStats(),
    circuits:    getCircuitStats(),
    slowQueries: getSlowQueryLog(),
    memory:      memStats(),
    uptime:      Math.floor(process.uptime()),
    timestamp:   new Date().toISOString(),
  });
});

// ── POST /api/cache/bust — clear cached analytics data ───────────────────────
// Super admin: clears all cache. Dept admin: clears only their dept's cache.
// Anyone can use ?_fresh=1 on any GET to bypass cache for a single request.
router.post('/cache/bust', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Authentication required' });

  const { bustCache, bustAllCache, getCacheStats } = require('../helpers/responseCache');
  const user = req.session.user;
  const isSuperAdmin = user.isSuperAdmin || user.role === 'superadmin';

  if (isSuperAdmin) {
    bustAllCache();
    console.log(`[cache/bust] ALL cache cleared by super admin ${user.username || user.email}`);
    return res.json({ ok: true, scope: 'all', stats: getCacheStats() });
  }

  // Dept admin: bust only their own dept
  const deptId = req.deptId || 'default';
  bustCache(deptId);
  console.log(`[cache/bust] dept=${deptId} cache cleared by ${user.username || user.email}`);
  res.json({ ok: true, scope: deptId, stats: getCacheStats() });
});

// ── POST /api/circuit/reset — force-close open circuit breakers ──────────────
// Useful when TFS recovers but the 60s cooldown hasn't elapsed yet.
router.post('/circuit/reset', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Authentication required' });

  const { resetAllCircuits, getCircuitStats } = require('../helpers/circuitBreaker');
  const user = req.session.user;
  resetAllCircuits();
  console.log(`[circuit/reset] All circuits reset by ${user.username || user.email}`);
  res.json({ ok: true, circuits: getCircuitStats() });
});

// ── POST /api/full-reset — bust cache + reset circuits in one shot ────────────
router.post('/full-reset', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Authentication required' });

  const { bustCache, bustAllCache, getCacheStats } = require('../helpers/responseCache');
  const { resetAllCircuits, getCircuitStats }      = require('../helpers/circuitBreaker');
  const user = req.session.user;
  const isSuperAdmin = user.isSuperAdmin || user.role === 'superadmin';

  resetAllCircuits();
  if (isSuperAdmin) {
    bustAllCache();
  } else {
    bustCache(req.deptId || 'default');
  }
  console.log(`[full-reset] Cache + circuits reset by ${user.username || user.email}`);
  res.json({ ok: true, scope: isSuperAdmin ? 'all' : (req.deptId || 'default'), cache: getCacheStats(), circuits: getCircuitStats() });
});

module.exports = router;
