'use strict';
/**
 * Auto-migration: runs on first server start after multi-tenant upgrade.
 *
 * Step 1 — Department data (gated on departments.json absence):
 *   1. Creates data/departments/default/
 *   2. Copies the root config.json  →  data/departments/default/config.json
 *   3. Copies data/annotations.json, data/retro-actions.json
 *   4. Copies snapshots/*.json      →  data/departments/default/snapshots/
 *   5. Writes data/departments.json registry with a single "default" entry
 *
 * Step 2 — User registry (gated on users.json absence):
 *   Reads default dept config → creates data/users.json from tfsAuth.adminUsers
 *   and tfsAuth.userRoles. First admin user gets isSuperAdmin: true.
 *   Azure AD deployments start with an empty registry (users are created on first login).
 *
 * Both steps are idempotent — each is skipped if its gate file already exists.
 */

const path = require('path');
const fs   = require('fs');

const { getDeptDir, getDeptDataFile, getSnapshotsDir, saveDepartments, REGISTRY } = require('./deptPaths');

const PROJECT_ROOT    = path.join(__dirname, '..', '..');
const LEGACY_CFG      = path.join(PROJECT_ROOT, 'config.json');
const LEGACY_DATA     = path.join(PROJECT_ROOT, 'data');
const LEGACY_SNAPS    = path.join(PROJECT_ROOT, 'snapshots');
const USERS_STORE     = path.join(LEGACY_DATA, 'users.json');

function copyIfMissing(src, dest) {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  [migration] copied ${path.relative(PROJECT_ROOT, src)} → ${path.relative(PROJECT_ROOT, dest)}`);
  }
}

// ── Step 1: Department data layout ───────────────────────────────────────────
function migrateDepartments() {
  if (fs.existsSync(REGISTRY)) return; // already done

  console.log('\n[migration] First start — migrating to multi-tenant data layout...');

  const defaultDir   = getDeptDir('default');
  const snapshotsDst = getSnapshotsDir('default');
  fs.mkdirSync(defaultDir,   { recursive: true });
  fs.mkdirSync(snapshotsDst, { recursive: true });

  copyIfMissing(LEGACY_CFG, getDeptDataFile('default', 'config.json'));
  copyIfMissing(path.join(LEGACY_DATA, 'annotations.json'),   getDeptDataFile('default', 'annotations.json'));
  copyIfMissing(path.join(LEGACY_DATA, 'retro-actions.json'), getDeptDataFile('default', 'retro-actions.json'));

  if (fs.existsSync(LEGACY_SNAPS)) {
    for (const f of fs.readdirSync(LEGACY_SNAPS).filter(f => f.endsWith('.json'))) {
      copyIfMissing(path.join(LEGACY_SNAPS, f), path.join(snapshotsDst, f));
    }
  }

  saveDepartments([{
    id:          'default',
    name:        'Default',
    description: 'Auto-migrated from single-tenant deployment',
    createdAt:   new Date().toISOString(),
  }]);

  console.log('[migration] Department migration done.\n');
}

// ── Step 2: User registry ─────────────────────────────────────────────────────
function migrateUsers() {
  if (fs.existsSync(USERS_STORE)) return; // already done

  // Read default dept config to extract known users
  let cfg = {};
  const deptCfg = getDeptDataFile('default', 'config.json');
  try {
    cfg = JSON.parse(fs.readFileSync(fs.existsSync(deptCfg) ? deptCfg : LEGACY_CFG, 'utf8'));
  } catch { /* no config yet — skip */ return; }

  if (!cfg.tfsAuth?.enabled) return; // Azure AD mode: no static users to seed

  const tfsAuth    = cfg.tfsAuth;
  const adminUsers = Array.isArray(tfsAuth.adminUsers) ? tfsAuth.adminUsers : [];
  const userRoles  = tfsAuth.userRoles && typeof tfsAuth.userRoles === 'object' ? tfsAuth.userRoles : {};

  const store = {};
  const now   = new Date().toISOString();

  // Seed admin users
  adminUsers.forEach((uname, idx) => {
    const k = `tfs:${uname.toLowerCase()}`;
    store[k] = {
      displayName:  uname,
      email:        '',
      isSuperAdmin: idx === 0, // first configured admin becomes the super admin
      departments:  [{ id: 'default', role: 'admin' }],
      createdAt:    now,
      lastLogin:    null,
    };
  });

  // Seed users from userRoles (may overlap with adminUsers)
  Object.entries(userRoles).forEach(([uname, role]) => {
    const k = `tfs:${uname.toLowerCase()}`;
    if (!store[k]) {
      store[k] = {
        displayName:  uname,
        email:        '',
        isSuperAdmin: false,
        departments:  [{ id: 'default', role }],
        createdAt:    now,
        lastLogin:    null,
      };
    } else {
      // Ensure role is set (admin users already have 'admin')
      const dept = store[k].departments.find(d => d.id === 'default');
      if (dept && dept.role !== 'admin') dept.role = role;
    }
  });

  fs.mkdirSync(path.dirname(USERS_STORE), { recursive: true });
  fs.writeFileSync(USERS_STORE, JSON.stringify(store, null, 2), 'utf8');
  console.log(`[migration] User registry created with ${Object.keys(store).length} user(s).\n`);
}

function runMigration() {
  migrateDepartments();
  migrateUsers();
}

module.exports = { runMigration };
