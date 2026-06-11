<overview>
The session focused on completing and deploying the AV Dashboard (Node.js/Express + React) — a live TFS/Azure DevOps monitoring dashboard. The work covered: fixing Test Coverage page slow load performance, adding observability persistence and CSV export, adding global 401→login redirect, adding team filter to Scope Change, and deploying to a VM. A recurring theme was fixing Helmet security headers that broke the app on HTTP-only servers accessed by IP address.
</overview>

<history>

1. **User reported Test Coverage loading in 30 seconds**
   - Investigated logs: found 3 WIQL queries filtered by `AutomationStatus` each taking 49–54 seconds (TFS doesn't index that field)
   - First attempt: replaced 1 WIQL + bulk fetchWorkItemDetails with 3 AutomationStatus-filtered count queries — this made things WORSE (49–54s each)
   - Root cause confirmed from server logs: `SLOW POST 49507ms` and `SLOW POST 54204ms` on AutomationStatus queries
   - Also found `ERR_HTTP_HEADERS_SENT` bug: after 35s timeout sent 503, route still tried `res.json()` when queries finished late
   - Fix: replaced 3 slow AutomationStatus WIQL queries with 1 fast unfiltered count query + 400-item sample via `fetchWorkItemDetails`; automation breakdown extrapolated from sample with `isEstimated` flag
   - Added `if (res.headersSent) return;` guards throughout the route
   - Fixed same `ERR_HTTP_HEADERS_SENT` in `snapshot.js`
   - Capped feature coverage link query at `$top=500`
   - Extended `/test-coverage` cache TTL to 15 min (was 5 min) via `cacheMiddleware(900, ['/test-coverage'])`
   - `responseCache.js` updated to support optional `onlyPaths` array parameter

2. **User asked why Observability data clears on server restart**
   - Root cause: slow query ring buffer was in-memory only (`_slowQueries` array in `tfsClient.js`)
   - Fix: persist to `logs/slow-queries.ndjson` (NDJSON append on each entry); load last 50 on startup
   - File auto-trims to 250 lines when it grows beyond 500 entries

3. **User requested CSV export from Observability tab**
   - Added `exportToCsv()` function in `MetricsTab` component of `AdminSection.jsx`
   - CSV has 3 sections: Summary (uptime, cache stats), Circuit Breakers, Slow Queries (all fields)
   - UTF-8 BOM included for Excel compatibility
   - Added "⬇ Export CSV" button next to Refresh button

4. **User requested 401 → auto redirect to login page**
   - All API calls go through `apiFetch` in `client/src/api/apiClient.js`
   - Added `handleUnauthorized()` function: redirects to `/login` on 401
   - Excluded auth endpoints (`/api/auth/me`, `/api/auth/tfs-login`, etc.) to avoid redirect loops
   - Fixed direct `fetch()` call in `AdminSection.jsx` MetricsTab to also handle 401

5. **User requested team filter in Scope Change section**
   - Backend: `fetchPIScope()` gained optional `filterPath` parameter (overrides `cfg.tfs.areaPath`)
   - Baseline snapshot stored unfiltered (all teams); filtered in-memory when `teamPath` param provided
   - Current items fetched from TFS with team's area path in WIQL `UNDER` clause
   - Summary KPIs (baseline pts, current pts, net growth %, churn %) recalculated for team scope
   - Frontend: `runCompare()` passes `selectedTeam` as `teamPath`; re-runs when team changes
   - Team filter badge `🏷 TeamName` shown in baseline info banner

6. **User planned VM deployment**
   - Verified `helmet` in `package.json` ✅, build fresh ✅
   - Created `scripts/update.ps1` — in-place VM update script (stop service → extract ZIP → copy files skipping `config.json` and `data/` → restart service)
   - Ran `package.ps1 -SkipBuild` → `releases/av-dashboard-20260608-1411.zip` (6.5 MB)
   - Bug: `update.ps1` had `&&` (invalid in PowerShell) and em dash `—` corrupted as `â€"` due to Unicode encoding
   - Fixed: rewrote script using `[System.IO.File]::WriteAllText(..., [Encoding]::ASCII)`, replaced `&&` with two separate lines

7. **VM deployment — update.ps1 path quoting error**
   - User ran script with unquoted path containing space: `-InstallDir D:\AV Dashboard`
   - Fix: told user to quote: `-InstallDir "D:\AV Dashboard"`

8. **VM deployment — Helmet HTTPS headers breaking HTTP server**
   - Errors: `ERR_SSL_PROTOCOL_ERROR` on CSS/JS assets, `upgrade-insecure-requests` forcing HTTPS
   - Root cause: Helmet's `upgradeInsecureRequests: []` in CSP + default HSTS header + `crossOriginOpenerPolicy`
   - Fix in `server.js`: removed `upgradeInsecureRequests` directive, added `hsts: false`, `crossOriginOpenerPolicy: false`
   - Also added `http:` to `imgSrc` directive for HTTP origin compatibility
   - Told user to clear Chrome HSTS cache at `chrome://net-internals/#hsts` for `144.54.104.49`
   - Rebuilt package: `releases/av-dashboard-20260608-1420.zip`
   - User is currently applying this fix directly on the VM (editing `server.js`, restarting service)
   - Still seeing `ERR_SSL_PROTOCOL_ERROR` — likely browser still has cached HSTS or the `index.html` references HTTPS

9. **Checked `client/dist/index.html`** — clean, no meta CSP tags, no HTTPS references. Issue is purely the CSP header from server.

</history>

<work_done>

Files modified:
- `src/routes/testCoverage.js` — complete rewrite: removed AutomationStatus WIQL queries, uses 1 unfiltered count + 400-item sample; `res.headersSent` guards; link query capped `$top=500`
- `src/routes/snapshot.js` — fixed `ERR_HTTP_HEADERS_SENT` in catch block
- `src/helpers/responseCache.js` — `cacheMiddleware()` now accepts optional `onlyPaths` array for per-path TTL
- `server.js` — added `cacheMiddleware(900, ['/test-coverage'])` line; fixed Helmet config: removed `upgradeInsecureRequests`, added `hsts: false`, `crossOriginOpenerPolicy: false`, added `http:` to imgSrc
- `src/tfsClient.js` — slow query ring buffer persisted to `logs/slow-queries.ndjson`; loaded on startup; file auto-trims
- `client/src/sections/AdminSection.jsx` — added `exportToCsv()` function + "⬇ Export CSV" button in MetricsTab; 401 redirect in `fetchMetrics()`
- `client/src/api/apiClient.js` — added `handleUnauthorized()` and 401 check in `apiFetch()` and `switchDeptApi()`
- `src/routes/scopeChange.js` — `fetchPIScope()` gains `filterPath` param; compare route accepts `teamPath`; filters baseline in-memory; KPIs recalculated for team scope; added `teamFilter` to summary response
- `client/src/sections/ScopeChangeSection.jsx` — `runCompare()` passes team; re-runs on `selectedTeam` change; team badge in banner
- `scripts/update.ps1` — new VM in-place update script (ASCII-encoded, no `&&`, no em dashes)

Files created:
- `scripts/update.ps1` — VM update script

Packages built:
- `releases/av-dashboard-20260608-1420.zip` (6.5 MB) — latest package with all fixes

Current state:
- ✅ Local server running (shellId: server-v5, pid varies)
- ✅ React client built (index-D6N-Uyce.js)
- ✅ All syntax checks pass
- ⚠ VM still showing ERR_SSL_PROTOCOL_ERROR — user is applying Helmet fix directly on VM

</work_done>

<technical_details>

**Test Coverage performance:**
- TFS does NOT index `AutomationStatus` (or any custom field) — WIQL queries filtering by it take 49–54 seconds on large datasets
- Safe approach: only filter WIQL by indexed fields (`WorkItemType`, `AreaPath`, `IterationPath`, `State`)
- Automation breakdown computed from top-400 sample → extrapolated to totalTC; `isEstimated: true` in response when totalTC > 400
- `ERR_HTTP_HEADERS_SENT`: requestTimeout middleware sends 503 after 35s; if async route continues and calls `res.json()` after — Node throws. Fix: `if (res.headersSent) return;` before every `res.json()` and in catch blocks

**Slow query persistence:**
- `SLOW_QUERY_FILE = logs/slow-queries.ndjson` (NDJSON — one JSON per line)
- Loaded on startup: reads last 50 lines
- Written: non-blocking `fs.appendFile` on each new slow query
- Auto-trims: when in-memory array length % 25 === 0, checks if file > 500 lines and trims to 250

**Cache TTL per-path:**
- `cacheMiddleware(ttl, onlyPaths)` — if `onlyPaths` provided, only applies to those paths; others fall through to the 300s global middleware
- Order in server.js: `app.use('/api', cacheMiddleware(300))` THEN `app.use('/api', cacheMiddleware(900, ['/test-coverage', ...]))`
- Cache key includes query params → different `teamPath` = different cache entry

**Scope Change team filter:**
- Baseline `_scope.json` always stored unfiltered (all teams) — avoids polluting stored data
- `teamPath` filter applied in-memory to baseline: `i.areaPath === teamPath || i.areaPath.startsWith(teamPath + '\\')`
- Current items fetched with team-scoped WIQL `UNDER` clause
- KPI recalculation uses `filteredBaseline` not `baselineItems`

**Helmet on HTTP servers:**
- `upgradeInsecureRequests: []` in CSP → browser upgrades all HTTP requests to HTTPS → breaks HTTP-only servers
- `hsts` default is enabled in Helmet → browser caches "always use HTTPS" for the origin
- `crossOriginOpenerPolicy` requires secure context → throws browser warning/error on HTTP origins
- Fix: `hsts: false`, `crossOriginOpenerPolicy: false`, remove `upgradeInsecureRequests` from CSP directives
- After fix, browser still uses cached HSTS → user must clear at `chrome://net-internals/#hsts` or use incognito

**Deployment:**
- `package.ps1`: creates self-contained ZIP with `node_modules` (prod only), `client/dist`, `src/`, `scripts/`
- `update.ps1`: VM in-place update — skips `config.json` and `data/` (preserves live config/data)
- PowerShell `&&` is invalid — use separate statements
- Paths with spaces MUST be quoted: `-InstallDir "D:\AV Dashboard"`
- File encoding: write scripts with `[System.Text.Encoding]::ASCII` to avoid em dash/Unicode corruption
- VM service name: `TFSDashboard` (not `AVDashboard` as in script defaults)
- VM install dir: `D:\AV Dashboard`
- Login: TFS Windows auth — accepts `DOMAIN\username`, `username`, email, or email local part

</technical_details>

<important_files>

- **`server.js`**
  - Entry point; all middleware chain
  - Modified: Helmet config — `hsts: false`, `crossOriginOpenerPolicy: false`, removed `upgradeInsecureRequests`, added `http:` to imgSrc; added `cacheMiddleware(900, ['/test-coverage'])` line
  - Lines 26–41: Helmet config

- **`src/routes/testCoverage.js`**
  - Test coverage API — complete rewrite for performance
  - Phase 1: 5 parallel WIQL queries on INDEXED fields only (no AutomationStatus)
  - Phase 2: fetchWorkItemDetails for ≤400 TCs + ≤50 features
  - `res.headersSent` guards at 3 points + catch block

- **`src/tfsClient.js`**
  - All TFS API calls + slow query ring buffer
  - Modified: ring buffer persisted to `logs/slow-queries.ndjson`; loaded on startup; file auto-trims
  - Lines 1–60: ring buffer, persistence, `_recordSlowQuery`, `getSlowQueryLog`

- **`src/helpers/responseCache.js`**
  - In-memory TTL cache for API responses
  - Modified: `cacheMiddleware(ttl, onlyPaths?)` — second param restricts which paths use this TTL
  - Lines 92–145: `cacheMiddleware` function

- **`src/routes/scopeChange.js`**
  - Scope change comparison API
  - Modified: `fetchPIScope(cfg, fm, piLabels, filterPath, requestState)` — added filterPath param; compare route accepts `teamPath`; in-memory baseline filter; recalculated KPIs
  - Lines 28–32: `fetchPIScope` signature; Lines 113–147: compare route teamPath handling

- **`client/src/api/apiClient.js`**
  - Central API fetch wrapper for all React hooks
  - Modified: added `handleUnauthorized()` + 401 check in `apiFetch()` and `switchDeptApi()`
  - AUTH_PATHS exclusion list prevents redirect loops on login endpoints

- **`client/src/sections/AdminSection.jsx`**
  - Admin panel including Observability tab
  - Modified: `exportToCsv()` in MetricsTab; "⬇ Export CSV" button; 401 guard in `fetchMetrics()`
  - Lines ~1257–1392: MetricsTab component

- **`client/src/sections/ScopeChangeSection.jsx`**
  - Scope Change UI
  - Modified: `runCompare(snapshotId, team)` passes teamPath; re-runs on selectedTeam change; team badge in banner
  - Lines ~179–200: runCompare + useEffect

- **`scripts/update.ps1`**
  - New VM in-place update script
  - ASCII-encoded; no `&&`; skips `config.json` and `data\`; handles NSSM service or raw node.exe

- **`releases/av-dashboard-20260608-1420.zip`**
  - Latest deployment package (6.5 MB)
  - Includes all fixes including Helmet HTTP fix

</important_files>

<next_steps>

**Immediate: Resolve VM Helmet/HTTPS issue**
- User is still seeing `ERR_SSL_PROTOCOL_ERROR` on the VM
- `client/dist/index.html` confirmed clean — no meta CSP tags
- The fix in `server.js` (remove `upgradeInsecureRequests`, add `hsts: false`, `crossOriginOpenerPolicy: false`) is correct
- Remaining steps for user:
  1. Verify `server.js` edit was saved correctly on VM
  2. Confirm service restarted: `Get-Service TFSDashboard`
  3. Clear Chrome HSTS: `chrome://net-internals/#hsts` → delete `144.54.104.49`
  4. OR use incognito/private window to bypass HSTS cache
  5. If still failing, check actual response headers: `Invoke-WebRequest -Uri "http://144.54.104.49:3000" -UseBasicParsing | Select -ExpandProperty Headers`

**No other pending feature work** — all 94 todos done, 1 blocked (`ux-role-first-run` — first-run PAT wizard).

</next_steps>