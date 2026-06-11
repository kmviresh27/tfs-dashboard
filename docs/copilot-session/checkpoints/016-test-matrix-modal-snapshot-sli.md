<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme (Node.js/Express + Vanilla HTML/JS/CSS, Filament dark theme). This session focused on: (1) completing the GitHub unit test matrix by fixing av-apps test file detection, (2) restructuring the Unit Test Case Matrix from an inline table to a modal with charts on the main screen, (3) adding GitHub test matrix data to the snapshot system, and (4) reorganizing the slideshow so every slide shows 4–6 cards minimum. The final incomplete task is making test coverage (TFS TC) and GitHub unit test coverage load on-demand only (not on every page load/dashboard refresh).
</overview>

<history>

1. **av-apps test file detection fix (carried from previous session)**
   - av-apps uses BDD-style test files named `Given_*.cs` inside `*Tests/` directories (not `*Tests.cs` filenames)
   - Fixed `scanTestFiles()` in server.js: changed flat filename pattern to path-aware detection — `.cs` files where the path contains `*Tests*/` OR filename ends in `*Tests.cs`
   - Removed unused `const pat = ...` line; introduced `isTestFile` arrow function
   - Result: AV Apps now returns 409 test files, 563 test cases, 30 modules (was 0 files before)
   - Full matrix: GfnApps 75 files/196 cases, SystemServices 72 files/407 cases, AV Apps 409 files/563 cases — no truncation

2. **User reported server port conflict**
   - Server wouldn't start (EADDRINUSE port 3000)
   - Fixed by killing the process using `Get-NetTCPConnection -LocalPort 3000 | Stop-Process`

3. **User asked: "Unit Test Case Matrix — move to modal, show charts"**
   - Moved `#ghCoverageDetailPanel` card (inline matrix table) out of main page
   - Added `#testMatrixModal` (wide table-modal-overlay) with 3 Chart.js charts + module table
   - Added `openTestMatrixModal()` / `closeTestMatrixModal()` / `handleTestMatrixOverlayClick()`
   - Charts: donut (test cases by repo), grouped bar (files vs cases per repo), horizontal bar (top 15 modules)
   - Added "📊 View Matrix" button to `#ghCoveragePanel` card header
   - **Bug**: `async function loadGithubCoverage() {` declaration was accidentally removed during edit — caused `await is only valid in async functions` syntax error at line 4332
   - Fixed by restoring the function declaration

4. **User asked: "charts should be on main screen, only table in popup"**
   - Moved 3 chart canvases out of modal into a new `#ghChartsPanel` card on main page (hidden until data loads)
   - Simplified modal to table-only
   - Button relabeled "📋 Module Breakdown"
   - `renderGithubCoverage()` now shows/hides `#ghChartsPanel` and calls `requestAnimationFrame` to draw charts inline
   - `openTestMatrixModal()` simplified — no chart drawing, just opens table

5. **User asked: "snapshot of this also" (GitHub test matrix in snapshot)**
   - `submitSnapshot()`: added `githubTestMatrix: state.ghCoverageData` to POST body
   - `server.js POST /api/snapshot`: stores `req.body.githubTestMatrix` in `snapshot.data.githubTestMatrix`
   - New endpoint `GET /api/snapshots/:id/github-matrix` returns stored GitHub matrix
   - `openTestMatrixModal()`: if `state.activeSnapshotId` present, fetches snapshot matrix and renders `#ghMatrixDeltaPanel` showing snapshot vs live comparison table (Δ test cases, Δ test files per repo)
   - `_loadGhMatrixDelta()` / `_renderGhMatrixDelta()` functions added
   - `#ghMatrixDeltaPanel` div added inside modal (shown only when snapshot active)

6. **User asked: "every page minimum 4-6 cards in slideshow"**
   - Audited all `data-*-group` attributes across all sections
   - Reassigned group numbers in `index.html` to merge thin slides:
     - **Features**: 4 slides → 2 (group 2 merged into 1; groups 3+stale merged into 2)
     - **Defects**: 5 slides → 3 (group 3 merged into 2; groups 4+crit merged into 3)
     - **Velocity**: 2 slides → 1 (group 2 merged into 1)
     - **Test Coverage**: 4-5 slides → 2 (TC charts merged to group 1; GH+uncovered+delta merged to group 2)
   - Updated `buildSlideshowSlides()` in app.js to match new groupings
   - New total: 12 slides (down from 18+), each with 4–6 cards

7. **User asked: "test coverage and unit test coverage should not call on page load — only on refresh click or auto-refresh interval"**
   - **IN PROGRESS** — identified the issue:
     - `initTestCoverage()` (line 4088) is called on page load and calls `loadTestCoverage()` which in turn calls `loadGithubCoverage()`
     - `loadTestCoverage()` also calls `loadGithubCoverage()` at line 4141 every time TC loads
     - Auto-refresh interval (`setInterval` at line 332) calls `fetchDashboard()` which presumably calls TC/GH coverage too
   - Fix not yet applied

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\server.js`
  - Fixed `scanTestFiles()`: path-aware dotnet test file detection (`isTestFile` arrow fn replacing `pat` regex)
  - `POST /api/snapshot`: added `githubTestMatrix: req.body.githubTestMatrix || null` to `snapshot.data`
  - New endpoint: `GET /api/snapshots/:id/github-matrix`

- `D:\views\AV Dashboard\public\app.js`
  - `renderGithubCoverage()`: removed matrix table rendering; added `#ghChartsPanel` show/hide + inline chart drawing
  - New `_renderTestMatrixTable(repos)`: renders module breakdown table (inside modal)
  - `openTestMatrixModal()`: opens modal, loads snapshot delta if active
  - `_loadGhMatrixDelta()` / `_renderGhMatrixDelta()`: fetch + render snapshot vs live comparison
  - `closeTestMatrixModal()` / `_handleTestMatrixEsc()` / `handleTestMatrixOverlayClick()`
  - `_tmDrawRepoCasesChart()` / `_tmDrawFilesVsCasesChart()` / `_tmDrawTopModulesChart()`: chart drawing functions (draw to main page canvases)
  - `submitSnapshot()`: added `githubTestMatrix: state.ghCoverageData` to POST body
  - `buildSlideshowSlides()`: completely rewritten — 12 slides total with 4-6 cards each
  - `loadGithubCoverage()`: function declaration restored (was accidentally deleted)

- `D:\views\AV Dashboard\public\index.html`
  - Replaced `#ghCoverageDetailPanel` inline card with `#testMatrixModal` (table-only modal)
  - Added `#ghChartsPanel` card with 3 canvas elements on main page (hidden until data loads)
  - Added `#ghMatrixDeltaPanel` div inside modal for snapshot comparison
  - Button on `#ghCoveragePanel` changed from "📊 View Matrix" → "📋 Module Breakdown"
  - Group attribute reassignments (14 attributes changed across Features/Defects/Velocity/TC sections)

Current state:
- ✅ av-apps test detection working (409 files, 563 cases)
- ✅ Charts on main page, table in modal
- ✅ GitHub test matrix included in snapshots; comparison shown in modal
- ✅ Slideshow: 12 slides, 4-6 cards each
- ❌ **PENDING**: Test coverage (TFS TC) and GitHub coverage still load automatically on page load and every dashboard refresh — needs to be load-on-demand only

</work_done>

<technical_details>

**av-apps test file detection:**
- BDD-style files: `Given_*.cs` inside `FcmrTests/Specs/`, `SpatialTests/`, etc.
- Detection: `/\.cs$/i.test(f.path) && (/[Tt]ests?\.cs$/i.test(f.path) || /[Tt]ests?\//.test(f.path))`
- `isTestFile` arrow fn defined at top of `scanTestFiles()`; `countBlobTestMethods` still uses its own pat internally

**GitHub SAML SSO:**
- `philips-internal` org enforces SAML SSO; Classic PAT (`ghp_...`) needs "Configure SSO → Authorize" by user
- Current token: `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` — may still need SSO authorization
- Copilot CLI tools access philips-internal separately (their own auth) — used for investigation

**Snapshot data structure:**
```json
{
  "id": "...", "pis": [...], "label": "...", "capturedAt": "...",
  "data": {
    "meta": {...}, "features": {...}, "defects": {...},
    "testCoverage": {...},        // TFS TC summary
    "githubTestMatrix": {...}     // NEW: full state.ghCoverageData object
  }
}
```
- Old snapshots won't have `githubTestMatrix` — modal handles null gracefully with a message

**Slideshow group system:**
- `data-feat-group`, `data-def-group`, `data-vel-group`, `data-tc-group` attributes on cards/grids
- `showSlideshowGroup(section, groupVal)` shows only matching elements
- `buildSlideshowSlides()` defines slide order + which group to show per slide
- New groupings: Features (1=Funnel+Throughput, 2=CycleTime+Pred+Stale), Defects (1=KPI+Trend, 2=How/Where+Aging, 3=Density+Delta+Crit), Velocity (1=all), TC (1=KPI+charts, 2=GH+uncovered+delta)

**Test coverage loading — the problem to fix:**
- `initTestCoverage()` called on section activation or page load → calls `loadTestCoverage()` → calls `loadGithubCoverage()`
- `fetchDashboard()` (called on page load + timer + manual refresh) may also trigger TC loading
- Need: flag `state.tcLoadedOnce` and `state.ghCovLoadedOnce` — skip auto-load if already loaded OR never load on init, only on explicit action
- GitHub scan is expensive (reads hundreds of blobs); TFS TC also does multiple API calls
- Auto-refresh interval should include these IF the user has configured the auto-refresh

**Charts on main page:**
- `#ghChartsPanel` is `hidden` by default; set to `hidden = false` inside `renderGithubCoverage()` when scanned repos exist
- Chart canvases: `tmRepoCasesChart`, `tmFilesVsCasesChart`, `tmTopModulesChart` — all in main page
- `requestAnimationFrame` used before drawing so canvas dimensions are settled

</technical_details>

<important_files>

- `D:\views\AV Dashboard\server.js`
  - Main backend (Node.js/Express)
  - `scanTestFiles()` ~line 1684: path-aware test file detection, tree navigation
  - `countBlobTestMethods()` ~line 1686: reads blob contents, counts test methods
  - `POST /api/snapshot` ~line 1333: now includes `githubTestMatrix`
  - `GET /api/snapshots/:id/github-matrix` ~line 1448: new endpoint

- `D:\views\AV Dashboard\public\app.js`
  - Main frontend (~4600+ lines)
  - `renderGithubCoverage()` ~line 4359: KPI cards + shows `#ghChartsPanel` + draws charts
  - `_renderTestMatrixTable()`: renders module breakdown (inside modal)
  - `openTestMatrixModal()` ~line 4465: opens modal, triggers snapshot delta load
  - `_tmDrawRepoCasesChart/FilesVsCasesChart/TopModulesChart()`: chart drawers
  - `_loadGhMatrixDelta()` / `_renderGhMatrixDelta()`: snapshot comparison
  - `buildSlideshowSlides()` ~line 3247: **rewritten** — 12 slides, 4-6 cards each
  - `initTestCoverage()` ~line 4088: **calls TC + GH coverage on load — NEEDS FIX**
  - `loadTestCoverage()` ~line 4125: calls `loadGithubCoverage()` at end — **NEEDS FIX**
  - `startRefreshTimer()` ~line 327: `setInterval` that fires `fetchDashboard()` — need to check if it calls TC/GH

- `D:\views\AV Dashboard\public\index.html`
  - `#ghCoveragePanel` ~line 1071: overview card with KPI strip + "📋 Module Breakdown" button
  - `#ghChartsPanel` ~line 1082: 3-chart grid (hidden by default)
  - `#testMatrixModal` ~line 1143: table-only modal with `#ghMatrixDeltaPanel` and `#ghCoverageBody`
  - All `data-*-group` attributes define slideshow card groupings

- `D:\views\AV Dashboard\config.json`
  - `github.repos`: 3 entries with `type`, `searchPath`, `owner`, `repo`, `label`
  - Current token: `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`

</important_files>

<next_steps>

**Immediate task — make TC and GitHub coverage load on-demand only:**

The fix needs two changes:

1. **`initTestCoverage()`** (line ~4088): Currently called on page load/section switch and immediately fires `loadTestCoverage()`. Change to only show a "Click Refresh to load" placeholder and NOT call `loadTestCoverage()` automatically.

2. **`loadTestCoverage()`** (line ~4125): Remove the `loadGithubCoverage()` call at the end (line 4141). GitHub coverage should be independent — triggered by its own Refresh button or auto-refresh timer only.

3. **`fetchDashboard()`** (line ~355): Check if it calls `initTestCoverage()` or `loadTestCoverage()`. If so, guard with a flag or remove the call — TC and GH coverage should NOT refresh when the main TFS data refreshes.

4. **Auto-refresh timer** (`startRefreshTimer()` line ~327): The `setInterval` fires `fetchDashboard()`. If the user has set an auto-refresh interval, both TC and GH coverage SHOULD also refresh at that interval — add separate calls in the timer for these if the user has manually loaded them at least once (use `state.tcLoadedOnce` and `state.ghCovLoadedOnce` flags).

5. Add a "Not loaded — click Refresh" state to `#ghCoveragePanel` and the TC section so the user knows data isn't auto-fetched.

</next_steps>