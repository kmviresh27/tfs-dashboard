<overview>
The session focused on fixing the "Feature Cycle Time per Team" chart in the TFS Dashboard (Node.js/Express + React/Vite) to correctly identify and display scrum team names. The core problem was that team extraction from TFS area paths was using the wrong approach — it needed to use the true leaf nodes (actual scrum teams with no children) from the TFS area classification tree, not just the last segment or direct children of root paths. A secondary goal was to surface a discrepancy warning for features assigned to parent/intermediate nodes (not leaf teams) so teams can fix their TFS area path assignments.
</overview>

<history>

1. **User reported `extractTeam` was taking first index from team path — needed last index**
   - Investigated `src/helpers/dataProcessors.js` — `extractTeam` was already using `.pop()` (last segment), not first
   - Also investigated `src/helpers/teamsHelper.js` which was returning direct children of `teamRootPath` roots (not true leaf nodes)
   - A previous fix had changed `extractTeam` to take "first segment after root" — user clarified this was wrong: `DevOps_Installation` in `ISP\Apollo\DevOps_Installation` should be the team (last/deepest segment = scrum team)

2. **User asked why `http://localhost:3000/api/cycle-time-distribution` returns `byTeam` at high level**
   - Root cause: WIQL query fetches features under entire `"Healthcare IT"` project, so features at `Healthcare IT\ICAP` level got grouped as team `"ICAP"` via `.pop()`
   - Fix: Added `underRoot` prefix guard — only features whose area path starts with one of the configured `teamRootPath` entries get grouped

3. **User said `DevOps_Installation` in `ISP\Apollo\DevOps_Installation` should be the scrum team**
   - Confirmed the logic: last segment = scrum team (`.pop()` is correct)
   - Reverted `extractTeam` back to last-segment approach, but added root guard
   - `extractTeam` now: checks if area path is under a known root → if yes, uses last segment; if area path IS the root itself, returns `'Unknown'`; if not under any root, returns `'Unknown'`

4. **User reported "why is Hercules coming, it has lots of children inside"**
   - Problem: `Hercules` was appearing in chart because features directly assigned to `ISP\Hercules` (not to any child) had last segment `"Hercules"` — but Hercules is an intermediate/parent node, not a true scrum team
   - Confirmed: 79 Done features assigned exactly at `Healthcare IT\ICAP\ISP\Hercules` level
   - Fix: Updated `teamsHelper.js` to recursively collect **true leaf nodes** (nodes with no children) instead of direct children of roots; increased depth from 5 to 10
   - Updated `cycleTime.js` to use `fetchLeafTeams()` as a whitelist — only features whose last segment is in the leaf set get grouped into teams
   - Result: 75 true leaf teams identified (vs. 25 direct children before); `Hercules` confirmed NOT in leaf set

5. **User said "we need to highlight these discrepancies"**
   - Added `misassigned` array to API response — features excluded from by-team grouping (assigned to parent nodes)
   - Added orange warning banner in `HealthSection.jsx` below the chart showing count of misassigned features
   - With "View all" button that expanded inline table with ID (TFS link), Title, Area Path

6. **User said "it should show on modal on click"**
   - Switched from inline expand to using existing `TableModal` component
   - Added `import TableModal from '../components/ui/TableModal.jsx'` to `HealthSection.jsx`
   - Was in the process of replacing the inline expand with `TableModal` when compaction occurred

</history>

<work_done>

Files modified:
- `src/helpers/teamsHelper.js` — Rewrote to recursively find true leaf nodes (no children) using `collectLeaves()`, increased depth from 5 to 10, confirmed 75 leaf teams returned, Hercules NOT a leaf
- `src/helpers/dataProcessors.js` — `extractTeam()` reverted to last-segment (`.pop()`) with root guard: returns `'Unknown'` if not under any configured `teamRootPath`, or if path IS the root itself
- `src/routes/cycleTime.js` — Uses `fetchLeafTeams()` as whitelist; tracks `misassigned[]` array; row building now captures `id`, `title` fields; returns `misassigned` in response
- `client/src/sections/HealthSection.jsx` — Added `showMisassigned` state, orange warning banner, inline "View all" expand (pre-modal version), then started modal refactor — added `import TableModal` but the actual replacement of the inline block was in progress

**Currently in progress (not complete):**
- `HealthSection.jsx` modal replacement: `TableModal` was imported but the warning banner still uses the old inline expand pattern with `showMisassigned` state. Need to replace the inline expand with `<TableModal>` wrapping the misassigned table.

Current server: `av-server15` (shellId) — running at localhost:3000

Work completed:
- [x] `extractTeam` uses last segment (deepest = scrum team) with root guard
- [x] `teamsHelper.js` returns 75 true leaf teams (recursive, depth=10)
- [x] `cycleTime.js` uses leaf whitelist — Hercules/Apollo/etc. parent nodes excluded
- [x] `misassigned[]` array in API response with id, title, areaPath
- [x] Orange warning banner added to Health page cycle time card
- [x] `TableModal` import added to `HealthSection.jsx`
- [ ] **Replace inline expand with `TableModal` in `HealthSection.jsx`** — in progress

</work_done>

<technical_details>

- **TFS area path structure**: `Healthcare IT\ICAP\ISP\Apollo\DevOps_Installation` — scrum team is the LAST segment (`DevOps_Installation`). Parent nodes like `Apollo`, `Hercules`, `ISP` are intermediate groupings, not scrum teams.
- **True leaf teams**: nodes in TFS area tree with NO children = actual scrum teams. Use `$depth=10` API call. `fetchLeafTeams()` recursively walks tree with `collectLeaves()` — only adds nodes where `children.length === 0`. Returns 75 teams.
- **Previous mistake**: `teamsHelper.js` was collecting *direct children of root* (depth=1 from root), which included `Hercules`, `Apollo` etc. that are intermediate nodes with their own children.
- **`extractTeam` root guard**: Before returning last segment, checks if `areaPath.toLowerCase()` starts with one of the normalized `teamRootPath` entries. If not under any root (e.g. `Healthcare IT\ICAP`), returns `'Unknown'`. If path IS exactly the root (e.g. `Healthcare IT\ICAP\ISP`), also returns `'Unknown'`.
- **`cycleTime.js` leaf whitelist**: After the root guard, checks `leafTeams.has(team)` where `team` = last segment. If Hercules is last segment and NOT in leaf set → excluded → goes into `misassigned[]`.
- **79 features at Hercules level**: These Done features (directly at `Healthcare IT\ICAP\ISP\Hercules`) are excluded from by-team grouping and shown in the discrepancy warning.
- **`misassigned` API field**: Only populated when `byTeam=true` query param. Contains `{ id, title, areaPath }` for each excluded feature.
- **TFS classification nodes API path format**: Includes `\Area\` after project name: `\Healthcare IT\Area\ICAP\ISP`. `normPath()` strips this: `.replace(/\\Area\\/i, '\\')`. Config `teamRootPath` doesn't have `\Area\`.
- **`teamRootPath` config**: `["Healthcare IT\ICAP\ISP", "Healthcare IT\AV On Cloud", "Healthcare IT\AV-Platform", "Healthcare IT\Image Analysis Hub"]`
- **`TableModal` component**: Existing reusable component at `client/src/components/ui/TableModal.jsx`. Props: `label`, `title`, `badge`, `btnClassName`, `btnStyle`, `csvFilename`. Opens modal on button click, closes on Escape or backdrop click.

</technical_details>

<important_files>

- `src/helpers/teamsHelper.js`
  - Single source of truth for leaf team names from TFS
  - Key change: `collectLeaves()` recursive function (lines ~38-44) finds nodes with `children.length === 0`
  - `$depth=10` in URL (line 18) ensures all sub-levels are fetched
  - Returns `Set<string>` of 75 leaf team names

- `src/routes/cycleTime.js`
  - Handles `GET /api/cycle-time-distribution?byTeam=true`
  - Row building (lines ~77-90) now captures `id`, `title`, `days`, `areaPath`
  - byTeam grouping (lines ~93-120): calls `fetchLeafTeams(cfg)`, checks underRoot prefix, checks `leafTeams.has(team)`, else pushes to `misassigned[]`
  - Response includes `byTeam`, `misassigned` fields

- `src/helpers/dataProcessors.js`
  - `extractTeam()` (lines 5-20): last-segment with root guard — used by all other routes (velocity, roadmap, blockers, etc.)
  - Key: checks `underRoot` before returning last segment; returns `'Unknown'` for root-level or above-root paths

- `client/src/sections/HealthSection.jsx`
  - Health page — Feature Cycle Time per Team chart + discrepancy warning
  - **Incomplete**: `TableModal` imported (line ~18) but inline expand logic with `showMisassigned` state still present
  - Warning banner (lines ~350-410 approx): orange `#ff7f0f` style, count badge, needs modal replacement
  - `teamCycleEntries` useMemo (lines ~83-93): filters `cycleData.byTeam` entries by selectedTeam

- `client/src/components/ui/TableModal.jsx`
  - Reusable modal component — already exists, just needs to be used in HealthSection
  - Props: `label` (button text), `title` (modal header), `badge` (count badge on button)
  - Children = table content rendered inside modal body

</important_files>

<next_steps>

Immediate — complete the modal replacement in `HealthSection.jsx`:

1. **Remove `showMisassigned` state** — no longer needed once modal is used
2. **Replace the inline warning banner's "View all" button + expand block** with `TableModal`:

```jsx
{!cycleLoading && (cycleData?.misassigned?.length > 0) && (
  <div style={{ /* orange warning banner */ }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span>⚠️</span>
      <span style={{ color: '#ff7f0f', fontWeight: 600 }}>
        {cycleData.misassigned.length} Done features not assigned to a leaf scrum team — excluded from chart
      </span>
      <TableModal
        label="View all"
        title={`⚠️ Misassigned Features (${cycleData.misassigned.length})`}
        badge={cycleData.misassigned.length}
        csvFilename="misassigned-features.csv"
        btnStyle={{ marginLeft: 'auto', background: 'none', border: '1px solid #ff7f0f88', color: '#ff7f0f', fontSize: 11 }}
      >
        <table className="data-table">
          <thead><tr><th>ID</th><th>Title</th><th>Area Path (incorrect)</th></tr></thead>
          <tbody>
            {cycleData.misassigned.map(f => (
              <tr key={f.id}>
                <td><a href={`${tfsBaseUrl}/_workitems/edit/${f.id}`} target="_blank">{f.id}</a></td>
                <td>{f.title}</td>
                <td style={{ color: '#ff7f0f', fontFamily: 'monospace' }}>{f.areaPath}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableModal>
    </div>
    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
      These features are assigned to a parent node (e.g. Hercules, Apollo). Move to leaf scrum team area path in TFS.
    </div>
  </div>
)}
```

3. Rebuild client (`npm run build` in `client/`) and restart server

</next_steps>