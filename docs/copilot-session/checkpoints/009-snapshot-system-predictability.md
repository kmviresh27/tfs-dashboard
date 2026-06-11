<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme built with Node.js/Express + Vanilla HTML/JS/CSS (Filament dark-mode). This session focused on performance fixes (fetch timeouts, parallel API calls), bug fixes (team filter on test coverage, cycle time field correction), and implementing two major new features: a Predictability Measure with effort-based gauges, and a global snapshot system that captures full dashboard state (features + defects + KPIs) for historical comparison.
</overview>

<history>

1. **User reported `/api/test-coverage` hanging indefinitely**
   - Diagnosed: no HTTP timeout on any TFS fetch call — any slow TFS response blocked forever
   - Added `fetchWithTimeout()` using `AbortController` with 30-second timeout, wrapping both `tfsGet` and `tfsPost`
   - Server restarted successfully

2. **User asked to optimise `/api/test-coverage` (still slow)**
   - Diagnosed 5 sequential TFS round-trips: TC WIQL → TC batch → Link WIQL → Feature WIQL → Uncovered detail + Test Runs
   - **Phase 1 parallel**: fired all 4 WIQL/REST queries simultaneously using `Promise.allSettled`
   - **Phase 2 parallel**: TC detail batch + uncovered feature detail fetched concurrently
   - `fetchWorkItemDetails` refactored: concurrent batch mode (fast path via `Promise.all`), falls back to serial with field-stripping on 400 errors
   - Dropped unused `System.Title` from TC fetch
   - Expected improvement: ~25-35s → ~10-12s

3. **User reported team filter not affecting test coverage section**
   - Diagnosed: `state.tcData` was never stored; `renderAll()` (called on team change) had no reference to test coverage
   - Fixed three ways:
     - Added `state.tcData` to state store
     - `loadTestCoverage()` now saves `state.tcData = data` and renders via `applyTeamFilterToTC(data)`
     - `renderAll()` now re-renders test-coverage section if active
     - Added `applyTeamFilterToTC()` for client-side filtering of `byTeam`, `automationBreakdown`, and `uncoveredFeatures`

4. **User clarified: team filter should affect ALL test coverage data, not just bar chart**
   - Changed approach: server-side filtering via `?teamPath=` parameter
   - Added `teamPath` optional param to `/api/test-coverage` — all 3 WIQL area filters now use `filterPath` (teamPath or global areaPath)
   - Added `getTeamAreaPath()` frontend helper: derives full TFS area path from `state.selectedTeam` by looking up item area paths
   - `loadTestCoverage()` passes `teamPath` to API; server returns pre-filtered data
   - `setupTeamFilter()` now re-fetches test-coverage from server when team changes and test-coverage section is active
   - `renderAll()` no longer needs `applyTeamFilterToTC` — server handles it

5. **Aravind RTE inputs: Predictability Measure and Feature Cycle Time**
   - User shared detailed requirements from RTE
   - Clarification questions asked and answered:
     - Predictability = **effort-based** (not feature count), `Microsoft.VSTS.Scheduling.Effort`
     - **Two separate gauges**: Planned (X) and Stretch (Y)
     - Snapshots stored as **local JSON files** in `snapshots/` folder
     - Snapshot capture = **manual button** in UI
     - Cycle time start = `System.CreatedDate` (proxy for Forecasted), end = `Microsoft.VSTS.Common.StateChangeDate`
     - Planned vs Stretch classification field = **TBD** (user will confirm later)
     - Predictability panel = **under Features section**

6. **Implemented Cycle Time fix + Predictability (Phase 4A + 4B)**
   - **Cycle time fix**: replaced `ActivatedDate` with `StateChangeDate`/`CreatedDate` in `processFeatures()`, `itemSummary()`, field fetch lists, `applyTeamFilter()`. Updated chart subtitle.
   - **Snapshot backend**: `POST /api/snapshot`, `GET /api/snapshots`, `DELETE /api/snapshots/:id`, `GET /api/predictability`
   - **Predictability UI** under Features: snapshot selector, two half-gauge charts, 6 KPI cards, team bar chart, feature comparison table
   - **Capture modal**: PI selector, label input, revision toggle, parent snapshot selector
   - Server restarted and verified routes working

7. **User clarified: snapshot is global, not specific to Predictability**
   - Snapshot = full dashboard data (features + defects + KPIs), not just feature list
   - Capture button = global, in topbar next to "Refresh Now"
   - Browse/compare = modal/drawer from topbar button (not sidebar section)
   - **Backend refactored**: `POST /api/snapshot` now reuses full dashboard query logic (same as `/api/dashboard`) — fetches features + defects in parallel, runs `processFeatures` + `processDefects`, saves complete `data: { meta, features, defects }` to JSON file
   - Added `DELETE /api/snapshots/:id` route
   - `GET /api/predictability` updated to read `snapshot.data.features.items` (new format) with fallback to `snapshot.features` (old format)
   - Snapshot schema changed: `pis[]` array instead of single `pi`, `data.features` + `data.defects` instead of flat `features` array
   - **Frontend changes in progress** when compaction triggered: topbar button + global snapshot modal with Browse/Capture tabs

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\server.js`
  - Added `fetchWithTimeout()` with AbortController (30s timeout) wrapping all TFS requests
  - `fetchWorkItemDetails()`: refactored to concurrent batch mode with serial fallback
  - `processFeatures()`: cycle time now uses `StateChangeDate − CreatedDate` (was `ActivatedDate → ChangedDate`)
  - `itemSummary()`: exposes `stateChangeDate` (was `activatedDate`)
  - `/api/dashboard` + `/api/features` featFields: `StateChangeDate` replaces `ActivatedDate`
  - `/api/test-coverage`: Phase 1/2 parallelization + optional `teamPath` param for server-side team filtering
  - **Snapshot routes** (new): `POST /api/snapshot` (full dashboard capture), `GET /api/snapshots`, `DELETE /api/snapshots/:id`, `GET /api/predictability`

- `D:\views\AV Dashboard\public\app.js`
  - Added `state.tcData` to state store
  - `loadTestCoverage()`: stores `state.tcData`, passes `teamPath` to server
  - Added `getTeamAreaPath()`: derives TFS area path from selected team name
  - Added `applyTeamFilterToTC()`: client-side TC data filter (kept for instant re-render, though server now filters too)
  - `setupTeamFilter()`: re-fetches test-coverage on team change when section active
  - `renderAll()`: removed TC re-render (server-filtered now)
  - `applyTeamFilter()`: cycle time uses `item.stateChangeDate` / `item.created` (was `activatedDate`)
  - Cycle time chart subtitle updated: "Forecasted → Done"
  - Added `setupPredictability()`, `openCaptureModal()`, `closeCaptureModal()`, `submitSnapshot()`, `refreshSnapshotList()`, `loadPredictability()`, `clearPredictability()`, `renderPredictability()`, `renderPredGauge()`, `renderPredTeamBar()`, `renderPredTable()`
  - `setupPredictability()` called from bootstrap
  - `renderFeaturesSection()`: calls `refreshSnapshotList()` on load
  - **Pending**: move 📸 button to topbar, build global snapshot modal with Browse/Capture tabs

- `D:\views\AV Dashboard\public\index.html`
  - Cycle time subtitle fixed: "Forecasted → Done"
  - Cycle time note updated to reflect new fields
  - Added full Predictability panel inside Features section (snapshot selector, KPI strip, 3-column gauges/team bar, comparison table)
  - Added "Capture Snapshot" modal HTML (inside Features section — **needs to move to global**)
  - **Pending**: move 📸 button to topbar, convert capture button/modal to global

- `D:\views\AV Dashboard\public\style.css`
  - Added `.pred-toolbar`, `.pred-kpi-strip`, gauge canvas sizing styles

**Current state:**
- Server running at http://localhost:3000 ✅
- All syntax checks pass ✅
- Snapshot POST/GET/DELETE routes implemented and verified ✅
- Predictability gauges + table implemented ✅
- **In progress**: Moving snapshot capture to topbar as global feature (server done, frontend partially done)

</work_done>

<technical_details>

**TFS Fetch Architecture:**
- `fetchWithTimeout(url, options)` wraps `node-fetch` with AbortController (30s)
- `fetchWorkItemDetails(ids, fields, cfg)`: fires all 200-item batches concurrently via `Promise.all`; on any error falls back to serial mode with field-stripping retry (handles unknown-field 400s)
- `/api/test-coverage` uses `Promise.allSettled` so partial TFS failures degrade gracefully

**Cycle Time Field Correction (confirmed by Aravind RTE):**
- Start: `System.CreatedDate` — proxy for when feature entered Forecasted state (features created in Forecasted)
- End: `Microsoft.VSTS.Common.StateChangeDate` — last state transition date; for Done features = Done date
- Formula: `max(0, floor((StateChangeDate - CreatedDate) / 86400000))`
- Rationale: avoids expensive revision history API; fast single-field fetch

**Snapshot System Architecture:**
- Files stored in `D:\views\AV Dashboard\snapshots\{id}.json`
- ID format: `{PI1}_{PI2}-{ISO-timestamp-sanitized}`
- Schema (new format): `{ id, pis[], label, capturedAt, isRevision, parentId, data: { meta, features, defects } }`
- Old format (features-only) still supported in predictability endpoint via fallback: `snapshot.data?.features?.items || snapshot.features`
- `POST /api/snapshot` reuses same WIQL queries + `processFeatures` + `processDefects` as `/api/dashboard`
- Revisions: new file saved with `isRevision: true, parentId: originalId`; original retained

**Predictability Measure (effort-based):**
- Two separate gauges: Planned (X) and Stretch (Y)
- Formula: `Done Effort / Total Snapshot Effort × 100` per type
- Target green zone: 80–100%
- RAG coloring: ≥80% green, ≥50% amber, <50% red
- Planned vs Stretch classification: `cfg.plannedStretchField` in config.json (TBD field from user); defaults all to "Planned" until set
- `GET /api/predictability?snapshotId=&teamPath=`: re-fetches live states/sizes for snapshot feature IDs only (not full dashboard re-query)

**Team Filter for Test Coverage:**
- Server-side: `?teamPath=Healthcare+IT%5CICAP%5CISP%5CHercules` narrows all WIQL AreaPath filters
- `getTeamAreaPath()` in app.js: looks up a real item's area path to derive the TFS path for selected team name
- Test runs summary not filterable by team (TFS test runs API has no AreaPath field)

**Known Pending Config Item:**
- `plannedStretchField`: TFS field name for Planned vs Stretch classification — user to confirm. Add to `config.json` when known.

</technical_details>

<important_files>

- `D:\views\AV Dashboard\server.js`
  - Main Express backend; all TFS routes and data processing
  - `fetchWithTimeout()` ~line 19: 30s AbortController timeout on all TFS requests
  - `fetchWorkItemDetails()` ~line 135: concurrent batch mode with serial fallback
  - `processFeatures()` ~line 198: cycle time uses `StateChangeDate − CreatedDate`
  - `itemSummary()` ~line 418: returns `stateChangeDate` field
  - `/api/test-coverage` ~line 1006: parallelized, accepts `teamPath` param
  - `POST /api/snapshot` ~line 1172: full dashboard capture
  - `GET /api/snapshots` ~line 1250: list with metadata
  - `DELETE /api/snapshots/:id` ~line 1266: delete snapshot file
  - `GET /api/predictability` ~line 1277: effort-based live vs snapshot comparison
  - `Start Server` block at ~line 1380+

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend logic (~3500+ lines)
  - `state` object ~line 40: includes `tcData` and `velData`
  - `renderFeaturesSection()` ~line 555: calls `refreshSnapshotList()`
  - `setupTeamFilter()` ~line 2535: re-fetches TC on team change
  - `getTeamAreaPath()` ~line 3239: derives TFS area path from team name
  - `applyTeamFilter()` ~line 2680+: cycle time uses `stateChangeDate`
  - Predictability functions ~line 3260–3430: `setupPredictability`, `openCaptureModal`, `submitSnapshot`, `refreshSnapshotList`, `loadPredictability`, `renderPredictability`, `renderPredGauge`, `renderPredTeamBar`, `renderPredTable`

- `D:\views\AV Dashboard\public\index.html`
  - Dashboard HTML structure
  - Predictability panel inside Features section: `#predictabilityPanel`
  - Capture modal: `#captureModal` — currently inside Features section, **needs to move to global/body level**
  - Capture button: `#predCaptureBtn` inside Features panel — **needs to move to topbar**
  - Snapshot selector: `#predSnapshotSel`
  - Gauge canvases: `#predPlannedGauge`, `#predStretchGauge`, `#predTeamBar`
  - Comparison table: `#predCompareBody`

- `D:\views\AV Dashboard\public\style.css`
  - `.pred-toolbar`, `.pred-kpi-strip` added for predictability panel layout
  - `#predPlannedGauge, #predStretchGauge { height: 160px }` for gauge sizing

- `D:\views\AV Dashboard\config.json`
  - `sizeField`: `Microsoft.VSTS.Scheduling.Effort`
  - `plannedStretchField`: **not yet set** — add when user confirms TFS field name
  - `tfs.pat`, `tfs.baseUrl`, `tfs.areaPath`, `tfs.iterationPath`, `tfs.teamRootPath`

</important_files>

<next_steps>

**Immediate — in progress when compaction triggered:**
Move snapshot capture from Features panel to global topbar:

1. **`index.html`**: 
   - Add 📸 button to topbar next to "Refresh Now" button: `<button class="btn btn-ghost btn-sm topbar-snap-btn" onclick="openSnapshotDrawer()">📸 Snapshot</button>`
   - Move `#captureModal` out of Features section to end of `<body>` (global)
   - Add Browse tab to the modal: show list of snapshots with date, PI, label, delete button
   - Remove `#predCaptureBtn` from Features panel (now topbar)

2. **`app.js`**:
   - Rename `openCaptureModal()` → `openSnapshotDrawer()` or keep name, add Browse tab logic
   - Browse tab: calls `GET /api/snapshots`, renders list with delete buttons
   - `deleteSnapshot(id)`: calls `DELETE /api/snapshots/:id`, refreshes list
   - On snapshot selected in Browse tab: load for Predictability comparison
   - Update `submitSnapshot()`: use `state.selectedPIs` as default `pis[]` (full dashboard, not single PI)

3. **`style.css`**: Style topbar snapshot button, modal Browse tab, snapshot list items

**Pending user input:**
- `plannedStretchField` in `config.json` — TFS field name for Planned (X) vs Stretch (Y) feature classification. User said "will confirm shortly." Once confirmed, add to config.json and all snapshots will automatically classify features.

**Also to verify on live TFS:**
- `Microsoft.VSTS.Common.StateChangeDate` is populated correctly for Done features (cycle time end date)
- Test coverage TestedBy link type (`Microsoft.VSTS.Common.TestedBy-Forward`) returns correct results

</next_steps>