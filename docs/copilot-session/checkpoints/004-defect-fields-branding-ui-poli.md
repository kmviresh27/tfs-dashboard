<overview>
The user is building "AV Dashboard" — a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme targeting R&D leaders and Executive Directors. The stack is Node.js (Express) backend + Vanilla HTML/JS/CSS frontend using Philips Filament Design Language System (dark mode). The dashboard monitors Features and Defects under `Healthcare IT\ICAP\ISP`, auto-refreshes every 30 minutes, and provides PI/Quarter-based navigation. This session focused on adding defect enrichment fields (How Found, Where Found, Severity, Rank, Size), ChangedDate-based velocity, nested team filter dropdown, Philips branding, UI polish (no border-radius, scrollable scorecard), and multi-entry Team Root Path support.
</overview>

<history>
1. **User reported Size field 400 error** (`Microsoft.VSTS.Scheduling.Size` not found in TFS)
   - Added retry loop in `fetchWorkItemDetails` that strips unknown fields on 400 and retries
   - Changed `config.json` default `sizeField` to `Microsoft.VSTS.Scheduling.StoryPoints`
   - Removed hardcoded `Microsoft.VSTS.Scheduling.Size` from all field arrays

2. **User reported WhereFound field 400 error** (`Custom.WhereFound` not found)
   - The retry logic was only handling one bad field, not multiple
   - Fixed `fetchWorkItemDetails` to use a `while (!done)` loop, stripping one bad field per iteration
   - Cleared `howFoundField` and `whereFoundField` to empty strings in config as interim fix

3. **User provided correct TFS field reference names:**
   - How Found: `Microsoft.VSTS.CMMI.HowFound`
   - Where Found: `Philips.Defects.WhereFound`
   - Updated `config.json` with real field names

4. **User asked to add Rank and Severity fields**
   - Added `severityField: "Microsoft.VSTS.Common.Severity"` and `rankField: "Microsoft.VSTS.Common.StackRank"` to config
   - Updated `processDefects()` to aggregate `severityBreakdown`
   - Updated `itemSummary()` to include severity, rank, howFound, whereFound, size
   - Added Severity breakdown donut chart alongside How Found / Where Found (3-column grid)
   - Added Severity filter dropdown in defect table controls
   - Defect table now shows: Severity (colour-coded), Priority, Rank, How Found, Where Found, Iteration, Changed
   - Fixed `processFeatures` call to `itemSummary` (was passing wrong args)

5. **User requested multi-entry Team Root Path in Settings**
   - Changed Settings field from `<input>` to `<textarea>` (one path per line)
   - `config.json` now stores `teamRootPath` as a JSON array
   - `extractTeam()` on server tries each root in order, first match wins
   - `extractTeamFromPath()` in frontend does the same
   - POST `/api/config` normalises any format to clean array on save
   - Backward compatible with old single-string configs

6. **User requested nested team filter dropdown**
   - Added `teamMatchesFilter(areaPath, filter)` helper supporting `ROOT:` prefix values
   - `populateTeamFilter()` rebuilt to use `<optgroup>` per root path
   - Each group shows "All [RootName]" option (value = `ROOT:fullPath`) + individual teams
   - `applyTeamFilter()` updated to re-aggregate howFoundBreakdown, whereFoundBreakdown, severityBreakdown when filtering
   - `filterVelocityByTeam()` updated to handle ROOT: prefix
   - Defect table team filter updated to use `teamMatchesFilter`

7. **User requested no border-radius anywhere + Philips branding**
   - Set `--radius: 0px`, `--radius-lg: 0px`, `--radius-pill: 0px` in CSS tokens
   - Zeroed scrollbar-thumb, progress bar fills (kept `border-radius: 50%` only for functional status dots)
   - Replaced sidebar brand logo SVG with Philips "P" mark on blue background
   - Added `brand-philips` class ("PHILIPS" in blue, letter-spacing: 2.5px)
   - Added topbar brand strip: "PHILIPS | Advanced Visualization · ISP"
   - Updated wizard logo and title to use Philips branding
   - Page title updated to "Philips Advanced Visualization – ISP Programme Dashboard"

8. **User requested Team Health Scorecard table to have scroll**
   - Added `table-wrap-scroll` class to the scorecard's `table-wrap` div (one-line change)

9. **User requested slideshow ON by default + sidebar collapsed by default** ← IN PROGRESS when compaction occurred
   - Found the relevant code locations but changes NOT yet made
</history>

<work_done>
Files modified:

- `D:\views\AV Dashboard\server.js`
  - `fetchWorkItemDetails`: while-loop retry stripping unknown fields on TFS 400
  - `getSprintDateRanges()`: new helper computing sprint date windows from PI label
  - `extractTeam()`: now accepts array of roots, tries each in order
  - `processDefects()`: added severityBreakdown, howFoundBreakdown (conditional), whereFoundBreakdown; accepts `defectFieldsCfg` object
  - `itemSummary()`: now includes size, severity, rank, howFound, whereFound; accepts `defectFieldsCfg`
  - `/api/dashboard` and `/api/defects`: include severity, rank, size, how/where found fields
  - `/api/config POST`: normalises teamRootPath to array
  - `/api/velocity`: ChangedDate-based sprint velocity with `getSprintDateRanges()`

- `D:\views\AV Dashboard\config.json`
  - `teamRootPath`: changed from string to array `["Healthcare IT\\ICAP\\ISP\\Hercules"]`
  - `defectFields`: `howFoundField: "Microsoft.VSTS.CMMI.HowFound"`, `whereFoundField: "Philips.Defects.WhereFound"`, `severityField: "Microsoft.VSTS.Common.Severity"`, `rankField: "Microsoft.VSTS.Common.StackRank"`
  - `sizeField`: `"Microsoft.VSTS.Scheduling.StoryPoints"`

- `D:\views\AV Dashboard\public\index.html`
  - Sidebar brand: Philips "P" SVG + PHILIPS wordmark + "Advanced Visualization" + "ISP Programme · Dashboard"
  - Topbar: Philips brand strip added after hamburger button
  - Defect table: new headers (Severity, Priority, Rank, How Found, Where Found, Iteration, Changed)
  - Defect filters: added How Found, Where Found, Severity filter dropdowns
  - 3-column chart grid for How Found / Where Found / Severity breakdown donuts
  - Team Root Path settings: `<input>` → `<textarea>`
  - Team Health Scorecard: `table-wrap` → `table-wrap table-wrap-scroll`
  - Page title: "Philips Advanced Visualization – ISP Programme Dashboard"
  - Wizard: Philips branding

- `D:\views\AV Dashboard\public\app.js`
  - `state.teamRootPath`: normalised to array on load
  - `extractTeamFromPath()`: tries each root in array
  - `teamMatchesFilter()`: new helper for `ROOT:` prefix and exact team name
  - `populateTeamFilter()`: now uses `<optgroup>` per root with "All [Root]" option
  - `applyTeamFilter()`: uses `teamMatchesFilter`, re-aggregates all breakdown fields
  - `filterVelocityByTeam()`: handles ROOT: prefix
  - `renderDefectsSection()`: calls 3 breakdown charts (How Found, Where Found, Severity)
  - `populateDefectFilters()`: replaces old `populateDefectTeamFilter`, handles all 4 dropdowns
  - `renderDefectBreakdownChart()`: new function for donut charts from breakdown objects
  - `renderDefectTable()`: new columns (Severity coloured, Priority, Rank, How Found, Where Found); 5 filters
  - Velocity: "Size Points" label instead of "Story Points"
  - Settings form: teamRootPath loaded/saved as newline-joined text

- `D:\views\AV Dashboard\public\style.css`
  - `--radius: 0px`, `--radius-lg: 0px`, `--radius-pill: 0px`
  - Scrollbar thumb `border-radius: 0`
  - Progress bar fills `border-radius: 0`
  - New classes: `.brand-philips`, `.topbar-brand`, `.topbar-philips`, `.topbar-brand-sep`, `.topbar-product`

- `D:\views\AV Dashboard\config.sample.json`: mirrored config.json structure changes

**Current state**: Server running on port 3000, HTTP 200. All changes above verified syntax-clean.

**Not yet done**: Slideshow ON by default + sidebar collapsed by default (interrupted by compaction).
</work_done>

<technical_details>
- **TFS 400 on unknown fields**: `workitemsbatch` returns HTTP 400 with `"TF51535: Cannot find field X"` if ANY field in the request array doesn't exist. The retry loop strips one field per iteration (regex: `/Cannot find field ([A-Za-z0-9_.]+)/`). The regex strips trailing `.` from the matched field name.

- **Actual TFS field names** (confirmed by user):
  - How Found: `Microsoft.VSTS.CMMI.HowFound`
  - Where Found: `Philips.Defects.WhereFound`
  - Severity: `Microsoft.VSTS.Common.Severity`
  - Rank: `Microsoft.VSTS.Common.StackRank`
  - Size/Story Points: `Microsoft.VSTS.Scheduling.StoryPoints` (Size field doesn't exist)

- **TFS Configuration**:
  - Base URL: `https://tfsemea1.ta.philips.com/tfs/TPC_Region11/Healthcare%20IT`
  - Auth: `Basic base64(":" + PAT)`
  - Area path: `Healthcare IT\ICAP\ISP`
  - Iteration path: `Healthcare IT\ISP`
  - Team root: `Healthcare IT\ICAP\ISP\Hercules`
  - API version: `5.0`
  - Work item types: `Feature` / `Defect` (not User Story / Bug)

- **Nested team filter**: Uses `<optgroup>` (non-selectable header) + "All [Root]" option with value `ROOT:fullPath`. `teamMatchesFilter(areaPath, 'ROOT:...')` checks `areaPath.startsWith(root)`. For velocity, ROOT: filter shows all teams (byTeam keys are team names, can't filter by area path at that level).

- **teamRootPath array**: Stored as JSON array in config. Server's `extractTeam()` and frontend's `extractTeamFromPath()` both try each root in order, return first match. Fallback: last segment of area path.

- **ChangedDate velocity**: Sprint date windows computed by `getSprintDateRanges(piLabel)` — splits PI quarter into 4 equal chunks (qDays/4). Sprint WIQL uses `State = 'Done' AND ChangedDate >= start AND ChangedDate <= end`. PI-end still uses IterationPath UNDER for accuracy.

- **Border-radius removal**: Setting CSS token variables to 0 cascades to all components. `border-radius: 50%` kept ONLY on functional indicator dots (refresh status dot, nav badge) which must remain circular.

- **`[hidden]` attribute override**: `[hidden] { display: none !important; }` is required in CSS reset because Filament's flex/block display rules override the HTML `hidden` attribute otherwise.

- **Filament design tokens**: `--bg:#242424`, `--bg-card:#2B2B2B`, `--primary:#0072db`. Philips brand blue is same as primary. PHILIPS wordmark uses `letter-spacing: 2.5px; font-weight: 800`.

- **Slideshow**: `startSlideshow()` / `stopSlideshow()` functions exist. `slideshow.active` starts as `false`. To enable by default: call `startSlideshow()` after `fetchDashboard()` completes.

- **Sidebar collapse**: `$('sidebar').classList.toggle('collapsed')` is the toggle. To collapse by default: add `collapsed` class to sidebar in HTML or call toggle on init.
</technical_details>

<important_files>
- `D:\views\AV Dashboard\server.js`
  - Express backend, all API routes, TFS proxy
  - Key: `fetchWorkItemDetails` (retry loop ~line 147), `getSprintDateRanges` (~line 62), `extractTeam` (~line 178), `processDefects` (~line 222), `itemSummary` (~line 277), `/api/velocity` endpoint (~line 650)
  - All data processing, field extraction, PI/sprint logic here

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend ~1900+ lines
  - Key: `teamMatchesFilter` (~line 2124), `populateTeamFilter` (~line 2140), `applyTeamFilter` (~line 2215), `renderDefectTable` (~line 658), `renderDefectBreakdownChart` (~line 626), `filterVelocityByTeam` (~line 1817), `startSlideshow`/`stopSlideshow` (~line 2398), sidebar toggle (~line 131)
  - `state.teamRootPath` always an array after `loadConfig()`

- `D:\views\AV Dashboard\public\index.html`
  - Dashboard shell: sidebar nav, topbar with Philips branding, all 9 sections
  - Defect section has 3 breakdown chart canvases + 5 filter dropdowns + 11-column table
  - Team Health Scorecard has `table-wrap-scroll`

- `D:\views\AV Dashboard\public\style.css`
  - Filament dark mode CSS; all `--radius*` tokens = 0
  - `.table-wrap-scroll`: `max-height: 420px; overflow-y: auto` with sticky headers
  - `.topbar-brand`, `.brand-philips` for Philips branding
  - `[hidden] { display: none !important; }` critical fix

- `D:\views\AV Dashboard\config.json`
  - Live config with PAT (git-ignored)
  - `teamRootPath` is now an array
  - `defectFields` has all 4 confirmed field names
  - `sizeField` = StoryPoints
</important_files>

<next_steps>
Remaining work (interrupted by compaction):

1. **Slideshow ON by default** — find the post-`fetchDashboard()` block in app.js DOMContentLoaded handler (~line 84) and call `startSlideshow()` after `fetchDashboard()` and `startRefreshTimer()`:
   ```javascript
   await fetchDashboard();
   startRefreshTimer();
   startSlideshow(); // ← add this
   ```

2. **Sidebar collapsed by default** — two approaches:
   - Option A: Add `collapsed` class directly to `<nav class="sidebar" id="sidebar">` in index.html
   - Option B: In `setupNavigation()` or DOMContentLoaded in app.js, call `$('sidebar').classList.add('collapsed')` on init
   - Option A (HTML) is cleanest — no flash of open sidebar before JS runs

After both changes, restart server (no server.js changes needed — frontend-only).
</next_steps>