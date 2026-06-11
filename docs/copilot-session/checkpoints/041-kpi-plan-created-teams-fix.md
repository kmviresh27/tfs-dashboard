<overview>
The AV Dashboard is a React + Express TFS-connected programme dashboard for Philips Healthcare IT (ICAP/ISP). This session focused on: (1) reading a requirements XLSX file (KPIs Lessons Learnt V4.0.xlsx) and creating a comprehensive KPI page implementation plan in HTML, and (2) fixing a "useState is not defined" crash in TeamsSection.jsx that caused the Teams section to fail to load. The KPI plan covers all 15 KPIs across 4 focus areas derived entirely from the XLSX, with TFS query designs, wireframes, data source analysis, and open questions.
</overview>

<history>
1. **User asked: "can you read xlsx?" for a new KPI page requirement**
   - Confirmed xlsx readable via Python (openpyxl)
   - Asked user to share the file and describe the structure/goal

2. **User pointed to `D:\views\AV Dashboard\docs\Requirements\KPIs Lessons Learnt V4.0.xlsx`**
   - Read all 16 sheets with Python/openpyxl
   - Discovered: 1 summary sheet (KPIs, 17 rows × 16 cols) + 15 detail sheets (one per KPI)
   - Extracted all 15 KPIs across 4 focus areas: Quality, Process, Change Management, AI/Automation
   - Also read Prerequisites sheet (7 items teams must set up first)
   - Noted one focus area (Delivery) has NO KPI — only a team context note

3. **User said "continue" to create the plan HTML**
   - Created `D:\views\AV Dashboard\docs\KPI_Page_Plan.html` (86,990 chars)
   - 7-tab interactive dark-themed HTML plan covering:
     - Tab 1 Overview: 4 focus area summary cards, prerequisites list, key design decisions
     - Tab 2 All KPIs: All 15 KPI cards with targets, formulas, detection logic, responsibilities
     - Tab 3 Wireframe: Full page layout wireframe with header, scorecards, tabs, KPI cards, team breakdown
     - Tab 4 Data Sources: Table mapping each KPI to TFS field/tag/pipeline source + complexity rating
     - Tab 5 Implementation Plan: 5 phases (Backend route, Frontend section, Settings tab, Nav/roles, Export)
     - Tab 6 TFS Queries: 3 WIQL queries (Features, Bugs, Say/Do) + API response schema
     - Tab 7 Open Questions: 8 questions to resolve before building (Q1-Q3 critical: mindmap detection, sVer date, checklist detection)

4. **User reported "Teams failed to load / useState is not defined"**
   - Checked all section files for React imports
   - Found `TeamsSection.jsx` had NO React import at all — was missing `import { useState } from 'react'`
   - This was introduced by the previous agent that added annotations to all 12 sections
   - Fixed: added `import { useState } from 'react';` as first line of TeamsSection.jsx
   - Verified all other annotation-using sections already had useState imported correctly
   - Build had not yet been rebuilt — server still running from before
</history>

<work_done>
Files created:
- `D:\views\AV Dashboard\docs\KPI_Page_Plan.html` — full 7-tab interactive plan for KPI page (86,990 chars)

Files modified:
- `D:\views\AV Dashboard\client\src\sections\TeamsSection.jsx` — added `import { useState } from 'react';` as line 1 (was completely missing)

Work completed:
- [x] Read KPIs Lessons Learnt V4.0.xlsx (16 sheets, all 15 KPIs extracted)
- [x] KPI_Page_Plan.html created with full implementation plan
- [x] TeamsSection.jsx useState import fixed

Current state:
- TeamsSection.jsx fix is in place but the **app has NOT been rebuilt yet** — user is still seeing the error because the dev build is stale
- Two shell sessions are running: `av-server` (node server.js) and `server-restart` (another server.js instance)
- The fix requires a frontend rebuild (`npm run build` in `/client`) to take effect in production, OR if running in dev mode (`npm run dev`), Vite's HMR should pick it up automatically
</work_done>

<technical_details>
- **Root cause of Teams error**: The agent that added annotations to 12 sections in the previous session added `useState` usage to `TeamsSection.jsx` but did NOT add the React import. Every other section file already imported from React; TeamsSection originally had no React import because it didn't use any React hooks before annotations were added.

- **TeamsSection.jsx original state**: Had no `import ... from 'react'` at all. Used only chart.js, react-chartjs-2, and custom hooks. The annotation agent added `annPopup` state but omitted the import.

- **Two server processes running**: `shellId: av-server` (PID 11776, running 17502s) and `shellId: server-restart` (PID 24828, running 5999s). There may be a port conflict. The fix only affects the frontend bundle — server restart alone won't fix it if the build is stale.

- **Build requirement**: The project uses Vite for frontend bundling. In production mode, `npm run build` in the `client/` directory is needed. In dev mode (`npm run dev`), HMR automatically picks up file saves.

- **KPI page XLSX structure**:
  - 15 KPIs: 10 Leading (predictive) + 5 Lagging (outcome)
  - Focus areas: Quality (4 KPIs), Process (4 KPIs), Change Management (4 KPIs), AI/Automation (3 KPIs)
  - Delivery focus area: explicitly NO KPI — context card only
  - 13/15 KPIs sourced from TFS (tags, attachments, links, timestamps)
  - 2/15 KPIs (Build Performance + Build Stability) require pipeline API or manual input
  - Key tags teams must use: `Scenario-Gap`, `Missed-Standard`, `Regression`, `Late-Change`, `AI-Assisted`
  - sVer milestone date needed for Late Changes KPI — currently not stored anywhere

- **Annotations ROOT: prefix**: Already fixed in prior session. GET filter normalises ROOT: prefix; POST strips it before storing.

- **Settings access bug**: Already fixed in prior session. `settings` section exempted from role restriction check in App.jsx line 365.

- **KPI open questions (critical — must resolve before building)**:
  - Q1: How is mindmap attachment detected? (filename, URL in description, custom field?)
  - Q2: Where/how is sVer milestone date stored per PI?
  - Q3: How is PR checklist completion detected in TFS?
  - Q4: Pipeline data — TFS build pipelines or external CI? (can start with manual fallback)
  - Q5: Say/Do — count-based or story-point-based?
</technical_details>

<important_files>
- `client/src/sections/TeamsSection.jsx`
  - Fixed: added missing `import { useState } from 'react';` at line 1
  - Caused "useState is not defined" crash on Teams section load
  - Has annotations support (annPopup state, useAnnotations hook, AnnotationButton, ChartAnnotations)

- `docs/KPI_Page_Plan.html`
  - Newly created comprehensive plan for KPI page feature
  - 7 interactive tabs: Overview, All KPIs (15), Wireframe, Data Sources, Implementation (5 phases), TFS Queries, Open Questions
  - Contains WIQL query designs and API response schema for `/api/kpi`
  - Reference for the entire KPI implementation

- `docs/Requirements/KPIs Lessons Learnt V4.0.xlsx`
  - Source requirements file for KPI page
  - 16 sheets: 1 master KPI sheet + 15 detail sheets (one per KPI)
  - All 15 KPIs extracted and documented in plan HTML

- `client/src/App.jsx`
  - Line 365: `restrictedSection` exempts `settings` from role restriction (previously fixed)
  - Needs KPISection added when implementation begins

- `src/routes/annotations.js`
  - ROOT: prefix normalisation fix (previously applied)
  - GET filter and POST storage both normalise team name

- `client/src/constants.js`
  - `NAV_ITEMS`, `ROLE_SECTIONS` — will need `kpi` added when implementation begins
</important_files>

<next_steps>
Immediate action needed:
- **Rebuild the frontend** so the TeamsSection useState fix takes effect. Run `npm run build` in `client/` directory OR restart Vite dev server. The fix is in the source but the running bundle is stale.

Pending work — KPI page implementation (not yet started, plan complete):
1. **Answer open questions** (Q1–Q3 critical) before coding:
   - How mindmap/FMEA/impact attachments are detected in TFS
   - Where sVer milestone date comes from per PI
   - How PR checklist completion is detected
2. **Phase 1**: Create `src/routes/kpi.js` — 3 WIQL queries + KPI computation
3. **Phase 2**: Create `client/src/sections/KPISection.jsx` + `KpiCard.jsx` component
4. **Phase 3**: Add KPI Config tab to Settings (12th tab) — sVer dates, tag mappings, pipeline manual values
5. **Phase 4**: Add `kpi` to NAV_ITEMS, ROLE_SECTIONS in constants.js; register in App.jsx
6. **Phase 5**: Export + annotations support

Multi-tenant implementation:
- Plan exists at `docs/MultiTenant_Architecture_Plan.html`
- 5 open questions still unresolved (auth model, scale, PAT strategy, super admin, scheduler cadence)
- Not started — waiting on user answers
</next_steps>