<overview>
The AV Dashboard is a live TFS monitoring dashboard for the Philips Healthcare IT ISP Programme, built with Node.js/Express backend and Vanilla HTML/JS/CSS frontend using the Philips Filament dark-mode design system. This session focused on implementing three new feature areas: Test Coverage (new full section with automation/execution/feature-coverage charts), Cycle Time (added to Features section), and Sprint Burndown (added to Sprint Trend section). All backend routes, frontend HTML, JS rendering functions, and CSS styles were written and the server was restarted successfully.
</overview>

<history>
1. **User approved the Phase 3 plan** ("yes" to implementing Test Coverage, Cycle Time, and Sprint Burndown)
   - Loaded plan.md to review context
   - Queried SQL todos (6 pending: tc-backend, tc-frontend, ct-backend, ct-frontend, sb-backend, sb-frontend)
   - Marked all backend todos as in_progress
   - Read server.js, config.json, app.js, index.html, style.css comprehensively to understand code structure before writing

2. **Implemented Cycle Time (ct-backend + ct-frontend)**
   - Added `cycleTimes = []` tracking inside `processFeatures()` loop in server.js
   - For each Done feature: computed days from `ActivatedDate` → `ChangedDate` (fallback to CreatedDate)
   - Added cycle time aggregation block after loop, returning `cycleTime: { count, avg, min, max, byTeam }` object
   - Added `Microsoft.VSTS.Common.ActivatedDate` to feature fetch fields in `/api/dashboard` and `/api/features`
   - Added `activatedDate` field to `itemSummary()` return value so it's included in item objects
   - Updated `applyTeamFilter()` in app.js to re-compute filteredCycleTime from filtered items (uses item.activatedDate)
   - Added `renderCycleTime(features)` function in app.js: bar chart by team with min/max/count tooltips + 4 KPI cards
   - Called `renderCycleTime` from `renderFeaturesSection()`
   - Added cycle time HTML row (2-column: bar chart + KPI stats panel with note) in Features section of index.html

3. **Implemented Sprint Burndown (sb-backend + sb-frontend)**
   - Added `/api/sprint-burndown?pi=26-PI1` route in server.js: queries features per sprint, returns total/done/remaining/effort
   - Modified `loadSprintTrend()` in app.js to do parallel fetch of both `/api/sprint-trend` and `/api/sprint-burndown`
   - Added `renderSprintBurndown(data)` function: two stacked bar charts (by count + by effort) with tooltip showing % complete
   - Added helper `_burndownOptions()` for shared Chart.js config
   - Added 2-column burndown HTML section at bottom of Sprint Trend section in index.html

4. **Implemented Test Coverage (tc-backend + tc-frontend)**
   - Added `/api/test-coverage?pis[]=...` route in server.js:
     - WIQL query: Test Cases by AreaPath (no iteration filter — test cases use root iteration)
     - Automation breakdown: groups by `Microsoft.VSTS.TCM.AutomationStatus` (Automated / Not Automated / Planned)
     - Feature coverage: WIQL link query with `Microsoft.VSTS.Common.TestedBy-Forward` to find Feature→TestCase links, then computes covered/uncovered counts for features in selected PIs
     - Test Runs: `GET _apis/test/runs?includeRunDetails=true&$top=100` to aggregate pass/fail/blocked outcomes
     - All three blocks wrapped in try/catch for graceful degradation
   - Added full `section-test-coverage` HTML section in index.html: PI selector, 6 KPI cards, 4 charts (automation donut, team bar, test runs donut, feature coverage donut), unit test placeholder card, uncovered features table
   - Added `🧪 Test Coverage` nav link in sidebar
   - Added `setupTestCoverage()`, `initTestCoverage()`, `loadTestCoverage()`, `renderTestCoverage()`, `renderTestAutoDonut()`, `renderTestTeamBar()`, `renderTestRunsChart()`, `renderTestFeatCovChart()`, `renderTestUncoveredTable()` functions in app.js
   - Called `setupTestCoverage()` from bootstrap DOMContentLoaded after loadPIList
   - Added `'test-coverage'` to `ALL_SECTIONS` array, `activateSection()`, and `buildSlideshowSlides()`

5. **Server restarted successfully**
   - Server running at http://localhost:3000
   - PAT configured ✅
</history>

<work_done>
Files modified:

- `D:\views\AV Dashboard\server.js`
  - `processFeatures()`: added `cycleTimes` array, cycle time computation for Done items, aggregation block, `cycleTime` in return
  - `itemSummary()`: added `activatedDate` field to returned object
  - `/api/dashboard` featFields: added `Microsoft.VSTS.Common.ActivatedDate`
  - `/api/features` fields: added `Microsoft.VSTS.Common.ActivatedDate`
  - Added `/api/sprint-burndown` route (before Start Server)
  - Added `/api/test-coverage` route (before Start Server)

- `D:\views\AV Dashboard\public\index.html`
  - Sidebar: added `🧪 Test Coverage` nav link after Velocity
  - Features section: added cycle time 2-column row (bar chart + KPI panel) before Stale Features
  - Sprint Trend section: added sprint burndown 2-column row (count + effort charts) at bottom
  - Added full `section-test-coverage` section before `</div><!-- /.main -->`

- `D:\views\AV Dashboard\public\app.js`
  - Bootstrap: added `setupTestCoverage()` call after `setupSprintTrend()`
  - `ALL_SECTIONS`: added `'test-coverage'` before `'settings'`
  - `activateSection()`: added `if (name === 'test-coverage') initTestCoverage();`
  - `renderFeaturesSection()`: added `renderCycleTime(data.features);` call
  - `loadSprintTrend()`: rewrote to parallel-fetch trend + burndown, call `renderSprintBurndown()`
  - `buildSlideshowSlides()`: added `test-coverage` slide
  - `applyTeamFilter()`: added filteredCycleTime re-computation, added `cycleTime: filteredCycleTime` to features return
  - Added at end (before old `hideSlidePageIndicator`): all new functions for cycle time, sprint burndown, and test coverage

- `D:\views\AV Dashboard\public\style.css`
  - Added `.ct-stats-panel`, `.ct-kpi-strip`, `.ct-note` styles
  - Added `.tc-placeholder`, `.tc-placeholder-icon` styles

Work completed:
- [x] ct-backend: Cycle Time API (processFeatures + ActivatedDate field)
- [x] ct-frontend: Cycle Time chart in Features section
- [x] sb-backend: Sprint Burndown `/api/sprint-burndown` route
- [x] sb-frontend: Sprint Burndown charts in Sprint Trend section
- [x] tc-backend: Test Coverage `/api/test-coverage` route
- [x] tc-frontend: Test Coverage full section UI
- [x] Server restarted and running (confirmed startup output)

Current state:
- Server is running at localhost:3000
- All 6 features implemented and code written
- **Untested against live TFS** — cannot verify data flows without browser access
- Test Coverage section most at risk (TestedBy link query format, test runs API field names may differ)
</work_done>

<technical_details>
**Cycle Time Architecture:**
- Server computes cycleTime in `processFeatures()` using raw TFS fields before `itemSummary()` strips them
- `itemSummary()` now returns `activatedDate` so the frontend `applyTeamFilter()` can re-compute cycle time for filtered subsets
- Formula: `max(0, floor((ChangedDate - ActivatedDate) / 86400000))` — negative days clamped to 0
- If ActivatedDate is null/missing, falls back to CreatedDate; if both missing, skips the item from cycle time computation
- `fetchWorkItemDetails` auto-retry strips unknown fields on 400 — ActivatedDate addition is safe

**Sprint Burndown Architecture:**
- Separate `/api/sprint-burndown?pi=XX` endpoint independent of `/api/sprint-trend`
- Uses same sprint path convention: `{iterBase}\{pi}\{pi} {suffix}` (S1, S2, S3, IP)
- Returns: `{ sprint, total, done, remaining, totalEffort, doneEffort, remainingEffort, pctComplete }`
- Frontend: two separate Chart.js stacked bar charts (count + effort) — `Chart.js stack: 'a'` key required for stacked bars
- `loadSprintTrend()` now does `Promise.all([trend, burndown])` with burndown wrapped in `.catch(() => null)` for graceful failure

**Test Coverage Architecture:**
- Test Cases: queried by `AreaPath UNDER ISP` only — NOT by IterationPath (confirmed: test cases assigned to root iteration)
- AutomationStatus field: `Microsoft.VSTS.TCM.AutomationStatus` — values mapped to Automated / Not Automated / Planned (fallback to Not Automated for unknown values)
- Feature coverage via WIQL link query with `MODE (MustContain)` — returns `workItemRelations` array with `{source: {id}, target: {id}}` pairs
- Link type: `Microsoft.VSTS.Common.TestedBy-Forward` (Feature → TestCase direction)
- Test Runs API: `GET _apis/test/runs?includeRunDetails=true&$top=100&api-version=5.0`
  - Fields used: `passedTests`, `failedTests`, `incompleteTests`, `blockedTests`, `inProgressTests`
  - **Uncertain**: exact field names in TFS 5.0 on-prem. `failedTests` might be `unanalyzedTests` on some versions. Route has try/catch so failure is non-fatal.
- Pass Rate = `passed / (passed + failed + blocked) × 100`

**TFS Confirmed Fields (from prior sessions):**
- Size/Effort: `Microsoft.VSTS.Scheduling.Effort`
- Priority/Rank: `Philips.Rank` (NOT Microsoft.VSTS.Common.Priority)
- Feature states: Forecasted → New → Activated → Approved → Done | Removed
- Defect states: New → Accepted → Investigated → Planned → Resolved → Closed | Removed
- Escape Ratio: Escaped = New+Accepted+Investigated; Caught = Resolved+Closed
- `programmeStartYear: 2024` in config.json

**Chart.js Notes:**
- All charts use `destroyChart(id)` before recreation to avoid canvas reuse errors
- `state.charts[id]` stores chart instances for resize/destroy management
- Stacked bar charts require `stack: 'a'` in both datasets (same key = same stack)
- Subtitle plugin: `plugins: { subtitle: { display: true, text: '...', ... } }`

**applyTeamFilter Pattern:**
- Re-aggregates all stats from filtered items (does not use server-computed aggregates)
- New cycle time block added: filters Done items, computes from `item.activatedDate` / `item.changed`
- Returns merged features/defects objects using spread operator + overrides
</technical_details>

<important_files>
- `D:\views\AV Dashboard\server.js`
  - Main Express backend; all TFS API routes and data processing
  - `processFeatures()` (~line 176): now computes cycleTime; added cycleTimes tracking in Done block
  - `itemSummary()` (~line 365): now includes `activatedDate` field
  - `/api/dashboard` (~line 510): featFields includes ActivatedDate
  - `/api/sprint-burndown` (new, before Start Server): per-sprint count + effort
  - `/api/test-coverage` (new, before Start Server): TC automation + TestedBy links + test runs
  - `FEATURE_STATES` line ~158, `DEFECT_STATES` line ~159
  - `Start Server` block at very end (~line 1050+)

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend logic (~3200+ lines after additions)
  - `ALL_SECTIONS` (~line 2764): includes `'test-coverage'`
  - `renderFeaturesSection()` (~line 551): calls `renderCycleTime()`
  - `loadSprintTrend()` (~line 1826): parallel fetches trend + burndown
  - `applyTeamFilter()` (~line 2621): re-computes cycleTime for filtered data
  - New functions at end (after original `hideSlidePageIndicator`): `renderCycleTime`, `renderSprintBurndown`, `_burndownOptions`, `setupTestCoverage`, `initTestCoverage`, `loadTestCoverage`, `renderTestCoverage`, `renderTestAutoDonut`, `renderTestTeamBar`, `renderTestRunsChart`, `renderTestFeatCovChart`, `renderTestUncoveredTable`

- `D:\views\AV Dashboard\public\index.html`
  - Dashboard HTML structure
  - Sidebar: `🧪 Test Coverage` nav link added after Velocity
  - Features section: cycle time row (`.charts-grid-2 mt-16`) with `cycleTimeChart` canvas + `ctStatsPanel`
  - Sprint Trend section: burndown row with `sprintBurndownChart` + `sprintBurndownEffortChart`
  - New `section-test-coverage`: full section with PI selector, KPI strip, 4 chart canvases, placeholder, table

- `D:\views\AV Dashboard\public\style.css`
  - Design tokens and component styles
  - Added `.ct-stats-panel`, `.ct-kpi-strip`, `.ct-note` (cycle time panel)
  - Added `.tc-placeholder`, `.tc-placeholder-icon` (test coverage placeholder card)

- `D:\views\AV Dashboard\config.json`
  - `sizeField`: `Microsoft.VSTS.Scheduling.Effort`
  - `defectFields.rankField`: `Philips.Rank`
  - `escapedStates`: `["New","Accepted","Investigated"]`
  - `caughtStates`: `["Resolved","Closed"]`
  - `app.programmeStartYear`: `2024`
</important_files>

<next_steps>
Remaining SQL todos: All 6 todos should be marked done (implementation complete, pending live testing).

**Potential issues to monitor on first load:**

1. **Test Runs API field names** — `failedTests` vs `unanalyzedTests` in TFS 5.0 on-prem. If outcomes show 0 failed, this is the cause. Fix: check actual API response shape and adjust field names in `/api/test-coverage` route.

2. **TestedBy link type** — If feature coverage shows 0 covered, the link type string may be wrong. Possible alternatives: `'Tested By'` or `'TestedBy'` (without namespace). The WIQL link query uses `'Microsoft.VSTS.Common.TestedBy-Forward'`.

3. **Test Cases with root IterationPath** — Confirmed test cases don't filter by IterationPath. But if some TFS instances assign them to specific sprints, the coverage data will still be correct since we only filter features by PI, not test cases.

4. **Cycle time negative values** — Clamped to 0 but if ActivatedDate > ChangedDate (data inconsistency), the value will show 0 days. Currently acceptable.

**Possible enhancements if user requests:**
- Sprint burndown % complete line overlay (currently only in tooltip, could be a separate `type: 'line'` dataset on secondary y-axis)
- Test coverage trend over time (compare PI1 vs PI2 automation %)
- Cycle time percentile (p50/p90) instead of just avg/min/max
- Update SQL todos to `done` status
</next_steps>