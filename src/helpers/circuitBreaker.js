'use strict';

/**
 * TFS Circuit Breaker
 *
 * Prevents cascading failures when TFS is down:
 * - CLOSED: normal operation, requests pass through
 * - OPEN: TFS is down, requests rejected immediately with 503 (no 30s waits)
 * - HALF-OPEN: after cooldown, one probe request allowed to test recovery
 *
 * One circuit per TFS base URL (so ADO and on-prem TFS are independent).
 *
 * Thresholds (configurable):
 *   failureThreshold: open after N consecutive failures (default 5)
 *   cooldownMs:       wait before half-open probe (default 60s)
 *   successThreshold: close after N consecutive successes in half-open (default 2)
 */

const FAILURE_THRESHOLD  = 5;
const COOLDOWN_MS        = 60 * 1000;  // 60 seconds
const SUCCESS_THRESHOLD  = 2;

const _circuits = new Map(); // baseUrl → CircuitState

function _getCircuit(baseUrl) {
  if (!_circuits.has(baseUrl)) {
    _circuits.set(baseUrl, {
      state:           'CLOSED',   // CLOSED | OPEN | HALF_OPEN
      failures:        0,
      successes:       0,
      openedAt:        null,
      lastFailureMsg:  null,
    });
  }
  return _circuits.get(baseUrl);
}

function _isOpen(circuit) {
  if (circuit.state === 'CLOSED') return false;
  if (circuit.state === 'OPEN') {
    // Check if cooldown has elapsed → transition to HALF_OPEN
    if (Date.now() - circuit.openedAt >= COOLDOWN_MS) {
      circuit.state    = 'HALF_OPEN';
      circuit.successes = 0;
      console.warn(`[circuit] ${circuit._url} → HALF_OPEN (probing after cooldown)`);
      return false; // allow one probe through
    }
    return true; // still open
  }
  return false; // HALF_OPEN allows requests
}

/**
 * Record a successful TFS call.
 */
function recordSuccess(baseUrl) {
  const c = _getCircuit(baseUrl);
  c._url = baseUrl;
  c.failures = 0;
  if (c.state === 'HALF_OPEN') {
    c.successes++;
    if (c.successes >= SUCCESS_THRESHOLD) {
      c.state    = 'CLOSED';
      c.openedAt = null;
      console.log(`[circuit] ${baseUrl} → CLOSED (recovered)`);
    }
  }
}

/**
 * Record a failed TFS call.
 */
function recordFailure(baseUrl, err) {
  const c = _getCircuit(baseUrl);
  c._url  = baseUrl;
  c.failures++;
  c.lastFailureMsg = err?.message?.slice(0, 120) || String(err);

  if (c.state === 'HALF_OPEN') {
    // Probe failed — back to OPEN
    c.state    = 'OPEN';
    c.openedAt = Date.now();
    c.successes = 0;
    console.warn(`[circuit] ${baseUrl} → OPEN (probe failed: ${c.lastFailureMsg})`);
  } else if (c.state === 'CLOSED' && c.failures >= FAILURE_THRESHOLD) {
    c.state    = 'OPEN';
    c.openedAt = Date.now();
    console.warn(`[circuit] ${baseUrl} → OPEN after ${c.failures} failures (${c.lastFailureMsg})`);
  }
}

/**
 * Check if requests to a base URL should be rejected.
 * Returns true if the circuit is OPEN (TFS is down).
 */
function isCircuitOpen(baseUrl) {
  const c = _getCircuit(baseUrl);
  c._url  = baseUrl;
  return _isOpen(c);
}

/**
 * Get circuit status for all tracked URLs (used by health endpoint).
 */
function getCircuitStats() {
  const result = {};
  for (const [url, c] of _circuits) {
    result[url] = {
      state:          c.state,
      failures:       c.failures,
      openedAt:       c.openedAt ? new Date(c.openedAt).toISOString() : null,
      cooldownRemaining: c.state === 'OPEN'
        ? Math.max(0, Math.round((COOLDOWN_MS - (Date.now() - c.openedAt)) / 1000)) + 's'
        : null,
      lastFailure:    c.lastFailureMsg,
    };
  }
  return result;
}

/**
 * Force-close a circuit (admin recovery action).
 * Use when TFS is back but the cooldown hasn't elapsed yet.
 */
function resetCircuit(baseUrl) {
  const c = _getCircuit(baseUrl);
  c.state    = 'CLOSED';
  c.failures = 0;
  c.successes = 0;
  c.openedAt = null;
  c.lastFailureMsg = null;
  console.log(`[circuit] ${baseUrl} → CLOSED (manual reset)`);
}

/** Force-close ALL circuits. */
function resetAllCircuits() {
  for (const [url] of _circuits) resetCircuit(url);
}

module.exports = { isCircuitOpen, recordSuccess, recordFailure, getCircuitStats, resetCircuit, resetAllCircuits };
