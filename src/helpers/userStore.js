'use strict';
/**
 * userStore.js — Global user registry for multi-tenant access control.
 *
 * File: data/users.json
 * Keys are provider-qualified: "tfs:domain\account" or "aad:<oid>"
 *
 * Schema per entry:
 * {
 *   displayName: string,
 *   email: string,
 *   isSuperAdmin: boolean,
 *   departments: [{ id: string, role: string }],
 *   createdAt: ISO string,
 *   lastLogin: ISO string | null
 * }
 */
const fs   = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/users.json');

// ── In-process write queue — prevents lost-update races in single Node process ─
let _writeChain = Promise.resolve();

function _load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function _saveAtomic(data) {
  const tmp = STORE_PATH + '.tmp';
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

function _queueWrite(fn) {
  _writeChain = _writeChain.then(fn).catch(err => console.error('[userStore] write error:', err));
  return _writeChain;
}

// ── Public key builder ────────────────────────────────────────────────────────
/**
 * Build the canonical storage key.
 * @param {'tfs'|'aad'|'setup'} authMode
 * @param {string} identifier  — domain\account for TFS, oid for AAD
 */
function userKey(authMode, identifier) {
  return `${authMode}:${(identifier || '').toLowerCase()}`;
}

// ── Read helpers ──────────────────────────────────────────────────────────────
function getUser(key) {
  if (!key) return null;
  const store = _load();
  return store[key.toLowerCase()] || null;
}

function getAllUsers() {
  const store = _load();
  return Object.entries(store).map(([key, val]) => ({ key, ...val }));
}

function getUsersForDept(deptId) {
  const store = _load();
  return Object.entries(store)
    .filter(([, val]) => (val.departments || []).some(d => d.id === deptId))
    .map(([key, val]) => ({
      key,
      displayName:  val.displayName  || '',
      email:        val.email        || '',
      isSuperAdmin: val.isSuperAdmin || false,
      role:         (val.departments || []).find(d => d.id === deptId)?.role || 'all',
      lastLogin:    val.lastLogin    || null,
    }));
}

// ── Write helpers (all queued + atomic) ───────────────────────────────────────
function upsertUser(key, data) {
  return _queueWrite(() => {
    const store = _load();
    const k = key.toLowerCase();
    store[k] = { ...(store[k] || {}), ...data };
    _saveAtomic(store);
  });
}

function addUserToDept(key, deptId, role = 'all') {
  return _queueWrite(() => {
    const store = _load();
    const k = key.toLowerCase();
    if (!store[k]) {
      store[k] = { isSuperAdmin: false, departments: [], createdAt: new Date().toISOString() };
    }
    const depts = store[k].departments || [];
    const idx = depts.findIndex(d => d.id === deptId);
    if (idx === -1) depts.push({ id: deptId, role });
    else depts[idx].role = role;
    store[k].departments = depts;
    _saveAtomic(store);
  });
}

function removeUserFromDept(key, deptId) {
  return _queueWrite(() => {
    const store = _load();
    const k = key.toLowerCase();
    if (!store[k]) return;
    store[k].departments = (store[k].departments || []).filter(d => d.id !== deptId);
    _saveAtomic(store);
  });
}

function setUserRole(key, deptId, role) {
  return addUserToDept(key, deptId, role);
}

/** Only callable by routes that already verify the requester is isSuperAdmin */
function setSuperAdmin(key, isSuperAdmin) {
  return _queueWrite(() => {
    const store = _load();
    const k = key.toLowerCase();
    if (!store[k]) return;
    store[k].isSuperAdmin = !!isSuperAdmin;
    _saveAtomic(store);
  });
}

module.exports = {
  userKey,
  getUser, getAllUsers, getUsersForDept,
  upsertUser,
  addUserToDept, removeUserFromDept, setUserRole,
  setSuperAdmin,
};
