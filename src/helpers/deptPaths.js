'use strict';
const path = require('path');
const fs   = require('fs');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const DEPT_DIR  = path.join(DATA_ROOT, 'departments');
const REGISTRY  = path.join(DATA_ROOT, 'departments.json');

/** Validate a department ID — must be a simple slug */
const DEPT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function isValidDeptId(id) {
  return typeof id === 'string' && DEPT_ID_RE.test(id);
}

/** Absolute path to a department's data folder */
function getDeptDir(deptId) {
  if (!isValidDeptId(deptId || 'default')) throw new Error(`Invalid dept ID: ${deptId}`);
  const resolved = path.join(DEPT_DIR, deptId || 'default');
  // Guard against path traversal
  if (!resolved.startsWith(DEPT_DIR + path.sep) && resolved !== DEPT_DIR) {
    throw new Error(`Path traversal attempt for dept ID: ${deptId}`);
  }
  return resolved;
}

/** Absolute path to a named data file inside a department's folder */
function getDeptDataFile(deptId, filename) {
  return path.join(getDeptDir(deptId), filename);
}

/** Absolute path to a department's snapshots sub-folder */
function getSnapshotsDir(deptId) {
  return path.join(getDeptDir(deptId), 'snapshots');
}

/** Read the department registry from disk. Returns [] on error. */
function getDepartments() {
  try {
    if (fs.existsSync(REGISTRY)) return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  } catch { /* ignore */ }
  return [];
}

/** Write the department registry to disk. */
function saveDepartments(depts) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(depts, null, 2));
}

module.exports = {
  DATA_ROOT, DEPT_DIR, REGISTRY,
  isValidDeptId, getDeptDir, getDeptDataFile, getSnapshotsDir,
  getDepartments, saveDepartments,
};
