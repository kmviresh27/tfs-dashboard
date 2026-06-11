'use strict';
const path = require('path');
const fs   = require('fs');

/** Legacy root-level config.json (still used as fallback for 'default' dept) */
const CFG_PATH = path.join(__dirname, '..', 'config.json');

const { getDeptDataFile, getDeptDir } = require('./helpers/deptPaths');

/** Sensible defaults applied to every dept config so missing fields never produce `undefined` */
const TFS_DEFAULTS = {
  apiVersion:    '5.0',
  areaPath:      '',
  iterationPath: '',
  teamRootPath:  '',
  organization:  '',
  project:       '',
};

function _applyDefaults(cfg) {
  if (!cfg.tfs) cfg.tfs = {};
  cfg.tfs = { ...TFS_DEFAULTS, ...cfg.tfs };
  return cfg;
}

// ── Write-through in-memory cache ─────────────────────────────────────────────
// Primary invalidation: saveConfig() deletes the entry.
// Secondary safety net: mtime check catches out-of-band file edits.
const _configCache = new Map(); // deptId → { cfg, mtime }

function _resolveConfigPath(deptId) {
  const deptPath = getDeptDataFile(deptId, 'config.json');
  if (fs.existsSync(deptPath)) return deptPath;
  if (deptId === 'default' && fs.existsSync(CFG_PATH)) return CFG_PATH;
  return null;
}

/**
 * Load config for a department.
 * Resolution order:
 *   1. data/departments/{deptId}/config.json  (multi-tenant path)
 *   2. config.json at project root            (legacy fallback — only for 'default')
 *
 * Cached in memory. Invalidated on saveConfig() and when mtime changes on disk.
 */
function loadConfig(deptId = 'default') {
  const targetPath = _resolveConfigPath(deptId);
  if (!targetPath) throw new Error(`Config not found for department: ${deptId}`);

  try {
    const mtime  = fs.statSync(targetPath).mtimeMs;
    const cached = _configCache.get(deptId);
    if (cached && cached.mtime === mtime) return cached.cfg;

    const cfg = _applyDefaults(JSON.parse(fs.readFileSync(targetPath, 'utf8')));
    _configCache.set(deptId, { cfg, mtime });
    return cfg;
  } catch {
    // Fallback: uncached read (e.g. stat fails during a concurrent write)
    return _applyDefaults(JSON.parse(fs.readFileSync(targetPath, 'utf8')));
  }
}

/**
 * Save config for a department.
 */
function saveConfig(cfg, deptId = 'default') {
  const dir = getDeptDir(deptId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getDeptDataFile(deptId, 'config.json'), JSON.stringify(cfg, null, 2));
  _configCache.delete(deptId); // write-through invalidation
}

module.exports = { loadConfig, saveConfig, CFG_PATH };
