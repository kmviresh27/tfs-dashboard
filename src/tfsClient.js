'use strict';
const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const { isCircuitOpen, recordSuccess, recordFailure } = require('./helpers/circuitBreaker');
const { getRequestContext } = require('./helpers/requestContext');

const FETCH_TIMEOUT_MS = 30000;
const SLOW_QUERY_MS    = 10000; // warn when any TFS call exceeds 10s

// ── Slow query ring buffer — persisted to disk so it survives restarts ────────
const SLOW_QUERY_MAX  = 50;
const SLOW_QUERY_FILE = path.join(__dirname, '..', 'logs', 'slow-queries.ndjson');

// Load last SLOW_QUERY_MAX entries from the persisted file on startup
const _slowQueries = (() => {
  try {
    if (!fs.existsSync(SLOW_QUERY_FILE)) return [];
    const lines = fs.readFileSync(SLOW_QUERY_FILE, 'utf8')
      .split('\n').filter(Boolean);
    return lines.slice(-SLOW_QUERY_MAX).map(l => JSON.parse(l));
  } catch { return []; }
})();

// Append one entry to the NDJSON log file (non-blocking)
function _persistSlowQuery(entry) {
  fs.appendFile(SLOW_QUERY_FILE, JSON.stringify(entry) + '\n', () => {});
  // Trim the file when it grows beyond 10× the ring buffer size
  // (do this async and only occasionally to avoid hammering disk)
  if (_slowQueries.length % 25 === 0) {
    setImmediate(() => {
      try {
        const lines = fs.readFileSync(SLOW_QUERY_FILE, 'utf8')
          .split('\n').filter(Boolean);
        if (lines.length > SLOW_QUERY_MAX * 10) {
          fs.writeFileSync(SLOW_QUERY_FILE, lines.slice(-SLOW_QUERY_MAX * 5).join('\n') + '\n');
        }
      } catch { /* non-fatal */ }
    });
  }
}

function _recordSlowQuery(method, url, ms, label, wiqlQuery) {
  const ctx = getRequestContext();
  const entry = {
    method,
    tfsUrl:    url,
    apiRoute:  ctx ? `${ctx.method} ${ctx.route}` : '—',
    user:      ctx?.user   || '—',
    deptId:    ctx?.deptId || '—',
    reqId:     ctx?.reqId  || '—',
    label:     label || null,
    wiqlQuery: wiqlQuery || null,
    ms,
    at:        new Date().toISOString(),
  };
  _slowQueries.push(entry);
  if (_slowQueries.length > SLOW_QUERY_MAX) _slowQueries.shift();
  _persistSlowQuery(entry);
}
function getSlowQueryLog() { return [..._slowQueries]; }

/** Extract WHERE clause excerpt from a WIQL body for the table label. */
function _wiqlLabel(body) {
  const q = (typeof body === 'object' && body !== null) ? (body.query || '') : '';
  if (!q) return null;
  const whereIdx = q.search(/\bWHERE\b/i);
  const excerpt  = whereIdx >= 0 ? q.slice(whereIdx, whereIdx + 200) : q.slice(0, 200);
  return excerpt.replace(/\s+/g, ' ').trim().slice(0, 150);
}

// Status codes that are transient and worth retrying
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
// Network error names/messages that indicate transient failures
const RETRY_ERR_NAMES = new Set(['AbortError', 'FetchError']);
const RETRY_ERR_MSGS  = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'socket hang up'];

function authHeader(pat) {
  return 'Basic ' + Buffer.from(':' + pat).toString('base64');
}

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/** Extract the base URL (origin) from a full TFS URL for circuit breaker keying. */
function _baseUrl(url) {
  try { return new URL(url).origin; } catch { return url.slice(0, 40); }
}

/**
 * Retry wrapper with exponential backoff + jitter.
 * Only retries on transient failures (429/502/503/504 and network errors).
 * Never retries 4xx client errors (bad WIQL, unknown fields, auth failures).
 *
 * @param {Function} fn        Async function to call
 * @param {number}   maxRetries Default 2 (3 total attempts)
 * @param {number}   baseMs    Base delay in ms (doubled each attempt + jitter)
 */
async function withRetry(fn, maxRetries = 2, baseMs = 500) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Parse HTTP status from error message: "TFS GET/POST ... → 503: ..."
      const statusMatch = err.message.match(/→ (\d{3}):/);
      const status = statusMatch ? Number(statusMatch[1]) : null;

      const isRetryable = (status && RETRY_STATUSES.has(status))
        || RETRY_ERR_NAMES.has(err.name)
        || RETRY_ERR_MSGS.some(m => err.message.includes(m));

      if (!isRetryable || attempt >= maxRetries) throw err;

      // Exponential backoff + jitter to avoid thundering herd
      const delay = baseMs * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(
        `[tfsClient] retry ${attempt + 1}/${maxRetries}` +
        ` after ${Math.round(delay)}ms (${err.message.slice(0, 80)})`
      );
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function tfsGet(url, pat) {
  const origin = _baseUrl(url);
  if (isCircuitOpen(origin)) {
    throw new Error(`Circuit open for ${origin} — TFS is temporarily unavailable`);
  }
  const t = Date.now();
  try {
    const result = await withRetry(() => _tfsGet(url, pat));
    const elapsed = Date.now() - t;
    if (elapsed > SLOW_QUERY_MS) {
      console.warn(`[tfsClient] SLOW GET ${elapsed}ms ${url.slice(-80)}`);
      _recordSlowQuery('GET', url, elapsed, null, null);
    }
    recordSuccess(origin);
    return result;
  } catch (err) {
    recordFailure(origin, err);
    throw err;
  }
}

async function tfsPost(url, body, pat) {
  const origin = _baseUrl(url);
  if (isCircuitOpen(origin)) {
    // For WIQL queries in circuit-open state, return empty rather than crashing
    if (url.includes('/_apis/wit/wiql')) return { workItems: [] };
    throw new Error(`Circuit open for ${origin} — TFS is temporarily unavailable`);
  }
  const t = Date.now();
  try {
    const result = await withRetry(() => _tfsPost(url, body, pat));
    const elapsed = Date.now() - t;
    if (elapsed > SLOW_QUERY_MS) {
      const isWiql  = url.includes('/_apis/wit/wiql');
      const label   = isWiql ? _wiqlLabel(body) : null;
      const fullQ   = isWiql && typeof body?.query === 'string' ? body.query : null;
      console.warn(`[tfsClient] SLOW POST ${elapsed}ms ${url.split('?')[0].slice(-80)}${label ? ` | ${label.slice(0, 80)}` : ''}`);
      _recordSlowQuery('WIQL', url, elapsed, label, fullQ);
    }
    recordSuccess(origin);
    return result;
  } catch (err) {
    recordFailure(origin, err);
    throw err;
  }
}

async function _tfsGet(url, pat) {
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: authHeader(pat), 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TFS GET ${url} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function _tfsPost(url, body, pat) {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: authHeader(pat), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    // For WIQL queries, gracefully handle "iteration/area path does not exist" (TF51011).
    // Return empty result set instead of crashing — the PI simply doesn't exist in this project.
    if (res.status === 400 && url.includes('/_apis/wit/wiql') &&
        (text.includes('TF51011') || text.includes('iteration path') || text.includes('area path'))) {
      console.warn(`[tfsPost] Path not found (TF51011), returning empty: ${url.split('?')[0].slice(-60)}`);
      return { workItems: [] };
    }
    throw new Error(`TFS POST ${url} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Like tfsPost but returns { workItems: [] } instead of throwing when the
 * iteration/area path doesn't exist (TF51011 / HTTP 400).
 * Use for WIQL queries that reference PIs that may not exist in this project.
 */
async function tfsPostWiql(url, body, pat) {
  try {
    return await tfsPost(url, body, pat);
  } catch (e) {
    if (e.message.includes('→ 400') && (e.message.includes('TF51011') || e.message.includes('iteration path') || e.message.includes('area path'))) {
      return { workItems: [] };
    }
    throw e;
  }
}

async function fetchWorkItemDetails(ids, fields, cfg) {
  if (!ids.length) return [];
  const url = `${cfg.tfs.baseUrl}/_apis/wit/workitemsbatch?api-version=${cfg.tfs.apiVersion}`;
  let activeFields = [...new Set(fields.filter(Boolean))];

  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));

  // Fast path: fire all batches concurrently (use internal _tfsPost to avoid double-retry)
  try {
    const results = await Promise.all(
      chunks.map(chunk =>
        withRetry(() => _tfsPost(url, { ids: chunk, fields: activeFields }, cfg.tfs.pat))
          .then(d => d.value || [])
      )
    );
    return results.flat();
  } catch (firstErr) {
    // Slow path: serial with field-stripping retry (handles unknown-field 400s)
    console.warn('[fetchWorkItemDetails] concurrent fetch failed, falling back to serial:', firstErr.message.slice(0, 80));
    const all = [];
    for (const chunk of chunks) {
      let done = false;
      while (!done) {
        try {
          const data = await _tfsPost(url, { ids: chunk, fields: activeFields }, cfg.tfs.pat);
          all.push(...(data.value || []));
          done = true;
        } catch (err) {
          const match = err.message.match(/Cannot find field ([A-Za-z0-9_.]+)/);
          if (match && err.message.includes('400')) {
            const badField = match[1].trim().replace(/\.$/, '');
            console.warn(`[fetchWorkItemDetails] Stripping unknown field '${badField}', retrying...`);
            activeFields = activeFields.filter(f => f !== badField && !f.endsWith(badField));
            if (!activeFields.length) throw new Error('No valid fields remaining after stripping unknown TFS fields');
          } else {
            throw err;
          }
        }
      }
    }
    return all;
  }
}

module.exports = { authHeader, fetchWithTimeout, tfsGet, tfsPost, tfsPostWiql, fetchWorkItemDetails, getSlowQueryLog, FETCH_TIMEOUT_MS };
