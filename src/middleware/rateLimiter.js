'use strict';

/**
 * In-process sliding-window rate limiter.
 *
 * No external dependencies. Safe for single-process deployments only.
 * For multi-process (PM2 cluster), replace with a shared store (Redis, etc.).
 *
 * Default: 200 requests / 60 seconds per client IP.
 */

const _windows = new Map(); // ip → { count, resetAt }

function rateLimiter({ maxRequests = 200, windowMs = 60 * 1000 } = {}) {
  // Periodic GC to prevent memory leak from idle IPs
  const gcInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of _windows) {
      if (entry.resetAt < now) _windows.delete(ip);
    }
  }, windowMs);
  // Don't hold the process open just for GC
  if (gcInterval.unref) gcInterval.unref();

  return (req, res, next) => {
    const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = _windows.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      _windows.set(ip, entry);
    }
    entry.count++;

    res.set('X-RateLimit-Limit',     String(maxRequests));
    res.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    res.set('X-RateLimit-Reset',     new Date(entry.resetAt).toISOString());

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }

    next();
  };
}

module.exports = { rateLimiter };
