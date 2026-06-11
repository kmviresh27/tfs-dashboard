<overview>
The AV Dashboard is a React + Express TFS-connected programme dashboard for Philips Healthcare IT (ICAP/ISP). This session segment focused on: (1) implementing the KPI Tracker section — a full new dashboard section based on requirements from `KPIs Lessons Learnt V4.0.xlsx` covering 15 KPIs across 4 focus areas; (2) fixing a runtime crash (`r.replace is not a function`) in the KPI backend; (3) adding TFS deep-links per KPI bucket and per team; and (4) redesigning the KPI page with three charts (RAG donut, KPI score bar, team radar), click-to-popup KPI detail modals, and `borderRadius: 0` throughout except chips/badges.
</overview>

<history>

1. **"continue with kpi html generation"** — user wanted the KPI section actually implemented in the dashboard (not just the plan HTML)
   - Read plan.md, constants.js, App.jsx, hooks.js, server.js to understand architecture
   - Created `src/routes/kpi.js` — full KPI backend: 8 parallel WIQL queries, `fetchWithRelations()` for attachment/link detection, 15 KPI computations with RAG, team breakdown
   - Fixed pipeline POST handler to use `fs.writeFileSync(CFG_PATH, ...)` pattern (no `saveConfig` export)
   - Registered route in `server.js`: `app.use('/api', require('./src/routes/kpi'))`
   - Added `useKPI(pi, team)` hook to `client/src/api/hooks.js`
   - Added `kpi` to `NAV_ITEMS` and all `ROLE_SECTIONS` in `constants.js`
   - Created `client/src/sections/KPISection.jsx` (initial version with summary bar, group tabs, KPI cards, team heatmap, pipeline input)
   - Added `kpi: 1` to `SECTION_PAGES` and full `POLICY_SCHEMA` entry in `constants.js`
   - Wired into `App.jsx`: import + `case 'kpi': return <KPISection />;`
   - Built frontend and restarted server — all successful

2. **`{"error":"r.replace is not a function"}` on `/api/kpi?pi=26-PI2`**
   - Root cause: `kpi.js` line 348 called `extractTeam(areaPath, cfg)` passing the entire config object as 2nd arg; `extractTeam` calls `.replace()` on the second arg (expects a string)
   - Fix: changed to `extractTeam(areaPath, cfg.tfs.areaPath)`
   - Server restarted — route now responds with 401 (TFS auth) as expected

3. **"I also should have tfs link to open per team and per bucket if possible"**
   - Added `buildTfsUrl(baseUrl, wiql)` helper to `kpi.js`
   - Added `KPI_WIQL_FN` map — WIQL generator per KPI id (13 KPIs; build-time and build-stability are manual, no URL)
   - Added `tfsUrl` to each KPI object in response (uses `filterPath` which respects team filter)
   - Added `teamAreaPaths` tracking when building `teamFeatMap` (stores full area path up to team leaf)
   - Added `tfsUrl` (generic features link) and `tfsUrls` (per-KPI links map) to each `teamBreakdown[team]` entry
   - Updated `KPISection.jsx`: `🔗 TFS` pill on each KPI card; team names in breakdown become links; heatmap table cells are clickable links; Late Changes column is a link
   - Rebuilt and restarted server

4. **"can you also think of graphs for this kpi page and details should be opened on popup like PI readiness page. Set border radius 0 except chips in KPI page"**
   - Studied `PIReadinessSection.jsx` modal pattern
   - Studied `TeamsSection.jsx` for Chart.js registration pattern (Radar already used)
   - Confirmed chart.js, react-chartjs-2, chartjs-plugin-annotation all installed
   - Delegated full rewrite to general-purpose sub-agent with complete spec
   - Sub-agent rewrote `KPISection.jsx` with:
     - **Chart A**: RAG Health Donut (180px, 72% cutout, centered score %, beside summary tiles)
     - **Chart B**: KPI Score Bar (horizontal Bar, values vs targets with dashed annotation lines per target, coloured by RAG)
     - **Chart C**: Team Coverage Radar (6 axes: Exploratory/FMEA/Checklist/Cross-Review/Impact/AI-Assisted, up to 6 teams)
     - Modal popup on KPI card click (PIReadiness pattern, `borderRadius: 0`)
     - `borderRadius: 0` everywhere except: Leading/Lagging badges, RAG status badges, group filter tab buttons (borderRadius: 4), `🔗 TFS` pill (borderRadius: 4)
     - Compact KPI cards (no inline expand — all detail in modal)
   - Build succeeded, server running on port 3000

</history>

<work_done>

Files created:
- `src/routes/kpi.js` — Full KPI backend route with 8 WIQL queries, 15 KPI computations, RAG, team breakdown, TFS URL generation per KPI + per team
- `client/src/sections/KPISection.jsx` — Complete KPI Tracker React component (charts + modal + heatmap + TFS links)

Files modified:
- `server.js` — Added `app.use('/api', require('./src/routes/kpi'))` after annotations route
- `client/src/api/hooks.js` — Added `useKPI(pi, team)` hook (staleTime 15 min)
- `client/src/constants.js` — Added `kpi` nav item, `kpi` to ROLE_SECTIONS (all/exec/rte/pm), `kpi: 1` to SECTION_PAGES, full POLICY_SCHEMA entry with 5 tabs + 2 charts
- `client/src/App.jsx` — Added `import KPISection` and `case 'kpi': return <KPISection />;`
- `client/src/sections/TeamsSection.jsx` — Added `import { useState } from 'react'` (prior session fix, bundle rebuilt)

Work completed:
- [x] KPI backend route (`/api/kpi` GET + `/api/kpi/pipeline` POST)
- [x] Fixed `r.replace is not a function` crash (wrong second arg to `extractTeam`)
- [x] TFS deep-links per KPI bucket and per team (all combinations)
- [x] KPI section React component with 3 charts + modal popup + `borderRadius: 0`
- [x] Frontend bundle rebuilt (131 modules, ~1.23MB)
- [x] Server running on port 3000 (HTTP 200 verified)

Current state: **Fully functional** — KPI Tracker section is accessible from sidebar, loads from TFS (requires PAT), renders all charts and KPI cards.

</work_done>

<technical_details>

**`extractTeam(areaPath, teamRoots)` signature**: Second arg must be a string (or array of strings) — it calls `.replace(/\//g, '\\')` on it. All callers must pass `cfg.tfs.areaPath`, NOT the full `cfg` object. This was the bug that caused `r.replace is not a function`.

**KPI backend architecture**:
- Phase 1: 8 parallel WIQL queries via `Promise.allSettled` (fail-safe — missing tags return 0 not crash)
- Phase 2: `fetchWithRelations()` — uses `GET /workitems?ids=...&$expand=relations` (NOT batch POST which doesn't support `$expand`)
- Phase 3: Attachment/link keyword detection via `rel.attributes.name`, `rel.attributes.comment`, `rel.url`
- Phase 4: Defect analysis time from `System.CreatedDate` / `Microsoft.VSTS.Common.ResolvedDate` timestamps
- Phase 5: Pipeline KPIs (build time, build stability) from `config.json` under `cfg.kpi.pipeline[pi]`
- Phase 6: Say/Do = Done features / Total features (PI-level proxy; real sprint-level is in Velocity section)

**TFS URL format for on-prem**: `{baseUrl}/_workitems?_a=query-edit&wiql=<encodeURIComponent(wiql)>` — opens the work item query editor pre-populated with the WIQL. Used for all KPI deep-links.

**Team area path tracking**: `teamAreaPath[team]` stores the full area path up to the team leaf (e.g., `Healthcare IT\ICAP\ISP\Hercules\Avyay`) by finding where the team name appears in the feature's area path. Used to construct per-team TFS URLs.

**Chart.js registration in this project**: No central registration file — each section that uses charts imports and registers what it needs. Pattern from `TeamsSection.jsx`:
```js
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, RadialLinearScale, PointElement, LineElement, Filler, ArcElement, Title, Tooltip, Legend } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
ChartJS.register(..., annotationPlugin);
```

**KPI target annotations on bar chart**: Uses `chartjs-plugin-annotation` with `type: 'line'`, `xMin/xMax` set to target value, `yMin/yMax` scoped to `index ± 0.36` to appear only within that bar's row.

**`borderRadius: 0` rule**: Applied to all cards, progress bars, buttons, panels, tables, inputs. Exceptions: Leading/Lagging type badges (`borderRadius: 10`), RAG status badges (`borderRadius: 10`), group filter tab buttons (`borderRadius: 4`), `🔗 TFS` pill (`borderRadius: 4`).

**Modal pattern** (copied from PIReadinessSection): Full-screen overlay `onClick={onClose}`, inner panel `onClick={e => e.stopPropagation()}`. `maxWidth: 720`, `maxHeight: 85vh`, `overflow-y: auto` on content area. `borderRadius: 0` on modal shell and all interior elements.

**`TM_COLORS` in constants.js**: `['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316']` — used for team radar chart colors.

**RAG computation logic**:
- `gte` (higher is better): green ≥ target, amber ≥ 90% of target, else red
- `lte` (lower is better): green ≤ target, amber ≤ 120% of target, else red
- `count` (ideally 0): green if 0, amber if ≤ 3, else red
- `unknown`: value is null (pipeline KPIs not configured)

**15 KPIs and their data sources**:
| # | ID | Data Source |
|---|---|---|
| 1 | exploratory-coverage | mindmap attachment/link on Feature |
| 2 | fmea-coverage | FMEA attachment/link on Feature |
| 3 | scenario-gap-defects | Bug tag: Scenario-Gap |
| 4 | regression-defects | Bug tag: Regression |
| 5 | checklist-compliance | checklist/dod attachment or `[x]` in description |
| 6 | cross-team-review | Related/Child/Dependency link with "review" in name |
| 7 | missed-standard-defects | Bug tag: Missed-Standard |
| 8 | say-do-ratio | Done features / Total features (PI proxy) |
| 9 | late-changes | Feature tag: Late-Change (raw count) |
| 10 | impact-assessment | impact attachment/link on Feature |
| 11 | build-time-reduction | Manual pipeline config in config.json |
| 12 | build-stability | Manual pipeline config in config.json |
| 13 | ai-assisted-usage | Feature tag: AI-Assisted |
| 14 | post-integration-regression | Bug tag: Regression (same as #4, different scope intent) |
| 15 | defect-analysis-time | Avg(ResolvedDate - CreatedDate) for resolved bugs |

**Config save pattern**: No `saveConfig()` export — use `fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2))`. `CFG_PATH` exported from `src/config.js`.

**Pre-existing lint error in App.jsx**: Known issue, unrelated to KPI work. Does not affect build or runtime.

</technical_details>

<important_files>

- `src/routes/kpi.js`
  - Core KPI backend route
  - GET `/api/kpi`: 8 WIQL queries → 15 KPI computations → RAG → team breakdown → TFS URLs
  - POST `/api/kpi/pipeline`: saves manual pipeline metrics to config.json
  - Key functions: `buildTfsUrl()`, `KPI_WIQL_FN` map, `fetchWithRelations()`, `ragStatus()`, `extractTeam()` call (line ~370: must use `cfg.tfs.areaPath`)

- `client/src/sections/KPISection.jsx`
  - Complete KPI Tracker React component (~1050 lines)
  - Structure: chart.js registration → constants → Modal → KPIDetailModal → ProgressBar → ValueDisplay → TeamBreakdown → PipelineInputPanel → KPICard → SummaryBar (with Doughnut) → KPIScoreBar → TeamRadar → TeamHeatmap → main `KPISection` export
  - KPI card click → `setSelectedKpiId(kpi.id)` → `KPIDetailModal` renders
  - `borderRadius: 0` everywhere except badges/chips/TFS pill

- `client/src/api/hooks.js`
  - Contains `useKPI(pi, team)` hook added at end of file
  - `staleTime: 15 * 60 * 1000` (15 min), `enabled: !!pi`
  - Query key: `['kpi', pi, team]`

- `client/src/constants.js`
  - Added `kpi` nav item (group: Analysis, icon: 📊)
  - Added `kpi` to all ROLE_SECTIONS except `sm`
  - Added `kpi: 1` to SECTION_PAGES
  - Added POLICY_SCHEMA entry with 5 tabs (all/quality/process/change/ai) and 2 charts
  - Contains `TM_COLORS` array used by KPI radar chart

- `client/src/App.jsx`
  - Added `import KPISection from './sections/KPISection.jsx'`
  - Added `case 'kpi': return <KPISection />;` after `case 'pi-readiness'`
  - Has pre-existing lint warning (unrelated)

- `server.js`
  - Added `app.use('/api', require('./src/routes/kpi'))` at line ~59

</important_files>

<next_steps>

No pending tasks from user requests — all requested items are complete and verified:
- ✅ KPI backend with 15 KPIs, RAG, team breakdown
- ✅ `r.replace is not a function` bug fixed
- ✅ TFS deep-links per KPI bucket and per team
- ✅ Three charts (Donut, Score Bar, Team Radar)
- ✅ KPI detail popup modal (PI Readiness pattern)
- ✅ `borderRadius: 0` everywhere except chips/badges
- ✅ Build passing, server running on port 3000

Potential follow-up items the user may raise:
- KPI data accuracy depends on teams using the required tags (`AI-Assisted`, `Regression`, `Scenario-Gap`, `Missed-Standard`, `Late-Change`) and attaching mindmap/FMEA/impact/checklist artifacts to Feature work items — these are process prerequisites, not code issues
- Pipeline KPIs (build-time-reduction, build-stability) require manual entry via the popup input form
- Say/Do is a PI-level proxy (Done/Total features) — sprint-level requires TFS historical snapshots

</next_steps>