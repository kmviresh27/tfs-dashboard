<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme (Node.js/Express backend + Vanilla HTML/JS/CSS Filament dark theme). This session focused on: (1) adding a Defect Density Trend chart comparing snapshot baseline vs live, (2) fixing a Predictability 100% bug caused by unestimated features, (3) fixing PI filter confusion by adding a PI badge column to the features table, (4) moving the Defect Delta panel from the Features tab to the Defects tab, and (5) beginning work to remove local PI selectors from Sprint Trend and Velocity (use global filter instead) and fix the slideshow pagination for Features/Defects tables.
</overview>

<history>

1. **User asked for Defect Density Trend chart showing snapshot baseline vs actual live**
   - Added `GET /api/defect-density-trend?pis[]=...&teamPath=...` endpoint in `server.js`
   - Logic: finds earliest snapshot per PI (baseline), fetches live counts per PI via WIQL
   - Returns `{ trend: [{pi, baselineDensity, baselineLabel, baselineAt, liveDensity, liveFeatures, liveDefects}] }`
   - Added `📈 Defect Density Trend` card in Defects section (`index.html`) — grouped bar chart
   - Added `loadDefectDensityTrend()` and `renderDefectDensityTrend(trend)` in `app.js`
   - Baseline bars blue, actual bars green (improved) / red (worsened)
   - Called from `renderDefectsSection()` and on team filter change
   - Server restarted and confirmed running

2. **User reported Predictability showing 100% when PI just started**
   - Root cause: features without effort estimates contribute 0 to both `doneEffort` and `totalEffort`, making them invisible in the ratio. If only Done features have non-zero effort, `doneEffort/totalEffort = 100%`
   - Fix: added `effectiveEffort = max(rawEffort, 1)` for % calculation while keeping `rawEffort` for display
   - Server uses `_effTotal` / `_effDone` accumulators for pct calculation
   - Added `unestimated` count to summary response
   - Frontend shows amber warning bar: *"⚠ N features without effort estimate — counted as 1 unit each"* (`#predUnestimatedWarn`)
   - Fixed `renderPredTeamBar` to use `_effTotal/_effDone` from byTeam as well
   - Server restarted ✅

3. **User reported feature 1725641 (PI1) showing in PI2 dashboard**
   - Investigation: `areaPath = "Healthcare IT"`, `iterationPath = "Healthcare IT\\ISP"` — WIQL filtering is correct
   - Root cause: when user opens PI filter and clicks PI2, both PI1 and PI2 stay checked (multi-select) → PI1 features appear mixed in the table
   - Fix: added **colored PI badge column** to feature table — each row shows `26-PI1` / `26-PI2` as colored badge (PI1=blue, PI2=teal, PI3=amber, PI4=purple)
   - Added **"All PIs" dropdown filter** (`#featurePIFilter`) in the feature table header to filter table by specific PI without changing global selection
   - Split Iteration column into separate **PI badge** + **Sprint** columns (7→8 columns)
   - Added `extractPIFromIter()` and `piBadgeStyle()` helper functions
   - Wired `#featurePIFilter` into `setupTableFilters()` with change listener
   - Server restarted ✅

4. **User asked to move Defect Delta (vs Snapshot) from Features tab to Defects tab**
   - Removed `#defectDeltaPanel` HTML block from `#section-features` (was after Predictability panel)
   - Inserted `#defectDeltaPanel` into `#section-defects` after `#defectDensityTrendCard`, before `<!-- SLA BREACH ALERT -->`
   - Removed `renderDefectDelta()` call from `renderPredictability()` in `app.js`
   - Removed defect delta KPI clearing from `clearPredictability()`
   - Added module-level `_lastPredDefects = null` cache variable
   - `renderPredictability()` now stores `{ defects, defectSummary }` into `_lastPredDefects`
   - `renderDefectsSection()` now calls `renderDefectDelta()` from cache or `clearDefectDelta()` if no snapshot
   - Added `clearDefectDelta()` function
   - `setActiveSnapshot()` clears both `_lastPredDefects` and calls `clearDefectDelta()` on snapshot clear
   - `loadPredictability()` after fetch: if Defects tab active, re-renders delta immediately
   - Server restarted ✅

5. **User asked: Sprint Trend should use global PI (not its own selector); same for Velocity; Features/Defects slideshow going behind screen — fix with multiple pages (IN PROGRESS when compaction occurred)**
   - This work was NOT yet started — user request came in and compaction occurred
   - Sprint Trend has `#sprintTrendPISelect` dropdown + `#sprintTrendLoadBtn` button (to be removed)
   - Velocity has `#velPICheckGrid` checkbox grid + `#velLoadBtn` button (to be replaced with global)
   - Slideshow currently shows one section at a time; Features/Defects tables go off-screen because there's no pagination in slideshow mode

</history>

<work_done>

Files modified this session:

- `D:\views\AV Dashboard\server.js`
  - Added `GET /api/defect-density-trend` endpoint (~line 1169) — reads snapshots for baseline, fetches live counts per PI
  - Fixed `GET /api/predictability` — added `_effTotal`/`_effDone` effective effort accumulators (min 1 per feature), added `unestimated` count to summary and overall response

- `D:\views\AV Dashboard\public\index.html`
  - Added `#defectDensityTrendCard` card in Defects section (after injection rate charts)
  - Added `#predUnestimatedWarn` amber warning bar below KPI strip in Predictability panel
  - Feature table: added `#featurePIFilter` dropdown, added PI badge column (8 columns), renamed Sprint column
  - Moved `#defectDeltaPanel` from Features section to Defects section (after density trend, before SLA breach)

- `D:\views\AV Dashboard\public\app.js`
  - Added `loadDefectDensityTrend()` + `renderDefectDensityTrend(trend)` grouped bar chart
  - Added `let _densityChart` and `let _lastPredDefects` module-level cache vars
  - Fixed `renderPredictability()` — removed `renderDefectDelta()` call, stores to `_lastPredDefects`, shows unestimated warning
  - Fixed `renderPredTeamBar()` — uses `_effTotal/_effDone`
  - Fixed `clearPredictability()` — removed defect delta clearing
  - Fixed `setActiveSnapshot()` — clears `_lastPredDefects` + `clearDefectDelta()` on clear
  - Fixed `loadPredictability()` — refreshes Defects tab delta if active
  - Added `clearDefectDelta()` function
  - Fixed `renderDefectsSection()` — renders or clears defect delta from cache; calls `loadDefectDensityTrend()`
  - Added `extractPIFromIter()`, `piBadgeStyle()`, `PI_BADGE_COLORS` helpers
  - Rewrote `renderFeatureTable()` — PI badge column, Sprint column, PI filter dropdown, 8-column layout
  - Updated `setupTableFilters()` — added `#featurePIFilter` change listener

**Current state:**
- Server running at http://localhost:3000 ✅
- Defect Density Trend chart ✅
- Predictability 100% bug fixed ✅
- PI badge column + PI filter in features table ✅
- Defect Delta in Defects tab ✅
- **NOT YET DONE**: Sprint Trend / Velocity PI selector removal + slideshow pagination fix

</work_done>

<technical_details>

**Predictability % bug (100% on PI start):**
- Root cause: unestimated features (effort=0) contribute 0 to both numerator and denominator, making them invisible. If all Done features happen to have effort > 0 and all undone features have effort = 0, ratio = 100%.
- Fix: `effectiveEffort = rawEffort > 0 ? rawEffort : 1` — every feature counts as min 1 unit in the denominator
- Display effort KPIs still use `rawEffort` (actual TFS values) — only the % calculation uses `effectiveEffort`
- Server tracks `_effTotal` / `_effDone` separately from `totalEffort` / `doneEffort` on summary objects
- `unestimated` count added to response so UI can warn the user

**Defect Density Trend:**
- New server endpoint finds earliest snapshot per PI (baseline), then fetches live feature + defect counts via WIQL per PI
- Chart shows two bars per PI: baseline (blue) and actual (green if ≤ baseline, red if worse)
- Tooltip shows snapshot label, date, live feature count, live defect count
- Reloads on `renderDefectsSection()` and on team filter change (only if Defects tab active)

**PI badge column:**
- `extractPIFromIter(iterPath)` — regex `/(\d{2}-PI\d)/` extracts "26-PI1" from any iteration path string
- `piBadgeStyle(piLabel)` — returns inline CSS with PI-specific color from `PI_BADGE_COLORS` array
- PI badge is a colored chip next to state badge in every feature row
- New `#featurePIFilter` dropdown is auto-populated from unique PIs in current items on each render

**Defect Delta panel location:**
- Lives in DOM inside `#section-defects` but is populated from predictability API data
- `_lastPredDefects` module variable caches `{defects, defectSummary}` after each predictability load
- `renderDefectsSection()` consumes this cache; `clearDefectDelta()` resets it
- Clearing active snapshot (`setActiveSnapshot(null)`) also clears `_lastPredDefects` and `clearDefectDelta()`

**PI filter multi-select confusion:**
- `getDefaultPIs()` returns completed PIs (e.g., `['26-PI1']` when in PI2)
- Default `state.selectedPIs = ['26-PI1']` — dashboard shows PI1 data by default
- When user opens PI filter and clicks PI2, both PI1+PI2 remain selected (multi-select), causing PI1 features to appear in table
- Fixed by: PI badge per row + "All PIs" dropdown to filter table without changing global selection

**Sprint Trend selector (to be removed):**
- `setupSprintTrend()` populates `#sprintTrendPISelect` dropdown from `state.availablePIs`
- `initSprintTrend()` reads `sel.value` or falls back to `state.selectedPIs[0]`
- `loadSprintTrend(pi)` accepts single PI string (not array) → `GET /api/sprint-trend?pi=...`
- Replace: remove selector + Load button, auto-call `loadSprintTrend(state.selectedPIs[0] || state.currentPI)` on navigate

**Velocity selector (to be removed):**
- `initVelocity()` builds `#velPICheckGrid` checkboxes and `#velLoadBtn`
- `loadVelocity(piLabels)` accepts array of PI labels
- Replace: remove grid + Load button, auto-call `loadVelocity(state.selectedPIs)` on navigate and on global PI change

**Slideshow pagination issue:**
- `buildSlideshowSlides()` lists one slide per section — Features and Defects tables overflow off-screen in slideshow mode
- Current `SLIDESHOW_ROWS_PER_PAGE = 12` is defined but never used in slideshow logic
- `renderFeatureTable(items, slideshowPage)` and `renderDefectTable(items, slideshowPage)` already support pagination via `slideshowPage` param
- Fix needed: in slideshow, calculate total pages for features/defects, generate multiple slides, show page indicator, pass correct `slideshowPage` to render functions
- Also need to remove `{ section: 'compare', mode: 'full' }` from `buildSlideshowSlides()` — Compare section was removed

**config.json key values:**
- `tfs.areaPath = "Healthcare IT"` (very broad)
- `tfs.iterationPath = "Healthcare IT\\ISP"`
- `tfs.teamRootPath` = array of 5 team root paths
- `sizeField = "Microsoft.VSTS.Scheduling.Effort"`

</technical_details>

<important_files>

- `D:\views\AV Dashboard\server.js`
  - Main Express backend; all TFS API routes and data processing
  - `GET /api/defect-density-trend` ~line 1169: new endpoint for trend chart
  - `GET /api/predictability` ~line 1381: effort-based predictability with `_effTotal/_effDone` fix
  - `POST /api/snapshot` ~line 1262: captures features+defects, classifies by System.Tags
  - `GET /api/sprint-trend` ~line 695: accepts `teamPath`, single PI
  - `GET /api/velocity` ~line 864: accepts `pis[]`
  - Snapshot helpers: `listSnapshotFiles()` ~line 1244, `readSnapshot()` ~line 1254

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend logic (~3900+ lines)
  - `loadDefectDensityTrend()` / `renderDefectDensityTrend()` ~line 1148+: density chart
  - `renderFeatureTable()` ~line 637: PI badge + Sprint columns + PI filter
  - `extractPIFromIter()` / `piBadgeStyle()` ~line 622: PI extraction helpers
  - `renderDefectsSection()` ~line 692: calls density trend + defect delta from cache
  - `clearDefectDelta()` / `renderDefectDelta()` ~line 3764+: defect vs snapshot comparison
  - `setActiveSnapshot()` ~line 3421: global snapshot selection, clears delta on clear
  - `loadPredictability()` ~line 3599: fetches predictability + caches `_lastPredDefects`
  - `renderPredictability()` ~line 3625: predictability render, includes unestimated warning
  - `setupSprintTrend()` / `initSprintTrend()` ~line 1968: TO BE CHANGED (remove local selector)
  - `initVelocity()` ~line 2319: TO BE CHANGED (remove local PI grid)
  - `buildSlideshowSlides()` ~line 3148: TO BE CHANGED (add multi-page features/defects, remove compare)
  - `startSlideshow()` / `showSlideshowSlide()` ~line 3242: TO BE CHANGED (pagination support)

- `D:\views\AV Dashboard\public\index.html`
  - Dashboard HTML structure
  - `#defectDensityTrendCard` in Defects section ~line 683
  - `#defectDeltaPanel` in Defects section ~line 692 (moved from Features)
  - `#predUnestimatedWarn` in Features section ~line 495 (amber warning bar)
  - Feature table with `#featurePIFilter` ~line 581 (8 columns now)
  - Sprint Trend section with `#sprintTrendPISelect` + `#sprintTrendLoadBtn` ~line 937: TO BE REMOVED
  - Velocity section with `#velPICheckGrid` + `#velLoadBtn` ~line 785: TO BE REMOVED

- `D:\views\AV Dashboard\config.json`
  - TFS connection config, team root paths, field names
  - `iterationPath = "Healthcare IT\\ISP"` — used in all WIQL iteration clauses
  - `sizeField = "Microsoft.VSTS.Scheduling.Effort"` — used for predictability

</important_files>

<next_steps>

**Currently in progress (interrupted by compaction):**
The user's last request had THREE parts, none implemented yet:

1. **Sprint Trend — remove local PI selector, use global**
   - Remove `#sprint-trend-selector` div (contains `#sprintTrendPISelect` and `#sprintTrendLoadBtn`) from `index.html`
   - Remove `setupSprintTrend()` listener code in `app.js` (populate dropdown logic)
   - Change `initSprintTrend()` to auto-use `state.selectedPIs[0] || state.currentPI`
   - Wire team filter change to also call `loadSprintTrend` (already done in `setupTeamFilter`)
   - Wire global PI filter apply to call `initSprintTrend()`

2. **Team Velocity — remove local PI selector, use global**
   - Remove `#velocity-controls` card (contains `#velPICheckGrid` and `#velLoadBtn`) from `index.html`
   - Change `initVelocity()` to auto-call `loadVelocity(state.selectedPIs)` on navigate
   - Wire global PI filter apply to re-load velocity with new selection
   - Wire team filter change to re-load velocity if Velocity section active

3. **Slideshow pagination for Features and Defects tables**
   - Problem: full feature/defect tables overflow the viewport in slideshow mode
   - `renderFeatureTable(items, slideshowPage)` and `renderDefectTable(items, slideshowPage)` already support paging (param controls which page of 12 rows to show)
   - Fix `buildSlideshowSlides()`: calculate `Math.ceil(items.length / 12)` pages for features and defects, push one slide per page
   - Fix `showSlideshowSlide()`: when slide has `mode: 'table-page'`, pass `slide.page` to render function and show page indicator
   - Remove `{ section: 'compare', mode: 'full' }` from slides (Compare section was deleted)
   - Show `showSlidePageIndicator("Features 1/3")` for paginated slides

</next_steps>