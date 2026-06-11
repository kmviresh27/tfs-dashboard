<overview>
The session focused on bug fixes and improvements to the TFS Dashboard (Node.js/Express + React/Vite). Primary goals: fix the "Avg Cycle Time (all teams)" KPI showing wrong value, refactor the Feature Cycle Time per Team chart to use authoritative team names from TFS area tree instead of blind last-segment extraction, and ensure "ISP" root node doesn't appear as a team. The approach was to extract a shared `teamsHelper.js` module that correctly fetches leaf teams from TFS, handling the `\Area\` path injection quirk in TFS classification nodes API.
</overview>

<history>

1. **User reported Avg Cycle Time KPI (139d) doesn't match manual calculation (sum of bars ÷ 18 teams = 176.88d)**
   - Root cause: KPI used weighted average (`sum(team_avg × team_count) / total_features`), which weights high-volume teams more
   - Fix: Changed `avgCycleAll` in `HealthSection.jsx` to simple average of team averages: `sum(team.avg) / count(teams)`
   - This now matches the user's manual calculation from chart bars
   - Build passed ✓

2. **User asked how team names are extracted in Feature Cycle Time per Team**
   - Explained: last segment of `System.AreaPath` via `teamLabel()` function in `cycleTime.js`
   - Noted issue: features nested deeper than one level (e.g. `ISP\Apollo\DevOps_Installation`) would give wrong team name `"DevOps_Installation"` instead of `"Apollo"`

3. **User suggested using TFS area tree to get authoritative team names**
   - Created `src/helpers/teamsHelper.js` — shared helper that fetches TFS classification nodes tree, strips `\Area\` segment TFS injects in node paths, finds each `teamRootPath` node, and returns direct children as leaf team Set
   - Updated `cycleTime.js` to import from `teamsHelper` instead of using last-segment approach; grouping now walks from deepest segment backward to find first matching known team
   - Updated `dashboard.js` `/api/teams` route to use `fetchLeafTeams(cfg)` instead of inline logic
   - Key discovery: TFS classification nodes API returns paths like `\Healthcare IT\Area\ICAP\ISP` (includes `\Area\`), but `teamRootPath` config uses `Healthcare IT\ICAP\ISP` (no `\Area\`) — must normalize

4. **Chart showed "No cycle time data available. Features need to be in Done state."**
   - Debugged: `fetchLeafTeams` correctly returns 25 teams (Dev Infra, TopQ, Apollo, Hercules, Envision, Athena, etc.)
   - Verified: 636 Done features exist for last 4 PIs
   - Test confirmed matching works: 39/50 sample features matched to teams (Apollo, Hercules, Envision, Athena, TerraNova)
   - Issue was server `av-server9` was running old code; `av-server10` has correct code
   - **Still being investigated** — user pointed out "we are taking first index from team path we need to take last", suggesting something in the path indexing is wrong

5. **Ongoing investigation of cycle time empty chart**
   - Test script `test-ct.js` created for diagnostics
   - Test shows logic is correct: `Healthcare IT\ICAP\ISP\Apollo\DevOps_Installation` → segments `["Healthcare IT","ICAP","ISP","Apollo","DevOps_Installation"]` → walks backward, finds "Apollo" in leafTeams ✓
   - Server is running (av-server10), 25 leaf teams found, 39 rows matched in sample of 50
   - Root cause of empty chart in browser not yet fully confirmed — may be client-side React Query error or stale cache

</history>

<work_done>

Files modified:
- `client/src/sections/HealthSection.jsx` — Changed `avgCycleAll` formula from weighted average to simple average of team averages (lines ~269-275)
- `src/routes/cycleTime.js` — Removed inline `fetchLeafTeams` and `teamLabel` functions; now imports from `teamsHelper`; grouping uses walk-backward-from-deepest approach with authoritative leaf teams
- `src/routes/dashboard.js` — `/api/teams` endpoint replaced with `fetchLeafTeams(cfg)` call; now returns actual leaf teams under all `teamRootPath` entries (not just top-level children)

Files created:
- `src/helpers/teamsHelper.js` — New shared helper: `fetchLeafTeams(cfg)` fetches TFS area classification tree, normalizes paths (strips `\Area\`), finds nodes matching `teamRootPath` entries, returns Set of direct-child team names
- `test-ct.js` — Diagnostic script (temp, should be deleted)

Work completed:
- [x] Avg Cycle Time KPI now shows simple average matching manual calculation
- [x] `teamsHelper.js` created and working (returns 25 teams)
- [x] `dashboard.js` `/api/teams` uses shared helper
- [x] `cycleTime.js` imports from shared helper
- [ ] **Feature Cycle Time chart still showing empty** — server has correct code (av-server10), logic verified in test, but browser chart not confirmed working yet
- [ ] `test-ct.js` temp file needs deletion

Current server: `av-server10` (shellId) — running at localhost:3000 with all latest changes

</work_done>

<technical_details>

- **TFS classification nodes API path format**: `\Healthcare IT\Area\ICAP\ISP` — includes `\Area\` after project name. Config `teamRootPath` uses `Healthcare IT\ICAP\ISP` (no `\Area\`). Must strip `\Area\` when comparing: `normPath = p.replace(/\\Area\\/i, '\\')`
- **`teamRootPath` in config** = `["Healthcare IT\ICAP\ISP", "Healthcare IT\AV On Cloud", "Healthcare IT\AV-Platform", "Healthcare IT\Image Analysis Hub"]` — four separate product areas
- **`cfg.tfs.areaPath`** = `"Healthcare IT"` — top-level project root, NOT useful for team filtering directly
- **Leaf team extraction strategy**: fetch TFS area tree → find each `teamRootPath` node → collect direct children → use Set for O(1) lookup. Then for each work item, walk area path segments from LAST to FIRST, return first segment that's a known leaf team
- **Why walk backward**: features can be assigned to sub-areas of teams (e.g. `ISP\Apollo\DevOps_Installation`). Last segment `DevOps_Installation` is not a team; `Apollo` is. Walking backward from deepest finds the correct team.
- **Avg Cycle Time KPI**: simple average `sum(team.avg) / count(teams)` = matches user's manual calculation from bar chart. Weighted average (old approach) gave lower number because high-volume low-cycle teams dominated.
- **`fetchLeafTeams` result**: 25 teams confirmed — Dev Infra, TopQ, AgentQ Team, ICAP SEA, ICAP PVT, System External, Athena, Hercules, External Groups, Requirements, ICAP DevOps FeatureOperation, VS, Apollo, Technical Debt, Clinical Applications, ICAP Clinical Science, Venus, Auto Defect, ProActive Monitoring, AI ACT, Envision, Phoenix, Orion, TerraNova, Image Analysis Hub Team
- **Feature count**: 636 Done features in last 4 PIs (26-PI2, 26-PI1, 25-PI4, 25-PI3) under `Healthcare IT`
- **Test results**: 39/50 sample features matched to teams; 11 skipped (root-level or missing dates)
- **Server restart required** after any `src/` change — client changes need `npm run build` only

</technical_details>

<important_files>

- `src/helpers/teamsHelper.js`
  - New shared helper — single source of truth for leaf team names from TFS
  - Created in this session; exports `fetchLeafTeams(cfg)`
  - Key logic: `normPath` strips `\Area\` (line 23), `findNode` exact-matches normalized paths (line 26-34), collects `child.name` for each root's direct children (lines 39-43)

- `src/routes/cycleTime.js`
  - Handles `GET /api/cycle-time-distribution?byTeam=true`
  - Modified: imports `fetchLeafTeams` from `teamsHelper`; removed duplicate inline function; grouping loop walks segments backward (lines ~94-108)
  - Key: `const leafTeams = await fetchLeafTeams(cfg)` then match walk

- `src/routes/dashboard.js`
  - Handles `/api/teams`, `/api/dashboard`, `/api/features`, `/api/defects`
  - Modified: `GET /api/teams` now calls `fetchLeafTeams(cfg)` — returns actual leaf teams (lines ~28-35)
  - Also imports `fetchLeafTeams` from `teamsHelper`

- `client/src/sections/HealthSection.jsx`
  - Health page — Feature Cycle Time per Team, Defect Aging, Escape Ratio charts
  - Modified: `avgCycleAll` useMemo uses simple avg (lines ~269-275); `teamCycleEntries` filters by last segment of selectedTeam (lines ~83-93)

- `src/helpers/dataProcessors.js`
  - Core server data processor for features/defects; `extractTeam()` still uses `.pop()` (last segment) for team breakdown in other routes
  - `isRootArea()` helper correctly skips items at `teamRootPath` roots using exact normalized path match

- `test-ct.js` (TEMP — should be deleted)
  - Diagnostic script at project root; used to verify cycle time logic end-to-end

</important_files>

<next_steps>

Immediate actions needed:
1. **Delete `test-ct.js`** — temp diagnostic file at project root
2. **Verify Feature Cycle Time chart in browser** — user reported it's empty. Server `av-server10` has correct code and test confirms 39/50 features match to teams. User should hard-refresh (Ctrl+Shift+R) to clear React Query cache. If still empty, check browser console for API errors on `/api/cycle-time-distribution?byTeam=true&piCount=4`
3. **If chart still empty after refresh**: add temporary `console.log` to `cycleTime.js` after `fetchLeafTeams` call to confirm it runs during HTTP request, not just in test script

Remaining open question:
- User said "we are taking first index from team path we need to take last" — may refer to something not yet identified. The current `cycleTime.js` grouping walks from LAST segment backward which is correct. Could be referring to `teamRootPath[0]` being used somewhere instead of iterating all entries — but `teamsHelper.js` correctly iterates all.

</next_steps>