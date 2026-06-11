<overview>
This session focused on completing NFR (Non-Functional Requirements) improvements across the Node.js/Express + React dashboard application, covering Performance, Observability, Reliability, Availability, and Security. The user requested fixing several bugs (Risks page Release/Team tab filter, Unknown category tab) and then systematically implementing all remaining NFR gaps. The approach was systematic: assess gaps, get rubber-duck validation, implement with verification at each step.
</overview>

<history>

1. **Risks page Release/Team tab filter bug**
   - User reported item 1742076 (type Release) showing in "All" but not in "Release" tab
   - Investigated: `ei-ci-dp-r-d` config had `hcTypeField: "Philips.HC.Type"` ✅ but `default` config had NO `hcTypeField` in its fieldMappings.fields section
   - Root cause: `default` dept config fell back to `fieldMappings.js` default of `''`, so `f['']` = undefined, all Risk items got `category: 'Unknown'`
   - Fix: Added `hcTypeField: "Philips.HC.Type"` (+ `fixedVersionField`, `stateChangeDateField`, `closedDateField`, `resolvedDateField`, `priorityField`, `automationStatusField`) to `data/departments/default/config.json`
   - Verified by fetching item 1742076 directly: `hcType: Release → category: Release` ✅

2. **User requested "Unknown" tab for uncategorised risks**
   - Added `❓ Unknown` (gray pill) to the category filter pills in `RisksSection.jsx`
   - Items without `Philips.HC.Type` already get `category: 'Unknown'` in the backend
   - Build: ✅ 136 modules

3. **User asked "is there anything else to cover as part of NFRs"**
   - Assessed current NFR state: all PARA todos already marked done
   - Identified remaining gaps: security headers (no Helmet), WIQL injection risk (142 unvalidated params), Promise.all in 40+ route files, React Error Boundaries (already existed), admin observability UI
   - Presented gap table with effort/impact ratings

4. **User said "fix all"**
   - Created 5 todos: `nfr-helmet`, `nfr-sanitize`, `nfr-allsettled`, `nfr-errbound`, `nfr-obsui`
   - Got rubber-duck review — key findings:
     - CSP would break reports inline JS (`onclick="window.print()"`) and external branding logoUrl
     - WIQL sanitization should validate+reject (400), not strip characters
     - Promise.allSettled + empty fallback could cache degraded data → add Cache-Control: no-store
     - Metrics UI should be in AdminSection behind auth, not HealthSection
     - Error boundaries already exist (`SectionErrorBoundary.jsx`) — skip that todo

   **Fix 1: Helmet (security headers)**
   - `npm install helmet`
   - Added to server.js with CSP: `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:` (for external logos)
   - Added `app.use('/api/reports', (req,res,next) => { res.removeHeader('Content-Security-Policy'); next(); })` to allow reports inline JS
   - Verified: CSP, HSTS, X-Frame-Options, X-Content-Type-Options all active on responses

   **Fix 2: Input Sanitization**
   - Created `src/helpers/sanitize.js` with `wiqlEscape()`, `validatePiLabel()`, `validatePiLabels()`, `validatePath()`, `validateInt()`, `validateId()`, `validateStr()`, `sanitizeMiddleware()`
   - `sanitizeMiddleware` attaches `req.san` with validated/escaped values, rejects with 400 on injection chars (`'`, `"`, `;`)
   - Wired globally in server.js after ROOT-strip middleware

   **Fix 3: Promise.allSettled (delegated to background agent)**
   - Background agent refactored 10 route files: defects.js, velocity.js, insights.js, sprint.js, releaseHealth.js, progress.js, scopeChange.js, piChecks.js, piDelivery.js, snapshot.js
   - Pattern: top-level `Promise.all([a,b])` → `Promise.allSettled`, fallback to empty arrays, `_warnings` in response on partial failure, `Cache-Control: no-store` on full failure

   **Fix 4: Observability Admin UI**
   - Added slow query ring buffer (50 entries) to `tfsClient.js`
   - Added `GET /api/health/metrics` endpoint to `health.js` (auth-required)
   - Added `📊 Observability` tab to `AdminSection.jsx` with KPI cards, circuit breaker table, slow query table
   - `nfr-errbound` marked done (already existed)
   - All 4 todos marked done

5. **NaN% Cache Hit Rate bug**
   - `getCacheStats()` returns `hitRate` already as string `"75%"`
   - MetricsTab was doing `Math.round(cache.hitRate)` → `Math.round("75%")` = `NaN`
   - Fix: `const hitRate = cache.hitRate ?? '—'`
   - Also fixed `cache.size`/`cache.maxSize` (don't exist) → `cache.activeEntries`/`cache.entries`

6. **Slow query log shows generic TFS endpoint URL not which query was slow**
   - User pointed out `/_apis/wit/wiql` URL is useless for identifying the query
   - Added `_wiqlLabel(body)` to extract WHERE clause excerpt as label
   - Updated table column to show WHERE clause instead of URL

7. **User wants: which API route triggered it, full WIQL in popup, user attribution**
   - Created `src/helpers/requestContext.js` using Node.js `AsyncLocalStorage`
   - Stores `{ route, method, deptId, reqId, user }` per request in async context
   - Wired `requestContextMiddleware` in server.js after `requireAuth`
   - Updated `tfsClient.js` to call `getRequestContext()` when recording slow queries
   - Slow query record now includes: `apiRoute`, `user`, `deptId`, `reqId`, `tfsUrl` (full), `wiqlQuery` (full query), `label` (WHERE excerpt), `ms`, `at`
   - Added `SlowQueryDetail` modal component in AdminSection showing all fields + formatted WIQL
   - Slow query table rows now show: Time · Duration · API Route · User · Dept · WHERE excerpt
   - Click any row → popup with full details

8. **User reports Test Coverage taking long to load**
   - Mid-investigation when compaction occurred
   - Identified root cause: `fetchWorkItemDetails` called for ALL test case IDs (potentially thousands) — if there are 3000 test cases, that's 15 concurrent batch requests which TFS throttles
   - `testCoverage.js` already in cache whitelist (`/test-coverage`) with 5-min TTL, so only first load is slow
   - Plan to fix (NOT YET IMPLEMENTED):
     - Replace `fetchWorkItemDetails` for automation breakdown counts with 3 targeted WIQL queries filtered by AutomationStatus (just count IDs returned — no detail fetch needed)
     - Keep `fetchWorkItemDetails` only for byTeam sample, capped at 400 items (`$top=400` in WIQL)
     - Increase cache TTL for `/test-coverage` from 5 min to 15 min

</history>

<work_done>

Files created:
- `src/helpers/sanitize.js` — WIQL validation + escaping; `sanitizeMiddleware` attached globally
- `src/helpers/requestContext.js` — `AsyncLocalStorage`-based request context propagation for slow query attribution

Files modified:
- `data/departments/default/config.json` — added `hcTypeField: "Philips.HC.Type"` + 6 other missing Philips-specific fields to `fieldMappings.fields`
- `client/src/sections/RisksSection.jsx` — added `❓ Unknown` category filter pill
- `server.js` — added `helmet` with CSP config, `/api/reports` CSP strip, `sanitizeMiddleware`, `requestContextMiddleware`
- `src/tfsClient.js` — slow query ring buffer (50 entries) with `getSlowQueryLog()`; `_recordSlowQuery()` now captures `apiRoute`, `user`, `deptId`, `reqId`, `tfsUrl`, `wiqlQuery`, `label`; imports `getRequestContext`; exports `getSlowQueryLog`
- `src/routes/health.js` — added `getSlowQueryLog` import; added `GET /api/health/metrics` endpoint (auth-required)
- `client/src/sections/AdminSection.jsx` — added `📊 Observability` tab with `MetricsTab` + `SlowQueryDetail` modal components; fixed `cache.hitRate` NaN bug; fixed `cache.size`→`cache.activeEntries`/`cache.entries`
- `src/routes/defects.js`, `velocity.js`, `insights.js`, `sprint.js`, `releaseHealth.js`, `progress.js`, `scopeChange.js`, `piChecks.js`, `piDelivery.js`, `snapshot.js` — Promise.allSettled refactor by background agent

Build status:
- ✅ React client builds successfully (136 modules)
- ✅ Server running at http://localhost:3000
- ✅ All backend syntax checks pass (node --check on all route files)
- ✅ Security headers verified on responses
- ✅ `/api/health/metrics` returns 401 without auth

**Currently mid-investigation**: Test Coverage slow load — root cause identified, fix NOT YET IMPLEMENTED

</work_done>

<technical_details>

**Risks page category fix:**
- `default` dept config fieldMappings.fields was missing `hcTypeField` — fell back to `''` in fieldMappings.js DEFAULTS
- `ei-ci-dp-r-d` config (ADO) had it correctly set
- Item 1742076 is on on-prem TFS (default dept), not ADO — 404 from ADO

**Helmet CSP design:**
- `img-src https:` allows any HTTPS external URL (covers branding.logoUrl)
- `style-src 'unsafe-inline'` required for React CSS-in-JS
- Reports endpoints (`/api/reports/*`) get CSP header stripped via after-Helmet middleware
- `crossOriginEmbedderPolicy: false` to avoid breaking Blob/worker assets

**Input sanitization:**
- `wiqlEscape(s)` doubles single quotes: `'` → `''` (WIQL standard escaping)
- `validatePath` rejects any value containing `'`, `"`, `;`, `<`, `>`, `{`, `}`
- `sanitizeMiddleware` attaches results to `req.san` (not req.query) — existing code still uses `req.query`; only new code should use `req.san`
- Routes should switch to `req.san.pi`, `req.san.pis`, `req.san.teamPath` etc. over time

**Promise.allSettled pattern:**
- When ANY of N settles as rejected: return partial data with `_warnings` array
- When ALL reject: also set `res.set('Cache-Control', 'no-store')` to prevent degraded empty response being cached for 5 min
- Inner/nested `Promise.all(items.map(...))` loops were NOT refactored — only top-level paired fan-outs

**AsyncLocalStorage for request context:**
- `requestContextMiddleware` must run AFTER `requireAuth` so `req.session.user` is populated
- `getRequestContext()` returns `null` outside a request (e.g. scheduler jobs) — safe to call anywhere
- Works correctly through async/await chains — no need to thread context through every function parameter

**Slow query ring buffer:**
- 50-entry ring buffer in `tfsClient.js` (`_slowQueries` array, shift on overflow)
- Records: `{ method, tfsUrl, apiRoute, user, deptId, reqId, label, wiqlQuery, ms, at }`
- `label` = WHERE clause excerpt (first 150 chars after WHERE keyword)
- `wiqlQuery` = full WIQL string from `body.query`
- GET calls record `method: 'GET'`, POST WIQL calls record `method: 'WIQL'`

**Test Coverage performance issue (NOT YET FIXED):**
- `fetchWorkItemDetails` is called for ALL test case IDs in area path
- With 3000 test cases: 15 concurrent batch requests (200 items each) → TFS throttles → retries → serial fallback → very slow
- `/test-coverage` IS in cache whitelist (5-min TTL) — only first load is slow
- Fix plan:
  1. Replace overall automation counts with 3 WIQL queries filtered by `automationStatusField` value (just count `.workItems.length` — no detail fetch)
  2. Keep `fetchWorkItemDetails` only for byTeam sample, add `$top=400` to the WIQL URL
  3. Increase `/test-coverage` cache TTL to 15 minutes (change `cacheMiddleware(300)` call or add per-route override)

**Architecture constraints:**
- Single-process app — `ecosystem.config.js` sets `instances: 1` (MemoryStore, responseCache, rateLimiter all in-process)
- `sanitizeMiddleware` is global but non-breaking — only validates params that are PRESENT, does not require them
- `requestContextMiddleware` must come after both `requireAuth` and `deptIdMiddleware` in server.js

</technical_details>

<important_files>

- **`data/departments/default/config.json`**
  - Default (on-prem TFS) department config
  - Added 7 missing `fieldMappings.fields` entries, most critically `hcTypeField: "Philips.HC.Type"`
  - Lines 143-165: the `fields` object in `fieldMappings`

- **`src/helpers/sanitize.js`** *(new)*
  - WIQL injection prevention — validation + escaping helpers
  - Key exports: `wiqlEscape()`, `validatePiLabel()`, `validatePath()`, `sanitizeMiddleware()`
  - `sanitizeMiddleware` rejects with 400 if injection chars found; attaches `req.san`

- **`src/helpers/requestContext.js`** *(new)*
  - AsyncLocalStorage-based per-request context propagation
  - `requestContextMiddleware` — wire after `requireAuth`
  - `getRequestContext()` — call anywhere in async chain to get `{ route, method, deptId, reqId, user }`

- **`src/tfsClient.js`**
  - All TFS API calls — retry, circuit breaker, slow query tracking
  - Slow query ring buffer with full context capture
  - `getSlowQueryLog()` exported for metrics endpoint
  - Lines 1-40: ring buffer + `_recordSlowQuery()` + `_wiqlLabel()`

- **`src/routes/health.js`**
  - `/api/health` (liveness), `/api/health/ready` (readiness), `/api/health/metrics` (auth-required)
  - Metrics returns cache stats + circuit breaker states + slow query log + memory/uptime
  - Line 94: `GET /api/health/metrics` handler

- **`server.js`**
  - Entry point — all middleware in correct order
  - New order: `initLogging` → `helmet` → `reports CSP strip` → `compression` → `session` → `requestLogger` → `rateLimiter` → `requestTimeout` → `health` → `ROOT strip` → `sanitizeMiddleware` → `deptId` → `auth` → `requireAuth` → `requestContextMiddleware` → `cacheMiddleware` → routes
  - Lines 23-52: Helmet + CSP config

- **`client/src/sections/AdminSection.jsx`**
  - Admin panel — Departments, All Users, **Observability** tabs
  - Added `SlowQueryDetail` modal + `MetricsTab` component with KPI cards, circuit table, slow query table
  - `MetricsTab` at ~line 1198; `SlowQueryDetail` just before it

- **`client/src/sections/RisksSection.jsx`**
  - Risks UI — ROAM board, charts, category filter
  - Added `❓ Unknown` pill to category filter (line ~471)

- **`src/routes/testCoverage.js`**
  - Test coverage route — CURRENTLY SLOW on first load
  - Uses `fetchWorkItemDetails` for ALL test case IDs → bottleneck
  - Lines 36-91: the two-phase fetch that needs to be refactored

- **`src/helpers/responseCache.js`**
  - Whitelist-based TTL cache (5-min TTL)
  - `/test-coverage` is in `EXACT_CACHE_PATHS` (line 29)
  - Need to increase TTL for this path to 15 min

</important_files>

<next_steps>

**Immediate: Fix Test Coverage slow load (mid-investigation)**

The plan (not yet implemented):

1. **Replace `fetchWorkItemDetails` for automation counts with 3 WIQL queries:**
   ```js
   // Instead of: WIQL all test case IDs → fetchWorkItemDetails for ALL
   // Do: 3 parallel WIQL queries, each returning IDs filtered by AutomationStatus
   const [autoRes, planRes, notAutoRes] = await Promise.allSettled([
     tfsPost(wiqlUrl, { query: `...WHERE WIT='Test Case' AND AreaPath UNDER '${filterPath}' AND [${fm.fields.automationStatusField}] = 'Automated'` }, pat),
     tfsPost(wiqlUrl, { query: `...AND [${fm.fields.automationStatusField}] = 'Planned'` }, pat),
     tfsPost(wiqlUrl, { query: `...AND [${fm.fields.automationStatusField}] NOT IN ('Automated','Planned')` }, pat),
   ]);
   // Counts = .workItems.length from each — NO fetchWorkItemDetails needed for totals
   ```

2. **For byTeam breakdown: cap with `$top=400`** — add `&$top=400` to the WIQL URL for the sample query, then `fetchWorkItemDetails` for those 400 IDs (2 batches instead of potentially 30+)

3. **Increase cache TTL for `/test-coverage`** — either change global `cacheMiddleware(300)` to `cacheMiddleware(900)` for this route, or add a per-route TTL override mechanism. Simplest: add a special check in cacheMiddleware for test-coverage path → 900s TTL.

4. **Rebuild client and restart server** after changes

**After Test Coverage fix:**
- No other known pending items (all 94 todos done, 1 blocked)
- The `ux-role-first-run` todo remains blocked (first-run PAT wizard for new deployments)

</next_steps>