<overview>
The session focused on fixing multi-tenant sprint path format issues for the Azure DevOps (DCP) department (`ei-ci-dp-r-d`) and expanding the dashboard's resilience for on-prem TFS vs ADO cloud differences. The core work involved making sprint iteration paths configurable per-department, gracefully handling missing PI paths (TF51011 errors), fixing snapshot isolation per-department, and adding `plannedForField` support. The user's latest request (not yet implemented) is for department admins to manage users/roles and policies within their own department scope.
</overview>

<history>

1. **Sprint path 400 errors: `DCP\PI26.2\PI26.2 SP1` doesn't exist**
   - Discovered ADO DCP uses `{pi}-{sprint}` naming (e.g. `PI26.2-SP1`), not `{pi} {sprint}` or just `{sprint}`
   - Queried ADO classification nodes API to confirm actual structure: `PI26.2-SP1` through `PI26.2-SP6` and `PI26.2-IP`
   - Fixed `sprintSubpathPattern` in `ei-ci-dp-r-d/config.json` to `{pi}-{sprint}`
   - Added `SP6` to `sprintLabels` (PI26.2 has 6 sprints + IP)
   - Fixed `matchSprintSuffix()` in `piHelpers.js` to handle dash format (`pi26.2-sp5`)
   - Fixed `sprintSortKey()` to strip dash-format PI prefix
   - Fixed `sprintDates.js` to match `name.endsWith('-' + sl)` format
   - Fixed all 5 hardcoded `${piLabel} ${sprintLabel}` sprint path constructions in `sprint.js`, `insights.js`, `velocity.js`, `snapshots.js`, `reports.js`

2. **`domainAccount: \kaushik.ms@philips.com` login bug**
   - Line 96 in `auth.js` used template literal `${result.domain}\\${result.account}` even when domain is empty
   - Fixed to: `(result.domain ? \`${result.domain}\\${result.account}\` : result.account).toLowerCase()`

3. **`sprintDates` always returning `{}`**
   - Local `fetchSprintDates` in `piDelivery.js` had old URL construction: `subParts = parts.length > 1 ? parts.slice(1) : parts` — for ADO where `iterBase = 'DCP'` (= project name), subParts became `['DCP']` and URL became `...Iterations/DCP/PI26.2` (wrong)
   - Fixed `sprintDates.js` (shared helper): when `iterBase` has only one segment AND equals `cfg.tfs.project`, use empty subParts → URL becomes `...Iterations/PI26.2` ✓
   - Replaced local `fetchSprintDates` in `piDelivery.js` with import from shared `sprintDates.js`

4. **TF51011 errors for non-existent PIs (e.g. `DCP\PI24.1`)**
   - Routes like velocity, cycleTime, dashboard use `getDefaultPIs`/`getLastNPIs` to generate historical PI labels going back N PIs
   - DCP doesn't have all those historical PIs in its iteration tree
   - **Fixed in `tfsClient.js`**: `tfsPost()` now detects 400 + TF51011 for WIQL URLs and returns `{ workItems: [] }` instead of throwing — fixes all 23 affected route files at once
   - Also fixed `cycleTime.js` to pass `fm.piStructure.piNamingPattern` to `getLastNPIs()`

5. **`plannedForField` support for on-prem TFS**
   - User said "in Azure DevOps 2021 there is no iteration path, it's called planned for"
   - ADO DCP features DO have `System.IterationPath` at sprint level (`DCP\PI26.2\PI26.2-SP5`) — confirmed via API
   - Added `plannedForField: ''` to `fieldMappings.js` DEFAULTS
   - Updated `piDelivery.js` to fetch `plannedForField` and use it as fallback when iterPath resolves to 'Unassigned'

6. **Snapshot not found for DCP dept**
   - `predictability.js` called `readSnapshot(snapshotId)` without `deptId` — looked in legacy `snapshots/` folder
   - DCP snapshot existed in `data/departments/ei-ci-dp-r-d/snapshots/PI26.2-2026-06-05T03-55-46-110Z.json`
   - Fixed `predictability.js` to call `readSnapshot(snapshotId, req.deptId)`
   - Fixed `piDelivery.js` `findPlanningSnapshot()` to accept and pass `deptId` to `listSnapshotFiles(deptId)`

7. **User requested: dept admin manage users/roles and policies**
   - Not yet implemented — was about to start exploring existing admin infrastructure
   - Existing backend: `departments.js` routes already have user CRUD (`/departments/:id/users`) but all protected by `requireAdmin` which checks `req.user?.isAdmin` — dept admins can already use these if `isAdmin` is true for their role
   - Existing frontend: `AdminSection.jsx` exists but scope unclear
   - Need to build a dept-scoped user management UI accessible to dept admins (not just super-admins)

</history>

<work_done>

Files modified:

**Backend:**
- `src/tfsClient.js` — `tfsPost()` gracefully returns `{ workItems: [] }` on TF51011 400 for WIQL URLs; added `tfsPostWiql` export (kept for future use)
- `src/helpers/piHelpers.js` — `matchSprintSuffix()` handles dash format (`pi26.2-sp1`); `sprintSortKey()` strips dash-format prefix; `buildSprintIterPath()` uses configurable pattern; exports updated
- `src/helpers/fieldMappings.js` — Added `plannedForField: ''` and `sprintSubpathPattern: '{pi} {sprint}'` to DEFAULTS
- `src/helpers/sprintDates.js` — Fixed URL construction for ADO (project-root iterBase); matches `name.endsWith('-' + sl)`; log message extended to 200 chars
- `src/helpers/snapshots.js` — `buildSprintIterPath` import added
- `src/routes/piDelivery.js` — Removed local `fetchSprintDates` (uses shared helper now); `findPlanningSnapshot(pi, deptId)` passes deptId; `plannedForField` fallback for sprint label; unused `tfsGet` import removed
- `src/routes/predictability.js` — `readSnapshot(snapshotId, req.deptId)` passes deptId
- `src/routes/sprint.js` — Uses `buildSprintIterPath()` with pattern; `sprint:` field uses `suffix` not removed `sprintLabel`
- `src/routes/insights.js` — Uses `buildSprintIterPath()`; sprint label display fixed
- `src/routes/velocity.js` — Uses `buildSprintIterPath()`
- `src/routes/reports.js` — `buildSprintClause()` uses `buildSprintIterPath()`; `extractSprintLabel()` uses `matchSprintSuffix()`
- `src/routes/cycleTime.js` — `getLastNPIs(n, fm.piStructure.piNamingPattern)`; uses `tfsPostWiql`
- `src/routes/auth.js` — Fixed `domainAccount` construction (no leading `\` when domain empty)
- `src/routes/piChecks.js` — `/api/pi-list` returns `sprintLabels`, `piPattern`, `programmeStartYear`
- All other routes (dashboard, insights, velocity, etc.) — `getDefaultPIs` calls use pattern

**Frontend:**
- `client/src/store/useStore.js` — `setActiveDept()` resets all dept-scoped values; `setSprintLabels` action
- `client/src/hooks/useAuth.js` — `logout()` clears `activeDept`
- `client/src/App.jsx` — Stale activeDept reset on login; applies `sprintLabels` from `/api/pi-list`

**Data:**
- `data/departments/ei-ci-dp-r-d/config.json` — `piNamingPattern: 'PI{yy}.{n}'`, `sprintSubpathPattern: '{pi}-{sprint}'`, `sprintLabels: ['SP1'..'SP6','IP']`

**Current state:**
- ✅ Sprint trend, velocity, pi-delivery working for DCP (`PI26.2`)
- ✅ Login working for `Kaushik.MS@philips.com`
- ✅ Predictability snapshot loading for DCP dept
- ✅ TF51011 400 errors handled gracefully across all routes
- ✅ Sprint dates URL fixed for ADO
- ⚠️ `sprintDates` in pi-delivery still returning `{}` (needs investigation if still failing)
- ❌ Dept admin user/role/policy management UI — not yet implemented

</work_done>

<technical_details>

**ADO DCP iteration tree structure:**
- PIs: `PI24.2`, `PI24.3`, `PI24.4`, `PI25.1`–`PI25.4`, `PI26.1`–`PI26.4`
- Sprint nodes under each PI: `PI26.2-SP1`, `PI26.2-SP2`... `PI26.2-SP6`, `PI26.2-IP` (dash-format, PI-prefixed)
- `PI24.1` does NOT exist — hence TF51011 errors when querying historical PIs
- ADO base URL: `https://dev.azure.com/ALMP-ORG-P01/DCP`

**Sprint subpath pattern system:**
- `sprintSubpathPattern` in `fieldMappings.piStructure` controls how sprint node names are built
- Default (on-prem TFS): `{pi} {sprint}` → `26-PI1\26-PI1 S1`
- DCP ADO: `{pi}-{sprint}` → `PI26.2\PI26.2-SP1`
- `buildSprintIterPath(iterBase, piLabel, suffix, pattern)` builds full iter path
- `matchSprintSuffix(iterPath, piLabel, sprintLabels)` extracts sprint suffix — tries exact, dash-prefix, space-prefix, full-path substring

**Classification nodes URL for ADO:**
- On-prem TFS: `iterBase='Healthcare IT\ISP'` → strip project name → path = `ISP/26-PI1`
- ADO: `iterBase='DCP'` (= project name itself) → subParts=[] → path = `PI26.2` only
- Fix: `parts.length > 1 ? parts.slice(1) : (parts[0]?.toLowerCase() === project.toLowerCase() ? [] : parts)`

**TF51011 graceful handling:**
- Modified `tfsPost()` in `tfsClient.js` to detect `res.status === 400 && url.includes('/_apis/wit/wiql') && text.includes('TF51011')` → returns `{ workItems: [] }`
- This fixes all 23 route files simultaneously without individual changes

**Multi-tenant snapshot isolation:**
- Snapshots stored at `data/departments/{deptId}/snapshots/`
- `readSnapshot(id, deptId)` and `listSnapshotFiles(deptId)` both require deptId
- `predictability.js` was missing deptId → looked in legacy `snapshots/` root dir
- `piDelivery.js` `findPlanningSnapshot` also needed deptId

**`plannedForField`:**
- Added to `fieldMappings.fields.plannedForField: ''`
- When set, fetched alongside IterationPath in pi-delivery
- Fallback: if iterPath → 'Unassigned', try field value via `getSprintLabel()`, then direct label match
- ADO DCP doesn't need it (iterPath IS at sprint level), but on-prem TFS may

**Existing user management backend (already built):**
- `GET/POST /api/departments/:id/users` — list/add users to dept
- `PUT /api/departments/:id/users/:key` — change role
- `DELETE /api/departments/:id/users/:key` — remove from dept
- All guarded by `requireAdmin` (checks `req.user?.isAdmin`)
- Roles: `'admin'`, `'all'`, `'read'`
- Users stored in `data/users.json` keyed by `tfs:email` or `aad:oid`

**Dept admin vs super-admin:**
- `isSuperAdmin`: can manage all departments, grant super-admin
- `isAdmin`: dept admin — `isAdmin = role === 'admin'` for active dept
- `requireAdmin` in departments.js allows dept admins in, but routes don't scope to their dept — any admin can list/modify any dept's users (security gap for dept-scoped admin)

</technical_details>

<important_files>

- **`src/tfsClient.js`**
  - Central TFS/ADO HTTP client
  - `tfsPost()` now handles TF51011 gracefully for WIQL queries
  - Line 28–51: `tfsPost` with TF51011 guard; line 53–63: `tfsPostWiql`

- **`src/helpers/piHelpers.js`**
  - PI label generation, sprint path building, sprint suffix matching
  - `buildSprintIterPath(iterBase, piLabel, suffix, pattern)` — line ~206
  - `matchSprintSuffix(iterPath, piLabel, sprintLabels)` — line ~223, handles space/dash/exact formats
  - `sprintSortKey()` — line ~9, strip dash-format prefix fix

- **`src/helpers/fieldMappings.js`**
  - DEFAULTS: `sprintSubpathPattern: '{pi} {sprint}'`, `plannedForField: ''`
  - All dept configs merge against these defaults

- **`src/helpers/sprintDates.js`**
  - Fetches sprint date windows from classification nodes API
  - Fixed URL construction for ADO (lines 10–15): project-name detection
  - Fixed sprint name matching (line ~21): handles exact, dash-suffix, space-suffix

- **`src/routes/piDelivery.js`**
  - PI delivery chart data — planned vs actual per sprint
  - Removed local `fetchSprintDates`, uses shared helper now
  - `findPlanningSnapshot(pi, deptId)` — passes deptId (line ~25)
  - `plannedForField` fallback logic (lines ~91–120)

- **`src/routes/predictability.js`**
  - Fixed: `readSnapshot(snapshotId, req.deptId)` — line 20

- **`src/routes/departments.js`**
  - User CRUD per dept: GET/POST/PUT/DELETE `/departments/:id/users`
  - `requireAdmin` guard — currently allows any dept admin but doesn't scope to own dept
  - Lines 126–171: user management routes

- **`data/departments/ei-ci-dp-r-d/config.json`**
  - `piNamingPattern: 'PI{yy}.{n}'`
  - `sprintSubpathPattern: '{pi}-{sprint}'`
  - `sprintLabels: ['SP1','SP2','SP3','SP4','SP5','SP6','IP']`
  - `baseUrl: 'https://dev.azure.com/ALMP-ORG-P01/DCP'`

- **`client/src/sections/AdminSection.jsx`**
  - Existing super-admin UI (department CRUD + user management)
  - Needs extension for dept-scoped admin view (users + policies)

</important_files>

<next_steps>

**User's pending request: "As a department admin I should be able to manage users and roles and policies"**

This requires:

1. **Backend — scope user management to dept admins:**
   - Add a new `requireDeptAdmin` middleware that allows access if `req.user?.isAdmin` AND the dept in the URL matches `req.user?.activeDeptId` (or `isSuperAdmin` bypasses)
   - Apply to `/api/d/:deptId/users` routes (new dept-scoped versions)
   - Expose new routes: `GET /api/d/:deptId/users`, `POST /api/d/:deptId/users`, `PUT /api/d/:deptId/users/:key`, `DELETE /api/d/:deptId/users/:key`

2. **Backend — policy management for dept admin:**
   - `GET /api/d/:deptId/config` already works (Settings section uses it)
   - Dept admin needs to edit: RAG thresholds, state mappings, sprint labels, PI structure, team paths
   - May need dedicated `/api/d/:deptId/policies` endpoint or reuse config endpoint

3. **Frontend — Dept Admin Panel UI:**
   - New section accessible when `user.isAdmin` (not just super-admin)
   - Tab 1: **Users** — list dept users, add by TFS username/key, change role (admin/all/read), remove
   - Tab 2: **Policies** — edit RAG thresholds, feature states, sprint labels, PI structure config
   - Should appear in sidebar when dept admin is logged in
   - Dept admins should NOT see other departments' data

4. **Planned approach:**
   - Add `DeptAdminSection.jsx` in `client/src/sections/`
   - Add it to sidebar nav conditional on `user.isAdmin`
   - Backend: add dept-scoped user management routes in `departments.js` or new `deptAdmin.js`
   - Reuse existing `readSnapshot`/userStore functions with deptId scoping

</next_steps>