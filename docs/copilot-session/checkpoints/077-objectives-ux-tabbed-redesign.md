<overview>
This session focused on fixing four team-reported issues with the Objectives section (missing objectives, wrong sort order, broken number filter, postponed/removed impact panel for Business Owners), then redesigning the entire Objectives UX into a tabbed layout. The user enforces a strict no-push rule — all work goes to `D:\views\AV Dashboard` (dev), then copied to `D:\views\tfs-dashboard` (for user to commit/push). Server restarts are done locally via PowerShell.
</overview>

<history>

1. **Four objectives fixes requested** (missing items, wrong sort, broken filter, postponed impact panel)
   - `objectives.js` + `objectivesPlan.js`: Fixed WIQL to include objectives at PI root iteration path (OR clause), added `ORDER BY [Microsoft.VSTS.Common.StackRank] ASC`, fetched `StackRank` + `Priority` fields
   - `ObjectivesPlanningSection.jsx`: Added `'tfs'` sort case using `stackRank`, fixed `#`-prefix search, changed default sort to `'tfs'`
   - Added `postponedImpact` block to `objectivesPlan.js` response and rendered panel at bottom of JSX

2. **Postponed panel not visible** — User couldn't see it
   - Root cause: panel used `{ total > 0 }` guard, so it was hidden when no objectives matched the state filter
   - Fixed: panel always renders; shows "No changes" message when clean
   - Also fixed: only compared objective's own state (`Removed`, `Postponed`, etc.) — missed active objectives with removed features underneath

3. **"We should depend on snapshot"** — User wanted comparison vs PI Planning baseline, not state string matching
   - Implemented two-step snapshot lookup: `listSnapshotMeta()` (metadata only) → `readSnapshot()` (full data for matched snapshot)
   - Category A: objective in snapshot but missing from current TFS → "Removed"
   - Category B: objective in both but snapshot had more features → "Scope Cut"
   - Added `hasSnapshot`, `snapshotLabel`, `droppedCount`, `impactedCount` to API response
   - Moved panel to **top** of objectives list

4. **"No PI Planning snapshot found" despite snapshot existing**
   - Root cause 1: `listSnapshotFiles` (old approach) silently caught parse errors — large snapshot files could fail
   - Root cause 2: Server was running old code (started before changes)
   - Root cause 3: Original approach auto-matched by PI label — no user-controlled snapshot selection
   - Proper fix: read `activeSnapshotId` from Zustand store (same pattern as Scope Change section), pass as `snapshotId` query param to backend, use `readSnapshot(snapshotId)` directly
   - Added `listSnapshotMeta()` to `snapshots.js` — reads full file but logs errors instead of silently swallowing them
   - Added console logging for debug: logs matched snapshot ID, baseline count, team, deptId
   - Restarted server after each change

5. **Team filter scoping for snapshot comparison**
   - When `requestedTeamName` is set, baseline objectives are filtered to that team before comparison
   - Feature-level comparison also scoped: only compares features belonging to selected team

6. **UX redesign requested** — "First time user should be able to use easily, also in executives perspective"
   - Designed 3-tab layout: `📊 Overview` | `🎯 Objectives (N)` | `⚠ Risks (N)`
   - **Overview tab**: Programme health banner (big progress bar + BV cards) + team progress matrix table (one row per team, clickable)
   - **Objectives tab**: Current ObjectiveCard list with simplified controls (search, type filter, sort, expand all)
   - **Risks tab**: Business Owner scope change view — fully expanded, no nested collapsibles, explains snapshot requirement, shows summary pills + detailed cards
   - Sticky header simplified: title + context line (PIs + team) + quick health pills (% / Red count / Scope changes pill)
   - Tab bar with active underline indicator; Risks tab turns red when there are scope changes
   - Started edit but ran into a "no match found" error on the large replacement — **incomplete**

</history>

<work_done>

Files modified in `D:\views\AV Dashboard`:

- **`src/routes/objectives.js`** — WIQL includes root iteration path, ORDER BY StackRank, returns stackRank/priority ✅
- **`src/routes/objectivesPlan.js`** — Same WIQL fix + sort; step 9 uses `snapshotId` query param directly (via `readSnapshot`), falls back to PI-label auto-match; team filter applied to baseline; `listSnapshotMeta` + `readSnapshot` imported ✅
- **`src/helpers/snapshots.js`** — Added `listSnapshotMeta()` function (reads full file but returns only top-level metadata, logs errors); exported in `module.exports` ✅
- **`client/src/api/hooks.js`** — `useObjectivesPlan` now accepts `snapshotId` param, includes in query key and URL ✅
- **`client/src/sections/ObjectivesPlanningSection.jsx`** — Reads `activeSnapshotId` + `activeSnapshotLabel` from store; passes to hook; **UX redesign edit FAILED** (no-match error, edit not applied) ❌

All completed files copied to `D:\views\tfs-dashboard`. Server restarted multiple times.

**Build status**: Last successful build was after snapshot/team-filter changes. UX redesign edit not yet applied so no new build.

**Completed:**
- [x] WIQL iteration fix (root path included)
- [x] StackRank sort (TFS priority order)
- [x] `#`-prefix search fix + exact ID match
- [x] Snapshot-based postponed impact (Category A: dropped, Category B: scope cut)
- [x] `activeSnapshotId` wired from config panel → hook → backend
- [x] Team filter scoping for snapshot baseline
- [x] `listSnapshotMeta` added to snapshots.js
- [x] Server restarted with latest code
- [ ] **Objectives UX redesign (3-tab layout) — NOT YET APPLIED**

</work_done>

<technical_details>

- **Snapshot location**: `data/departments/{deptId}/snapshots/*.json`. Files can be very large (hundreds of KB to MB) containing features, defects, objectives. `listSnapshotFiles` reads all fully — can fail silently for large files. New `listSnapshotMeta` still parses fully but logs errors.

- **`activeSnapshotId` pattern**: Same as Scope Change section. User selects snapshot in Config panel → `setActiveSnapshot(id, label)` → stored in Zustand. Pass as `?snapshotId=` query param. Backend calls `readSnapshot(id, deptId)` directly. This is the correct, intentional pattern.

- **Snapshot structure**: `snap.data.objectives.items` = array of `{id, title, state, team, iter, businessValue, type, features: [{id, title, state, team}], linkedTeams}` — captured at PI planning time.

- **Team filter in snapshot comparison**: `requestedTeamName` = last path segment of `req.query.teamPath`. Applied to `baselineObjs` with: `bo.team === requestedTeamName || bo.features.some(f => f.team === requestedTeamName)`. Feature-level cuts also scoped: only compare `snapFeatures.filter(f => f.team === requestedTeamName)`.

- **PI label format**: `26-PI2` (from `{yy}-PI{n}` pattern). `getDefaultPIs()` returns past PIs only (before current). UI uses `availablePIs.filter(p => p.isPast || p.isCurrent)` which includes current PI. Snapshot `pis` field matches this format.

- **`deptId` for default dept**: API calls from default dept go to `/api/...` (not `/api/d/default/...`). `deptIdMiddleware` sets `req.deptId = 'default'`. Snapshots stored at `data/departments/default/snapshots/`.

- **UX redesign plan** (not yet implemented):
  - 3 tabs: `📊 Overview`, `🎯 Objectives (N)`, `⚠ Risks (N)`
  - Overview: programme health banner + team matrix table (one row per team)
  - Objectives: current ObjectiveCard list with simplified controls
  - Risks: always-expanded, explains snapshot, shows dropped + scope cut cards
  - Sticky header: title + PI/team context + quick health pills
  - Tab bar with underline; Risks tab turns red when `riskCount > 0`
  - Clicking team row in Overview navigates to Objectives tab
  - Clicking "Scope Changes" pill in header navigates to Risks tab

- **`ObjectiveCard` component**: Existing component kept as-is. Has `forceExpanded` prop for expand/collapse all. Shows progress bar, feature metrics, linked teams. Expandable to show feature rows.

- **Git workflow**: Dev in `D:\views\AV Dashboard`. Copy to `D:\views\tfs-dashboard`. User handles all git operations. Never push directly.

- **Server restart command** (PowerShell):
  ```powershell
  $srv = Get-Process node | Where-Object { (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -like "*server.js*" }
  Stop-Process -Id $srv.Id -Force; Start-Sleep 2
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "D:\views\AV Dashboard" -RedirectStandardOutput "D:\views\AV Dashboard\server.log" -WindowStyle Hidden
  ```

</technical_details>

<important_files>

- **`D:\views\AV Dashboard\client\src\sections\ObjectivesPlanningSection.jsx`**
  - Main objectives UI component — the primary file for the UX redesign
  - Current state: has `activeSnapshotId` wired, old flat layout still in place (redesign edit FAILED)
  - **THIS IS THE NEXT FILE TO EDIT** — needs the full 3-tab redesign applied
  - Key: `useObjectivesPlan` hook call at ~line 284; state variables at ~line 272-278; return block starts at ~line 328

- **`D:\views\AV Dashboard\src\routes\objectivesPlan.js`**
  - Backend for `/api/objectives-plan`
  - Step 9 (~line 262): snapshot-based postponed impact with team scoping
  - `listSnapshotMeta` + `readSnapshot` imported at top
  - Returns `postponedImpact.{total, droppedCount, impactedCount, bvAtRisk, byTeam, objectives, hasSnapshot, snapshotLabel}`

- **`D:\views\AV Dashboard\src\helpers\snapshots.js`**
  - Contains `listSnapshotMeta()` (new, ~line 34-60) and `listSnapshotFiles()` (existing)
  - `listSnapshotMeta` returns `{id, pis, label, capturedAt, isRevision, parentId, _file}` without `data`
  - Both exported in `module.exports` at ~line 625

- **`D:\views\AV Dashboard\client\src\api\hooks.js`**
  - `useObjectivesPlan(pis, team, snapshotId)` at ~line 317 — accepts snapshotId, includes in queryKey and URL
  - `buildQs` at line 7 serializes arrays as `key[]=val`

- **`D:\views\AV Dashboard\src\routes\objectives.js`**
  - Backend for `/api/objectives` (executive view, different from planning section)
  - Also fixed: StackRank sort, iteration path fix, returns stackRank/priority

- **`D:\views\AV Dashboard\client\src\store\useStore.js`**
  - `activeSnapshotId` + `activeSnapshotLabel` at lines 37-38
  - `setActiveSnapshot(id, label)` at line 90
  - Set by `ConfigPanel.jsx` when user browses/selects a snapshot

</important_files>

<next_steps>

**Immediate — UX redesign edit failed, needs to be re-applied:**

The 3-tab redesign was designed but the `edit` tool reported "no match found". Need to replace the `return` block of `ObjectivesPlanningSection.jsx` plus state declarations.

**The redesign to implement:**

Replace from `const [filterType, ...` (state declarations, ~line 274) through the end of the component `}` with:

1. **State**: Replace `showPostponed` with `activeTab` (`'overview' | 'objectives' | 'risks'`), keep other states
2. **Sticky header**: Title + PI/team context line + quick health pills (progress %, red count, scope changes)
3. **Tab bar**: 3 clickable tabs with underline indicator; Risks tab turns red when `riskCount > 0`
4. **Overview tab** (`OverviewTab` function):
   - Programme health banner: big `{prog}%` + progress bar + RAG counts
   - BV cards: Committed, Stretch, BV Planned, BV Weighted
   - Team matrix table: one row per team (Team, Committed, Stretch, mini progress bar %, Done/Total, BV, Status emoji)
   - Clicking a team row → `setActiveTab('objectives')`
5. **Objectives tab**: Search input + type filter + sort select + expand/collapse button + ObjectiveCard list grouped by team
6. **Risks tab** (`RisksTab` function):
   - No-snapshot state: centered 📷 message explaining how to select snapshot in Config
   - Has-snapshot, no changes: ✅ green message
   - Has changes: summary pills (N removed, N scope cuts, BV at risk, per-team) + `ImpactCard` list for dropped + scope-cut sections
7. **Remove** `showPostponed` state entirely (no more collapsible)

**After implementing:**
- Run `npm run build` in `client/`
- Copy all changed files to `D:\views\tfs-dashboard`
- Restart local server

</next_steps>