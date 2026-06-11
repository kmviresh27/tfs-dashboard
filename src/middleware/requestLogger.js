'use strict';

const { randomUUID } = require('crypto');

/**
 * Structured request logger middleware.
 * Logs: [ISO timestamp] [LEVEL] [reqId] METHOD /path [deptId] → STATUS Xms [cache:HIT|MISS]
 * Also sets X-Request-ID response header for client-side tracing.
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const reqId = req.headers['x-request-id'] || randomUUID().slice(0, 8);
  req.reqId   = reqId;
  res.set('X-Request-ID', reqId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const dept     = req.deptId && req.deptId !== 'default' ? ` [${req.deptId}]` : '';
    const cacheVal = res.getHeader('X-Cache');
    const cache    = cacheVal ? ` cache:${cacheVal}` : '';
    const level    = res.statusCode >= 500 ? 'ERROR'
                   : res.statusCode >= 400 ? 'WARN'
                   : 'INFO';

    console.log(
      `[${new Date().toISOString()}] [${level}] [${reqId}] ${req.method} ${req.path}${dept}` +
      ` → ${res.statusCode} ${duration}ms${cache}`
    );
  });

  next();
}

module.exports = { requestLogger };
