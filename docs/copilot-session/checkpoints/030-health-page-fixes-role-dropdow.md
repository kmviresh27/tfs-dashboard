<overview>
The session continued bug-fixing and feature work on the TFS Dashboard (Node.js/Express + React/Vite). The primary goals were: fixing multiple UI bugs (Health page chart data paths, escape ratio API query, TFS User Roles dropdown, Feature Cycle Time orientation, Settings crash), and diagnosing why the Health page doesn't appear in the sidebar nav even after enabling it in Policies. The approach was systematic: read server logs to find API errors, trace data paths through components, and check config.json for the actual saved state.
</overview>

<history>

1. **Defect Aging chart showing empty on Health page**
   - Root cause: `const d = dashData || {}` was accessing top-level dashboard data; `agingBuckets` is nested at `dashData.defects.agingBuckets`
   - Fix: Changed to `const d = dashData?.defects || {}` — same pattern as `DefectsSection` line 100: `const d = dashData?.defects`
   - Also fixed: `escapeChartOpts` wrapped in `useMemo`, loading guard changed from `dashLoading && cycleLoading` to `dashLoading || cycleLoading`
   - Build passed

2. **Defect Escape Ratio by Quarter chart empty**
   - Server was returning 400 errors visible in logs: `"You cannot supply a time with the date when running a query using date precision"` caused by `[System.CreatedDate] <= '2026-12-31T23:59:59.999Z'`
   - TFS WIQL rejects datetime values (with time component) in date-precision field comparisons for upper bounds
   - Fix: Changed from `${year}-12-31T23:59:59.999Z` to `${year + 1}-01-01` (date-only) with `<` instead of `<=`
   - Server restarted to pick up route fix

3. **App not running / server restart**
   - After code changes, server needed restart; used async PowerShell with `node server.js`
   - Verified running via `Get-NetTCPConnection -LocalPort 3000`

4. **TFS User Roles tab — newly saved custom roles not appearing in Role dropdown**
   - Root cause: `TfsUsersTab` used module-level hardcoded `ROLE_OPTIONS` constant — never read `cfg?.roles?.custom`
   - Fix: Renamed to `BUILTIN_ROLE_OPTIONS`; added `useMemo`-computed `roleOptions` inside `TfsUsersTab` merging built-ins + `cfg?.roles?.custom`
   - Added `useMemo` to `import { useState, useEffect, useMemo }` in SettingsSection.jsx
   - Build passed

5. **Settings crash — React error #31 after selecting team in TFS User Roles**
   - Error: "Objects are not valid as a React child (found: object with keys {id, label, icon, sections})"
   - Root cause: `cfg?.roles?.custom` stores full objects `{id, label, icon, sections}` (as created by `RolesManager.jsx` line 114), not plain strings. My fix did `map(r => ({ value: r, label: r }))` making both value and label the full object — React tried to render an object as child
   - Fix: Changed to `map(r => ({ value: r.id, label: r.label || r.id }))` — same pattern as Role Mappings tab at line 1659
   - Build passed

6. **Feature Cycle Time per Team — teams should be X-axis (vertical bars)**
   - Chart was horizontal (`indexAxis: 'y'`); user wants vertical bars with teams on X
   - Fix: Removed `indexAxis: 'y'`, changed `align: 'right'` → `align: 'top'`, swapped axis labels (X = team names, Y = "Avg Days"), changed `padding.right` → `padding.top: 24`, fixed chart height from dynamic `teamCycleEntries.length * 36 + 40` to fixed `260`
   - Build passed

7. **Health page not visible in sidebar even after enabling in Policies**
   - Investigated: NAV_ITEMS has `health`, ROLE_SECTIONS has `health` for all roles, POLICY_SCHEMA has `health`, App.jsx has `case 'health':`
   - Checked saved config.json: `policies` for 'all' and 'admin' both have empty `hiddenPages` → health should be visible
   - **Key finding**: Custom role `sravan` (label: "Directors") has `sections` array that does NOT include `'health'` — it was created before health was added, so `getEffectiveRoleSections` returns that role's sections without health
   - Investigation was in progress at time of compaction: if the user is logged in as `sravan` role, `allowed = roleSections['sravan']` which lacks `'health'`, so sidebar filters it out regardless of policies

</history>

<work_done>

Files modified:
- `client/src/sections/HealthSection.jsx` — Fixed `d = dashData?.defects || {}` (was `dashData || {}`); wrapped `escapeChartOpts` in `useMemo`; fixed loading guard `||`; changed cycle time chart to vertical (removed `indexAxis:'y'`, fixed axis labels, datalabel alignment, fixed height to 260)
- `src/routes/defects.js` — Fixed WIQL date range: `${year}-01-01` and `< ${year+1}-01-01` (date-only, no time component) for escape-by-quarter route
- `client/src/sections/SettingsSection.jsx` — Added `useMemo` to React imports; renamed `ROLE_OPTIONS` → `BUILTIN_ROLE_OPTIONS`; added dynamic `roleOptions` useMemo in `TfsUsersTab` using `r.id`/`r.label` from custom role objects; used `roleOptions` in the select

Work completed:
- [x] Defect Aging data path fix (`d.defects.agingBuckets`)
- [x] Escape Ratio WIQL date format fix (TFS 400 error resolved)
- [x] Server restart after route fix
- [x] TFS User Roles dropdown shows custom roles
- [x] Settings crash fix (React #31 — custom roles are objects not strings)
- [x] Feature Cycle Time chart orientation changed to vertical
- [x] All builds pass (126 modules)
- [ ] **IN PROGRESS**: Health page not appearing in sidebar — `sravan` custom role's `sections` array doesn't include `'health'`

</work_done>

<technical_details>

**Data structure of `useFilteredDashboard`:**
- Returns `{ meta, features, defects }` — never a flat object
- `agingBuckets` is at `data.defects.agingBuckets`, NOT `data.agingBuckets`
- `DefectsSection` correctly does `const d = dashData?.defects` on line 100 — this is the pattern to follow
- `HealthSection` was broken because it did `const d = dashData || {}` directly

**TFS WIQL date precision quirk:**
- TFS WIQL rejects `[System.CreatedDate] <= '2026-12-31T23:59:59.999Z'` with error: "You cannot supply a time with the date when running a query using date precision"
- `>=` with datetime format works; `<=` does NOT
- Fix: Use date-only format (`YYYY-MM-DD`) and `<` next-year start instead of `<=` year-end
- Other working routes use only lower bounds (`>= yearStart`) to avoid this issue entirely

**Custom roles structure (`cfg.roles.custom`):**
- Each entry is `{ id, label, icon, sections }` where `sections` is an array of NAV_ITEM ids the role can access
- Saved by `RolesManager.jsx` line 114: `const added = { id, label, icon, sections: ALL_SECTION_IDS }`
- `ALL_SECTION_IDS = NAV_ITEMS.map(n => n.id)` — captured at **component definition time**, so custom roles created before 'health' was added to NAV_ITEMS will NOT have 'health' in their sections
- This is why the `sravan` role doesn't show health: it was created before health was added

**Sidebar visibility — dual-gate:**
- A nav item shows only if BOTH conditions are true:
  1. `allowed.includes(item.id)` — where `allowed = roleSections[activeRole] ?? roleSections.all`
  2. `pageVisible(item.id)` — from `usePolicies()`, reads `policies[useAuth().role].hiddenPages`
- `activeRole` (store) ≠ `role` (useAuth) — `activeRole` is the "viewing as" role; `role` is the auth session role
- Built-in roles (all/exec/rte/pm/sm) all have 'health' in ROLE_SECTIONS; `admin` is NOT in ROLE_SECTIONS (falls back to `roleSections.all` via `??`)
- Custom roles only have sections explicitly saved — if created before a nav item was added, that item won't appear

**`sravan` custom role missing 'health':**
- Config shows `roles.custom[0].sections` does not include `'health'`
- This is a data fix problem, not a code bug: the role's saved sections need 'health' added
- Two solutions: (1) user goes to Settings → Policies → Role Management → Directors role → no way to add sections there (VisibilityNote says use Visibility Policies) OR (2) auto-migrate: when `getEffectiveRoleSections` is called, for custom roles, add any missing NAV_ITEMS that are in `ALL_SECTION_IDS`

**`usePolicies` role vs store activeRole:**
- `usePolicies` reads `role` from `useAuth().role` (server session role, e.g. 'sravan')
- Sidebar reads `activeRole` from store (can be switched via UI, defaults to 'all')
- If user is `sravan` (auth), policies check is against `policies.sravan.hiddenPages`
- Config shows `policies.sravan.hiddenPages` does NOT include 'health' — so policies are fine
- The real gate is `allowed.includes('health')` which fails because `roleSections['sravan'].sections` lacks 'health'

**Server startup:**
- `node server.js` in `D:\views\AV Dashboard`
- Currently running as async background PowerShell (shellId: av-server4)
- Listens on port 3000

</technical_details>

<important_files>

- `client/src/sections/HealthSection.jsx`
  - The new Health page with 3 charts
  - **Critical fix applied**: `d = dashData?.defects || {}` (line ~78)
  - Chart 1: Feature Cycle Time — vertical bar, `useCycleTimeDistribution(null, 4)`, `cycleData.byTeam`
  - Chart 2: Defect Aging — horizontal bar, `d.agingBuckets`
  - Chart 3: Escape Ratio — mixed bar+line, `useDefectEscapeByQuarter`, year selector + quarter pills

- `src/routes/defects.js`
  - All defect server routes including new `GET /api/defect-escape-by-quarter`
  - **Critical fix applied** at lines 405-416: date-only format `${year}-01-01` / `${year+1}-01-01` with `<`
  - Without this fix, TFS returns 400 for all escape-by-quarter queries

- `client/src/sections/SettingsSection.jsx`
  - All settings tabs including TFS User Roles, Role Mappings, Policies
  - **Fix at line 228**: `BUILTIN_ROLE_OPTIONS` (renamed from `ROLE_OPTIONS`)
  - **Fix at lines 250-254**: dynamic `roleOptions` useMemo using `r.id`/`r.label` — fixes React #31 crash
  - **Fix at line 369**: uses `roleOptions` instead of `ROLE_OPTIONS` in the per-user select

- `client/src/constants.js`
  - Single source of truth: `NAV_ITEMS`, `ROLE_SECTIONS`, `ROLE_DEFS`, `POLICY_SCHEMA`, `getEffectiveRoleSections`
  - `health` is correctly registered in NAV_ITEMS (line 68), ROLE_SECTIONS for all built-in roles (lines 85-89), POLICY_SCHEMA (lines 269-276)
  - `getEffectiveRoleSections` at line 100 uses saved `r.sections` for custom roles — no auto-migration for new pages

- `client/src/components/layout/Sidebar.jsx`
  - Dual-gate filter at line 18-20: `allowed.includes(item.id) && pageVisible(item.id)`
  - `allowed` = `roleSections[activeRole] ?? roleSections.all`
  - `pageVisible` = from `usePolicies()` hook

- `client/src/hooks/usePolicies.js`
  - Reads `policies` from store and `role` from `useAuth()`
  - `pageVisible(id)` = `!hiddenPages.includes(id)`

- `config.json` (server root)
  - Actual saved config; `roles.custom[0]` = sravan/"Directors" role — `sections` array lacks `'health'`
  - `policies.all.hiddenPages = []`, `policies.admin.hiddenPages = []` — policies are fine
  - `policies.sravan.hiddenPages` does NOT include 'health' — also fine; the issue is `roles.custom[0].sections`

- `client/src/components/ui/RolesManager.jsx`
  - Creates custom roles with `sections: ALL_SECTION_IDS` where `ALL_SECTION_IDS = NAV_ITEMS.map(n => n.id)`
  - This snapshot is taken at build time; roles created before a new NAV_ITEM is added won't have that item

</important_files>

<next_steps>

**Active bug to resolve — Health not in sidebar for custom roles:**

The `sravan` custom role's `sections` array in `config.json` does not include `'health'`. Since `getEffectiveRoleSections` uses saved `r.sections` verbatim for custom roles, health is filtered out by the `allowed.includes('health')` check in Sidebar.

**Two options:**

**Option A — Auto-migration in `getEffectiveRoleSections`** (recommended):
In `constants.js` line 103, when applying custom role sections, add any NAV_ITEMS ids that are missing:
```js
customRoles.forEach(r => {
  // ensure new NAV_ITEMS are always accessible to custom roles
  const saved = r.sections || [];
  const all = NAV_ITEMS.map(n => n.id);
  result[r.id] = [...new Set([...saved, ...all.filter(id => !result[r.id]?.includes(id) && saved.includes(id))])];
});
```
Actually simpler: just ensure any id present in `ALL_SECTION_IDS` but not in saved sections gets added: custom roles default to showing new pages unless explicitly hidden in policies.

**Option B — One-time config patch**: Add `'health'` to `config.json` → `roles.custom[0].sections` manually or via Settings UI.

**Simplest code fix** in `getEffectiveRoleSections` (`constants.js` line 103):
```js
customRoles.forEach(r => {
  const base = NAV_ITEMS.map(n => n.id); // all known pages
  const saved = new Set(r.sections || []);
  // keep saved order, then append any newly-added nav items
  result[r.id] = [...saved, ...base.filter(id => !saved.has(id))];
});
```
This makes custom roles include all pages by default (new ones added later are appended), with visibility controlled by policies (hiddenPages). This matches how built-in roles work.

**After fix:** rebuild and verify Health appears in sidebar for the sravan/Directors role.

</next_steps>