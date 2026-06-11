'use strict';

/**
 * Request context propagation using AsyncLocalStorage.
 *
 * Stores per-request context (route, user, deptId, reqId) so tfsClient can
 * read it when logging slow queries — without needing to thread it through
 * every function call.
 *
 * Usage:
 *   Middleware: requestContext.run({ route, user, deptId, reqId }, next)
 *   Anywhere:  requestContext.get()  → { route, user, deptId, reqId } | null
 */

const { AsyncLocalStorage } = require('async_hooks');

const _store = new AsyncLocalStorage();

/**
 * Express middleware — wraps the request execution in an ALS context.
 * Must run AFTER deptIdMiddleware and requireAuth so user/deptId are known.
 */
function requestContextMiddleware(req, _res, next) {
  const user = req.session?.user;
  _store.run({
    route:  req.path,
    method: req.method,
    deptId: req.deptId || 'default',
    reqId:  req.reqId  || '',
    user:   user ? (user.displayName || user.key || user.id || 'unknown') : 'anonymous',
  }, next);
}

/** Get current request context (or null outside a request). */
function getRequestContext() {
  return _store.getStore() || null;
}

module.exports = { requestContextMiddleware, getRequestContext };
