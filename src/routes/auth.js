'use strict';
const express = require('express');
const { generators } = require('openid-client');
const { getOidcClient, fetchUserGroups, mapGroupsToRole, isSetupMode, isTfsAuthMode, validateTfsPat, requireAuth } = require('../middleware/auth');
const { loadConfig } = require('../config');
const { hasPat, getPat, storePat, removePat } = require('../helpers/userPatStore');
const { userKey, getUser, upsertUser, getAllUsers, getUsersForDept } = require('../helpers/userStore');
const { getDepartments } = require('../helpers/deptPaths');

const router = express.Router();

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/auth/me', (req, res) => {
  const cfg = loadConfig();
  const authMode = cfg.tfsAuth?.enabled ? 'tfs' : (isSetupMode() ? 'setup' : 'azure-ad');

  if (authMode === 'setup') {
    return res.json({
      authenticated: true,
      authMode,
      user: { id: 'admin', displayName: 'Admin', email: '', role: 'admin', isAdmin: true,
              isSuperAdmin: true, setupMode: true, departments: [{ id: 'default', role: 'admin' }],
              activeDeptId: 'default' },
    });
  }
  if (req.session?.user) return res.json({ authenticated: true, authMode, user: req.session.user });
  res.status(401).json({ authenticated: false, authMode });
});

// ── GET /api/auth/tfs-check-user?username=… ───────────────────────────────────
// Returns whether a stored PAT exists for this username (so UI can hide PAT field)
router.get('/auth/tfs-check-user', (req, res) => {
  const cfg = loadConfig();
  if (!cfg.tfsAuth?.enabled) return res.status(400).json({ error: 'TFS auth not enabled' });
  const username = (req.query.username || '').trim();
  if (!username) return res.json({ hasPat: false });
  res.json({ hasPat: hasPat(username) });
});

// ── POST /api/auth/tfs-login ──────────────────────────────────────────────────
router.post('/auth/tfs-login', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (!cfg.tfsAuth?.enabled) return res.status(400).json({ error: 'TFS auth not enabled' });

    const { username, pat: rawPat } = req.body || {};
    if (!username?.trim()) return res.status(400).json({ error: 'Username is required' });

    const uname = username.trim();

    // Resolve PAT: use submitted PAT if provided, else look up stored one
    let pat = rawPat?.trim() || null;
    let usingStoredPat = false;
    if (!pat) {
      pat = getPat(uname);
      if (!pat) return res.status(400).json({ error: 'PAT is required for first-time login' });
      usingStoredPat = true;
    }

    // Build list of dept configs to try:
    // Known user → only their registered dept's TFS (fast, targeted)
    // New user   → try all depts to discover which TFS they belong to
    const allDepts = getDepartments();
    const accountLower = uname.toLowerCase().replace(/^.*\\/, ''); // strip domain
    // getAllUsers() returns { key, ...userData } — key is "tfs:domain\account"
    const knownUserEntry = getAllUsers().find(u =>
      u.key?.toLowerCase().includes(accountLower)
    );

    let deptsToTry;
    if (knownUserEntry && knownUserEntry.departments?.length) {
      // Try only the depts this user is registered in
      const userDeptIds = new Set(knownUserEntry.departments.map(d => d.id));
      deptsToTry = allDepts.filter(d => userDeptIds.has(d.id));
      if (!deptsToTry.length) deptsToTry = allDepts; // fallback
    } else {
      // New user: try all depts
      deptsToTry = allDepts;
    }

    let tfsUser = null;
    let matchedDeptId = 'default';

    console.log('[AUTH/TFS] Login attempt:', uname, '| deptsToTry:', deptsToTry.map(d => d.id));

    for (const dept of deptsToTry) {
      const deptCfg = loadConfig(dept.id);
      if (!deptCfg?.tfs?.baseUrl) { console.log('[AUTH/TFS] Skipping dept', dept.id, '— no baseUrl'); continue; }
      console.log('[AUTH/TFS] Trying dept:', dept.id, deptCfg.tfs.baseUrl);
      const result = await validateTfsPat(deptCfg, pat);
      console.log('[AUTH/TFS] validateTfsPat result:', JSON.stringify(result));
      if (result) {
        const entered         = uname.toLowerCase();
        const enteredAcctOnly = entered.replace(/^.*\\/, ''); // strip DOMAIN\ prefix if present
        const enteredLocalPart = entered.split('@')[0];       // strip @domain if email
        const domainAccount   = (result.domain ? `${result.domain}\\${result.account}` : result.account).toLowerCase();
        const accountOnly     = result.account.toLowerCase();
        const accountLocalPart = accountOnly.split('@')[0];  // account may itself be an email
        console.log('[AUTH/TFS] Compare entered:', entered, '| domainAccount:', domainAccount, '| accountOnly:', accountOnly);
        const matches = entered === domainAccount
          || entered === accountOnly
          || (accountOnly && enteredAcctOnly === accountOnly)
          || (accountOnly && enteredLocalPart === accountLocalPart && accountLocalPart.length > 2);
        if (matches) {
          tfsUser = result;
          matchedDeptId = dept.id;
          break;
        }
      }
    }

    if (!tfsUser) {
      console.log('[AUTH/TFS] Login failed for:', uname);
      if (usingStoredPat) {
        removePat(uname);
        return res.status(401).json({ error: 'PAT_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid PAT or username does not match PAT owner' });
    }

    // Store PAT for future logins (keyed by canonical form — no leading backslash when domain is empty)
    const domainAccount = tfsUser.domain
      ? `${tfsUser.domain}\\${tfsUser.account}`.toLowerCase()
      : tfsUser.account.toLowerCase();
    storePat(domainAccount, pat);

    const displayName = tfsUser.displayName || uname;
    const userId      = tfsUser.id || uname;

    // Resolve admin/role from the matched dept config
    const matchedCfg  = loadConfig(matchedDeptId);
    const adminUsers  = matchedCfg.tfsAuth?.adminUsers || cfg.tfsAuth.adminUsers || [];
    const userRoles   = matchedCfg.tfsAuth?.userRoles  || cfg.tfsAuth.userRoles  || {};
    const accountOnly2 = tfsUser.account.toLowerCase();
    const entered2     = uname.toLowerCase();
    const mappedRole  = userRoles[domainAccount] || userRoles[accountOnly2] || null;
    const isAdmin     = mappedRole === 'admin' ||
      adminUsers.some(u => {
        const ul = u.toLowerCase();
        return ul === domainAccount || ul === accountOnly2 || ul === entered2;
      });
    const role = mappedRole || (isAdmin ? 'admin' : 'all');

    // ── Enrich with multi-tenant dept context ─────────────────────────────────
    const key = userKey('tfs', domainAccount);
    let userEntry = getUser(key);
    if (!userEntry) {
      // First login: register into matched dept
      const noSuperAdminsYet = !getAllUsers().some(u => u.isSuperAdmin);
      userEntry = {
        displayName, email: tfsUser.mail || '',
        isSuperAdmin: isAdmin && noSuperAdminsYet,
        departments: [{ id: matchedDeptId, role }],
        createdAt: new Date().toISOString(), lastLogin: null,
      };
    } else if (!userEntry.departments?.some(d => d.id === matchedDeptId)) {
      // Returning user logging in via a new dept — add it
      userEntry.departments = [...(userEntry.departments || []), { id: matchedDeptId, role }];
    }
    await upsertUser(key, { ...userEntry, displayName, lastLogin: new Date().toISOString() });
    userEntry = { ...userEntry, displayName };

    const activeDeptId = req.session?.user?.activeDeptId || matchedDeptId;
    const activeDeptRole = (userEntry.departments.find(d => d.id === activeDeptId) || {}).role || role;

    req.session.user = {
      id: userId, displayName, email: '',
      authKey: key,
      role: activeDeptRole,
      isAdmin: userEntry.isSuperAdmin || activeDeptRole === 'admin',
      isSuperAdmin: userEntry.isSuperAdmin || false,
      departments: userEntry.departments,
      activeDeptId,
      setupMode: false, authMode: 'tfs',
    };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error('[AUTH/TFS]', e.message);
    res.status(500).json({ error: 'TFS validation failed: ' + e.message });
  }
});

// ── GET /api/auth/tfs-teams?search=… ─────────────────────────────────────────
// Searches teams in the TFS project using the project teams API (supports contains matching)
router.get('/auth/tfs-teams', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (!cfg.tfsAuth?.enabled) return res.status(400).json({ error: 'TFS auth not enabled' });
    const search = (req.query.search || '').trim().toLowerCase();
    if (!search || search.length < 2) return res.json([]);

    const org = cfg.tfs.organization;
    const project = cfg.tfs.project;
    const collectionUrl = cfg.tfs.baseUrl.split('/' + org)[0] + '/' + org;
    const b64 = Buffer.from(':' + cfg.tfs.pat).toString('base64');
    const headers = { Authorization: 'Basic ' + b64 };

    // Fetch all teams (project typically has a few hundred, not 10k)
    const r = await fetch(
      `${collectionUrl}/_apis/projects/${encodeURIComponent(project)}/teams?$top=1000&api-version=2.0`,
      { headers }
    );
    if (!r.ok) return res.status(r.status).json({ error: 'TFS error' });
    const data = await r.json();
    const teams = (data.value || [])
      .filter(t => t.name.toLowerCase().includes(search))
      .map(t => ({ id: t.id, name: t.name }));
    res.json(teams);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/auth/tfs-teams/:teamId/members ───────────────────────────────────
// Fetches members of a TFS project team by GUID team ID
router.get('/auth/tfs-teams/:teamId/members', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (!cfg.tfsAuth?.enabled) return res.status(400).json({ error: 'TFS auth not enabled' });
    const org = cfg.tfs.organization;
    const project = cfg.tfs.project;
    const collectionUrl = cfg.tfs.baseUrl.split('/' + org)[0] + '/' + org;
    const b64 = Buffer.from(':' + cfg.tfs.pat).toString('base64');
    const headers = { Authorization: 'Basic ' + b64 };
    const teamId = req.params.teamId;

    const mr = await fetch(
      `${collectionUrl}/_apis/projects/${encodeURIComponent(project)}/teams/${teamId}/members?api-version=2.0`,
      { headers }
    );
    if (!mr.ok) return res.status(mr.status).json({ error: 'TFS teams members API failed' });
    const md = await mr.json();
    const members = (md.value || [])
      .filter(m => m && m.uniqueName)
      .map(m => ({ displayName: m.displayName || '', uniqueName: m.uniqueName }));
    res.json(members);
  } catch (e) {
    console.error('[AUTH/TFS] members error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/auth/tfs-users/resolve ─────────────────────────────────────────
// Resolves CODE1 account names → { displayName, email } using TFS Identities API
// Body: { accounts: ['CODE1\\user1', 'CODE1\\user2', ...] }
router.post('/auth/tfs-users/resolve', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (!cfg.tfsAuth?.enabled) return res.status(400).json({ error: 'TFS auth not enabled' });

    const accounts = (req.body?.accounts || [])
      .filter(a => typeof a === 'string' && a.trim())
      .slice(0, 100); // safety cap
    if (!accounts.length) return res.json({});

    const org = cfg.tfs.organization;
    const collectionUrl = cfg.tfs.baseUrl.split('/' + org)[0] + '/' + org;
    const b64 = Buffer.from(':' + cfg.tfs.pat).toString('base64');
    const headers = { Authorization: 'Basic ' + b64 };

    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        const r = await fetch(
          `${collectionUrl}/_apis/identities?searchFilter=AccountName&filterValue=${encodeURIComponent(account)}&queryMembership=None&api-version=2.0`,
          { headers }
        );
        if (!r.ok) return { account, displayName: '', email: '' };
        const data = await r.json();
        const identity = (data.value || [])[0];
        if (!identity) return { account, displayName: '', email: '' };
        const props = identity.properties || {};
        return {
          account,
          displayName: identity.providerDisplayName || identity.customDisplayName || '',
          email:       props.Mail?.$value || '',
        };
      })
    );

    const resolved = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.account) {
        resolved[r.value.account.toLowerCase()] = {
          displayName: r.value.displayName,
          email:       r.value.email,
        };
      }
    }
    res.json(resolved);
  } catch (e) {
    console.error('[AUTH/TFS] resolve error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/auth/login (Azure AD) ────────────────────────────────────────────
router.get('/auth/login', async (req, res) => {
  try {
    const client = await getOidcClient();
    if (!client) return res.redirect('/?auth=unconfigured');
    const cfg = loadConfig();
    const redirectUrl = cfg.azureAd?.redirectUrl ||
      `${req.protocol}://${req.get('host')}/api/auth/callback`;
    req.session.cv = generators.codeVerifier();
    req.session.st = generators.state();
    req.session.nn = generators.nonce();
    res.redirect(client.authorizationUrl({
      scope: 'openid profile email User.Read GroupMember.Read.All',
      code_challenge: generators.codeChallenge(req.session.cv),
      code_challenge_method: 'S256',
      state: req.session.st,
      nonce: req.session.nn,
      redirect_uri: redirectUrl,
    }));
  } catch (e) {
    console.error('[AUTH] Login error:', e.message);
    res.redirect('/?auth=error');
  }
});

// ── GET /api/auth/callback ────────────────────────────────────────────────────
router.get('/auth/callback', async (req, res) => {
  try {
    const client = await getOidcClient();
    if (!client) return res.redirect('/?auth=error');
    const cfg = loadConfig();
    const redirectUrl = cfg.azureAd?.redirectUrl ||
      `${req.protocol}://${req.get('host')}/api/auth/callback`;
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(redirectUrl, params, {
      code_verifier: req.session.cv,
      state: req.session.st,
      nonce: req.session.nn,
    });
    const claims = tokenSet.claims();
    const email = claims.preferred_username || claims.email || '';
    const groups = await fetchUserGroups(tokenSet.access_token);
    const tokenGroups = (claims.groups || []).map(id => ({ id, name: id }));
    const allGroups = [...groups, ...tokenGroups.filter(tg => !groups.some(g => g.id === tg.id))];
    const roleMappings = cfg.roleMappings || [];
    const adminRoles = cfg.adminRoles || ['admin'];
    const role = mapGroupsToRole(allGroups, email, roleMappings);
    const isAdminRole = adminRoles.includes(role);

    // ── Enrich with multi-tenant dept context ─────────────────────────────────
    const oid = claims.oid || claims.sub;
    const key = userKey('aad', oid);
    let userEntry = getUser(key);
    if (!userEntry) {
      const noSuperAdminsYet = !getAllUsers().some(u => u.isSuperAdmin);
      userEntry = {
        displayName: claims.name || email,
        email,
        isSuperAdmin: isAdminRole && noSuperAdminsYet,
        departments: [{ id: 'default', role }],
        createdAt: new Date().toISOString(), lastLogin: null,
      };
    }
    await upsertUser(key, { ...userEntry, displayName: claims.name || email, email, lastLogin: new Date().toISOString() });
    userEntry = { ...userEntry, displayName: claims.name || email, email };

    const activeDeptId   = req.session?.user?.activeDeptId || userEntry.departments[0]?.id || 'default';
    const activeDeptRole = (userEntry.departments.find(d => d.id === activeDeptId) || {}).role || role;

    req.session.user = {
      id: oid,
      displayName: claims.name || email,
      email,
      authKey: key,
      role: activeDeptRole,
      isAdmin: userEntry.isSuperAdmin || adminRoles.includes(activeDeptRole),
      isSuperAdmin: userEntry.isSuperAdmin || false,
      departments: userEntry.departments,
      activeDeptId,
      groups: allGroups.map(g => g.name || g.id),
      setupMode: false,
    };
    delete req.session.cv;
    delete req.session.st;
    delete req.session.nn;
    res.redirect('/');
  } catch (e) {
    console.error('[AUTH] Callback error:', e.message);
    res.redirect('/?auth=failed');
  }
});

// POST form_post support
router.post('/auth/callback', (req, res) => {
  const qs = new URLSearchParams(req.body || {}).toString();
  res.redirect(`/api/auth/callback?${qs}`);
});

// ── POST /api/auth/switch-dept ────────────────────────────────────────────────
// Updates the active department in the session. User must be in that dept.
router.post('/auth/switch-dept', requireAuth, (req, res) => {
  const { deptId } = req.body || {};
  if (!deptId) return res.status(400).json({ error: 'deptId is required' });

  const user = req.session.user;
  const isSuperAdmin = user?.isSuperAdmin || false;
  const departments  = user?.departments  || [];

  if (!isSuperAdmin && !departments.some(d => d.id === deptId)) {
    return res.status(403).json({ error: `You do not have access to department '${deptId}'` });
  }

  // Verify dept exists in registry
  const allDepts = getDepartments();
  if (!allDepts.find(d => d.id === deptId)) {
    return res.status(404).json({ error: `Department '${deptId}' not found` });
  }

  const newRole = departments.find(d => d.id === deptId)?.role || (isSuperAdmin ? 'admin' : 'all');
  req.session.user = {
    ...user,
    activeDeptId: deptId,
    role:    newRole,
    isAdmin: isSuperAdmin || newRole === 'admin',
  };
  res.json({ ok: true, activeDeptId: deptId, user: req.session.user });
});

// ── GET /api/auth/departments ─────────────────────────────────────────────────
// Returns the list of departments the current user can access.
router.get('/auth/departments', requireAuth, (req, res) => {
  const user = req.session.user;
  const allDepts = getDepartments();

  let accessible;
  if (user?.isSuperAdmin) {
    accessible = allDepts;
  } else {
    const memberIds = new Set((user?.departments || []).map(d => d.id));
    accessible = allDepts.filter(d => memberIds.has(d.id));
  }

  // Attach user's role in each dept, and enrich with TFS org from config
  const result = accessible.map(d => {
    let tfsOrg = '';
    try {
      const deptCfg = loadConfig(d.id);
      // Extract org name from TFS base URL (last path segment before project)
      const urlParts = (deptCfg.tfs?.baseUrl || '').replace(/\/$/, '').split('/');
      tfsOrg = urlParts[urlParts.length - 1] || '';
    } catch { /* dept may not have config yet */ }
    return {
      ...d,
      tfsOrg,
      userRole: user?.isSuperAdmin
        ? 'admin'
        : (user?.departments || []).find(m => m.id === d.id)?.role || 'all',
      isActive: d.id === (user?.activeDeptId || 'default'),
    };
  });

  res.json({ departments: result });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
