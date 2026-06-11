'use strict';

/**
 * Structured logger helper.
 * Format: [ISO timestamp] [LEVEL] [route] [deptId?] message
 *
 * Usage:
 *   const log = require('../helpers/logger');
 *   log.error('[dashboard]', req.deptId, 'TFS call failed', err);
 *   log.warn('[cycleTime]', 'default', 'No cycle time data');
 *   log.info('[scheduler]', null, 'Digest sent successfully');
 */

function _log(level, route, deptId, message, err) {
  const ts   = new Date().toISOString();
  const dept = deptId && deptId !== 'default' ? ` [${deptId}]` : '';
  const line = `[${ts}] [${level}] ${route}${dept} ${message}`;

  if (err) {
    const detail = err instanceof Error ? (err.stack || err.message) : String(err);
    if (level === 'ERROR') console.error(line, detail);
    else if (level === 'WARN') console.warn(line, detail);
    else console.log(line, detail);
  } else {
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }
}

module.exports = {
  error: (route, deptId, msg, err) => _log('ERROR', route, deptId, msg, err),
  warn:  (route, deptId, msg, err) => _log('WARN',  route, deptId, msg, err),
  info:  (route, deptId, msg, err) => _log('INFO',  route, deptId, msg, err),
  debug: (route, deptId, msg, err) => _log('DEBUG', route, deptId, msg, err),
};
