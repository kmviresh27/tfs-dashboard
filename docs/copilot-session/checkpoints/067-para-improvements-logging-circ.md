<overview>
This session focused on two main tracks: (1) removing the "View As" role-switching feature from the dashboard UI since policies already control section visibility, and (2) a comprehensive performance, observability, reliability, and availability (PARA) improvement initiative across the Node.js/Express backend. The approach was systematic — first assessing all gaps, getting rubber-duck validation, then implementing in tiers with verification at each step. The session was mid-implementation of the second batch of PARA improvements when compaction occurred.
</overview>

<history>

1. **User: "View As not required in config model since we have policies to control sections"**
   - Scanned all files referencing `viewAs`, `activeRole`, `setActiveRole`, `roleDefs`, `roleLocked`
   - **`ConfigPanel.jsx`**: Removed `import getEffectiveRoleDefs`, removed `activeRole`/`setActiveRole`/`roleDefs`/`roleLocked` store vars, removed "Role" badge from config button pills, removed `role` from saved views (save & restore), removed `setActiveRole()` call in `applySavedView`, removed entire "View As" UI block (lines 503–549)
   - **`SlideshowConfigModal.jsx`**: Removed `getEffectiveRoleDefs` import, removed `setActiveRole`/`roleDefs`/`rolesList`/`roleLocked`/`role` state, slideshow now pre-selects sections based on user's assigned role from policies, removed "Role Filter" pill row from the modal UI
   - Built client successfully ✅

2. **User: "server not running"**
   - Killed stray node processes, restarted server → running at `http://localhost:3000` ✅

3. **User: "work on application in aspects of performance, observability, reliability and availability"**
   - Assessed current architecture — identified gaps across all 4 pillars
   - Got rubber-duck review before implementing — key feedback: cache must be whitelist-based (not global), PM2 must be single-instance only, retry needs jitter, health should split liveness/readiness
   - User chose "all three tiers"

   **Tier 1 (Cache + Observability):**
   - Created `src/helpers/responseCache.js` — whitelist-based TTL Map cache, 1000-entry bounded, bypass via `?_fresh=1`, busted on config save
   - Updated `src/config.js` — write-through in-memory cache with mtime secondary safety net
   - Created `src/middleware/requestLogger.js` — logs `[ISO] [LEVEL] METHOD /path [deptId] → STATUS Xms cache:X`
   - Created `src/routes/health.js` — `GET /api/health` (liveness, instant) + `GET /api/health/ready` (TFS ping, cached 30s)
   - Created `src/helpers/logger.js` — structured `log.error/warn/info/debug(route, deptId, msg, err)` helper

   **Tier 2 (Retry + Teams Cache + Graceful Shutdown):**
   - Updated `src/tfsClient.js` — `withRetry()` with exponential backoff+jitter on 429/502/503/504 + network errors
   - Updated `src/helpers/teamsHelper.js` — 30-min TTL cache per `baseUrl:teamRoots` key, `bustTeamsCache()` export
   - Added SIGTERM/SIGINT/uncaughtException/unhandledRejection handlers to `server.js`

   **Tier 3 (PM2 + Rate Limiter + Logger):**
   - Created `src/middleware/rateLimiter.js` — 200 req/min per IP, in-process sliding window with GC
   - Created `ecosystem.config.js` — PM2 single-instance fork mode with warning comment
   - Wired all new middleware into `server.js` in correct order: requestLogger → rateLimiter → health → deptId → auth → cacheMiddleware → routes → graceful shutdown

   **Fixed health/ready TFS ping**: Was using collection-level API (`/_apis/projects`), fixed to use project-level `/_apis/wit/fields` — now returns `status: ready` ✅
   - Verified: both health endpoints working, request logging with timestamps/levels/cache labels confirmed ✅

4. **User: "where these logs stored?"**
   - Explained logs only went to stdout/stderr (terminal), not disk, unless using PM2
   - User asked "what is PM2?" — explained it's a process manager
   - Created `src/helpers/logWriter.js` — tees ALL stdout+stderr to daily rotating log files:
     - `logs/app-YYYY-MM-DD.log` (combined)
     - `logs/error-YYYY-MM-DD.log` (errors only)
     - Midnight rotation, 30-day auto-purge, fail-open design
   - Wired `initLogging()` as very first call in `server.js`, `closeLogging()` in shutdown handler
   - Added `logs/` to `.gitignore`
   - Restarted and verified — `D:\views\AV Dashboard\logs\app-2026-06-05.log` contains all request logs, auth events, TFS warnings ✅

5. **User: "in the aspects of performance, observability, reliability and availability what is pending"**
   - Identified remaining gaps:
     - **Perf**: No gzip compression, client bundle 1.36MB, cache stats not in admin UI
     - **Obs**: No request correlation IDs, no slow query warnings, health/ready only pings default dept, no 5xx alerting
     - **Rel**: `Promise.all` in routes (one fail = full 500), no circuit breaker, in-memory sessions
     - **Avail**: No incoming request timeout, run.bat has no restart loop

6. **User: "all"** — implement all remaining PARA gaps
   - Tracked 8 new todos in DB
   - ✅ Created `src/helpers/circuitBreaker.js` — CLOSED/OPEN/HALF_OPEN states, 5 failure threshold, 60s cooldown, per-URL
   - ✅ Created `src/middleware/requestTimeout.js` — 35s timeout middleware, responds 503, exempt for health endpoints
   - ✅ Updated `src/tfsClient.js` — integrated circuit breaker (`isCircuitOpen`/`recordSuccess`/`recordFailure`), slow query warnings at 10s threshold
   - **COMPACTION OCCURRED HERE** — still pending items below

</history>

<work_done>

Files created:
- `src/helpers/responseCache.js` — whitelist-based TTL cache for ~30 analytics endpoints
- `src/helpers/teamsHelper.js` — updated with 30-min cache + `bustTeamsCache()` export
- `src/helpers/logger.js` — structured logging helper
- `src/helpers/logWriter.js` — file logging with daily rotation, tees stdout/stderr
- `src/helpers/circuitBreaker.js` — TFS circuit breaker (CLOSED/OPEN/HALF_OPEN) ✅ NEW
- `src/middleware/requestLogger.js` — request logging middleware
- `src/middleware/rateLimiter.js` — in-process rate limiter (200/min per IP)
- `src/middleware/requestTimeout.js` — 35s incoming request timeout ✅ NEW
- `src/routes/health.js` — `/api/health` (liveness) + `/api/health/ready` (readiness)
- `ecosystem.config.js` — PM2 single-instance config

Files modified:
- `server.js` — added `initLogging()` as first line, wired requestLogger/rateLimiter/health/cacheMiddleware, graceful shutdown with SIGTERM/SIGINT handlers, closeLogging() on shutdown
- `src/config.js` — write-through in-memory cache with mtime secondary check
- `src/tfsClient.js` — retry with backoff+jitter, circuit breaker integration, slow query warnings ✅ UPDATED AGAIN
- `src/routes/config.js` — added `bustCache(deptId)` + `bustTeamsCache()` calls after `saveConfig()`
- `client/src/components/ui/ConfigPanel.jsx` — removed View As block, role from saved views
- `client/src/components/ui/SlideshowConfigModal.jsx` — removed Role Filter picker
- `.gitignore` — added `logs/`

Current state:
- ✅ Server running at http://localhost:3000 (shell: av-main10, but likely needs restart after tfsClient.js change)
- ✅ Logs writing to `D:\views\AV Dashboard\logs\app-2026-06-05.log`
- ✅ Health endpoints working (`/api/health` → 200, `/api/health/ready` → 200 with TFS latency)
- ✅ Request logging, rate limiter, response cache all operational
- ✅ `circuitBreaker.js` and `requestTimeout.js` created but NOT yet wired into server.js
- ❌ Gzip compression not installed/wired yet (npm install compression ran but not wired)
- ❌ `Promise.allSettled` in dashboard.js / velocity.js not done
- ❌ Correlation IDs not added
- ❌ run.bat restart loop not added
- ❌ Health/ready multi-dept TFS check not added

</work_done>

<technical_details>

**Architecture constraints:**
- App is single-process only — `ecosystem.config.js` explicitly set `instances: 1`. express-session (MemoryStore), responseCache, rateLimiter, and node-cron scheduler are all in-process state that breaks if multiple instances run
- Circuit breaker is per-URL `origin` (e.g., `https://tfsemea1.ta.philips.com`, `https://dev.azure.com`) — ADO and on-prem TFS have independent circuits

**Cache design:**
- `responseCache.js` uses an exact whitelist of paths (`EXACT_CACHE_PATHS` Set) + prefix patterns (`CACHE_PREFIXES: ['/reports/', '/insights/']`)
- Cache key: `${deptId}:${effectivePath}:${sortedQueryString}` — strips `/d/:deptId` prefix for consistent keying
- Cache runs AFTER `requireAuth` and `deptIdMiddleware` — ensures dept isolation and no auth bypass
- `bustCache(deptId)` called from `POST /api/config` to invalidate dept's cached data
- Bypass: `?_fresh=1` query param or `X-Cache-Bypass: 1` header

**loadConfig cache:**
- Write-through: `saveConfig()` calls `_configCache.delete(deptId)` immediately
- Secondary safety: also checks `fs.statSync().mtimeMs` to detect out-of-band file edits
- Falls back to uncached read if stat fails (e.g., concurrent write)

**Circuit breaker thresholds:**
- Opens after 5 consecutive failures
- 60s cooldown before HALF_OPEN probe
- 2 consecutive successes in HALF_OPEN → CLOSED
- When circuit is OPEN: WIQL requests return `{ workItems: [] }` instead of throwing (graceful degradation); non-WIQL requests throw with "Circuit open" error

**TFS retry logic:**
- Only retries on `429/502/503/504` and network errors (`ECONNRESET`, `ETIMEDOUT`, `AbortError`, etc.)
- Never retries 4xx (bad WIQL/fields/auth) — those are client errors
- Exponential backoff: `baseMs * 2^attempt + random(0-200ms)` jitter
- circuit breaker sits above retry — if circuit is open, no retries attempted

**Request logger format:**
```
[2026-06-05T11:17:07.848Z] [INFO] GET /dashboard [ei-ci-dp-r-d] → 200 944ms cache:MISS
```
- Level: INFO (2xx), WARN (4xx), ERROR (5xx)
- dept name only shown when not 'default'
- cache header only shown for cacheable routes

**logWriter.js approach:**
- Monkey-patches `process.stdout.write` and `process.stderr.write` to tee to file streams
- Preserves original write functions so terminal output is unaffected
- `initLogging()` must be called BEFORE any `require()` that might log (it's line 1 of server.js)
- File streams use `flags: 'a'` (append) so restart doesn't overwrite logs

**Health endpoint TFS ping:**
- Uses `/_apis/wit/fields?$top=1` (project-scoped, lightweight) — NOT `/_apis/projects` (collection-scoped, returns 404 for project URLs)
- Readiness result cached 30s to prevent TFS slowness making health appear degraded

**View As removal rationale:**
- `activeRole` store state still exists and is still used by `Sidebar.jsx`, `App.jsx`, `usePolicies.js`, `GlobalSearch.jsx`
- Only the USER-FACING toggle UI was removed — policies-driven section filtering still fully intact
- Users can no longer manually switch roles via UI; their role comes from their user assignment + policies

**npm packages added:**
- `compression` — installed but not yet wired into server.js (pending)

**Pending Promise.allSettled refactor:**
- `dashboard.js` line 63: `Promise.all([featWIQL, defWIQL])` — if either WIQL fails, whole dashboard returns 500
- `dashboard.js` line 95: `Promise.all([featItems, defItems])` — same issue
- `velocity.js` line 72: `Promise.all(piLabels.map(...))` — if one PI fails, all fail
- Fix pattern: use `Promise.allSettled`, check `.status === 'fulfilled'`, use empty array for rejected

</technical_details>

<important_files>

- **`server.js`**
  - Entry point, mounts all middleware and routes
  - Critical order: `initLogging` → session → requestLogger → rateLimiter → health → ROOT: strip → deptId → auth → cacheMiddleware → routes → graceful shutdown
  - **Still needs**: `compression` middleware, `requestTimeout` middleware wired in
  - Line 1: `initLogging()` call
  - Lines ~30-40: middleware chain (add compression before routes, timeout after rateLimiter)

- **`src/tfsClient.js`**
  - All TFS API calls go through here
  - Latest state: retry + circuit breaker + slow query warnings all integrated
  - `_baseUrl(url)` extracts origin for circuit breaker keying
  - `SLOW_QUERY_MS = 10000` — threshold for slow query warnings

- **`src/helpers/circuitBreaker.js`** ✅ NEW
  - Per-URL circuit state machine (CLOSED/OPEN/HALF_OPEN)
  - `isCircuitOpen(baseUrl)` — check before making TFS call
  - `recordSuccess/recordFailure(baseUrl, err)` — update state after call
  - `getCircuitStats()` — for health endpoint display

- **`src/middleware/requestTimeout.js`** ✅ NEW
  - Created but NOT YET mounted in server.js
  - Must be mounted: `app.use('/api', requestTimeout(35_000))` after rateLimiter, before health
  - Health endpoints (`/health`, `/health/ready`) are exempt

- **`src/helpers/responseCache.js`**
  - Whitelist in `EXACT_CACHE_PATHS` Set — add new analytics routes here when created
  - `bustCache(deptId)` called from config.js POST handler
  - `getCacheStats()` used by health.js
  - Bypass: `?_fresh=1` or `X-Cache-Bypass: 1`

- **`src/helpers/logWriter.js`**
  - File logging — `initLogging()` must be called first in server.js
  - Logs dir: `D:\views\AV Dashboard\logs\`
  - Daily rotation, 30-day retention
  - `closeLogging()` called in graceful shutdown

- **`src/routes/health.js`**
  - `GET /api/health` — liveness (no auth, fast)
  - `GET /api/health/ready` — readiness with TFS ping (30s cache)
  - **Still needs**: circuit breaker stats + multi-dept TFS check in readiness
  - Import `getCircuitStats` from circuitBreaker.js needed

- **`src/routes/config.js`**
  - `POST /api/config` — now calls `bustCache(deptId)` and `bustTeamsCache(baseUrl)` after save
  - Lines 3-5: imports for bustCache and bustTeamsCache

- **`src/helpers/teamsHelper.js`**
  - `fetchLeafTeams(cfg)` — 30-min TTL cache per `${baseUrl}:${teamRoots.join('|')}` key
  - `bustTeamsCache(baseUrl)` — invalidate on config change
  - Falls back to `areaPath` when `teamRootPath` is empty (ADO dept fix)

- **`ecosystem.config.js`**
  - PM2 config — `instances: 1, exec_mode: 'fork'` (MUST stay single instance)
  - Log files: `logs/out.log`, `logs/error.log`
  - Max 10 restarts, 2s delay

- **`client/src/components/ui/ConfigPanel.jsx`**
  - View As block removed, role removed from saved views
  - `useAuth` still imported for `user` reference (needed for admin checks elsewhere)

- **`client/src/components/ui/SlideshowConfigModal.jsx`**
  - Role Filter UI removed
  - `useEffect` now pre-selects sections based on user's actual role when modal opens

</important_files>

<next_steps>

**Immediately pending (mid-implementation when compaction occurred):**

1. **Wire `requestTimeout` into `server.js`** — add after rateLimiter, before health:
   ```js
   const { requestTimeout } = require('./src/middleware/requestTimeout');
   app.use('/api', requestTimeout(35_000));
   ```

2. **Wire `compression` (gzip) into `server.js`** — add near top, before all routes:
   ```js
   const compression = require('compression');
   app.use(compression());
   ```

3. **Add circuit breaker stats to `/api/health/ready`** — in `src/routes/health.js`:
   ```js
   const { getCircuitStats } = require('../helpers/circuitBreaker');
   // add to readiness response: circuits: getCircuitStats()
   ```

4. **Multi-dept TFS check in health/ready** — ping all configured depts' TFS, not just default:
   - Use `getDepartments()` from `deptPaths.js` + `loadConfig(deptId)` for each
   - Return per-dept TFS status object

5. **`Promise.allSettled` refactor** — `src/routes/dashboard.js` and `src/routes/velocity.js`:
   - `dashboard.js` lines 63 and 95: convert `Promise.all` → `Promise.allSettled`, handle rejections with empty arrays, still return partial response with error info in meta
   - `velocity.js` line 72: same pattern for per-PI calls

6. **Request correlation IDs** — add to `requestLogger.js`:
   - Generate `req.id = crypto.randomUUID()` per request
   - Include in log lines and response header `X-Request-ID`
   - Routes can reference `req.id` for correlated error logs

7. **`run.bat` restart loop** — add `:restart_loop` in production section:
   ```batch
   :restart_loop
   node server.js
   echo Server exited. Restarting in 3 seconds...
   timeout /t 3 /nobreak > nul
   goto restart_loop
   ```

8. **Restart server** to pick up `tfsClient.js` circuit breaker changes (shell av-main10 still has old code loaded)

**After those, remaining backlog:**
- KPI Section frontend (useKPI hook + KPISection.jsx + wire into nav)
- Test Coverage Section
- Sprint Burndown chart
- Predictability/Snapshot feature

</next_steps>