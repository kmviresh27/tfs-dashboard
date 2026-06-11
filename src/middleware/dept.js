'use strict';
const { getDepartments, isValidDeptId } = require('../helpers/deptPaths');

/**
 * deptIdMiddleware
 *
 * Runs for ALL /api/* requests — sets req.deptId based on URL path, then session.
 *
 * - /api/d/:deptId/*  →  req.deptId = deptId (validated against registry)
 * - /api/*            →  req.deptId = session user's activeDeptId (or 'default')
 */
function deptIdMiddleware(req, res, next) {
  const m = req.path.match(/^\/d\/([^/]+)/);
  if (m) {
    // Explicit dept-scoped URL
    const deptId = m[1];
    if (!isValidDeptId(deptId)) {
      return res.status(400).json({ error: 'Invalid department ID format' });
    }
    const depts = getDepartments();
    if (!depts.find(d => d.id === deptId)) {
      return res.status(404).json({ error: `Department not found: ${deptId}` });
    }
    req.deptId = deptId;
  } else {
    // Legacy /api/* — use the session user's active dept so non-default users
    // automatically get their department's TFS config without URL changes.
    const sessionDeptId = req.session?.user?.activeDeptId;
    req.deptId = (sessionDeptId && isValidDeptId(sessionDeptId))
      ? sessionDeptId
      : 'default';
  }
  next();
}

module.exports = { deptIdMiddleware };
