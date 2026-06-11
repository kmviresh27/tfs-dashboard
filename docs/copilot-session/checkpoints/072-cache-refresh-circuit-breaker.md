<overview>
The session focused on performance and reliability improvements to the AV Dashboard (Node.js/Express + React multitenant TFS monitoring app). The main goals were: (1) fixing `snapshot-tc-delta` endpoint returning 503 due to slow live TFS fetches, (2) fixing test coverage totalTestCases regression (showing 33 instead of ~294k), (3) adding a manual cache refresh mechanism for admins, and (4) diagnosing empty data after server restart caused by the circuit breaker tripping. The approach was to share the TC cache between endpoints, fix a bad PI iteration filter, add a `POST /api/cache/bust` endpoint with UI buttons, and identify the circuit breaker as the root cause of empty data after restart.
</overview>

<history>

1. **User reported `snapshot-tc-delta` returning 503 (slow/timeout)**
   - Identified root cause: `fetchTCSummary()` called directly on every request — 4 TFS API calls + full work item detail fetch (~20-40s), no cache
   - Added `getCacheEntry()` to `responseCache.js`
   - Rewrote `snapshot-tc-delta` route to check TC cache first (same key as `/api/test-coverage`), fallback to `computeTestCoverage()` only on cache miss
   - `computeTestCoverage` (from `testCoverage.js`) result is stored in cache for future requests
   - Updated `server.js` cache TTL: `cacheMiddleware(3600, ['/test-coverage', '/cycle-time-distribution'], 3600)` for 1hr fresh + 1hr stale-while-revalidate

2. **User reported test coverage showing only 33 total test cases (was ~294k)**
   - Root cause: a previous optimization added `iterPart` (PI iteration filter) to the TC count query in `computeTestCoverage()`
   - Test cases use **sprint-level** iteration paths, not PI-level paths → filtering by PI path gave only TCs directly at the PI node (33 items)
   - Fix: removed `iterPart` from query #1 (total TC count). The `iterPart` filter is correct only for features (query #4), not test cases.

3. **User reported KPI Tracker not fetching data, PI checks empty, and requested a cache refresh mechanism**
   - No manual cache bust endpoint existed (only auto-bust on config save)
   - Added `POST /api/cache/bust` to `health.js`:
     - Super admin → `bustAllCache()` (all departments)
     - Dept admin → `bustCache(deptId)` (their dept only)
   - Added `bustCache()` function + `busting`/`bustMsg` state to `MetricsTab` in `AdminSection.jsx`
   - Added **"🗑 Clear Cache"** button to Admin Panel → Observability tab (danger style, shows success/error message)
   - Added `bustDeptCache()` function + state to `SettingsSection.jsx`
   - Added **"🗑 Clear Cache"** button to Settings → TFS tab footer for dept admins
   - Built React client, restarted server

4. **Server restart caused all APIs to return empty data; cache bust didn't fix it**
   - Read server logs — real root cause identified: **circuit breaker tripped OPEN** after 5 failures on `AutoBots Team/_apis/work/teamsettings/iterati` (sprint dates lookup)
   - With circuit OPEN, all TFS calls fail immediately with "Circuit open" error
   - PI checks catches the error but returns 200 with empty data → gets cached → cache bust clears empty result but next request also returns empty (circuit still open)
   - Circuit auto-recovers after 60s cooldown (transitions to HALF_OPEN, then CLOSED on 2 successes)
   - **In progress**: need to add circuit reset endpoint + button, and fix PI checks to return 503 (not 200) when circuit is open so empty results don't get cached

</history>

<work_done>

Files modified:
- `src/helpers/responseCache.js` — Added `getCacheEntry(key)` function; exported it
- `src/routes/snapshot.js` — Rewrote `snapshot-tc-delta` route to use TC cache (via `getCacheEntry`/`buildCacheKey`) instead of calling `fetchTCSummary()` directly; falls back to `computeTestCoverage()` on cache miss
- `src/routes/testCoverage.js` — Removed `iterPart` from query #1 (total TC count); TC count is now area-path only (not PI-filtered)
- `src/routes/health.js` — Added `POST /api/cache/bust` endpoint (auth required; super admin busts all, dept admin busts own dept)
- `client/src/sections/AdminSection.jsx` — Added `bustCache()` async function, `busting`/`bustMsg` state, "🗑 Clear Cache" danger button, success/error banner in `MetricsTab`
- `client/src/sections/SettingsSection.jsx` — Added `bustDeptCache()` function, `cacheBusting`/`cacheMsg` state, "🗑 Clear Cache" button in TFS tab footer
- `server.js` — Updated cache TTL: `cacheMiddleware(3600, ['/test-coverage', '/cycle-time-distribution'], 3600)` (was 900s, no stale-while-revalidate)

Work completed:
- [x] `snapshot-tc-delta` no longer does full live TFS fetch on every call — uses shared cache
- [x] Test coverage totalTestCases regression fixed (33 → ~294k)
- [x] `POST /api/cache/bust` backend endpoint added
- [x] "🗑 Clear Cache" button in Admin Panel (super admin)
- [x] "🗑 Clear Cache" button in Settings page (dept admin)
- [x] React client rebuilt and deployed locally
- [ ] Circuit breaker reset endpoint not yet added
- [ ] PI checks still returns 200 with empty data when circuit is open (should be 503)
- [ ] "Reset Circuit" button not yet added to admin panel
- [ ] VM deployment not done (changes not pushed to `144.54.104.49`)

</work_done>

<technical_details>

- **Circuit breaker is per-host-URL** (not per-endpoint or per-team): one team endpoint failing 5x trips the breaker for the entire TFS host. `AutoBots Team/_apis/work/teamsettings/iterati` is the specific failing endpoint.
- **Circuit breaker thresholds**: `FAILURE_THRESHOLD=5`, `COOLDOWN_MS=60000` (60s), `SUCCESS_THRESHOLD=2`. After 60s cooldown it auto-transitions to HALF_OPEN, then CLOSED after 2 successes.
- **Root cause of "empty data after restart"**: Circuit opens → TFS calls fail silently → routes return 200 with empty arrays → cache stores empty result → cache bust clears it but next request also returns empty (circuit still open). Two separate fixes needed: (1) reset circuit, (2) return 503 not 200 when circuit is open.
- **Test cases use sprint-level iteration paths** (e.g. `ISP\26-PI1\26-PI1 S1`), not PI-level paths. Filtering TC count by PI iteration path gives only TCs at the PI node level (very few).
- **`computeTestCoverage` vs `fetchTCSummary`**: `computeTestCoverage` is the optimized version (200-sample, 5 parallel queries, no AutomationStatus WIQL filter). `fetchTCSummary` in `snapshots.js` is the old version (fetches ALL TCs + AutomationStatus). `snapshot-tc-delta` now uses `computeTestCoverage` + shared cache.
- **Cache key format**: `${deptId}:${effectivePath}:${queryString}` — built by `_buildKey(req)` in middleware or `buildCacheKey(deptId, path, query)` manually.
- **Stale-while-revalidate**: Only applies to `/test-coverage` and `/cycle-time-distribution` (3600s fresh + 3600s stale). All other endpoints use 300s TTL with no stale extension.
- **`POST /api/cache/bust` is in `health.js`** which is mounted at `/api` with NO auth middleware (health checks are unauthenticated). The cache bust endpoint adds its own `req.session?.user` auth check.
- **Sessions are in-memory** — lost on server restart. After restart, all requests return 401 until user logs in again. Frontend does handle 401 by redirecting to login.
- **PI checks `queryMap` silently empty**: if the TFS folder fetch fails (circuit open), `queryMap` stays empty, all checks return "Query not found" error with 200 status → gets cached as empty.

</technical_details>

<important_files>

- **`src/helpers/circuitBreaker.js`**
  - Circuit breaker implementation; per-host-URL state machine
  - **NOT yet modified** — needs `resetCircuit(baseUrl)` and `resetAllCircuits()` functions added
  - Key: `FAILURE_THRESHOLD=5`, `COOLDOWN_MS=60000`, `SUCCESS_THRESHOLD=2`

- **`src/routes/health.js`**
  - Health/observability endpoints + new cache bust endpoint
  - Added `POST /api/cache/bust` at lines ~107-124
  - **Needs**: `POST /api/circuit/reset` endpoint added here

- **`src/routes/piChecks.js`**
  - PI consistency checks — runs saved TFS queries
  - Lines 70-74: folder fetch failure is silently swallowed → returns 200 with empty checks
  - **Needs**: return 503 when circuit is open / folder fetch fails

- **`src/routes/testCoverage.js`**
  - Optimized TC computation with stale-while-revalidate
  - Query #1 (total TC count): area-path only, NO iterPart (fixed regression)
  - Exports `computeTestCoverage` for use by `snapshot-tc-delta`

- **`src/routes/snapshot.js`**
  - Snapshot capture + comparison routes
  - `snapshot-tc-delta` (lines ~247-310): now uses `getCacheEntry`/`buildCacheKey`/`computeTestCoverage` instead of `fetchTCSummary`

- **`src/helpers/responseCache.js`**
  - In-memory TTL cache with stale-while-revalidate support
  - Exports: `cacheMiddleware`, `putCacheEntry`, `getCacheEntry`, `buildCacheKey`, `bustCache`, `bustAllCache`, `getCacheStats`
  - `getCacheEntry` added this session

- **`client/src/sections/AdminSection.jsx`**
  - Super admin dashboard — Observability tab has "🗑 Clear Cache" button
  - `MetricsTab` function: `bustCache()` calls `POST /api/cache/bust`

- **`client/src/sections/SettingsSection.jsx`**
  - Dept admin settings — TFS tab has "🗑 Clear Cache" button
  - `bustDeptCache()` calls `POST /api/cache/bust`

- **`server.js`**
  - Entry point; cache TTL now `cacheMiddleware(3600, ['/test-coverage', '/cycle-time-distribution'], 3600)`

</important_files>

<next_steps>

**Immediate — circuit breaker reset (in progress when compacted):**

1. **Add `resetCircuit(baseUrl)` and `resetAllCircuits()` to `src/helpers/circuitBreaker.js`**:
   ```js
   function resetCircuit(baseUrl) {
     const c = _getCircuit(baseUrl);
     c.state = 'CLOSED'; c.failures = 0; c.successes = 0; c.openedAt = null;
   }
   function resetAllCircuits() { for (const c of _circuits.values()) { c.state='CLOSED'; c.failures=0; c.successes=0; c.openedAt=null; } }
   ```
   Export both.

2. **Add `POST /api/circuit/reset` to `src/routes/health.js`** (auth required, super admin resets all, dept admin resets their host):
   - Import `resetAllCircuits` from circuitBreaker
   - Super admin: `resetAllCircuits()`
   - Dept admin: `resetCircuit(cfg.tfs.baseUrl)`

3. **Combine into a single "🔄 Full Reset" button in AdminSection `MetricsTab`** that calls both `/api/cache/bust` and `/api/circuit/reset` — this is what users actually need after TFS goes briefly down.

4. **Fix `piChecks.js` to return 503 when circuit is open** — check `isCircuitOpen(cfg.tfs.baseUrl)` at top of route and return `res.status(503).json({ error: 'TFS circuit open' })` so the empty result doesn't get cached.

5. **Rebuild React client and restart server** after above changes.

6. **VM deployment** — package and deploy to `144.54.104.49`:
   - `.\scripts\package.ps1 -SkipBuild` then copy ZIP + run `update.ps1`

**Longer-term improvements:**
- Consider making circuit breaker per-endpoint-type rather than per-host, so one team's sprint settings failing doesn't block all TFS calls
- The `AutoBots Team` sprint dates endpoint is the specific trigger — may need to add it to a skip-list or make sprint-dates fetches non-fatal

</next_steps>