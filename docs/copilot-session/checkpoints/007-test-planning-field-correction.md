<overview>
The AV Dashboard is a live TFS monitoring dashboard for the Philips Healthcare IT ISP Programme, built with Node.js/Express backend and Vanilla HTML/JS/CSS frontend using the Philips Filament dark-mode design system. This session focused on: fixing the "Story Points Delivered" chart (wrong TFS field), auditing and correcting all assumed TFS field names/states based on user confirmation, creating a TFS Field Dictionary (both markdown and HTML), improving the PI filter panel with year-based navigation, and planning three new feature areas (Test Coverage, Sprint Burndown, Cycle Time).
</overview>

<history>
1. **Story Points Delivered chart showed empty data**
   - Root cause: velocity route used `Microsoft.VSTS.Scheduling.Size` as fallback (doesn't exist in this TFS) and `StoryPoints` (not set on Features)
   - User confirmed: correct field is `Microsoft.VSTS.Scheduling.Effort`
   - Updated `config.json` sizeField, all 4 server.js locations, and `getSize()` fallback chain: Effort → StoryPoints → 0
   - Restarted server (PID 26924)

2. **User asked to audit all assumed TFS fields**
   - Presented table of confirmed vs. assumed fields
   - User provided corrections:
     - Escape ratio: Escaped = New + Accepted + **Investigated**; Caught = **Resolved + Closed** (removed Planned from caught)
     - Priority/rank field: `Philips.Rank` (not `Microsoft.VSTS.Common.Priority` or `StackRank`)
     - `Microsoft.VSTS.Common.Severity` — exists but often not populated (display only)
     - `Microsoft.VSTS.Build.FoundIn` — confirmed working
     - Feature lifecycle needs **Activated** state added between New and Approved

3. **Applied all TFS field corrections**
   - `config.json`: updated escapedStates, caughtStates, rankField
   - `server.js`: FEATURE_STATES (added Activated), DEFECT_STATES (added Investigated + Closed), WIP states (added Activated), all Philips.Rank references, p1p2Count exclusions, resolveRate includes Closed, aging/injection open guards exclude Closed
   - `app.js`: COLORS (added Activated, Investigated, Closed), FEATURE_STATES + DEFECT_STATES arrays, all WIP checks, renderCommittedVsDone inProgress = Activated + Approved, applyTeamFilter escape/caught/resolve/p1p2 all corrected
   - Server restarted (PID 40412)

4. **Created TFS Field Dictionary documentation**
   - Created `docs/TFS-FIELD-DICTIONARY.md` at project root with all 12 sections
   - User requested HTML version linked from dashboard
   - Created `public/docs/tfs-field-dictionary.html` — full Filament dark-mode styled HTML page with colored state pills, badges (✓/⚠/✗), formula blocks, lifecycle flows, RAG cells, decision rationale table
   - Added 4th card to `public/docs/index.html` (grid expanded to 4-column) linking to the dictionary
   - Accessible via topbar 📖 button → docs hub → TFS Field Dictionary

5. **PI Filter: year-based navigation**
   - User requested: year selector so PIs are filtered by year, not a flat list
   - Updated `config.json`: added `programmeStartYear: 2024`
   - Updated `/api/pi-list` route: returns all years from `programmeStartYear` to current year (not hardcoded ±2 years)
   - Added `state.piFilterYear` to track active year tab
   - Rewrote `renderPIFilterGrid()`: year tab row (scrollable) + 4 PI buttons for active year
   - Added `piFilterClear` button; added `scrollIntoView` for active year tab
   - CSS: `.pi-filter-wrap` wrapper (position:relative), panel anchors `top: calc(100% + 6px); left: 0` — positioned directly below button
   - Moved panel HTML inside `.pi-filter-wrap` in index.html
   - Server restarted (PID 12644)

6. **Removed redundant selection hint text**
   - User: "4 selected: 26-PI1..." hint is redundant since buttons show selection visually
   - Removed `updatePIFilterHint()` function and all calls
   - Removed other-year hint block from `renderPIFilterGrid()`
   - Removed `piFilterHint` span from index.html
   - Simplified `.pi-filter-footer` CSS (no more flex space-between)

7. **Planning: Test Coverage + Sprint Burndown + Cycle Time**
   - User initiated discussion of new features
   - Confirmed via questions:
     - Test Cases tracked as TFS work items + Test Plans/Runs
     - AutomationStatus field: `Microsoft.VSTS.TCM.AutomationStatus`
     - Unit tests: not tracked in TFS (placeholder only)
     - Test Run outcomes: Passed/Failed/Blocked/Not Executed/In Progress/Paused/Not Applicable
     - Test Cases linked to Features via `Microsoft.VSTS.Common.TestedBy-Reverse` (standard link)
     - Also scoped by AreaPath; IterationPath at root level for test cases
   - User chose: All three (Test Coverage + Sprint Burndown + Cycle Time)
   - User chose: Fetch TestedBy links per feature (slower but accurate) for feature coverage
   - Created 6 todos in SQL session DB with dependencies
</history>

<work_done>
Files modified:

- `D:\views\AV Dashboard\config.json`
  - `sizeField`: → `Microsoft.VSTS.Scheduling.Effort`
  - `defectEscapeRatio.escapedStates`: → `["New","Accepted","Investigated"]`
  - `defectEscapeRatio.caughtStates`: → `["Resolved","Closed"]`
  - `defectFields.rankField`: → `"Philips.Rank"`
  - `app.programmeStartYear`: → `2024`

- `D:\views\AV Dashboard\server.js`
  - `FEATURE_STATES`: added `'Activated'`
  - `DEFECT_STATES`: added `'Investigated'`, `'Closed'`
  - WIP count: added `'Activated'`
  - `processDefects()`: aging/injection open guards now exclude `'Closed'`; priority field → `Philips.Rank`; `resolveRate` includes Closed; `p1p2Count` excludes Closed
  - `itemSummary()`: `priority` sourced from `Philips.Rank`; `rankField` default → `'Philips.Rank'`
  - All field fetch lists: `Microsoft.VSTS.Common.Priority` → `Philips.Rank`, StackRank → `Philips.Rank`
  - `sizeField` fallbacks: all updated to use Effort as default
  - `getSprintDateRanges()`: removed (dead code)
  - `/api/pi-list`: now returns all years from `programmeStartYear` to current year; includes `years` array in response

- `D:\views\AV Dashboard\public\app.js`
  - `COLORS`: added `Activated (#9B5CFF)`, `Investigated (#e06c1f)`, `Closed (#068443)`
  - `FEATURE_STATES`: added `'Activated'`
  - `DEFECT_STATES`: added `'Investigated'`, `'Closed'`
  - `state`: added `piFilterYear: null`
  - `loadPIList()`: sets `piFilterYear` to current year on first load
  - `setupPIFilterPanel()`: added `piFilterClear` handler; updated click-outside to use `.pi-filter-wrap`
  - `renderPIFilterGrid()`: complete rewrite — year tabs + 4 PI buttons per year + scrollIntoView
  - Removed `updatePIFilterHint()` and all references
  - `renderWipSlip()`: added `'Activated'` to WIP check
  - `renderCommittedVsDone()`: `inProgress = Activated + Approved`; donut label updated
  - `applyTeamFilter()`: escape/caught/resolveRate/p1p2Count all corrected for new states
  - WIP count in `applyTeamFilter`: added `'Activated'`

- `D:\views\AV Dashboard\public\index.html`
  - PI filter button wrapped in `.pi-filter-wrap` div
  - Panel HTML moved inside wrapper; old standalone panel removed
  - `piFilterClear` button added; `piFilterHint` span removed
  - Year row `<div id="piYearRow">` added to panel

- `D:\views\AV Dashboard\public\style.css`
  - `.pi-filter-wrap`: `position: relative`
  - `.pi-filter-panel`: repositioned to `top: calc(100% + 6px); left: 0`
  - `.pi-year-row`: scrollable flex row with thin scrollbar
  - `.pi-year-btn`: `flex: 0 0 auto`, active state styling
  - `.pi-check-btn`: updated to show PI number prominently
  - `.pi-filter-footer` / `.pi-filter-actions`: simplified (hint removed)

Files created:

- `D:\views\AV Dashboard\docs\TFS-FIELD-DICTIONARY.md`
  - 12-section reference: connection, PI structure, feature fields, defect fields, feature states, defect states, escape ratio formula, resolve rate, SLA thresholds, config.json reference, key decisions

- `D:\views\AV Dashboard\public\docs\tfs-field-dictionary.html`
  - Full Filament dark-mode styled HTML dictionary page, 28KB
  - Colored state pills, ✓/⚠/✗ badges, formula blocks, lifecycle flows, RAG cells, decision table

- `D:\views\AV Dashboard\public\docs\index.html` (modified)
  - Added 4th card linking to tfs-field-dictionary.html
  - Grid expanded from 3 to 4 columns

Work completed:
- [x] Story Points Delivered chart fixed (Effort field)
- [x] All TFS field corrections applied (Philips.Rank, Activated state, Investigated+Closed states)
- [x] Escape ratio formula corrected
- [x] TFS Field Dictionary created (MD + HTML)
- [x] PI filter panel repositioned below button
- [x] Year tab navigation in PI filter
- [x] programmeStartYear config (all years accessible forever)
- [x] Selection hint removed
- [ ] Test Coverage section (planned, not started)
- [ ] Sprint Burndown (planned, not started)
- [ ] Cycle Time (planned, not started)

Current server PID: 12644
</work_done>

<technical_details>
**TFS Field Corrections (critical):**
- `Microsoft.VSTS.Scheduling.Effort` — correct size/effort field for Features AND Defects in this instance
- `Philips.Rank` — replaces both `Microsoft.VSTS.Common.Priority` AND `Microsoft.VSTS.Common.StackRank`; numeric rank used for SLA thresholds (1=7d, 2=14d, 3+=30d) and p1p2Count
- `Microsoft.VSTS.TCM.AutomationStatus` — test case automation field (TCM namespace, not Common)
- `Microsoft.VSTS.Common.Severity` — exists but rarely populated; display only, never filter

**Feature Lifecycle (confirmed final order):**
`Forecasted → New → Activated → Approved → Done | Removed`
- WIP states: `Activated` + `Approved`

**Defect Lifecycle (confirmed final order):**
`New → Accepted → Investigated → Planned → Resolved → Closed | Removed`
- Escaped: New + Accepted + Investigated
- Caught: Resolved + Closed
- Neutral: Planned (transitional)
- Excluded: Removed

**PI Filter Architecture:**
- `config.json.app.programmeStartYear = 2024` — all years from this year to current are shown forever
- Server builds year array: `for (let y = startYY; y <= yy; y++) years.push(y)`
- Client `state.piFilterYear` tracks which year tab is active in the panel
- Panel is inside `.pi-filter-wrap` (position:relative), anchored via `top: calc(100% + 6px); left: 0`
- Year tabs are scrollable (`overflow-x: auto`) to handle 5+ years gracefully
- `scrollIntoView` called on active year tab after render

**Test Coverage Architecture (planned):**
- Test Cases scoped by `AreaPath UNDER Healthcare IT\ICAP\ISP` (NOT IterationPath — test cases have root-level iteration)
- AutomationStatus field: `Microsoft.VSTS.TCM.AutomationStatus`; values: Automated, Not Automated, Planned
- Feature-to-TestCase link type: `Microsoft.VSTS.Common.TestedBy-Reverse` (Test Case → Feature direction)
- Test Runs outcomes: Passed, Failed, Blocked, Not Executed, In Progress, Paused, Not Applicable
- Pass Rate = Passed / (Passed + Failed + Blocked) × 100
- Unit tests: not in TFS — show placeholder card

**Cycle Time Architecture (planned):**
- Start date: `Microsoft.VSTS.Common.ActivatedDate` (when feature entered Activated state)
- End date: `System.ChangedDate` for Done items (imperfect — document limitation in UI subtitle)
- Compute per Done feature per team; show avg/min/max

**Sprint Burndown Architecture (planned):**
- Use IterationPath UNDER sprint path (same as velocity route)
- Per sprint: Done count + Done effort vs. Total count + Total effort
- Current sprint highlighted

**`fetchWorkItemDetails` auto-retry:** Strips unknown fields on 400 and retries — adding new fields like `Philips.Rank` is safe even if not all items have it.

**Server restart pattern:** `Stop-Process -Id {PID} -Force; Start-Process node -ArgumentList "server.js"` from project root.
</technical_details>

<important_files>
- `D:\views\AV Dashboard\server.js`
  - Main Express backend; all TFS API calls and data processing
  - `FEATURE_STATES` (~line 158): `['Forecasted','New','Activated','Approved','Done','Removed']`
  - `DEFECT_STATES` (~line 159): `['New','Accepted','Investigated','Planned','Resolved','Closed','Removed']`
  - `processFeatures()` (~line 176): wipCount uses Activated+Approved
  - `processDefects()` (~line 256): uses Philips.Rank, excludes Closed from open counts
  - `itemSummary()` (~line 365): priority sourced from Philips.Rank
  - `/api/pi-list` (~line 450): builds years from programmeStartYear to current
  - `/api/velocity` (~line 800): uses Effort field; sprint queries use IterationPath UNDER

- `D:\views\AV Dashboard\config.json`
  - `sizeField`: `"Microsoft.VSTS.Scheduling.Effort"`
  - `defectFields.rankField`: `"Philips.Rank"`
  - `escapedStates`: `["New","Accepted","Investigated"]`
  - `caughtStates`: `["Resolved","Closed"]`
  - `app.programmeStartYear`: `2024`

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend logic (~3000+ lines)
  - `COLORS` (~line 7): includes Activated, Investigated, Closed
  - `FEATURE_STATES` (~line 25): includes Activated
  - `DEFECT_STATES` (~line 26): includes Investigated, Closed
  - `state` (~line 38): includes `piFilterYear`
  - `loadPIList()` + `renderPIFilterGrid()` (~line 156): year-tab PI filter
  - `renderCommittedVsDone()` (~line 1902): inProgress = Activated + Approved
  - `applyTeamFilter()` (~line 2566): all corrected state-based calculations

- `D:\views\AV Dashboard\public\index.html`
  - `.pi-filter-wrap` wraps button + panel for positioning
  - `piYearRow` div inside panel for year tabs

- `D:\views\AV Dashboard\public\style.css`
  - `.pi-filter-wrap`, `.pi-filter-panel` (repositioned)
  - `.pi-year-row` (scrollable), `.pi-year-btn` (tab styles)

- `D:\views\AV Dashboard\public\docs\tfs-field-dictionary.html`
  - Definitive field reference, linked from dashboard via 📖 → docs hub
  - 9 sections: TFS connection, PI structure, feature fields, defect fields, feature states, defect states, escape ratio, resolve rate/SLA, key decisions

- `D:\views\AV Dashboard\docs\TFS-FIELD-DICTIONARY.md`
  - Same content in markdown format for repository reference
</important_files>

<next_steps>
Remaining work (in SQL todos):

1. **`tc-backend`** — `/api/test-coverage` route:
   - WIQL: `SELECT [System.Id],[System.AreaPath],[Microsoft.VSTS.TCM.AutomationStatus] FROM WorkItems WHERE [System.WorkItemType] = 'Test Case' AND [System.AreaPath] UNDER 'Healthcare IT\ICAP\ISP'`
   - Group by team (AreaPath) and AutomationStatus (Automated / Not Automated / Planned)
   - Test Runs REST API: `GET {baseUrl}/_apis/test/runs?api-version=5.0` → aggregate outcomes
   - Feature coverage: for each feature, `GET _apis/wit/workItems/{id}?$expand=relations` and check for `Microsoft.VSTS.Common.TestedBy-Reverse` links
   - Return: automationBreakdown, passRate, outcomeBreakdown, featuresWithTests, featuresWithoutTests

2. **`tc-frontend`** — New "🧪 Test Coverage" sidebar section:
   - Automation donut (Automated/Manual/Planned) + team breakdown bar
   - Execution outcomes bar + Pass Rate KPI
   - Features without test cases table (behind 📋 modal)
   - Unit test placeholder card ("Not tracked in TFS")

3. **`ct-backend`** — Cycle Time additions:
   - Add `Microsoft.VSTS.Common.ActivatedDate` to feature fetch fields
   - For Done features: cycle time = ChangedDate - ActivatedDate (fallback to CreatedDate)
   - Add `cycleTime: { avg, min, max, byTeam }` to processFeatures output

4. **`ct-frontend`** — Cycle Time chart in Features section:
   - Bar chart: avg cycle time per team
   - Tooltip shows min/max
   - Subtitle notes ChangedDate limitation

5. **`sb-backend`** — `/api/sprint-burndown` route:
   - Per sprint in selected PI: Done count, Total count, Done effort, Total effort
   - Uses `IterationPath UNDER {iterBase}\{piLabel}\{piLabel} {sprintLabel}`

6. **`sb-frontend`** — Sprint Burndown in Sprint Trend section:
   - Stacked bar: Done vs Remaining per sprint
   - % complete line overlay
   - Current sprint highlighted

**Immediate next step:** Start with `tc-backend` (Test Coverage API), then `tc-frontend`, then cycle time, then burndown. All three backend routes can be built independently before frontend work.
</next_steps>