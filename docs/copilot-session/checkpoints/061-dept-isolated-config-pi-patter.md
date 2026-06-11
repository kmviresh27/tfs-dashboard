<overview>
The session focused on multi-tenant department isolation bugs in the AV Dashboard — specifically ensuring each department's Settings page, ConfigPanel, PI list, sprint labels, and TFS/ADO API calls use that department's own configuration rather than leaking across departments. A secondary major effort was making the PI naming pattern, sprint sub-path naming, and sprint label extraction configurable per-department to support both on-premise TFS (`{yy}-PI{n}` / `{pi} {sprint}`) and Azure DevOps cloud (`PI{yy}.{n}` / `{sprint}`) conventions. Work was in progress when context compaction occurred.
</overview>

<history>
1. **User: "Settings page should be specific to respective department right?"**
   - Investigated `SettingsSection.jsx`, `apiClient.js`, `hooks.js`, and `deptIdMiddleware`
   - Found that `apiClient.js` `scopeUrl()` already rewrites `/api/config` → `/api/d/<deptId>/config` based on store's `activeDept` — so Settings IS dept-scoped
   - But found critical bug: `activeDept` persisted in localStorage from previous user's session. If User A (default dept) logged out and Kaushik (ei-ci-dp-r-d) logged in, the stale `activeDept={id:'default'}` caused Settings to load default dept config
   - **Fixed**: `useAuth.js` logout now calls `useStore.getState().setActiveDept(null)` to clear localStorage
   - **Fixed**: `App.jsx` auto-activate logic now resets stale `activeDept` if it's not in the logged-in user's department list
   - Rebuilt frontend

2. **User: "Config panel is not changing according to department settings"**
   - Found that `setActiveDept()` in `useStore.js` only updated `activeDept` reference — left `selectedPIs`, `availablePIs`, `selectedTeam`, `currentPI`, `areaPath`, `tfsBaseUrl`, etc. as stale previous-dept values
   - **Fixed**: `setActiveDept()` now atomically resets all dept-scoped store values when dept changes
   - Rebuilt frontend

3. **User: "Config panel PI pattern, sprints and starting program should be from respective department settings"**
   - Discovered `getPILabel()` hardcoded `{yy}-PI{n}` format, ignoring `piNamingPattern` in `fieldMappings.piStructure`
   - `ei-ci-dp-r-d` dept config has `piNamingPattern: 'PI{yy}.{n}'` and `sprintLabels: ['SP1','SP2','SP3','SP4','SP5','IP']`
   - **Fixed `piHelpers.js`**: `getPILabel(yy, pi, pattern)` now pattern-aware; added `parsePILabel(label, pattern)` for reverse parsing
   - **Fixed `/api/pi-list`**: uses dept's `piNamingPattern`; now returns `sprintLabels`, `piPattern`, `programmeStartYear` in response
   - **Fixed all 10+ backend routes**: `getDefaultPIs(pisPerYear, pattern)` calls updated
   - **Fixed `insights.js`**: `parsePI`, `sortPIs`, `previousPI`, `extractPIFromIteration` made pattern-aware
   - **Fixed `roadmap.js`**: Uses `getPILabel` with pattern
   - **Fixed frontend store**: Added `setSprintLabels` action; `setActiveDept` resets `sprintLabels` to default
   - **Fixed `App.jsx`**: Applies `sprintLabels` from `/api/pi-list` response immediately on load
   - Rebuilt frontend and restarted server

4. **User: Error `DCP\PI26.2\PI26.2 SP1` iteration path does not exist**
   - Hardcoded sprint sub-path pattern `${piLabel} ${sprintLabel}` (e.g., `PI26.2 SP1`) appears in 5 backend files
   - In Azure DevOps DCP, sprint nodes are named just `SP1`, `SP2` etc. (not `PI26.2 SP1`)
   - Plan: add `sprintSubpathPattern` to `fieldMappings.piStructure` defaults, add `buildSprintIterPath()` helper
   - Started implementation when user reported the next issue

5. **User: "Planned Sprint / Current Sprint are unassigned — in Azure DevOps 2021 there may be no iteration path as planned, need provision based on version"**
   - Root cause: `getSprintLabel()` in `piDelivery.js` checks `lower.includes(\`${piLabel} ${s}\`)` — only matches on-prem TFS format, not ADO simple format
   - `fetchSprintDates()` checks `name.endsWith(\` ${s}\`)` — also won't match exact `SP1` sprint names
   - Need to fix extraction logic to try multiple naming conventions
   - Was implementing fixes when compaction occurred
</history>

<work_done>
Files modified:

**Frontend:**
- `client/src/hooks/useAuth.js` — logout clears `activeDept` from store/localStorage
- `client/src/App.jsx` — stale activeDept reset on login; applies sprintLabels from pi-list response; added `setSprintLabels` store reference
- `client/src/store/useStore.js` — `setActiveDept()` resets all dept-scoped values; added `setSprintLabels` action
- Frontend rebuilt ✓

**Backend:**
- `src/helpers/fieldMappings.js` — Added `sprintSubpathPattern: '{pi} {sprint}'` to `piStructure` defaults
- `src/helpers/piHelpers.js` — `getPILabel(yy, pi, pattern)` pattern-aware; `parsePILabel(label, pattern)` added; `getDefaultPIs/getAllPIsForYear/getLastNPIs` accept pattern; added `buildSprintIterPath()` and `matchSprintSuffix()` helpers; exports updated
- `src/routes/piChecks.js` — `/api/pi-list` uses dept piNamingPattern; returns `sprintLabels`, `piPattern`, `programmeStartYear`
- `src/routes/dashboard.js` — `getDefaultPIs` calls updated with pattern
- `src/routes/insights.js` — imports updated; `normalizePILabels`, `parsePI`, `sortPIs`, `previousPI`, `extractPIFromIteration` made pattern-aware
- `src/routes/velocity.js` — both `getDefaultPIs` fallbacks updated with pattern; imports `buildSprintIterPath`
- `src/routes/roadmap.js` — `getPILabel` and `getAllPIsForYear` use pattern
- `src/routes/dependencies.js`, `objectives.js`, `objectivesPlan.js`, `reports.js`, `storyMetrics.js`, `testCoverage.js`, `sprintCapacity.js`, `teamCapacities.js`, `kpi.js` — `getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern)` pattern
- `src/routes/piDelivery.js` — `getSprintLabel()` now uses `matchSprintSuffix()`; `fetchSprintDates()` matches exact name or endsWith; imports `matchSprintSuffix`, `buildSprintIterPath`
- `src/helpers/snapshots.js` — imports `buildSprintIterPath`
- `src/routes/reports.js` — imports `buildSprintIterPath`, `matchSprintSuffix`
- Server restarted ✓

**Data:**
- `data/departments/ei-ci-dp-r-d/config.json` — `sprintSubpathPattern` needs to be set to `'{sprint}'`; piNamingPattern already `'PI{yy}.{n}'`; sprintLabels `['SP1','SP2','SP3','SP4','SP5','IP']`

**IN PROGRESS (not finished):**
- [ ] Replace hardcoded `${piLabel} ${sprintLabel}` sprint path constructions in: `insights.js` (line 213), `velocity.js` (line 74), `snapshots.js` (line 450), `reports.js` (line 335), `sprint.js` (lines 33, 115, 116)
- [ ] Add `sprintSubpathPattern` to `ei-ci-dp-r-d/config.json` as `'{sprint}'`
- [ ] Also fix `sprint.js` `sprintLabel = \`${pi} ${suffix}\`` (display label vs iter path)
- [ ] Fix `sprintDates.js` helper `fetchSprintDates` (same sprint name matching issue exists there too)
- [ ] Fix `scopeChange.js` `sprintLabel()` function if relevant
</work_done>

<technical_details>
**Multi-tenant dept isolation:**
- `apiClient.js` `scopeUrl()` rewrites `/api/*` → `/api/d/<deptId>/*` based on `useStore.getState().activeDept?.id`
- Backend `deptIdMiddleware` uses URL param for `/api/d/:deptId/*` routes, or `req.session.user.activeDeptId` for legacy `/api/*`
- `useConfig()` uses `deptId` in query key → different depts cache separately in React Query
- `setActiveDept()` MUST reset all dept-scoped store values (selectedPIs, availablePIs, currentPI, selectedTeam, sprintLabels, etc.) — failure causes cross-dept data leakage

**PI naming pattern system:**
- `piNamingPattern` tokens: `{yy}` = 2-digit year, `{n}` = PI number
- Default: `{yy}-PI{n}` → `26-PI1` (on-prem TFS)
- ADO example: `PI{yy}.{n}` → `PI26.1`
- `parsePILabel(label, pattern)` does reverse: builds regex from pattern, extracts `{yy}` and `{n}` groups
- Stored in `fieldMappings.piStructure.piNamingPattern`

**Sprint sub-path pattern system (NEW, in progress):**
- `sprintSubpathPattern` tokens: `{pi}` = PI label, `{sprint}` = sprint suffix
- Default: `{pi} {sprint}` → on-prem TFS: `26-PI1\26-PI1 S1` (sprint node named `26-PI1 S1`)
- ADO simple: `{sprint}` → `PI26.2\SP1` (sprint node named just `SP1`)
- `buildSprintIterPath(iterBase, piLabel, sprintSuffix, subpathPattern)` in `piHelpers.js`
- Stored in `fieldMappings.piStructure.sprintSubpathPattern`

**Sprint label extraction — `matchSprintSuffix(iterPath, piLabel, sprintLabels)`:**
- Tries (1) last path segment exact match, (2) last segment = `{pi} {sprint}`, (3) full path contains `{pi} {sprint}`
- Returns matching sprint suffix string or null
- Replaces hardcoded `lower.includes(\`${piLabel} ${s}\`)` pattern in `getSprintLabel`

**`ei-ci-dp-r-d` (Azure DevOps DCP) config specifics:**
- baseUrl: `https://dev.azure.com/ALMP-ORG-P01/DCP`
- apiVersion: `6.0`
- piNamingPattern: `PI{yy}.{n}` → PIs named `PI26.1`, `PI26.2`
- sprintLabels: `['SP1','SP2','SP3','SP4','SP5','IP']` (6 sprints per PI)
- sprintSubpathPattern: needs `{sprint}` (ADO sprint nodes not prefixed with PI label)
- Email username: `Kaushik.MS@philips.com` (no domain prefix)
- PAT: `1fCcw1Q1JYc3uMAXJBzT8tHRy6Xt2hi0nWmmLKxH9FGrDQ6vvi4CJQQJ99CFACAAAAAGZUNUAAASAZDOu6Tn`

**Azure DevOps auth differences from on-prem TFS:**
- `authenticatedUser.properties.Account.$value` = full email `Kaushik.MS@philips.com`
- No domain prefix, no `uniqueName` field in all versions
- Username comparison uses email local-part matching: `enteredLocalPart === accountLocalPart`
- `domainAccount` key must not prepend `\` when domain is empty: use `tfsUser.account.toLowerCase()` directly

**On-prem TFS sprint iteration path format:**
- `{iterationPath}\{piLabel}\{piLabel} {sprintSuffix}`
- e.g., `Healthcare IT\ISP\26-PI1\26-PI1 S1`

**Azure DevOps sprint iteration path format (DCP):**
- `{iterationPath}\{piLabel}\{sprintSuffix}` (assumed, unconfirmed)
- e.g., `DCP\PI26.2\SP1`
- Error confirmed: `DCP\PI26.2\PI26.2 SP1` does NOT exist

**`/api/pi-list` now returns extra fields:** `piPattern`, `sprintLabels`, `programmeStartYear` — frontend `App.jsx` uses these to update store immediately on load.
</technical_details>

<important_files>
- **`src/helpers/piHelpers.js`**
  - Core PI/sprint path helper library
  - Added: `getPILabel(yy, pi, pattern)`, `parsePILabel(label, pattern)`, pattern params to `getDefaultPIs/getAllPIsForYear/getLastNPIs`, `buildSprintIterPath(iterBase, piLabel, sprintSuffix, subpathPattern)`, `matchSprintSuffix(iterPath, piLabel, sprintLabels)`
  - Exports updated at bottom of file

- **`src/helpers/fieldMappings.js`**
  - Contains `DEFAULTS.piStructure` — source of truth for all PI/sprint config defaults
  - Added `sprintSubpathPattern: '{pi} {sprint}'` to defaults

- **`src/routes/piChecks.js`**
  - Contains `/api/pi-list` endpoint — generates PI list for frontend ConfigPanel
  - Now uses `fm.piStructure.piNamingPattern`; returns `sprintLabels`, `piPattern`, `programmeStartYear`

- **`src/routes/piDelivery.js`**
  - Contains `getSprintLabel()` and `fetchSprintDates()` — source of "Planned Sprint" / "Current Sprint" values
  - Fixed: `getSprintLabel` uses `matchSprintSuffix`; `fetchSprintDates` matches exact name or endsWith
  - Imports `matchSprintSuffix`, `buildSprintIterPath`

- **`src/routes/sprint.js`**
  - Lines 33-34 and 115-116: hardcoded `sprintLabel = \`${pi} ${suffix}\`` and `sprintPath = \`${iterBase}\\${pi}\\${sprintLabel}\``
  - **NOT YET FIXED** — needs to use `buildSprintIterPath` with `fm.piStructure.sprintSubpathPattern`

- **`src/routes/insights.js`**
  - Line 213: `sprintIter = \`${cfg.tfs.iterationPath}\\${piLabel}\\${piLabel} ${sprintLabel}\``
  - **NOT YET FIXED**

- **`src/routes/velocity.js`**
  - Line 74: `sprintIter = \`${iterBase}\\${piLabel}\\${piLabel} ${sprintLabel}\``
  - **NOT YET FIXED**

- **`src/helpers/snapshots.js`**
  - Line 450: `sprintIter = \`${iterBase}\\${piLabel}\\${piLabel} ${sprintLabel}\``
  - **NOT YET FIXED** (but `buildSprintIterPath` import added)

- **`src/routes/reports.js`**
  - Line 335: `pi => \`[System.IterationPath] UNDER '${iterationBase}\\${pi}\\${pi} ${sprint}'\``
  - **NOT YET FIXED** (but `buildSprintIterPath` import added)

- **`client/src/store/useStore.js`**
  - `setActiveDept()` resets all dept-scoped values; `setSprintLabels` action added

- **`client/src/hooks/useAuth.js`**
  - `logout()` clears `activeDept` from store

- **`client/src/App.jsx`**
  - Stale activeDept validation on login; applies `sprintLabels` from `/api/pi-list`

- **`data/departments/ei-ci-dp-r-d/config.json`**
  - piNamingPattern: `PI{yy}.{n}`, sprintLabels: `['SP1'..'SP5','IP']`
  - Needs `sprintSubpathPattern: '{sprint}'` added to `fieldMappings.piStructure`
</important_files>

<next_steps>
Remaining work — **complete the sprint sub-path pattern fix**:

1. **`src/routes/sprint.js`** (lines 33-34, 115-116) — Replace:
   ```js
   const sprintLabel = `${pi} ${suffix}`;
   const sprintPath  = `${iterBase}\\${pi}\\${sprintLabel}`;
   ```
   With:
   ```js
   const sprintPath = buildSprintIterPath(iterBase, pi, suffix, fm.piStructure.sprintSubpathPattern);
   ```
   Also fix the display label: keep `suffix` as the sprint label for the response; `sprint: sprintLabel` field should use a human-readable form.
   Need to import `buildSprintIterPath` and ensure `fm` is in scope.

2. **`src/routes/insights.js`** (line 213) — Replace:
   ```js
   const sprintIter = `${cfg.tfs.iterationPath}\\${piLabel}\\${piLabel} ${sprintLabel}`;
   ```
   With:
   ```js
   const fm = getFieldMappings(cfg); // ensure fm is in scope at this point
   const sprintIter = buildSprintIterPath(cfg.tfs.iterationPath, piLabel, sprintLabel, fm.piStructure.sprintSubpathPattern);
   ```

3. **`src/routes/velocity.js`** (line 74) — Replace:
   ```js
   const sprintIter = `${iterBase}\\${piLabel}\\${piLabel} ${sprintLabel}`;
   ```
   With:
   ```js
   const sprintIter = buildSprintIterPath(iterBase, piLabel, sprintLabel, fm.piStructure.sprintSubpathPattern);
   ```

4. **`src/helpers/snapshots.js`** (line 450) — Replace:
   ```js
   const sprintIter = `${iterBase}\\${piLabel}\\${piLabel} ${sprintLabel}`;
   ```
   With:
   ```js
   const sprintIter = buildSprintIterPath(iterBase, piLabel, sprintLabel, fm.piStructure.sprintSubpathPattern);
   ```
   Need to pass `fm` into the function that contains this line.

5. **`src/routes/reports.js`** (line 335) — Replace:
   ```js
   pi => `[System.IterationPath] UNDER '${iterationBase}\\${pi}\\${pi} ${sprint}'`
   ```
   With:
   ```js
   pi => `[System.IterationPath] UNDER '${buildSprintIterPath(iterationBase, pi, sprint, fm.piStructure.sprintSubpathPattern)}'`
   ```

6. **`data/departments/ei-ci-dp-r-d/config.json`** — Add to `fieldMappings.piStructure`:
   ```json
   "sprintSubpathPattern": "{sprint}"
   ```

7. **`src/helpers/sprintDates.js`** — Also fix `fetchSprintDates` sprint name matching (same issue as piDelivery.js version — line 21: `name.endsWith(\` ${s.toLowerCase()}\`)` should also try exact match).

8. **Rebuild frontend** (no frontend changes needed for these backend fixes).

9. **Restart server** to pick up all backend changes.

10. **Test**: Login as Kaushik → ConfigPanel shows `PI26.1`, `PI26.2`... → Sprint charts don't 400-error → Planned/Current Sprint show correctly.
</next_steps>