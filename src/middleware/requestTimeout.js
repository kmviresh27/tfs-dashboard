'use strict';

/**
 * Incoming request timeout middleware.
 *
 * If a route handler hasn't sent a response within `timeoutMs`,
 * automatically responds with HTTP 503 Service Unavailable.
 *
 * This prevents browsers from hanging when TFS is unresponsive (30s timeout
 * × 3 retries = 90s without this middleware).
 *
 * Applied only to /api/* routes (static files and SPA are unaffected).
 * Skips health endpoints (they must always respond quickly).
 *
 * @param {number} timeoutMs  Default 35 000ms (35s — just above TFS 30s timeout)
 */
function requestTimeout(timeoutMs = 35_000) {
  return (req, res, next) => {
    // Health endpoints are exempt — they must never time out
    if (req.path === '/health' || req.path === '/health/ready') return next();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        console.warn(
          `[${new Date().toISOString()}] [WARN] [timeout] ${req.method} ${req.path}` +
          ` exceeded ${timeoutMs}ms — responding 503`
        );
        res.status(503).json({
          error: 'Request timed out. The data source may be temporarily unavailable.',
          path:  req.path,
        });
      }
    }, timeoutMs);

    // Clear the timer as soon as the response finishes
    res.on('finish', () => clearTimeout(timer));
    res.on('close',  () => clearTimeout(timer));

    next();
  };
}

module.exports = { requestTimeout };
