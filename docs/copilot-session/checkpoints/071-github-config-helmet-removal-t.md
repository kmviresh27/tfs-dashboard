<overview>
The session focused on fixing the AV Dashboard (Node.js/Express + React multitenant TFS monitoring app) deployed on a VM at `http://144.54.104.49:3000`. The primary issues were: Helmet security headers breaking the HTTP-only server (causing ERR_SSL_PROTOCOL_ERROR), GitHub Coverage configuration (token, repos, API base URL, SSO auth), and test coverage endpoint performance. The approach was to remove Helmet entirely, add GitHub configuration to the Settings and Admin UI, and implement stale-while-revalidate caching for the test coverage endpoint.
</overview>

<history>

1. **VM deployment — Helmet HTTPS headers breaking HTTP server**
   - Server at `144.54.104.49:3000` was returning `ERR_SSL_PROTOCOL_ERROR` because Helmet's default config sent `upgradeInsecureRequests` (CSP) and `Strict-Transport-Security` (HSTS) headers
   - Created `scripts/fix-helmet.ps1` to patch `server.js` — had multiple bugs: `&&` operator, parentheses in double-quoted strings, Unicode issues
   - Fixed script multiple times (parse errors on VM)
   - Created `scripts/disable-helmet.ps1` — uses a Node.js inline patch to replace `require('helmet')` with a no-op function
   - Script reported "ALREADY_PATCHED" but service still ran old code (service name `TFSDashboard` didn't exist on VM)
   - User said "remove this https itself" → removed Helmet entirely from codebase
   - Uninstalled `helmet` npm package, removed all references from `server.js`
   - Root confirmed: server is running (PID 2016/7416 on port 3000), firewall was open (ESTABLISHED connections from external IP), but browser had HSTS cached
   - Created `vm-firewall-netsh.md` in `D:\views\AV Dashboard\` with all netsh commands + ERR_SSL diagnosis steps
   - Added Windows Firewall rule instructions and netsh commands to md file
   - Updated `plan.md` with VM deployment troubleshooting notes

2. **GitHub Coverage — Token configuration not in Admin UI**
   - User couldn't find GitHub token field in admin panel
   - Added `githubToken` field to `AdminSection.jsx`: `EMPTY_CONFIG_FORM`, `toConfigForm()`, `buildDepartmentPayload()`, `saveDeptConfigMutation`, and both inline edit forms
   - Built React client ✅

3. **GitHub Coverage — Token also needed in Settings page (dept admin)**
   - Settings page (`SettingsSection.jsx`) didn't have GitHub token
   - Added `githubToken` and `githubApiBase` to `tfsForm` state, loaded from `cfg.github`
   - Added GitHub repos editor to Settings TFS tab (row-based: owner/repo/type/label/searchPath)
   - Added `githubRepos` state loaded from `cfg.github.repos`
   - Save function sends `github: { token, apiBase, repos }` to `/api/config`
   - Added `apiBase` field to backend `config.js` save handler
   - Built React client ✅

4. **GitHub Coverage — 404 errors for philips-internal org**
   - Token was valid (github.com user `vireshkm`) but repos returned 404
   - Tested various GHE URLs — `github.philips.com` had SSL error from local machine
   - User clarified: repos are at `https://github.com/philips-internal/av-apps` (public github.com)
   - Token returned empty org list — confirmed SAML SSO authorization issue
   - Fine-grained PATs don't support SAML SSO → need classic PAT or fine-grained PAT with org as resource owner
   - User said "we are not supposed to use classic tokens" → advised creating fine-grained PAT with `philips-internal` as resource owner (requires org admin approval)
   - Made `github.js` route configurable with `apiBase` (previously hardcoded to `https://api.github.com`)

5. **Test Coverage endpoint slow**
   - User reported it takes "lot of time"
   - Previous fix reduced from 30s → ~8-10s (removed AutomationStatus WIQL queries)
   - Plan: stale-while-revalidate + reduce sample size 400→200 + add iteration path filter to TC count query
   - Added `putCacheEntry()` and `buildCacheKey()` to `responseCache.js`
   - Updated `cacheMiddleware()` to support `staleWhileRevalidate` parameter: returns stale data immediately + sets `res.locals._cacheStale` flag
   - Refactored `testCoverage.js`: extracted `computeTestCoverage(cfg, params)` function, new route handler handles stale-while-revalidate background recompute
   - **In progress** — old route code still exists after the new code (lines 230+), needs to be removed

</history>

<work_done>

Files modified:
- `server.js` — Removed `helmet` require and all `app.use(helmet({...}))` block + reports CSP removal middleware
- `scripts/fix-helmet.ps1` — Created (fixes Helmet config via regex), had bugs fixed multiple times
- `scripts/disable-helmet.ps1` — Created (replaces helmet with no-op via Node.js patch script)
- `vm-firewall-netsh.md` — Created in `D:\views\AV Dashboard\` with netsh/firewall/Helmet/HSTS diagnostic commands
- `plan.md` (session file) — Added VM deployment troubleshooting notes section
- `client/src/sections/AdminSection.jsx` — Added `githubToken` to all config forms (EMPTY_CONFIG_FORM, toConfigForm, buildDepartmentPayload, saveDeptConfigMutation, both inline edit forms)
- `client/src/sections/SettingsSection.jsx` — Added `githubToken`, `githubApiBase`, `githubRepos` state; GitHub API Base URL field; GitHub Token field; GitHub Repos table editor; saves to `/api/config` with `github:` block
- `src/routes/github.js` — Made `apiBase` configurable (was hardcoded `https://api.github.com`); reads `cfg.github.apiBase`; passes `apiBase` through all fetch calls
- `src/routes/config.js` — Added `apiBase` to github config save handler
- `src/helpers/responseCache.js` — Added `staleWhileRevalidate` param to `cacheMiddleware()`; added `putCacheEntry()` and `buildCacheKey()` exports; stale detection sets `res.locals._cacheStale` and `res.locals._cacheKey`
- `src/routes/testCoverage.js` — **PARTIALLY REFACTORED** — Added imports for `putCacheEntry`/`buildCacheKey`, extracted `computeTestCoverage()` function, added new route handler with stale-while-revalidate logic — BUT old route code (lines 230+) still remains in file and needs to be removed

Files uninstalled:
- `helmet` npm package — removed via `npm uninstall helmet`

Current state:
- ✅ Helmet completely removed from codebase
- ✅ GitHub token + repos UI added to Settings page and Admin dept config panel
- ✅ responseCache.js updated with stale-while-revalidate support
- ⚠️ `testCoverage.js` has duplicate route handlers — new one added at top but old one (lines ~230-end) still exists and must be deleted
- ✅ React client built after AdminSection and SettingsSection changes
- ❌ React client NOT rebuilt after latest SettingsSection/github.js changes
- Local server running (shellId: server-v7, started ~09:50 IST)

</work_done>

<technical_details>

**Helmet on HTTP servers:**
- `upgradeInsecureRequests` in CSP → browser upgrades all HTTP→HTTPS → ERR_SSL_PROTOCOL_ERROR
- `Strict-Transport-Security` (HSTS) → browser caches "always use HTTPS" for origin for 1 year
- Browser HSTS cache persists even after server fix → must clear at `chrome://net-internals/#hsts` or use incognito
- Fix: removed Helmet entirely (was causing too many issues on HTTP-only VM)

**VM Service:**
- Service name `TFSDashboard` does NOT exist on the VM
- Node runs as a detached process (PID 2016/7416 on port 3000)
- To restart: `Stop-Process -Id <PID> -Force` then `Start-Process node -ArgumentList "server.js" -WorkingDirectory "D:\AV Dashboard" -WindowStyle Hidden`
- VM install dir: `D:\AV Dashboard`

**PowerShell script gotchas:**
- `&&` is invalid in PowerShell — use separate statements
- Parentheses inside double-quoted strings are evaluated as subexpressions: use single quotes for regex
- `[^...]` inside double-quoted strings = array index error: use single quotes
- Em dash `—` gets corrupted in ASCII-encoded files: use `-` instead

**GitHub Coverage / SAML SSO:**
- Repos are at `github.com/philips-internal` (not GHE)
- Fine-grained PATs cannot be authorized for SAML SSO organizations
- Classic PATs can be authorized via "Configure SSO" button on tokens page
- Company policy prohibits classic PATs
- Solution: create fine-grained PAT with `philips-internal` as resource owner → requires org admin approval
- GitHub API route now reads `cfg.github.apiBase` (default: `https://api.github.com`) for GHE compatibility

**Test Coverage performance:**
- TFS doesn't index `AutomationStatus` → WIQL filtering by it = 50s+ queries
- Safe WIQL fields: `WorkItemType`, `AreaPath`, `IterationPath`, `State`
- Sample reduced from 400→200 items for Phase 2
- Added `iterPart` filter to TC count query (was fetching ALL TCs regardless of PI)
- `fetchWorkItemDetails` batches 200 items per request (concurrent)

**Stale-while-revalidate pattern:**
- `cacheMiddleware(ttl, onlyPaths, staleWhileRevalidate)` — third param = seconds to serve stale after TTL
- When stale: sets `res.locals._cacheStale = true` and `res.locals._cacheKey = key`, returns data immediately
- Route detects `res.locals._cacheStale`, triggers background `setImmediate()` recompute
- Background recompute calls `putCacheEntry(key, data, ttl)` directly into cache
- `_recomputing` Set prevents duplicate background jobs per key
- TC_CACHE_TTL = 3600s (1hr fresh), TC_STALE_EXTRA = 3600s (serve stale for another 1hr)

**server.js cache TTL for test-coverage:**
- Line: `app.use('/api', cacheMiddleware(900, ['/test-coverage']))` — needs updating to `cacheMiddleware(3600, ['/test-coverage'], 3600)` to use new stale-while-revalidate

</technical_details>

<important_files>

- **`server.js`**
  - Entry point; Helmet now fully removed
  - Still has `cacheMiddleware(900, ['/test-coverage'])` — needs updating to use new 3600s TTL + staleWhileRevalidate

- **`src/routes/testCoverage.js`**
  - ⚠️ IN PROGRESS — has duplicate route handlers
  - New code: imports `putCacheEntry`/`buildCacheKey`, defines `computeTestCoverage()` function (lines 1–172), new route handler (lines 174–228)
  - Old code: still has the original route handler starting around line 230 that must be deleted
  - Also exports `computeTestCoverage` for scheduler use

- **`src/helpers/responseCache.js`**
  - Cache middleware with new stale-while-revalidate support
  - New exports: `putCacheEntry(key, data, ttlSeconds)`, `buildCacheKey(deptId, path, query)`
  - `cacheMiddleware` now accepts 3rd param `staleWhileRevalidate`

- **`src/routes/github.js`**
  - GitHub repo scanner for test coverage
  - Now reads `cfg.github.apiBase` for configurable API URL (GHE support)
  - `countBlobTestMethods` and `scanTestFiles` both accept `apiBase` parameter

- **`src/routes/config.js`**
  - Config save route — now persists `github.apiBase` alongside token and repos

- **`client/src/sections/SettingsSection.jsx`**
  - Settings page for dept admins and super admins
  - Added: `githubToken`, `githubApiBase`, `githubRepos` state; GitHub API Base URL field; GitHub Token field; GitHub Repos table editor (owner/repo/type/label/searchPath)
  - ⚠️ React client NOT rebuilt after latest changes

- **`client/src/sections/AdminSection.jsx`**
  - Super admin dept management panel
  - Added `githubToken` to all config forms and save mutations

- **`vm-firewall-netsh.md`**
  - VM troubleshooting reference doc at `D:\views\AV Dashboard\vm-firewall-netsh.md`
  - Contains: netsh commands, ERR_SSL diagnosis steps, Helmet no-op patch, node restart commands

</important_files>

<next_steps>

Immediate actions needed:

1. **Fix `testCoverage.js` duplicate route** — view lines 228+ and delete the old route handler (the original `router.get('/test-coverage', ...)` block that remains after the new refactored code)

2. **Update `server.js` cache TTL** — change:
   ```js
   app.use('/api', cacheMiddleware(900, ['/test-coverage']))
   ```
   to:
   ```js
   app.use('/api', cacheMiddleware(3600, ['/test-coverage'], 3600))
   ```
   This enables 1hr fresh + 1hr stale-while-revalidate for test coverage

3. **Rebuild React client** — `cd client && npm run build` (SettingsSection changes not yet built)

4. **Restart local server** — shellId server-v7 may be stale

5. **VM deployment** — package and deploy updated build to VM:
   - `.\scripts\package.ps1 -SkipBuild` after rebuild
   - Copy ZIP to VM and run `update.ps1`

6. **GitHub Coverage** — still blocked on SAML SSO for `philips-internal` org. User needs to either:
   - Create fine-grained PAT with `philips-internal` as resource owner (needs org admin approval)
   - Or use alternative approach (GitHub Actions workflow publishing test count JSON)

</next_steps>