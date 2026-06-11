'use strict';
const express = require('express');
const fs      = require('fs');
const { getDepartments, saveDepartments, isValidDeptId, getDeptDir, getDeptDataFile } = require('../helpers/deptPaths');
const { loadConfig, saveConfig } = require('../config');
const { userKey, getUser, upsertUser, getAllUsers, getUsersForDept, addUserToDept, removeUserFromDept, setUserRole, setSuperAdmin } = require('../helpers/userStore');
const { requireDeptAdmin } = require('../middleware/auth');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ── Auth guard: only admins can manage departments ────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── GET /api/departments ──────────────────────────────────────────────────────
router.get('/departments', requireAdmin, (req, res) => {
  const depts = getDepartments();
  // Augment each entry with TFS org info from its config (if available)
  const augmented = depts.map(d => {
    try {
      const cfg = loadConfig(d.id);
      return { ...d, tfsOrg: cfg.tfs?.organization || '', tfsProject: cfg.tfs?.project || '', hasPat: !!(cfg.tfs?.pat) };
    } catch {
      return { ...d, tfsOrg: '', tfsProject: '', hasPat: false };
    }
  });
  res.json({ departments: augmented });
});

// ── GET /api/departments/:id ──────────────────────────────────────────────────
router.get('/departments/:id', requireAdmin, (req, res) => {
  const depts = getDepartments();
  const dept  = depts.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  try {
    const cfg = loadConfig(dept.id);
    return res.json({ ...dept, config: cfg });
  } catch {
    return res.json(dept);
  }
});

// ── POST /api/departments ─────────────────────────────────────────────────────
router.post('/departments', requireAdmin, (req, res) => {
  const { id, name, description, config: deptConfig } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' });
  if (!isValidDeptId(id)) return res.status(400).json({ error: 'Department ID must match ^[a-z0-9][a-z0-9-]{0,63}$' });

  const depts = getDepartments();
  if (depts.find(d => d.id === id)) return res.status(409).json({ error: `Department '${id}' already exists` });

  // Create folder + config
  const dir = getDeptDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(getDeptDataFile(id, 'snapshots'), { recursive: true });

  if (deptConfig) {
    saveConfig(deptConfig, id);
  } else {
    // Clone from default config as a starting point
    try {
      const defaultCfg = loadConfig('default');
      saveConfig({ ...defaultCfg, branding: { ...(defaultCfg.branding || {}), appName: name } }, id);
    } catch { /* no default — create minimal config */ }
  }

  const newDept = { id, name, description: description || '', createdAt: new Date().toISOString() };
  depts.push(newDept);
  saveDepartments(depts);

  res.status(201).json(newDept);
});

// ── PUT /api/departments/:id ──────────────────────────────────────────────────
router.put('/departments/:id', requireAdmin, (req, res) => {
  const depts = getDepartments();
  const idx   = depts.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Department not found' });

  const { name, description } = req.body || {};
  if (name) depts[idx].name = name;
  if (description !== undefined) depts[idx].description = description;
  depts[idx].updatedAt = new Date().toISOString();
  saveDepartments(depts);

  res.json(depts[idx]);
});

// ── DELETE /api/departments/:id ───────────────────────────────────────────────
router.delete('/departments/:id', requireAdmin, (req, res) => {
  if (req.params.id === 'default') return res.status(400).json({ error: 'Cannot delete the default department' });

  const depts  = getDepartments();
  const idx    = depts.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Department not found' });

  depts.splice(idx, 1);
  saveDepartments(depts);
  res.json({ ok: true });
});

// ── POST /api/departments/:id/test-connection ─────────────────────────────────
router.post('/departments/:id/test-connection', requireAdmin, async (req, res) => {
  try {
    const cfg = loadConfig(req.params.id);
    if (!cfg.tfs?.pat || !cfg.tfs?.baseUrl) return res.json({ ok: false, error: 'TFS URL or PAT not configured' });

    const org = cfg.tfs.organization;
    const collectionUrl = cfg.tfs.baseUrl.split('/' + org)[0] + '/' + org;
    const b64 = Buffer.from(':' + cfg.tfs.pat).toString('base64');

    const fetch = require('node-fetch');
    const r = await fetch(`${collectionUrl}/_apis/connectionData?api-version=1.0`, {
      headers: { Authorization: 'Basic ' + b64 },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.json({ ok: false, error: `TFS returned HTTP ${r.status}` });
    const d = await r.json();
    return res.json({ ok: true, user: d.authenticatedUser?.providerDisplayName || 'connected' });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

// ── GET /api/departments/:id/users ────────────────────────────────────────────
router.get('/departments/:id/users', requireAdmin, (req, res) => {
  const depts = getDepartments();
  if (!depts.find(d => d.id === req.params.id)) return res.status(404).json({ error: 'Department not found' });
  res.json({ users: getUsersForDept(req.params.id) });
});

// ── POST /api/departments/:id/users ───────────────────────────────────────────
// Add or update a user's membership in a department.
router.post('/departments/:id/users', requireAdmin, async (req, res) => {
  const depts = getDepartments();
  if (!depts.find(d => d.id === req.params.id)) return res.status(404).json({ error: 'Department not found' });

  const { key, displayName = '', email = '', role = 'all' } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required (e.g. tfs:domain\\user or aad:<oid>)' });
  const validRoles = ['admin', 'all', 'read'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });

  let existing = getUser(key);
  if (!existing) {
    await upsertUser(key, { displayName, email, isSuperAdmin: false, departments: [], createdAt: new Date().toISOString(), lastLogin: null });
  }
  await addUserToDept(key, req.params.id, role);
  res.status(201).json({ ok: true, key, deptId: req.params.id, role });
});

// ── PUT /api/departments/:id/users/:key ────────────────────────────────────────
// Change a user's role within a department.
router.put('/departments/:id/users/:key', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  const validRoles = ['admin', 'all', 'read'];
  if (!role || !validRoles.includes(role)) return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });

  const key = decodeURIComponent(req.params.key);
  if (!getUser(key)) return res.status(404).json({ error: 'User not found' });
  await setUserRole(key, req.params.id, role);
  res.json({ ok: true, key, deptId: req.params.id, role });
});

// ── DELETE /api/departments/:id/users/:key ─────────────────────────────────────
router.delete('/departments/:id/users/:key', requireAdmin, async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (!getUser(key)) return res.status(404).json({ error: 'User not found' });
  await removeUserFromDept(key, req.params.id);
  res.json({ ok: true });
});

// ── PUT /api/users/:key/superadmin ────────────────────────────────────────────
// Only super-admins can grant/revoke super-admin status.
router.put('/users/:key/superadmin', async (req, res) => {
  if (!req.user?.isSuperAdmin) return res.status(403).json({ error: 'Super-admin access required' });
  const key = decodeURIComponent(req.params.key);
  const { isSuperAdmin } = req.body || {};
  if (typeof isSuperAdmin !== 'boolean') return res.status(400).json({ error: 'isSuperAdmin (boolean) is required' });
  if (!getUser(key)) return res.status(404).json({ error: 'User not found' });
  await setSuperAdmin(key, isSuperAdmin);
  res.json({ ok: true, key, isSuperAdmin });
});

// ── GET /api/users ────────────────────────────────────────────────────────────
// Super-admin: list all users across all departments.
router.get('/users', (req, res) => {
  if (!req.user?.isSuperAdmin) return res.status(403).json({ error: 'Super-admin access required' });
  res.json({ users: getAllUsers() });
});

// ── GET /api/admin/summary ────────────────────────────────────────────────────
// Cross-department summary: dept count, user count per dept, last connection.
router.get('/admin/summary', requireAdmin, (req, res) => {
  const depts = getDepartments();
  const allUsers = getAllUsers();
  const userList = Object.entries(allUsers);

  const deptStats = depts.map(d => {
    const memberCount = userList.filter(([, u]) =>
      (u.departments || []).some(m => m.id === d.id)
    ).length;
    let tfsOrg = '', hasPat = false, lastConfigLoad = null;
    try {
      const cfg = loadConfig(d.id);
      tfsOrg = cfg.tfs?.organization || '';
      hasPat = !!(cfg.tfs?.pat);
      lastConfigLoad = cfg._loadedAt || null;
    } catch { /* dept may have no config */ }
    return { id: d.id, name: d.name, memberCount, tfsOrg, hasPat, lastConfigLoad };
  });

  res.json({
    deptCount: depts.length,
    totalUsers: userList.length,
    superAdminCount: userList.filter(([, u]) => u.isSuperAdmin).length,
    depts: deptStats,
  });
});

// ── POST /api/departments/:id/clone ───────────────────────────────────────────
// Clone a department's TFS config (URL, area path, PAT) into a new dept.
router.post('/departments/:id/clone', requireAdmin, (req, res) => {
  const { targetId, targetName } = req.body || {};
  if (!targetId || !targetName) return res.status(400).json({ error: 'targetId and targetName are required' });
  if (!isValidDeptId(targetId)) return res.status(400).json({ error: 'targetId must match ^[a-z0-9][a-z0-9-]{0,63}$' });

  const depts = getDepartments();
  if (!depts.find(d => d.id === req.params.id)) return res.status(404).json({ error: 'Source department not found' });
  if (depts.find(d => d.id === targetId)) return res.status(409).json({ error: `Department '${targetId}' already exists` });

  // Copy config
  let srcCfg = {};
  try { srcCfg = loadConfig(req.params.id); } catch { /* no config */ }

  const dir = getDeptDir(targetId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(getDeptDataFile(targetId, 'snapshots'), { recursive: true });

  const newCfg = { ...srcCfg, branding: { ...(srcCfg.branding || {}), appName: targetName } };
  saveConfig(newCfg, targetId);

  const newDept = { id: targetId, name: targetName, description: `Cloned from ${req.params.id}`, createdAt: new Date().toISOString() };
  depts.push(newDept);
  saveDepartments(depts);

  res.status(201).json(newDept);
});


// ════════════════════════════════════════════════════════════════════════════════
// Dept-admin routes — accessible to dept admins (not just super-admins)
// All mounted under /api/d/:deptId/* so req.deptId is always set.
// ════════════════════════════════════════════════════════════════════════════════

const VALID_ROLES = ['admin', 'all', 'exec', 'rte', 'pm', 'sm', 'read'];

// ── GET /api/d/:deptId/members ────────────────────────────────────────────────
router.get('/d/:deptId/members', requireDeptAdmin, (req, res) => {
  res.json({ users: getUsersForDept(req.deptId) });
});

// ── POST /api/d/:deptId/members ───────────────────────────────────────────────
router.post('/d/:deptId/members', requireDeptAdmin, async (req, res) => {
  const { key, displayName = '', email = '', role = 'read' } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required (e.g. tfs:user@domain.com)' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  // Dept admin cannot grant admin role unless they are super-admin
  if (role === 'admin' && !req.user?.isSuperAdmin && !req.user?.isAdmin) {
    return res.status(403).json({ error: 'Only super-admins can grant admin role' });
  }
  if (!getUser(key)) {
    await upsertUser(key, { displayName, email, isSuperAdmin: false, departments: [], createdAt: new Date().toISOString(), lastLogin: null });
  }
  await addUserToDept(key, req.deptId, role);
  res.status(201).json({ ok: true, key, deptId: req.deptId, role });
});

// ── PUT /api/d/:deptId/members/:key ──────────────────────────────────────────
router.put('/d/:deptId/members/:key', requireDeptAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (!role || !VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  if (role === 'admin' && !req.user?.isSuperAdmin && !req.user?.isAdmin) {
    return res.status(403).json({ error: 'Only super-admins can grant admin role' });
  }
  const key = decodeURIComponent(req.params.key);
  if (!getUser(key)) return res.status(404).json({ error: 'User not found' });
  await setUserRole(key, req.deptId, role);
  res.json({ ok: true, key, deptId: req.deptId, role });
});

// ── DELETE /api/d/:deptId/members/:key ───────────────────────────────────────
router.delete('/d/:deptId/members/:key', requireDeptAdmin, async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (!getUser(key)) return res.status(404).json({ error: 'User not found' });
  // Cannot remove yourself
  if (req.user?.authKey === key) return res.status(400).json({ error: 'Cannot remove yourself' });
  await removeUserFromDept(key, req.deptId);
  res.json({ ok: true });
});

// ── GET /api/d/:deptId/policies ───────────────────────────────────────────────
// Returns the configurable business-rule policies for a department.
router.get('/d/:deptId/policies', requireDeptAdmin, (req, res) => {
  const cfg = loadConfig(req.deptId);
  const fm  = getFieldMappings(cfg);
  res.json({
    ragThresholds:    cfg.ragThresholds    || {},
    defectEscapeRatio: cfg.defectEscapeRatio || {},
    piStructure:      fm.piStructure,
    stateValues:      fm.stateValues,
    fieldMappings:    {
      fields:        fm.fields,
      workItemTypes: fm.workItemTypes,
    },
  });
});

// ── PUT /api/d/:deptId/policies ───────────────────────────────────────────────
// Update configurable policies. Dept admins can update thresholds, sprint config, state values.
router.put('/d/:deptId/policies', requireDeptAdmin, (req, res) => {
  const { ragThresholds, defectEscapeRatio, piStructure, stateValues } = req.body || {};
  const cfg = loadConfig(req.deptId);

  if (ragThresholds)     cfg.ragThresholds     = { ...(cfg.ragThresholds || {}),     ...ragThresholds };
  if (defectEscapeRatio) cfg.defectEscapeRatio  = { ...(cfg.defectEscapeRatio || {}), ...defectEscapeRatio };
  if (piStructure) {
    cfg.fieldMappings = cfg.fieldMappings || {};
    cfg.fieldMappings.piStructure = { ...(cfg.fieldMappings?.piStructure || {}), ...piStructure };
  }
  if (stateValues) {
    cfg.fieldMappings = cfg.fieldMappings || {};
    cfg.fieldMappings.stateValues = { ...(cfg.fieldMappings?.stateValues || {}), ...stateValues };
  }

  saveConfig(cfg, req.deptId);
  res.json({ ok: true });
});

module.exports = router;