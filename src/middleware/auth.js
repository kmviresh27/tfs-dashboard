'use strict';
const { Issuer, generators } = require('openid-client');
const session = require('express-session');
const fetch = require('node-fetch');
const { loadConfig } = require('../config');
const { TOKEN: INTERNAL_TOKEN, HEADER: INTERNAL_HEADER } = require('../internalToken');

let _client = null;
let _clientHash = null;

function cfgHash(az) {
  return `${az.tenantId}|${az.clientId}|${az.redirectUrl}`;
}

async function getOidcClient() {
  const cfg = loadConfig();
  const az = cfg.azureAd || {};
  if (!az.tenantId || !az.clientId || !az.clientSecret) return null;
  const hash = cfgHash(az);
  if (_client && _clientHash === hash) return _client;
  const issuer = await Issuer.discover(
    `https://login.microsoftonline.com/${az.tenantId}/v2.0`
  );
  _client = new issuer.Client({
    client_id: az.clientId,
    client_secret: az.clientSecret,
    redirect_uris: [az.redirectUrl || 'http://localhost:3000/api/auth/callback'],
    response_types: ['code'],
  });
  _clientHash = hash;
  return _client;
}

function resetOidcClient() {
  _client = null;
  _clientHash = null;
}

async function fetchUserGroups(accessToken) {
  if (!accessToken) return [];
  try {
    const r = await fetch(
      'https://graph.microsoft.com/v1.0/me/memberOf?$select=displayName,id&$top=200',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return (d.value || []).map(g => ({ id: g.id, name: g.displayName }));
  } catch { return []; }
}

function mapGroupsToRole(groups, email, roleMappings) {
  if (!roleMappings || !roleMappings.length) return 'all';
  for (const m of roleMappings) {
    if (m.groupId   && groups.some(g => g.id   === m.groupId))   return m.role;
    if (m.groupName && groups.some(g => g.name === m.groupName)) return m.role;
    if (m.email     && email === m.email)                        return m.role;
    if (m.domain    && email.endsWith(m.domain))                 return m.role;
  }
  return 'all';
}

// ── TFS Auth helpers ──────────────────────────────────────────────────────────
function isTfsAuthMode() {
  const cfg = loadConfig();
  return !!(cfg.tfsAuth?.enabled);
}

async function validateTfsPat(cfg, pat) {
  // Derive collection URL by stripping project from baseUrl
  const org = cfg.tfs.organization;
  const collectionUrl = cfg.tfs.baseUrl.split('/' + org)[0] + '/' + org;
  const b64 = Buffer.from(':' + pat).toString('base64');
  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // Step 1: validate PAT via connectionData, get descriptor
    const res = await fetch(`${collectionUrl}/_apis/connectionData?api-version=1.0`, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const authUser = data.authenticatedUser;
    if (!authUser) return null;

    console.log('[AUTH/TFS] authUser keys:', Object.keys(authUser));
    console.log('[AUTH/TFS] authUser raw:', JSON.stringify(authUser).substring(0, 500));

    // Step 2: fetch full identity (Domain, Account, Mail) via descriptor
    const descriptor = encodeURIComponent(authUser.descriptor);
    const idRes = await fetch(
      `${collectionUrl}/_apis/identities?descriptors=${descriptor}&queryMembership=None&api-version=2.0`,
      { headers, signal: controller.signal }
    );
    let props = {};
    let idObj = null;
    if (idRes.ok) {
      const idData = await idRes.json();
      idObj = idData.value?.[0] || null;
      props = idObj?.properties || {};
      console.log('[AUTH/TFS] identity obj keys:', idObj ? Object.keys(idObj) : 'none');
      if (idObj) console.log('[AUTH/TFS] identity raw:', JSON.stringify(idObj).substring(0, 500));
    }

    // Extract account/domain from multiple possible locations
    // 1) Identities API properties (Account.$value, Domain.$value)
    // 2) authUser.properties (connectionData already has Account)
    // 3) authUser.uniqueName ("DOMAIN\account") if present
    const uniqueParts = (authUser.uniqueName || '').split('\\');
    const uqDomain  = uniqueParts.length > 1 ? uniqueParts[0] : '';
    const uqAccount = uniqueParts.length > 1 ? uniqueParts[1] : (uniqueParts[0] || '');

    return {
      id:          authUser.id,
      displayName: authUser.providerDisplayName || authUser.displayName || '',
      account:     props.Account?.$value || authUser.properties?.Account?.$value || uqAccount,
      domain:      props.Domain?.$value  || authUser.properties?.Domain?.$value  || uqDomain,
      mail:        props.Mail?.$value    || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Session & auth middleware ─────────────────────────────────────────────────
function createSessionMiddleware() {
  const cfg = loadConfig();
  return session({
    secret: cfg.sessionSecret || 'av-dashboard-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 },
  });
}

function isSetupMode() {
  const cfg = loadConfig();
  // TFS auth mode — not "setup mode", login form handles auth
  if (cfg.tfsAuth?.enabled) return false;
  // Azure AD mode
  return !cfg.azureAd?.tenantId || !cfg.azureAd?.clientId || !cfg.azureAd?.clientSecret;
}

function requireAuth(req, res, next) {
  // Internal service calls from the scheduler (no session cookie, but carry a token)
  if (req.headers[INTERNAL_HEADER] === INTERNAL_TOKEN) {
    req.user = { id: 'internal', displayName: 'Internal Scheduler', role: 'admin', isAdmin: true,
                 isSuperAdmin: true, departments: [{ id: 'default', role: 'admin' }], activeDeptId: 'default' };
    return next();
  }

  const cfg = loadConfig();
  // TFS auth mode
  if (cfg.tfsAuth?.enabled) {
    if (req.session?.user) {
      req.user = req.session.user;
      _rehydrateDeptInfo(req);
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Azure AD setup mode fallback
  if (isSetupMode()) {
    req.user = { id: 'admin', displayName: 'Admin', email: '', role: 'admin', isAdmin: true,
                 isSuperAdmin: true, setupMode: true, departments: [{ id: 'default', role: 'admin' }], activeDeptId: 'default' };
    return next();
  }
  if (req.session?.user) {
    req.user = req.session.user;
    _rehydrateDeptInfo(req);
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Rehydrate dept memberships from users.json in case they changed mid-session.
 * Also sets req.user.deptRole for the current req.deptId.
 */
function _rehydrateDeptInfo(req) {
  try {
    const { getUser } = require('../helpers/userStore');
    const authKey = req.user?.authKey;
    if (authKey) {
      const stored = getUser(authKey);
      if (stored) {
        req.user.departments  = stored.departments;
        req.user.isSuperAdmin = stored.isSuperAdmin;
        const activeDeptId = req.user.activeDeptId || 'default';
        const activeDeptRole = (stored.departments || []).find(d => d.id === activeDeptId)?.role || req.user.role;
        req.user.isAdmin = stored.isSuperAdmin || activeDeptRole === 'admin';
        req.user.role    = activeDeptRole;
        // Keep session in sync
        req.session.user = { ...req.session.user, ...req.user };
      }
    }
    // Always expose deptRole for the current request's dept
    const deptId = req.deptId || 'default';
    req.user.deptRole = req.user.isSuperAdmin
      ? 'admin'
      : (req.user.departments || []).find(d => d.id === deptId)?.role || req.user.role || 'all';
  } catch { /* non-fatal */ }
}

/**
 * Dept access guard — applied only to /api/d/:deptId/* routes.
 * Legacy /api/* routes (req.deptId = 'default') remain open to all authenticated users.
 */
function requireDeptAccess(req, res, next) {
  // Internal scheduler and setup mode bypass
  if (req.user?.id === 'internal' || req.user?.setupMode) return next();
  // Super admin bypasses all
  if (req.user?.isSuperAdmin) return next();

  const deptId = req.deptId;
  // Only enforce for explicit non-default dept-scoped requests
  if (!deptId || deptId === 'default') return next();

  const userDepts = req.user?.departments || [];
  if (userDepts.some(d => d.id === deptId)) return next();

  return res.status(403).json({ error: `Access to department '${deptId}' is not authorized` });
}

/**
 * Department admin guard — requires super-admin OR role:'admin' in the current request dept.
 * Use for write operations that dept admins should control (e.g. POST /api/config).
 */
function requireDeptAdmin(req, res, next) {
  if (req.user?.id === 'internal' || req.user?.setupMode) return next();
  if (req.user?.isSuperAdmin) return next();
  // deptRole is set by _rehydrateDeptInfo based on req.deptId
  const deptRole = req.user?.deptRole || 'all';
  if (deptRole === 'admin') return next();
  return res.status(403).json({ error: 'Department admin access required' });
}

module.exports = {
  getOidcClient, resetOidcClient, fetchUserGroups, mapGroupsToRole,
  createSessionMiddleware, requireAuth, requireDeptAccess, requireDeptAdmin, isSetupMode,
  isTfsAuthMode, validateTfsPat,
};
