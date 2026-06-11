<overview>
The user is building "AV Dashboard" — a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme, targeting R&D leaders and Executive Directors. The stack is Node.js (Express) backend + Vanilla HTML/JS/CSS frontend using Philips Filament Design Language System (dark mode v4.12.0), running locally at `http://localhost:3000`. The dashboard monitors Features and Defects under `Healthcare IT\ICAP\ISP`, auto-refreshes every 30 minutes, and provides PI/Quarter-based navigation, Feature lifecycle funnels, Defect ratios, team-wise breakdowns, executive health scores, and now velocity tracking.
</overview>

<history>
1. **Initial build (prior checkpoint)** — Full Phase 1 + Phase 2 P0/P1 dashboard built with server.js, public/index.html, public/app.js, public/style.css. All 20 Phase 1+2 todos completed. Executive summary, RAG indicators, PI comparison, setup wizard, team scorecard all implemented.

2. **User reported error-banner always visible** → Fixed with `[hidden] { display: none !important; }` in CSS reset.

3. **User asked to build all 5 remaining Phase 2 todos** (sprint-trend, defect-density, committed-vs-done, feature-aging, export-print) → Delegated to background agent which implemented all 5. Server restarted and verified.

4. **User requested 3 UI improvements:**
   - Scrollable Feature/Defect list tables → added `table-wrap-scroll` class with `max-height: 420px; overflow-y: auto` and sticky headers
   - Slideshow mode → `▶ Slideshow` toggle button in topbar, cycles all sections every 10s, glows amber when active
   - Move Settings/Docs to top-right → removed from sidebar "Configuration" section, added as icon buttons (`⚙` / `📖`) with separator in topbar-actions

5. **User asked "anything you feel want to add?"** → Proposed 5 improvements, user approved all:
   - PI Stage progress bar in topbar (sprint label + gradient bar + %)
   - Alert badge on Defects nav (red count of P1/P2 open)
   - Global team filter dropdown (scopes entire dashboard to one team)
   - Keyboard shortcuts (←→ navigate, S slideshow, R refresh, ? help toast)
   - Stale data warning (⚠ amber if last refresh >35 min ago)

6. **User asked about velocity tracking** → Explained calculation approach, user confirmed "Both — show both metrics (features + story points)"
   - Added `/api/velocity` endpoint to server.js
   - Added `⚡ Velocity` nav section with PI selector, sprint velocity bar charts, story points chart, trend line chart, PI-end summary cards, velocity table with Avg/PI + trend arrows
   - Verified: endpoint returns 200, 4 sprints, 217 features for 26-PI1

7. **User reported two bugs:**
   - `.exec-kpi-strip` needs margin-top → added `margin-top: 16px` to CSS
   - Team dropdown not affecting Velocity page → added `state.velData` caching, `filterVelocityByTeam()`, `renderVelocity()` wrapper, wired team filter change to re-render velocity, updated `activateSection` to re-render with filter when navigating to velocity

8. **User asked how velocity is calculated** → Explained current approach (IterationPath-based, current state only) and its limitation (can't see when features moved to Done). Offered Option B (ChangedDate/StateChangeDate).

9. **User confirmed** → wants ChangedDate-based velocity, plus:
   - **How Found** and **Where Found** fields for Defects
   - **Size** field (not StoryPoints) for story points on both Features and Defects
   - This work was IN PROGRESS when compaction occurred — changes NOT yet made
</history>

<work_done>
Files created/modified:

- `D:\views\AV Dashboard\server.js` — Express backend; added `/api/sprint-trend`, `/api/velocity` endpoints; updated `processDefects` to include `p1p2Count`; updated `itemSummary` to include `priority`
- `D:\views\AV Dashboard\public\index.html` — All sections present: executive, overview, features, defects, teams, compare, sprint-trend, velocity, settings. Wizard overlay, topbar with PI stage wrap, team filter, slideshow btn, export btn, settings/docs icon buttons. Defects nav link has `nav-badge` span.
- `D:\views\AV Dashboard\public\app.js` — Full frontend logic ~1800+ lines. All features implemented including slideshow, keyboard shortcuts, team filter with velocity re-render, PI progress bar, stale data warning, velocity section with full charts/table.
- `D:\views\AV Dashboard\public\style.css` — Filament dark mode CSS with all additions: table-wrap-scroll, topbar icon buttons, slideshow active, PI stage bar, team filter, nav badge, stale indicator, kbd toast, velocity cards, print CSS.
- `D:\views\AV Dashboard\config.json` — Has PAT, TFS URLs, areaPath, teamRootPath, iterationPath, ragThresholds. No `defectFields` block yet.
- `D:\views\AV Dashboard\config.sample.json` — Template without PAT.

Work completed (all 20 todos done):
- [x] Full Phase 1 dashboard (features, defects, teams, overview, settings)
- [x] Executive summary with health score, RAG indicators
- [x] Team health scorecard
- [x] PI comparison charts
- [x] Setup wizard (first-run)
- [x] Sprint trend section
- [x] P1/P2 critical defects spotlight
- [x] Committed vs Delivered gauge
- [x] Stale feature alerts
- [x] Print/export
- [x] Scrollable tables
- [x] Slideshow mode
- [x] Settings/Docs moved to topbar
- [x] PI progress bar, alert badge, team filter, keyboard shortcuts, stale data warning
- [x] Velocity section with sprint charts, trend chart, PI-end summary

Currently in progress (NOT YET DONE — interrupted by compaction):
- [ ] ChangedDate-based velocity calculation (sprint windows based on quarter date ranges)
- [ ] How Found field for Defects (add to queries, display in table + chart)
- [ ] Where Found field for Defects (add to queries, display in table + chart)
- [ ] Size field replacing StoryPoints for both Features and Defects
</work_done>

<technical_details>
**TFS Configuration (critical)**
- Base URL: `https://tfsemea1.ta.philips.com/tfs/TPC_Region11/Healthcare%20IT`
- Auth: PAT → `Authorization: Basic base64(":" + PAT)`
- AreaPath root (WIQL): `Healthcare IT\ICAP\ISP`
- IterationPath root (DIFFERENT!): `Healthcare IT\ISP`
- teamRootPath (team extraction): `Healthcare IT\ICAP\ISP\Hercules`
- Teams live under: `Healthcare IT\ICAP\ISP\Hercules\<TeamName>` (Avyay, Action Team, Groot, Logon, etc.)
- Feature work item type: `Feature` (not User Story)
- Defect work item type: `Defect` (not Bug)
- Feature states: Forecasted, New, Approved, Done, Removed
- Defect states: New, Accepted, Planned, Resolved, Removed
- TFS API version: `5.0`
- WIQL endpoint: `POST /{project}/_apis/wit/wiql?api-version=5.0`
- Batch fetch: `POST /_apis/wit/workitemsbatch?api-version=5.0` (max 200 IDs)

**PI / Sprint Structure**
- Format: `{YY}-PI{N}` e.g. `26-PI1`, Sprint: `{YY}-PI{N} S{N}`, IP: `{YY}-PI{N} IP`
- 4 PIs per year; PI1=Q1(Jan-Mar), PI2=Q2(Apr-Jun), PI3=Q3(Jul-Sep), PI4=Q4(Oct-Dec)
- Each PI has 4 iterations: S1, S2, S3, IP
- Sprint iteration path: `Healthcare IT\ISP\{PI}\{PI} S1`
- Currently May 2026 = 26-PI2, S2

**Velocity calculation (current — known limitation)**
- Sprint velocity = features with State=Done AND IterationPath UNDER sprint path
- This counts by sprint *assignment*, not by *when* completed
- Limitation: can't see when feature moved to Done via WIQL (no history)
- **Planned fix**: use `Microsoft.VSTS.Common.StateChangeDate` with computed sprint date windows (quarter split into 4 equal chunks)

**Pending field names (user-confirmed, not yet implemented)**
- Story Points field: `Microsoft.VSTS.Scheduling.Size` (user said "size is the field")
- How Found field: likely `Microsoft.VSTS.Common.HowFound` or `Custom.HowFound` — TBD, should be configurable
- Where Found field: likely `Custom.WhereFound` — TBD, should be configurable
- These should be added to `config.json` as a `defectFields` block for flexibility

**Filament Design Tokens (dark mode)**
- `--bg:#242424`, `--bg-card:#2B2B2B`, `--bg-card2:#363636`, `--bg-sidebar:#171717`
- `--primary:#0072db`, `--primary-light:#1492ff`
- `--success:#068443`, `--danger:#eb3f3f`, `--caution:#F5CC00`, `--warning:#fa7000`
- `--violet:#858FFF`, `--orange:#ff7f0f`, `--teal:#21837c`

**CSS gotcha**: `[hidden]` HTML attribute is overridden by `display:flex/block` — fixed with `[hidden] { display: none !important; }` in reset section

**Architecture**: Proxy pattern — browser → localhost:3000/api/* → TFS (PAT never exposed to browser). `config.json` is git-ignored.

**Velocity API timing**: `/api/velocity` makes many parallel TFS calls per PI per sprint — takes 10-30s. Normal 5s timeouts will fail; verified working with 45s timeout.

**Team colors for charts**: `TEAM_COLORS` array in app.js has 10 Filament-based colors, assigned by sorted team name index.
</technical_details>

<important_files>
- `D:\views\AV Dashboard\server.js`
  - Express proxy + all API routes: `/api/config` (GET/POST), `/api/pi-list`, `/api/teams`, `/api/dashboard`, `/api/features`, `/api/defects`, `/api/pi-comparison`, `/api/sprint-trend`, `/api/velocity`
  - Key functions: `extractTeam()`, `processFeatures()`, `processDefects()` (includes p1p2Count), `itemSummary()` (includes priority), `buildIterationClauses()`, `getCurrentPIInfo()`, `getDefaultPIs()`
  - Velocity endpoint at bottom before "Start server" block (~line 592)
  - **Needs changes**: defect fields (How Found, Where Found), Size field, ChangedDate velocity

- `D:\views\AV Dashboard\public\app.js`
  - All frontend logic, ~1800+ lines
  - `state` object includes: `data`, `selectedPIs`, `availablePIs`, `teamRootPath`, `ragThresholds`, `selectedTeam`, `lastRefreshAt`, `lastRefreshOk`, `velData`
  - Key sections: navigation (~82), loadConfig (~116), fetchDashboard (~246), renderAll (~269), KPIs (~281), velocity section (~1696), PI progress bar (~2107), team filter (~2019), keyboard shortcuts (~2118), stale data (~2162)
  - `applyTeamFilter()` at ~2057 re-aggregates all metrics for selected team
  - `filterVelocityByTeam()` + `renderVelocity()` handle velocity team filtering
  - **Needs changes**: velocity to use Size field label, How Found/Where Found in defect table/charts

- `D:\views\AV Dashboard\public\index.html`
  - Dashboard shell: 9 sections (executive, overview, features, defects, teams, compare, sprint-trend, velocity, settings)
  - Sidebar nav has all links including `⚡ Velocity`
  - Topbar has: PI stage wrap, team filter select, slideshow btn, refresh btn, export btn, icon separator, ⚙ settings, 📖 docs
  - Defects section has `kpi-d-p1p2` KPI card and Critical Defects table
  - Features section has stale features card + scrollable table
  - Velocity section has PI checker grid, loading indicator, summary cards, 3 charts, PI-end table
  - **Needs changes**: How Found/Where Found columns in defect table, How Found filter dropdown, breakdown charts

- `D:\views\AV Dashboard\public\style.css`
  - Full Filament dark mode CSS
  - Critical: `[hidden] { display: none !important; }` in reset (line ~83)
  - `.table-wrap-scroll` for scrollable tables with sticky headers
  - `.exec-kpi-strip` has `margin-top: 16px` (recently added)
  - `.vel-pi-card`, `.vel-ctrl-row` etc. for velocity section
  - `@media print` at end for export

- `D:\views\AV Dashboard\config.json`
  - Contains live PAT (git-ignored), all TFS config, ragThresholds
  - **Needs addition**: `defectFields` block with `howFoundField`, `whereFoundField`, `sizeField`

- `D:\views\AV Dashboard\config.sample.json`
  - Template without PAT — should mirror config.json structure changes
</important_files>

<next_steps>
Remaining work (user confirmed, interrupted by compaction):

1. **ChangedDate-based velocity calculation**
   - Add `getSprintDateRanges(piLabel)` helper to server.js that computes sprint start/end dates by splitting the quarter into 4 equal chunks
   - Update `/api/velocity` endpoint: for each sprint, query `State = 'Done' AND Microsoft.VSTS.Common.StateChangeDate >= '{start}' AND StateChangeDate <= '{end}'` instead of IterationPath UNDER
   - Keep PI-end velocity as-is (IterationPath UNDER PI = accurate for closed PIs)
   - This gives "features that actually moved to Done in each sprint window" — true velocity

2. **Size field (replaces StoryPoints everywhere)**
   - Add `"sizeField": "Microsoft.VSTS.Scheduling.Size"` to config.json under a new `defectFields` (or `workItemFields`) block
   - Update velocity endpoint: replace `Microsoft.VSTS.Scheduling.StoryPoints` with configured size field
   - Update frontend labels from "Story Points" to "Size Points" or just "Size"

3. **How Found field for Defects**
   - Add `"howFoundField": "Custom.HowFound"` to config (configurable — actual field name TBD)
   - Add to defect WIQL fields list and `itemSummary()`
   - Add `howFoundBreakdown` aggregation in `processDefects()`
   - Add How Found filter dropdown to Defects section in index.html
   - Add How Found column to defect table
   - Add "Defect Origin (How Found)" donut/bar chart in Defects section

4. **Where Found field for Defects**
   - Add `"whereFoundField": "Custom.WhereFound"` to config (configurable)
   - Same pattern as How Found: fetch field, aggregate, show in table + chart
   - Add "Where Found" breakdown chart (e.g., Dev/QA/Production breakdown)

**Implementation approach:**
- Update `config.json` and `config.sample.json` first with new field names block
- Update `server.js`: `processDefects()`, `itemSummary()`, defect fields array, `/api/velocity` with date ranges
- Update `index.html`: defect table headers, How Found/Where Found filter dropdowns, new chart canvases
- Update `app.js`: defect table rendering, How Found/Where Found charts, velocity labels
- Restart server after server.js changes
- Field names for How Found/Where Found are uncertain — make them configurable so user can update in Settings if TFS names differ
</next_steps>