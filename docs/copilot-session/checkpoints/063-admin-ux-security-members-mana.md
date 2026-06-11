<overview>
The session focused on hardening and productizing a multi-tenant Azure DevOps/TFS dashboard application. Key goals were: (1) making the app work for both on-prem TFS and Azure DevOps cloud users, (2) adding dept-admin user/role/policy management within the Settings page, (3) securing the super-admin panel from unauthorized URL access, (4) redesigning the Admin UI for better usability, and (5) beginning productization planning (packaging, docs, chatbot). The user is preparing to launch this as a commercial multi-tenant product accessible to any Azure DevOps team.
</overview>

<history>

1. **User: Config panel PI pattern not updating per department**
   - Config panel (PI pattern, sprints, start year) was not reading from the active department's settings
   - Fixed `useStore.setActiveDept()` to reset dept-scoped values; `App.jsx` now applies `sprintLabels` from `/api/pi-list` on dept switch
   - Root cause: store cached values not reset on department change

2. **User: TF51011 sprint path errors for DCP (Azure DevOps) department**
   - `DCP\PI26.2\PI26.2 IP` and `DCP\PI26.2\PI26.2 SP1` paths didn't exist
   - Discovered ADO DCP uses dash-format sprint naming: `PI26.2-SP1` through `PI26.2-SP6` and `PI26.2-IP`
   - Fixed `sprintSubpathPattern` in `ei-ci-dp-r-d/config.json` to `{pi}-{sprint}`
   - Fixed `matchSprintSuffix()`, `sprintSortKey()`, `buildSprintIterPath()` in `piHelpers.js`
   - Fixed `sprintDates.js` URL construction for ADO (project-root iterBase)
   - Fixed all 5 hardcoded sprint path constructions across `sprint.js`, `insights.js`, `velocity.js`, `snapshots.js`, `reports.js`

3. **User: Historical PI paths don't exist causing TF51011 400 errors**
   - Routes querying historical PIs (e.g. `DCP\PI24.1`) were throwing because DCP only has PIs from PI24.2 onward
   - Fixed `tfsClient.js` `tfsPost()` to detect 400 + TF51011 for WIQL URLs and return `{ workItems: [] }` instead of throwing
   - This fixed all ~23 affected route files simultaneously

4. **User: `plannedForField` support — Azure DevOps 2021 uses "Planned For" not Iteration Path**
   - Added `plannedForField: ''` to `fieldMappings.js` DEFAULTS
   - Updated `piDelivery.js` to use it as fallback when iterPath resolves to 'Unassigned'
   - ADO DCP confirmed to have `System.IterationPath` at sprint level so it doesn't need the fallback

5. **User: Snapshot not found for DCP dept**
   - `predictability.js` called `readSnapshot(snapshotId)` without `deptId`
   - DCP snapshots stored at `data/departments/ei-ci-dp-r-d/snapshots/`
   - Fixed `predictability.js` to pass `req.deptId`; fixed `piDelivery.js` `findPlanningSnapshot()` to accept and pass `deptId`

6. **User: Dept admin should manage users/roles/policies**
   - Initially created a separate `DeptAdminSection.jsx` with Members + Policies tabs
   - User corrected: these should be **inside the existing Settings page**, not a new page
   - Removed `DeptAdminSection.jsx`; removed `dept-admin` from `NAV_ITEMS`
   - Added **Members tab** to `SettingsSection.jsx` — visible to dept admins (not super-admin only)
   - Moved `policies` (Roles & Visibility) tab out of `SUPERADMIN_ONLY_TABS` so dept admins can access it
   - Backend: added `GET/POST/PUT/DELETE /api/d/:deptId/members` and `GET/PUT /api/d/:deptId/policies` routes in `departments.js` protected by `requireDeptAdmin`

7. **User: "Error loading members" in the new Members tab**
   - First error: `apiFetch(...).then(r => r.json())` — `apiFetch` already parses JSON, calling `.json()` again threw `TypeError`
   - Fixed all query/mutation functions in `MembersTab` to use `apiFetch(...)` directly
   - Second error: "Unexpected token '<'" — server was returning HTML because old server instance (started 10:21 AM) didn't have the new routes
   - Stopped old Node process (PID 20644) and restarted server

8. **User: Non-super-admins can access Admin page via URL**
   - Security hole: `restrictedSection` in `App.jsx` fell back to `NAVIGABLE_SECTIONS` (which includes `admin`) when `activeRole` wasn't in ROLE_SECTIONS
   - Fixed `App.jsx`: `restrictedSection` now explicitly checks `!user?.isSuperAdmin` for `activeSection === 'admin'`
   - Fixed `AdminSection.jsx`: changed `!user?.isAdmin` guard to `!isSuperAdmin`

9. **User: Admin panel not user-friendly**
   - Redesigned `AdminSection.jsx` main render completely:
     - Two-panel master-detail layout: searchable dept list (left) + dept detail (right)
     - **＋ New** button inline in dept list opens collapsible Add Dept form
     - Dept detail has sub-tabs: **Members** and **Connection** (TFS config)
     - **All Users** tab: searchable user table with super-admin toggle
     - Stats chips at top (dept count, user count, super-admin count)
     - Removed Settings tab (connection editing is now in the dept detail Connection sub-tab)

10. **User: Compare Snapshots showing "Compare PIs" section**
    - Label mismatch: sidebar said "Compare Snapshots", component showed "Compare PIs"
    - Renamed NAV_ITEM to `label: 'Compare PIs'`, icon `⚖️`

11. **User: Remove Compare PIs, Admin, and Settings from sidebar**
    - Removed `compare` entry from `NAV_ITEMS` entirely (user said Cross-PI Trends covers it)
    - Removed admin section rendering from `Sidebar.jsx` (Admin and Settings still accessible via FloatingBar gear icon)

12. **User: Productize for any Azure DevOps user**
    - User wants: cleanup of extra files, packaging scripts, comprehensive documentation, chatbot
    - In progress — exploring directory structure first
    - Found: loose `.html` files (`defect-cycle-time.html`, `feature-cycle-time.html`, `research-tracker.html`, `tfs-query-reference.html`), log files (`server.log`, `server-debug.log`, etc.), `_backups/` folder, `releases/` folder, `snapshots/` (legacy root-level)

</history>

<work_done>

**Backend files modified:**
- `src/tfsClient.js` — `tfsPost()` returns `{ workItems: [] }` on TF51011 400 for WIQL; added `tfsPostWiql` export
- `src/helpers/piHelpers.js` — `matchSprintSuffix()` handles dash format; `sprintSortKey()` strips dash prefix; `buildSprintIterPath()` uses configurable pattern
- `src/helpers/fieldMappings.js` — Added `plannedForField: ''` and `sprintSubpathPattern: '{pi} {sprint}'` to DEFAULTS
- `src/helpers/sprintDates.js` — Fixed URL construction for ADO (project-name detection); handles dash-suffix sprint names
- `src/routes/piDelivery.js` — Uses shared `sprintDates` helper; `findPlanningSnapshot(pi, deptId)` passes deptId; `plannedForField` fallback
- `src/routes/predictability.js` — Passes `req.deptId` to `readSnapshot()`
- `src/routes/sprint.js`, `insights.js`, `velocity.js`, `reports.js` — Use `buildSprintIterPath()` with pattern
- `src/routes/cycleTime.js` — `getLastNPIs()` passes `piNamingPattern`
- `src/routes/auth.js` — Fixed `domainAccount` construction (no leading `\` when domain empty)
- `src/routes/departments.js` — Added `requireDeptAdmin` + `getFieldMappings` imports; added 6 new dept-scoped routes: `GET/POST/PUT/DELETE /d/:deptId/members`, `GET/PUT /d/:deptId/policies`
- `data/departments/ei-ci-dp-r-d/config.json` — `piNamingPattern: 'PI{yy}.{n}'`, `sprintSubpathPattern: '{pi}-{sprint}'`, `sprintLabels: ['SP1'...'SP6','IP']`

**Frontend files modified:**
- `client/src/constants.js` — Added then removed `dept-admin`; removed `compare`; removed `admin`/`settings` from sidebar (kept in NAV_ITEMS for FloatingBar routing); Admin and Settings items remain in NAV_ITEMS with `adminOnly` flags
- `client/src/App.jsx` — Imports `DeptAdminSection` (added then removed); added `restrictedSection` guard for `admin` requiring `isSuperAdmin`; removed `dept-admin` case
- `client/src/hooks/useAuth.js` — Added `isSuperAdmin` to return value
- `client/src/sections/SettingsSection.jsx` — Added `members` to `ALL_TABS`; added `Members` label; moved `policies` out of `SUPERADMIN_ONLY_TABS`; added `useMutation, useQuery` imports; added `MembersTab` component (add/list/role-change/remove members); added `activeTab === 'members'` render block
- `client/src/sections/AdminSection.jsx` — Changed `!user?.isAdmin` guard to `!isSuperAdmin`; complete render redesign: stats chips, two-panel dept list+detail, searchable users tab, inline add-dept form, dept detail with Members/Connection sub-tabs
- `client/src/components/layout/Sidebar.jsx` — Removed admin items block from sidebar render

**Files created:**
- `client/src/sections/DeptAdminSection.jsx` — Created then superseded (functionality merged into SettingsSection); still exists on disk but no longer imported

**Current state:**
- ✅ Members tab in Settings works (after server restart)
- ✅ Policies (Roles & Visibility) tab accessible to dept admins
- ✅ Admin panel security fixed — only super-admins can access via URL
- ✅ Admin panel redesigned with master-detail layout
- ✅ Sidebar clean — no Admin/Settings/Compare items
- ✅ Server restarted with new routes at PID (new process)
- ⏳ Productization work not yet started (user just asked)

</work_done>

<technical_details>

**Dept-scoped route auth flow:**
- `deptIdMiddleware` (mounted at `/api`) extracts deptId from URL `/d/:deptId/...` into `req.deptId`
- `requireAuth` → `_rehydrateDeptInfo` sets `req.user.deptRole` based on `req.deptId`
- `requireDeptAdmin` checks `deptRole === 'admin'` OR `isSuperAdmin`
- This means dept admin routes automatically scope correctly — no extra middleware needed

**ADO DCP sprint path format:**
- Pattern: `{pi}-{sprint}` → `PI26.2-SP1` through `PI26.2-SP6`, `PI26.2-IP`
- `iterBase = 'DCP'` (same as project name) — ADO uses project root
- SprintDates URL fix: when `iterBase === project`, use empty subParts → `…/Iterations/PI26.2`

**TF51011 graceful handling:**
- `tfsPost()` in `tfsClient.js`: if `res.status === 400 && url.includes('/_apis/wit/wiql') && text.includes('TF51011')` → return `{ workItems: [] }` instead of throwing
- Fixes all historical PI queries for depts that don't have all PIs in their iteration tree

**`apiFetch` behavior:**
- Already calls `res.json()` and throws `new Error(json.error || HTTP ${res.status})` on non-OK
- Calling `.then(r => r.json())` on the result is a `TypeError` (object, not Response)
- All mutation/query functions must use `apiFetch(...)` directly without chaining `.json()`

**Security fix for admin URL access:**
- `visibleSections` fallback to `NAVIGABLE_SECTIONS` (which includes 'admin') when `activeRole` not in ROLE_SECTIONS
- Fixed: `restrictedSection = activeSection === 'admin' ? !user?.isSuperAdmin : !visibleSections.includes(activeSection)`
- AdminSection also has its own `!isSuperAdmin` guard as defence-in-depth

**`requireDeptAdmin` for admin grant:**
- Current code in `departments.js` member routes: `if (role === 'admin' && !req.user?.isSuperAdmin && !req.user?.isAdmin)` blocks non-super-admins from granting admin role
- Logic flaw: `isAdmin` is true for dept admins, so dept admins CAN grant admin role — this may be intentional

**`DeptAdminSection.jsx` orphan file:**
- Still exists at `client/src/sections/DeptAdminSection.jsx` but is not imported anywhere
- Should be deleted during cleanup

**Extra files to clean up (root level):**
- Loose `.html` files: `defect-cycle-time-requirements.html`, `defect-cycle-time.html`, `feature-cycle-time.html`, `research-tracker.html`, `tfs-query-reference.html`
- Log files: `server.log`, `server-debug.log`, `server-debug-err.log`, `server-err.log`, `server-out.log`, `server.err`, `notifications-log.json`
- Legacy: `snapshots/` root folder (dept snapshots now in `data/departments/{id}/snapshots/`)
- `_backups/` folder
- `-w` file (unknown, likely artifact)
- `releases/` folder

</technical_details>

<important_files>

- **`src/routes/departments.js`**
  - Central user/dept management; new dept-admin routes added at bottom
  - New routes: `GET/POST/PUT/DELETE /d/:deptId/members`, `GET/PUT /d/:deptId/policies`
  - Lines 253–335: new dept-admin route block

- **`src/middleware/auth.js`**
  - `requireDeptAdmin` (line 228): checks `deptRole === 'admin'` based on `req.deptId`
  - `_rehydrateDeptInfo` (line 179): sets `req.user.deptRole` correctly per request's deptId
  - `requireDeptAccess` (line 208): general dept membership check

- **`src/tfsClient.js`**
  - `tfsPost()` with TF51011 graceful handling (lines 28–51)
  - Critical for all WIQL queries against depts with incomplete PI history

- **`src/helpers/piHelpers.js`**
  - `buildSprintIterPath(iterBase, piLabel, suffix, pattern)` — sprint path building
  - `matchSprintSuffix()` — handles space/dash/exact formats
  - `sprintSortKey()` — strips dash-format PI prefix

- **`src/helpers/fieldMappings.js`**
  - DEFAULTS include `sprintSubpathPattern: '{pi} {sprint}'` and `plannedForField: ''`
  - All dept configs merge against these defaults

- **`client/src/sections/SettingsSection.jsx`**
  - Contains `MembersTab` component (lines ~2340–2470)
  - `SUPERADMIN_ONLY_TABS` no longer includes `'policies'`
  - `ALL_TABS` includes `'members'` at end

- **`client/src/sections/AdminSection.jsx`**
  - Complete render redesign (lines ~1413–end)
  - Super-admin guard at line ~1406
  - New state: `deptSearch`, `deptDetailTab`, `addDeptOpen`, `userSearch`

- **`client/src/App.jsx`**
  - `restrictedSection` security fix: `activeSection === 'admin' ? !user?.isSuperAdmin : ...`

- **`client/src/constants.js`**
  - `NAV_ITEMS`: `compare` removed; admin/settings kept with `adminOnly` flags but hidden from sidebar
  - `SUPERADMIN_ONLY_TABS` now excludes `'policies'`

- **`client/src/components/layout/Sidebar.jsx`**
  - Admin items block removed (line ~72): admins reach admin/settings via FloatingBar only

- **`data/departments/ei-ci-dp-r-d/config.json`**
  - ADO DCP configuration: `piNamingPattern: 'PI{yy}.{n}'`, `sprintSubpathPattern: '{pi}-{sprint}'`, `sprintLabels: ['SP1'...'SP6','IP']`

- **`client/src/sections/DeptAdminSection.jsx`** *(orphan — should be deleted)*
  - No longer imported; functionality merged into SettingsSection
  - Safe to delete

</important_files>

<next_steps>

**User's pending large request: productize for any Azure DevOps user**

The user wants all of:
1. **Cleanup** — remove extra files from root: loose `.html` files, log files, `_backups/`, `releases/`, `snapshots/` (legacy root), `-w` file, orphan `DeptAdminSection.jsx`
2. **Make product work for any ADO user** — both on-prem TFS and Azure DevOps cloud; review field mappings, API version handling, auth modes
3. **Packaging scripts** — Docker image, or zip installer, or both
4. **Documentation** — comprehensive, self-service; user should be able to set up and configure without external help
5. **Chatbot** — in-app help chatbot (technology/approach TBD — need to ask user)

**Open questions to ask user before implementing:**
- Chatbot: embedded static Q&A widget, or AI-powered (needs API key)?
- Packaging: Docker + docker-compose, Windows installer `.zip`, or both?
- Docs: in-app (HTML in `/docs`), separate GitHub Pages, or markdown README?

**Immediate next steps (can start without clarification):**
1. Delete orphan files and log files (cleanup)
2. Move loose `.html` research files to `docs/` or delete if outdated
3. Review `config.sample.json` and ensure it covers all ADO cloud settings
4. Check if `snapshots/` root legacy folder can be safely removed

</next_steps>