<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme (Node.js/Express + Vanilla HTML/JS/CSS, Filament dark theme). This session focused on UI/UX polish and performance improvements: (1) renaming all "snapshot" terminology to "PI Plan Data" in the dashboard UI, (2) reorganising the topbar refresh status display, (3) implementing cache-key guards to prevent heavy APIs from re-fetching on every page navigation, and (4) fixing the velocity API to pass teamPath for team-filtered requests.
</overview>

<history>

1. **User asked: move `refreshStatus`/`nextRefresh` to topbar, `lastUpdated` to sidebar footer**
   - Removed `#refreshStatus` + `#nextRefresh` from `<nav>` sidebar footer
   - Added `<div class="topbar-refresh-block">` in topbar (right side, after docs icon) containing both elements stacked right-aligned
   - Moved `#lastUpdated` into `<div class="sidebar-footer">` in nav
   - Added `.topbar-refresh-block` CSS: `flex-direction:column`, `align-items:flex-end`, overrides `padding-left:0` on `.next-refresh` (which had sidebar-specific padding)
   - `app.js` needed no changes — same element IDs

2. **User asked: rename "snapshot" → "PI Plan Data" everywhere in the dashboard**
   - Updated all user-facing text in `index.html` and `app.js` (function names, API routes, `state` property names kept unchanged — only display strings changed)
   - `index.html` changes: topbar button `📸 Snapshot` → `📋 PI Plan Data`, chip tooltip, predictability card subtitle, predSnapInfo text, table column headers (`Snapshot State` → `PI Plan State`), defect delta card title/subtitle, KPI labels (`Snapshot Defects` → `Plan Defects`, `Snapshot Escape Ratio` → `Plan Escape Ratio`), TC delta card title/header column, modal title `📸 Snapshots` → `📋 PI Plan Data`, capture tab button, description text, footer button
   - `app.js` changes: `setActiveSnapshot()` info text, notification messages, empty-state messages, chart legend label (`Baseline (snapshot)` → `Baseline (PI Plan Data)`), tooltip label, `_renderGhMatrixDelta()` heading/column headers, `loadSnapshotBrowser()` empty state

3. **User asked: heavy APIs calling on every page load — fix `sprint-burndown`, `velocity`, `test-coverage`, `snapshot-tc-delta`, `github-coverage`**
   - Added 3 cache key fields to `state`: `sprintTrendKey`, `velocityKey`, `tcKey` (format: `"pis||selectedTeam"`)
   - Modified `initSprintTrend(force=false)`, `initVelocity(force=false)`, `initTestCoverage(force=false)` to check key before calling API; skip if key unchanged unless `force=true`
   - `fetchDashboard()`: clears all 3 keys **before** `renderAll()`, then calls `initSprintTrend(true)`, `initVelocity(true)`, `initTestCoverage(true)` unconditionally to refresh all pages in background
   - PI filter `piFilterApply` handler: passes `force=true` to all three
   - Team filter handler: passes `force=true` to all three (when section active)

4. **User asked: `defect-density-trend` API also calling every time**
   - Added `defectDensityKey` to `state`
   - `loadDefectDensityTrend()`: computes key `"pis||teamPath"`, returns early if key matches
   - `fetchDashboard()`: clears `defectDensityKey = null` **before** `renderAll()` (critical — if cleared after, `renderAll`→`renderDefectsSection`→`loadDefectDensityTrend()` sets the key, then clearing it defeats the purpose)
   - Bug fixed: initial implementation cleared keys **after** `renderAll()`, causing defect density to always reload on next navigation. Moved all key clears to before `renderAll()`.

5. **User asked: why have an explicit Refresh button for unit test coverage when global refresh exists**
   - Removed `<button class="btn btn-ghost btn-sm" onclick="loadGithubCoverage()">🔄 Refresh</button>` from `#ghCoveragePanel` card header
   - Global 🔄 Refresh → `fetchDashboard()` → `initTestCoverage(true)` → chains `loadGithubCoverage()`

6. **User asked: make explicit refresh and auto-interval update ALL pages, not just active section**
   - Updated `fetchDashboard()` to call `initSprintTrend(true)`, `initVelocity(true)`, `initTestCoverage(true)` unconditionally (not just for active section) — background loads so all sections are fresh when navigated to

7. **User reported: velocity not passing teamPath when team selected (`/api/velocity?pis[]=26-PI2`)**
   - `loadVelocity()` was building query with only `pis[]`, no `teamPath`
   - Fixed client: added `getTeamAreaPath()` call and `teamPath=` param in `loadVelocity()`
   - Fixed server: `/api/velocity` endpoint didn't read `req.query.teamPath` at all — hardcoded `cfg.tfs.areaPath` in all WIQL queries
   - Added `const teamPath = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null` and `const filterPath = teamPath || cfg.tfs.areaPath` in server.js; replaced both WIQL `cfg.tfs.areaPath` references with `filterPath`
   - User confirmed URL now correctly shows: `http://localhost:3000/api/velocity?pis[]=26-PI2&teamPath=Healthcare%20IT%5CICAP%5CISP%5CHercules%5CAvyay`

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\public\index.html`
  - Moved `#refreshStatus` + `#nextRefresh` from sidebar footer into new `.topbar-refresh-block` div in topbar
  - Moved `#lastUpdated` into sidebar footer (was in topbar)
  - All user-facing "snapshot/Snapshot/📸" text replaced with "PI Plan Data/📋"
  - Removed redundant `🔄 Refresh` button from `#ghCoveragePanel`

- `D:\views\AV Dashboard\public\style.css`
  - Added `.topbar-refresh-block` styles (flex column, right-aligned, padding override for `.next-refresh`)

- `D:\views\AV Dashboard\public\app.js`
  - Added `sprintTrendKey`, `velocityKey`, `tcKey`, `defectDensityKey` to `state` object
  - `initSprintTrend(force=false)`, `initVelocity(force=false)`, `initTestCoverage(force=false)`: key-based cache guard
  - `loadVelocity()`: added `getTeamAreaPath()` + `teamPath` query param
  - `loadDefectDensityTrend()`: key-based cache guard
  - `fetchDashboard()`: clears all 4 keys before `renderAll()`, then calls all 3 init functions unconditionally for background refresh
  - All "snapshot" display strings updated to "PI Plan Data"

- `D:\views\AV Dashboard\server.js`
  - `/api/velocity` endpoint: reads `req.query.teamPath`, defines `filterPath`, uses it in both sprint-level and PI-end WIQL queries

Work completed:
- ✅ Topbar refresh status reorganised
- ✅ "PI Plan Data" rename across all UI
- ✅ Sprint trend, velocity, test coverage, GitHub coverage, defect density — all cache-guarded
- ✅ All pages refresh on global Refresh / auto-interval
- ✅ Velocity passes teamPath to server and server filters WIQL accordingly
- ✅ Redundant section-level refresh button removed

</work_done>

<technical_details>

**Cache key pattern:**
- Key format: `"pis.join(',')  ||  selectedTeam"` — covers both PI change and team filter change
- Keys must be cleared **before** `renderAll()` in `fetchDashboard()`, not after. If cleared after, `renderDefectsSection()` (called inside `renderAll`) calls `loadDefectDensityTrend()` which sets the key — then clearing it immediately after means the next navigation finds null and re-fetches unnecessarily.

**`force=true` parameter:**
- PI filter `piFilterApply` and team filter handler pass `force=true` to all `initXxx()` calls to bypass key check
- `fetchDashboard()` passes `force=true` + reloads ALL sections in background regardless of which is active

**`filterVelocityByTeam` gotcha (partially unfixed):**
- Client-side `filterVelocityByTeam(velocity, filter)` has `if (isRoot) return byTeam` — i.e., when team is selected from the tree (always `ROOT:` prefix), it skips filtering and returns all teams
- This was originally a workaround, but now that server-side `filterPath` filters TFS data, the server only returns data for the selected team's area — so `byTeam` in the response only contains that team's data anyway. The client-side `isRoot` shortcut is harmless when server filtering is active.
- However: if `getTeamAreaPath()` returns `null` (can't find area path), server falls back to `cfg.tfs.areaPath` (all teams) and client-side filter is still broken for `ROOT:` values.

**Team filter values:**
- Flat team list (no tree): `data-tf-val="Avyay"` → `state.selectedTeam = "Avyay"` (plain name)
- Tree nodes: `data-tf-val="ROOT:Healthcare IT\ICAP\ISP\Hercules\Avyay"` → `state.selectedTeam = "ROOT:..."`
- `getTeamAreaPath()` handles `ROOT:` prefix: `if (filter.startsWith('ROOT:')) return filter.slice(5)`

**`getTeamAreaPath()` flow:**
- Returns `null` if no team selected
- For `ROOT:` prefix: returns path directly (e.g. `Healthcare IT\ICAP\ISP\Hercules\Avyay`)
- For plain team name: looks up item in `state.data` to find area path, extracts team segment from `teamRootPath`

**Server `decodeURIComponent` note:**
- Express `req.query` already URL-decodes values; calling `decodeURIComponent` again is redundant but harmless (no double-percent-encoding in practice)

**Velocity area path depth:**
- Avyay team is at `Healthcare IT\ICAP\ISP\Hercules\Avyay` (4 levels deep under root), not just `ISP\Avyay` — the intermediate `Hercules` node is a structural parent. The WIQL `UNDER` operator handles any depth correctly.

</technical_details>

<important_files>

- `D:\views\AV Dashboard\public\app.js`
  - Main frontend (~4600+ lines); all dashboard logic
  - `state` object ~line 40: now has `sprintTrendKey`, `velocityKey`, `tcKey`, `defectDensityKey`
  - `fetchDashboard()` ~line 358: clears keys, calls all init functions unconditionally
  - `initSprintTrend(force)` ~line 2019, `initVelocity(force)` ~line 2353, `initTestCoverage(force)` ~line 4105: cache-guarded
  - `loadVelocity()` ~line 2364: now passes `teamPath`
  - `loadDefectDensityTrend()` ~line 1169: cache-guarded with `defectDensityKey`
  - `setActiveSnapshot()` ~line 3588, `renderPredTable()` ~line 3925, `renderDefectDelta()` ~line 4028, `_renderGhMatrixDelta()` ~line 4500: all display strings updated to "PI Plan Data"

- `D:\views\AV Dashboard\public\index.html`
  - Main HTML; topbar structure changed, all "Snapshot" UI text updated
  - `.topbar-refresh-block` ~line 194: new wrapper for refreshStatus + nextRefresh
  - `#lastUpdated` ~line 116: moved to sidebar footer
  - `#snapshotBtn` ~line 180: now labelled "📋 PI Plan Data"
  - `#snapshotModal` ~line 1194: title and button labels updated

- `D:\views\AV Dashboard\public\style.css`
  - `.topbar-refresh-block` added ~line 255: controls topbar refresh display layout

- `D:\views\AV Dashboard\server.js`
  - `/api/velocity` ~line 866: now reads `req.query.teamPath` → `filterPath`; WIQL queries at ~line 927 and ~line 947 use `filterPath` instead of `cfg.tfs.areaPath`

</important_files>

<next_steps>

No explicit pending tasks from the user — all requested items in this session are complete. Potential follow-ups to watch for:

- **Velocity still showing wrong total?** If the user reports 258 after the server fix, verify TFS is returning filtered data with the `UNDER` clause on the deep path `Healthcare IT\ICAP\ISP\Hercules\Avyay`. Could also add a console.log in the velocity endpoint to confirm `filterPath` value.
- **`filterVelocityByTeam` `isRoot` bug**: client-side `isRoot` shortcut still returns all `byTeam` data. This is now harmless because the server filters, but if `getTeamAreaPath()` ever returns null (e.g. team name not found in state.data), server falls back to full area path and client-side filter won't narrow it. Consider fixing by extracting team name from ROOT: path's last segment.
- **TC/GitHub coverage first-load UX**: When a user first opens the test coverage section, they may see a blank state until the background load (triggered by fetchDashboard at startup) completes. Consider showing a "Loading…" indicator.

</next_steps>