<overview>
The AV Dashboard is a React + Express TFS-connected programme dashboard for Philips Healthcare IT (ICAP/ISP). This session focused on: (1) fixing a "useState is not defined" crash in TeamsSection.jsx (left over from a prior annotation agent that forgot to add the React import), rebuilding the frontend bundle, and restarting the server; and (2) beginning implementation of the KPI Tracker section — a new full dashboard section based on requirements from `KPIs Lessons Learnt V4.0.xlsx`, covering 15 KPIs across 4 focus areas (Quality, Process, Change Management, AI/Automation).
</overview>

<history>
1. **User said "still its showing" (Teams failed to load / useState is not defined)**
   - The fix (adding `import { useState } from 'react'` to TeamsSection.jsx) was already applied in the prior session but the bundle was never rebuilt
   - Ran `npm run build` in `/client` → succeeded, new bundle generated
   - Killed stale server processes (PIDs 11776 and 24828) and restarted server
   - Port 3000 was still occupied — killed lingering process, restarted successfully
   - Server confirmed running with `🚀 AV Dashboard running → http://localhost:3000`

2. **User said "continue with kpi html generation"**
   - Read plan.md and todos DB — 34 todos, all previously done or blocked except the new KPI work
   - Read `docs/KPI_Page_Plan.html` (the planning document created in prior session) for all 15 KPI specs, formulas, data sources
   - Read `client/src/constants.js`, `client/src/App.jsx`, `src/routes/testCoverage.js`, `src/tfsClient.js`, `server.js` to understand the codebase architecture
   - Determined that "continue with kpi html generation" means implement the actual KPI section in the dashboard (not just update the plan HTML)
   - Added 4 new todos: kpi-backend, kpi-hooks, kpi-section, kpi-wire

3. **Started KPI implementation — backend and wiring**
   - Created `src/routes/kpi.js` — full backend route with 8 parallel WIQL queries + feature relations fetch + 15 KPI computations
   - Fixed a bug in the pipeline POST handler (saveConfig doesn't exist; use `fs.writeFileSync(CFG_PATH, ...)` pattern from config.js route)
   - Registered `app.use('/api', require('./src/routes/kpi'))` in `server.js`
   - Added `useKPI(pi, team)` hook to `client/src/api/hooks.js`
   - Added `kpi` nav item to `NAV_ITEMS` in `constants.js` (group: Analysis, icon: 📊, label: KPI Tracker)
   - Added `kpi` to all `ROLE_SECTIONS` (all, exec, rte, pm — not sm)
   - **Was actively building KPISection.jsx when the summary was requested** — not yet created
</history>

<work_done>
Files created:
- `src/routes/kpi.js` — Full KPI backend route:
  - 8 parallel WIQL queries (features, bugs, AI-Assisted tag, Late-Change tag, Scenario-Gap tag, Regression tag, Missed-Standard tag, resolved bugs)
  - `fetchWithRelations()` — batch fetches feature work items with `$expand=relations` to detect mindmap/FMEA/impact/checklist/review evidence
  - 15 KPI computations with RAG (green/amber/red/unknown) per KPI
  - Team breakdown from feature AreaPath
  - `POST /api/kpi/pipeline` — saves manual pipeline values (build time baseline/current, build stability %) to config.json

Files modified:
- `server.js` — added `app.use('/api', require('./src/routes/kpi'))` after annotations route
- `client/src/api/hooks.js` — added `useKPI(pi, team)` hook at end of file (staleTime: 15 min)
- `client/src/constants.js`:
  - Added `{ id: 'kpi', icon: '📊', label: 'KPI Tracker', group: 'Analysis' }` to NAV_ITEMS
  - Added `kpi` to ROLE_SECTIONS for all, exec, rte, pm roles
- `client/src/sections/TeamsSection.jsx` — added missing `import { useState } from 'react'` (prior session fix)

Work completed:
- [x] Fixed TeamsSection.jsx useState crash
- [x] Rebuilt frontend bundle (`npm run build`)
- [x] Restarted server on port 3000 (detached)
- [x] Created KPI backend route (`src/routes/kpi.js`)
- [x] Registered route in server.js
- [x] Added useKPI hook to hooks.js
- [x] Added kpi to NAV_ITEMS in constants.js
- [x] Added kpi to ROLE_SECTIONS in constants.js
- [ ] **KPISection.jsx — NOT YET CREATED** (was next task)
- [ ] SECTION_PAGES entry for kpi — not added yet
- [ ] POLICY_SCHEMA entry for kpi — not added yet
- [ ] App.jsx import + switch case — not done yet
- [ ] Frontend rebuild + server restart after KPISection created
</work_done>

<technical_details>
- **TeamsSection.jsx fix**: The prior agent that added annotations support added `useState` usage but forgot to import React hooks. All other sections import from 'react'; TeamsSection originally had no React imports at all (pre-annotations, used only chart.js/react-chartjs-2/custom hooks). Fix: `import { useState } from 'react';` as line 1.

- **Server rebuild flow**: Changes to `client/src/` require `npm run build` in `/client` dir (Vite). Server serves from `client/dist/`. After build, server needs restart if it started before the dist existed (ENOENT error on index.html). Always kill old PIDs before restarting.

- **Config save pattern**: `loadConfig` and `CFG_PATH` are exported from `src/config.js`. To save, use `fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2))` — there is no `saveConfig` export. This pattern is used in `src/routes/config.js`.

- **KPI backend architecture**:
  - Phase 1: 8 parallel WIQL queries via `Promise.allSettled` (fail-safe)
  - Phase 2: `fetchWithRelations()` — uses `GET /workitems?ids=...&$expand=relations` (NOT the batch POST API which doesn't support $expand). Returns full fields + relations array per work item.
  - Attachment/link detection: inspect `rel.attributes.name`, `rel.attributes.comment`, `rel.url` for keywords (mindmap, fmea, impact, checklist, review)
  - Checklist also detected from work item description containing `[x]`, `☑`, or `checklist`
  - Tag-based KPIs use WIQL `[System.Tags] CONTAINS 'TagName'` syntax
  - Pipeline KPIs (11, 12) stored in `config.json` under `cfg.kpi.pipeline[pi]`

- **15 KPIs summary**:
  | # | ID | Group | Type | Method |
  |---|---|---|---|---|
  | 1 | exploratory-coverage | quality | leading | mindmap attachment/link |
  | 2 | fmea-coverage | quality | leading | FMEA attachment/link |
  | 3 | scenario-gap-defects | quality | lagging | Scenario-Gap tag |
  | 4 | regression-defects | quality | lagging | Regression tag |
  | 5 | checklist-compliance | process | leading | checklist attachment/description |
  | 6 | cross-team-review | process | leading | review linked task |
  | 7 | missed-standard-defects | process | lagging | Missed-Standard tag |
  | 8 | say-do-ratio | process | lagging | Done/Total features (PI proxy) |
  | 9 | late-changes | change | leading | Late-Change tag (count) |
  | 10 | impact-assessment | change | leading | impact attachment/link |
  | 11 | build-time-reduction | change | leading | manual (pipeline config) |
  | 12 | build-stability | change | lagging | manual (pipeline config) |
  | 13 | ai-assisted-usage | ai | leading | AI-Assisted tag |
  | 14 | post-integration-regression | ai | lagging | Regression tag (same data as #4) |
  | 15 | defect-analysis-time | ai | lagging | Avg(Resolved-Created) timestamps |

- **RAG logic**:
  - `gte` (higher is better): green if ≥target, amber if ≥90% of target, else red
  - `lte` (lower is better): green if ≤target, amber if ≤120% of target, else red
  - `count` (ideally 0): green if 0, amber if ≤3, else red
  - `unknown`: value is null (e.g., pipeline KPIs not configured)

- **KPI API response shape**:
  ```json
  {
    "pi": "26-PI2",
    "computedAt": "...",
    "totalFeatures": N,
    "totalBugs": N,
    "summary": { "green": 7, "amber": 5, "red": 3, "unknown": 0 },
    "kpis": [ { "id", "name", "group", "type", "seq", "value", "unit", "target", "targetDir", "met", "total", "formula", "note", "isManual", "rag", ... } ],
    "teamBreakdown": { "Avyay": { "features": N, "exploratory": %, "fmea": %, ... }, ... }
  }
  ```

- **Say/Do proxy**: Real Say/Do requires sprint-start snapshot vs sprint-end. TFS has no historical state. Used PI-level Done/Total features as proxy. Note on card: "Sprint-level breakdown in Velocity section."

- **Delivery focus area**: Has NO KPI per XLSX — only a context card showing the team's note about 16% requirement changes being acceptable in AVW-16.

- **Open questions from KPI plan (still unresolved)**:
  - Q1: How is mindmap detection validated? (filename heuristic used for now)
  - Q2: Where/how is sVer milestone date stored per PI? (Late-Changes KPI uses tag only, not date-gated for now)
  - Q3: How is PR checklist completion detected? (description/attachment heuristic used)
  - Q4: Pipeline data source (manual input via `/api/kpi/pipeline` POST for now)
  - Q5: Say/Do count-based or story-point-based? (count-based, PI proxy)
</technical_details>

<important_files>
- `src/routes/kpi.js`
  - Newly created KPI backend route
  - GET /api/kpi: 8 parallel WIQL + feature relations fetch → 15 KPI computations + RAG + team breakdown
  - POST /api/kpi/pipeline: saves manual pipeline metrics to config.json
  - Attachment detection via `$expand=relations` on TFS workitems API

- `client/src/sections/KPISection.jsx`
  - **NOT YET CREATED** — this is the immediate next task
  - Should use `useKPI(pi, team)` hook, show summary bar, 4-tab focus area filter, 15 KPI cards with RAG/progress bars/team breakdown, pipeline manual input

- `client/src/constants.js`
  - Added `kpi` nav item (line ~81: `{ id: 'kpi', icon: '📊', label: 'KPI Tracker', group: 'Analysis' }`)
  - Added `kpi` to ROLE_SECTIONS for all/exec/rte/pm roles
  - Still needs: `SECTION_PAGES['kpi'] = 1` and `POLICY_SCHEMA` entry

- `client/src/App.jsx`
  - Still needs: `import KPISection from './sections/KPISection.jsx'` and `case 'kpi': return <KPISection />;` in switch

- `server.js`
  - Line ~59: `app.use('/api', require('./src/routes/kpi'))` added after annotations route

- `client/src/api/hooks.js`
  - Added `useKPI(pi, team)` at end of file (staleTime 15 min, enabled when pi is truthy)

- `docs/KPI_Page_Plan.html`
  - Planning document (7 tabs: Overview, All KPIs, Wireframe, Data Sources, Implementation, TFS Queries, Open Questions)
  - Reference for all 15 KPI specs, formulas, wireframe layout

- `client/src/sections/TeamsSection.jsx`
  - Fixed: `import { useState } from 'react';` added as line 1 (was missing, caused crash)
</important_files>

<next_steps>
Remaining work — KPI implementation:

1. **Create `client/src/sections/KPISection.jsx`** (immediate next task):
   - Use `useKPI(pi, team)` hook from hooks.js
   - PI selector (single PI, not array — KPI is per-PI)
   - Team filter from useStore
   - Summary bar: Green/Amber/Red/Unknown counts + 10 Leading / 5 Lagging badges
   - Tab filter: All | 🧪 Quality | ⚙️ Process | 🔄 Change Mgmt | 🤖 AI/Auto
   - KPI cards (2–3 per row): title, Leading/Lagging badge, big value+unit, RAG indicator, progress bar (for %), formula, note, team breakdown collapsible
   - Special handling: `isManual=true` cards show pipeline input form or "Configure in Settings" notice
   - Delivery focus area: context-only card (no KPI)
   - Annotations support (AnnotationButton + ChartAnnotations)

2. **Update `client/src/constants.js`**:
   - Add `'kpi': 1` to SECTION_PAGES
   - Add kpi entry to POLICY_SCHEMA

3. **Update `client/src/App.jsx`**:
   - Add `import KPISection from './sections/KPISection.jsx'`
   - Add `case 'kpi': return <KPISection />;` in ActiveSection switch

4. **Rebuild and restart**:
   - `cd client && npm run build`
   - Kill PID on port 3000 and restart `node server.js`

5. **Verify**: Navigate to KPI Tracker in sidebar, check all 15 KPI cards render, RAG indicators appear, team breakdown works

Blockers: None — backend is ready, just need the React component.
</next_steps>