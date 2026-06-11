# AV Dashboard — TFS Live Monitoring Dashboard

## Problem Statement
Build a standalone, locally-run Node.js + HTML dashboard that connects to a Philips TFS server and monitors Features and Defects under `Healthcare IT\ICAP\ISP`. Data refreshes every 30 minutes. The dashboard shows feature lifecycle, defect ratios, and team-wise breakdowns across PIs/Quarters for the current year.

---

## Confirmed Requirements

| Item | Value |
|------|-------|
| TFS URL | https://tfsemea1.ta.philips.com/tfs/TPC_Region11/Healthcare IT |
| Auth | Personal Access Token (PAT) |
| Area Root (AreaPath) | Healthcare IT\ICAP\ISP |
| Iteration Root | Healthcare IT\ISP |
| Teams | Dynamically discovered from AreaPath sub-paths |
| Feature States | Forecasted → New → Activated → Approved → Done \| Removed |
| Defect States | New → Accepted → Investigated → Planned → Resolved → Closed \| Removed |
| Escape Ratio | Escaped = New+Accepted+Investigated; Caught = Resolved+Closed |
| Priority Field | Philips.Rank (NOT Microsoft.VSTS.Common.Priority) |
| Effort Field | Microsoft.VSTS.Scheduling.Effort |
| PI Naming | `{YY}-PI{N}` — 4 PIs per year |
| Sprint Naming | `{YY}-PI{N} S{N}` + `{YY}-PI{N} IP` |
| Programme Start Year | 2024 (config: app.programmeStartYear) |

---

## Technology Stack
- Backend: Node.js 18+ / Express, node-fetch
- Frontend: Vanilla HTML/JS, Chart.js (CDN), Filament dark-mode CSS
- Auth: PAT in Authorization header
- Port: 3000

---

## Current Dashboard Sections (all complete)

| Section | Status |
|---------|--------|
| Executive Summary (RAG, KPIs, health score) | ✅ |
| Features (funnel, team bar, lifecycle, velocity, WIP, slip, throughput) | ✅ |
| Defects (escape ratio, aging, injection, found-in, SLA breach) | ✅ |
| PI Compare | ✅ |
| Velocity (sprint velocity, story points, trend) | ✅ |
| Sprint Trend | ✅ |
| Settings | ✅ |
| Docs hub + TFS Field Dictionary | ✅ |

---

## Phase 4 — In Planning (Aravind RTE inputs, May 2026)

### 4A. Feature Cycle Time — Correction

**Current (wrong):** Activated Date → Last Changed Date
**Correct:** `System.CreatedDate` (proxy for Forecasted entry) → `Microsoft.VSTS.Common.StateChangeDate` (Done date)

**Decisions confirmed:**
- Start = `System.CreatedDate` — proxy for when feature first entered Forecasted (features are created in Forecasted state)
- End = `Microsoft.VSTS.Common.StateChangeDate` — records last state transition; for Done features this = Done date
- Rationale: avoids expensive revision-history API; StateChangeDate is fast (single field)

**Backend changes (server.js):**
- Replace `Microsoft.VSTS.Common.ActivatedDate` with `Microsoft.VSTS.Common.StateChangeDate` in feat field list
- In `processFeatures()`: cycle time = `StateChangeDate − CreatedDate` (for Done features only)
- `itemSummary()`: expose `stateChangeDate` instead of `activatedDate`

**Frontend changes (app.js):**
- `applyTeamFilter()`: use `item.stateChangeDate` (not `item.activatedDate`) for cycle time re-compute
- Chart subtitle: change label to "Forecasted → Done (days)"

---

### 4B. Predictability Measure

**Decisions confirmed (May 2026):**
- Measurement: **Effort-based** (`Microsoft.VSTS.Scheduling.Effort`), NOT feature count
- Two separate gauges: one for Planned (X), one for Stretch (Y)
- Formula: Predictability % = Sum(Done effort) / Sum(Total snapshot effort) × 100
- Target: 80–100% = green zone on both gauges
- Not Done states: New, Approved, Forecasted, Removed
- Planned vs Stretch classification field: **TBD** — stored in `config.json` as `plannedStretchField`; until confirmed, all features treated as Planned

**Snapshot system:**
- Storage: local JSON files in `snapshots/` folder (one file per snapshot)
- File name: `{pi}-{iso-timestamp}.json`
- Schema per snapshot file:
  ```json
  {
    "id": "26-PI1-2025-01-15T10:30:00",
    "pi": "26-PI1", "label": "Plan Final - Approved",
    "capturedAt": "2025-01-15T10:30:00Z",
    "isRevision": false, "parentId": null,
    "features": [{ "id": 1234, "title": "...", "state": "Forecasted", "type": "Planned", "team": "Hercules", "iter": "..." }]
  }
  ```
- Revisions: new file with `isRevision: true, parentId: original-id`; old file retained

**Backend endpoints:**
- `POST /api/snapshot` — fetch live features for PI, save to `snapshots/`, return snapshot metadata
- `GET /api/snapshots?pi=26-PI1` — list all snapshots for a PI (id, label, capturedAt, isRevision, parentId)
- `GET /api/predictability?snapshotId=xxx&teamPath=` — compare live TFS data vs snapshot; return predictability %

**Frontend (sub-panel inside Features section):**
- Snapshot selector dropdown (shows label + date + Revision badge)
- "📸 Capture Snapshot" button → confirmation modal → POST → refresh list
- Revision toggle: "Save as revision of current snapshot"
- Gauge chart (0–100%) with 80–100% green zone
- KPI cards: Planned Done / Planned Total / Stretch Done / Stretch Total / Predictability %
- Comparison table: feature title | type | snapshot state | live state | delta (Done / Not Done)
- Filters: PI, Team

---

## Phase 3 — In Planning

### 1. Test Coverage Section (`🧪 Test Coverage`)

**Backend: `/api/test-coverage?pis[]=26-PI1`**
- WIQL: `WorkItemType = 'Test Case' AND AreaPath UNDER ISP`
- Field: `Microsoft.VSTS.TCM.AutomationStatus` (Automated / Not Automated / Planned)
- Group by team (AreaPath) and automation status
- Test Runs REST API: `GET _apis/test/runs` → aggregate outcomes per PI
  - Outcomes: Passed, Failed, Blocked, Not Executed, In Progress, Paused, Not Applicable
  - Compute Pass Rate = Passed / (Passed + Failed + Blocked)
- Feature coverage: expand TestedBy links on features to find uncovered features

**Frontend cards:**
- Automation Coverage donut + % KPI + team breakdown bar
- Test Execution outcomes stacked bar + Pass Rate KPI
- Feature Coverage: linked vs unlinked count + uncovered features list (📋 modal)

**Known limitations:**
- Test Cases use AreaPath for team scoping (not IterationPath — set to root)
- Unit tests NOT in TFS; placeholder card only

---

### 2. Cycle Time (add to Features section)

**Backend: add fields to feature fetch**
- Add `Microsoft.VSTS.Common.ActivatedDate` to features field list
- For Done features: cycle time = ChangedDate − ActivatedDate (days)
- If ActivatedDate null: fall back to CreatedDate
- Compute per-team: avg, min, max, p50 cycle time
- Add `cycleTime` object to processFeatures() output

**Frontend:**
- Bar chart: avg cycle days per team
- Tooltip: min / max / median
- Subtitle note: "based on Activated→last change date"

---

### 3. Sprint Burndown (add to Sprint Trend section)

**Backend: `/api/sprint-burndown?pi=26-PI1`**
- For each sprint in the PI (S1, S2, S3, IP):
  - Features: `IterationPath UNDER sprint-path` — total count + Done count + total effort + done effort
- Return per-sprint: total, done, remaining, totalEffort, doneEffort

**Frontend:**
- Stacked bar: Done (green) vs Remaining (amber) per sprint
- % complete line overlay
- Current sprint highlighted with a border

---

## Todos (active)

| ID | Title | Depends On | Status |
|----|-------|-----------|--------|
| tc-backend | Test Coverage API route | — | pending |
| tc-frontend | Test Coverage section UI | tc-backend | pending |
| ct-backend | Cycle Time API additions | — | pending |
| ct-frontend | Cycle Time chart in Features | ct-backend | pending |
| sb-backend | Sprint Burndown API | — | pending |
| sb-frontend | Sprint Burndown chart | sb-backend | pending |

---

## VM Deployment — Troubleshooting Notes

### Helmet / HTTPS Fix
Server runs over **HTTP only**. Default Helmet config breaks HTTP servers accessed by IP.

**Required Helmet config in `server.js`:**
```js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // upgradeInsecureRequests intentionally OMITTED — forces HTTPS, breaks HTTP servers
    },
  },
  hsts: false,                      // no HSTS — server is HTTP, not HTTPS
  crossOriginOpenerPolicy: false,   // requires secure context; breaks HTTP IP access
  crossOriginEmbedderPolicy: false,
}));
```

**To apply fix on VM, run:**
```powershell
cd "D:\AV Dashboard\scripts"
.\fix-helmet.ps1
```

**If service name is unknown:**
```powershell
Get-Service | Where-Object { $_.DisplayName -like "*dashboard*" -or $_.DisplayName -like "*node*" }
Get-Process -Name "node"
netstat -ano | findstr ":3000"
# Kill old process and restart:
Stop-Process -Id <PID> -Force
cd "D:\AV Dashboard"; node server.js
```

### Browser HSTS Cache
After fixing Helmet, Chrome may still force HTTPS due to cached HSTS.

**Fix:**
1. Chrome → `chrome://net-internals/#hsts`
2. Delete domain: `144.54.104.49`
3. Reload `http://144.54.104.49:3000`

OR open **Incognito window** to bypass immediately.

### Windows Firewall — Allow Port 3000
If server is running but unreachable from outside the VM:
```powershell
# Check if rule exists
netsh advfirewall firewall show rule name="Node 3000"

# Add inbound rule
netsh advfirewall firewall add rule name="Node 3000" dir=in action=allow protocol=TCP localport=3000
```

### Deployment Script
```powershell
# Package (local machine)
.\scripts\package.ps1 -SkipBuild

# Update VM in-place (run on VM)
.\scripts\update.ps1 -zipPath "D:\av-dashboard-<timestamp>.zip" -InstallDir "D:\AV Dashboard" -ServiceName "<ServiceName>"
```
- `config.json` and `data\` are **preserved** during update
- Paths with spaces must be quoted

---

## TFS Field Reference
See `docs/tfs-field-dictionary.html` for confirmed field names, states, and decisions.


## Problem Statement
Build a standalone, locally-run Node.js + HTML dashboard that connects to a Philips TFS server and monitors Features and Defects under `Healthcare IT\ICAP\ISP`. Data refreshes every 30 minutes. The dashboard shows feature lifecycle, defect ratios, and team-wise breakdowns across PIs/Quarters for the current year.

---

## Confirmed Requirements

| Item | Value |
|------|-------|
| TFS URL | https://tfsemea1.ta.philips.com/tfs/TPC_Region11/Healthcare IT |
| Auth | Personal Access Token (PAT) |
| Area Root (AreaPath) | Healthcare IT\ICAP\ISP |
| Iteration Root | Healthcare IT\ISP |
| Teams | Dynamically discovered from AreaPath sub-paths (e.g., Healthcare IT\ICAP\ISP\Hercules\Avyay) |
| Work Item: Feature | States: Forecasted, New, Approved, Done, Removed |
| Work Item: Defect | States: New, Accepted, Planned, Resolved, Removed |
| PI Naming Format | `{YY}-PI{N}` — 4 PIs per year e.g. `26-PI1`, `26-PI2`, `26-PI3`, `26-PI4` |
| Sprint Naming Format | `{YY}-PI{N} S{N}` e.g. `26-PI1 S1`, `26-PI1 S2`, `26-PI1 S3` |
| IP Naming Format | `{YY}-PI{N} IP` e.g. `26-PI1 IP` |
| PI ↔ Quarter | PI1=Q1(Jan-Mar), PI2=Q2(Apr-Jun), PI3=Q3(Jul-Sep), PI4=Q4(Oct-Dec) |
| Year Boundary | Rolls over per year: 2026=`26-PI1..PI4`, 2027=`27-PI1..PI4` |
| Each PI | 3 Sprints (S1, S2, S3) + 1 IP |
| Current (May 2026) | In `26-PI2` (Q2) → show `26-PI1` (Q1) by default |
| Refresh | Every 30 minutes (countdown + manual override) |
| Caching | None — always live from TFS |
| Hosting | Run locally on Windows PC, open in browser |

---

## Technology Stack

```
┌──────────────────────────────────────────────┐
│  Node.js 18+ (Express)  — localhost:3000      │
│  ┌────────────────────────────────────────┐   │
│  │  /api/features   (WIQL query)          │   │
│  │  /api/defects    (WIQL query)          │   │
│  │  /api/iterations (area iteration tree) │   │
│  │  /api/teams      (derived area paths)  │   │
│  │  /api/config     (GET/POST settings)   │   │
│  │  Serves /public/ (HTML + JS + CSS)     │   │
│  └────────────────────────────────────────┘   │
│          │  PAT in Authorization header        │
└──────────┼───────────────────────────────────┘
           ▼
  TFS EMEA: tfsemea1.ta.philips.com
```

**Libraries:**
- Backend: `express`, `node-fetch`, `cors`
- Frontend charts: `Chart.js` (CDN)
- Frontend UI: Vanilla JS + CSS Grid (no framework, max portability)

---

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│  🏥 ISP Dashboard   [Q1 2025][Q2 2025]▾   ⚙ Settings       │
│  Last refresh: 11:30 AM · Next in 28:42  [↺ Refresh Now]   │
├──────────┬──────────┬──────────┬─────────────────────────────┤
│ PI1      │ PI2      │ PI3      │ PI4                         │
│ Sprint1  │ Sprint1  │ Sprint1  │ Sprint1                     │
│ Sprint2  │ Sprint2  │ Sprint2  │ Sprint2                     │
│ Sprint3  │ Sprint3  │ Sprint3  │ Sprint3                     │
│ IP       │ IP       │ IP       │ IP                          │
├──────────┴──────────┴──────────┴────────────────────────────┤
│  FEATURE LIFECYCLE                                           │
│  [Forecasted ████████████ 42]                               │
│  [New        ███████ 28]                                     │
│  [Approved   █████ 20]                                       │
│  [Done       ████ 15]                                        │
│  [Removed    ██ 7]                                          │
├──────────────────────┬──────────────────────────────────────┤
│  DEFECT RATIO        │  DEFECT ESCAPE RATIO                 │
│  [Donut chart]       │  [KPI Card: X%]                      │
│  by state            │  [Trend line by sprint]              │
├──────────────────────┴──────────────────────────────────────┤
│  TEAM-WISE DEFECT BREAKDOWN                                  │
│  [Stacked bar: Avyay | ActionTeam | ... by state]          │
└─────────────────────────────────────────────────────────────┘
```

---

## Quarter Logic
- Current quarter auto-detected from system date
- Show all **completed** quarters of the current year by default
- Quarter selector dropdown allows manual override
- PI ↔ Quarter mapping stored in `config.json` (configurable)

---

## Key WIQL Patterns

**Features:**
```sql
SELECT [System.Id], [System.Title], [System.State], [System.AreaPath], [System.IterationPath]
FROM WorkItems
WHERE [System.WorkItemType] = 'Feature'
  AND [System.AreaPath] UNDER 'Healthcare IT\ICAP\ISP'
  AND [System.IterationPath] UNDER 'Healthcare IT\ISP\25-PI5'
ORDER BY [System.CreatedDate] DESC
```

**Defects:**
```sql
SELECT [System.Id], [System.Title], [System.State], [System.AreaPath], [System.IterationPath]
FROM WorkItems
WHERE [System.WorkItemType] = 'Defect'
  AND [System.AreaPath] UNDER 'Healthcare IT\ICAP\ISP'
  AND [System.IterationPath] UNDER 'Healthcare IT\ISP\25-PI5'
```

> ⚠️ **AreaPath ≠ IterationPath root** — AreaPath root is `Healthcare IT\ICAP\ISP`, Iteration root is `Healthcare IT\ISP`

---

## File Structure
```
AV Dashboard/
├── server.js               # Express server + TFS proxy
├── config.json             # PAT, TFS URL, configurable settings
├── package.json
├── package-lock.json
├── .gitignore              # Exclude config.json (has PAT)
├── public/
│   ├── index.html          # Dashboard shell
│   ├── app.js              # Frontend logic + Chart.js rendering
│   └── style.css           # Styling
└── README.md
```

---

## Todos — Phase 1 (Core, all done)
| ID | Title | Status |
|----|-------|--------|
| project-scaffold | Scaffold Node.js project | ✅ done |
| tfs-api-layer | Build TFS API proxy layer | ✅ done |
| dashboard-html | Build main dashboard HTML shell | ✅ done |
| dashboard-css | Style dashboard (Filament dark mode) | ✅ done |
| feature-lifecycle | Feature Lifecycle Funnel chart | ✅ done |
| defect-charts | Defect ratio + escape ratio charts | ✅ done |
| auto-refresh | 30-min auto-refresh + manual refresh | ✅ done |
| quarter-logic | Quarter filter and PI mapping logic | ✅ done |
| config-panel | Configuration panel (settings drawer) | ✅ done |
| readme | README with setup instructions | ✅ done |

## Todos — Phase 2 (Executive / R&D Leader, pending)
| ID | Title | Priority |
|----|-------|----------|
| first-run-ux | First-run PAT welcome wizard | P0 — blocks all usage |
| executive-summary | Executive Summary panel (programme health, RAG, score) | P1 |
| rag-indicators | RAG thresholds on KPI cards | P1 |
| team-scorecard | Team RAG scorecard table | P1 |
| pi-comparison | PI-vs-PI comparison view (trend direction) | P1 |
| committed-vs-done | Committed vs Delivered tracking gauge | P2 |
| defect-density | Defect density + P1/P2 spotlight | P2 |
| sprint-trend | Sprint-level trend charts (S1→S2→S3→IP) | P2 |
| feature-aging | Stale/aging feature alerts | P2 |
| export-print | Print / PDF export (exec-ready layout) | P3 |

---

## Audience: R&D Leaders & Executive Directors
- Need programme health at a glance — no scrolling, no tables
- Care about: delivery confidence, quality trend, team health, risk flags
- Want to compare PI performance over time
- Need to share/print a single-page status report
- RAG indicators let them scan without reading numbers

## Open Decisions / Assumptions
1. **Defect Escape Ratio formula** — configurable via Settings
2. **Feature states display order** — Forecasted → New → Approved → Done (Removed separate)
3. **Teams** — dynamically fetched from TFS: `Healthcare IT\ICAP\ISP\Hercules\<Team>`
4. **teamRootPath** — configurable in config.json and Settings UI
5. **RAG thresholds** — configurable per metric in Settings
6. **Programme Health Score** — weighted composite of Done Rate + Escape Ratio + P1/P2 count
