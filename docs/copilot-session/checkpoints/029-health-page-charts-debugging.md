<overview>
The session continued bug fixes and new feature development for the TFS Dashboard (Node.js/Express + React/Vite). The main focus was: (1) fixing existing UI bugs (expand buttons, role dropdowns), and (2) building a new "Health" page with three charts — Feature Cycle Time per team, Defect Aging, and Defect Escape Ratio per quarter. After the Health page was built, the user reported two charts were empty and one was showing only horizontal axes, triggering a debugging investigation that was still in progress at compaction.
</overview>

<history>

1. **Sprint-wise Feature Delivery expand button not working**
   - Root cause: `handleExpand` in `CopyButton.jsx` only searched for `.card` ancestor; Sprint-wise Feature Delivery used `data-copy-scope` wrapper (no `.card` class)
   - Fix: Added `|| e.currentTarget.closest('[data-copy-scope]')` fallback to `handleExpand`
   - Build passed

2. **Cross PI Trends and Scope Change pages missing expand/copy buttons**
   - Root cause: Neither `CrossPITrendSection.jsx` nor `ScopeChangeSection.jsx` imported `<CopyButton>` at all
   - Fix for `CrossPITrendSection.jsx`: Added `CopyButton` import; restructured 4 chart card headers to include `<div className="card-actions"><CopyButton type="chart" /></div>`
   - Fix for `ScopeChangeSection.jsx`: Same treatment for both chart cards
   - Build passed

3. **Custom roles not appearing in Role Mappings dropdown**
   - Root cause: The "Role" `<select>` in Settings → Role Mappings tab had a **hardcoded** array `['admin', 'all', 'exec', 'rte', 'pm', 'sm']`; never read `cfg?.roles?.custom`
   - Fix: Replaced hardcoded array with dynamic list appending `(cfg?.roles?.custom || [])` entries
   - Build passed

4. **New "Health" page built**
   - User requested: Feature Cycle Time per team (bar, X=team), Defect Aging, Defect Escape Ratio per quarter (year/quarter selector, current quarter default)
   - Explored existing APIs: `useCycleTimeDistribution(null, 4)` returns `byTeam: { teamName: { avg, total, ... } }`; `useFilteredDashboard` → `d.defects.agingBuckets`; no existing escape-by-quarter API
   - **Server**: Added `GET /api/defect-escape-by-quarter?year&teamPath` to `src/routes/defects.js` — queries defects for year, splits by howFound into inHouse/inField per quarter
   - **Hook**: Added `useDefectEscapeByQuarter(year, team)` to `hooks.js` — had a syntax error (missing function declaration for `usePIStoryVelocity` after insertion) that was fixed
   - **HealthSection.jsx**: Created with KPI strip + 3 charts; cycle time horizontal bar, aging horizontal bar, escape ratio grouped bar+line (mixed Chart component)
   - Registered in `constants.js` (NAV_ITEMS, ROLE_SECTIONS, SECTION_PAGES, POLICY_SCHEMA) and `App.jsx`
   - Build passed (126 modules)

5. **User reported: Defect Aging and Escape Ratio empty; Cycle Time showing horizontal**
   - Server was running with old code (new `/api/defect-escape-by-quarter` route not loaded)
   - Restarted server — new route now live
   - Investigated Defect Aging: checked en-dash encoding (confirmed correct, UTF-8 `E2 80 93`)
   - **Critical discovery in progress**: `useFilteredDashboard` returns `{ meta, features, defects }` structure. `agingBuckets` lives at `d.defects.agingBuckets` — but HealthSection code accesses `d.agingBuckets` (top-level, wrong path!). DefectsSection was being checked to confirm the correct path when compaction occurred.

</history>

<work_done>

Files modified:
- `client/src/components/ui/CopyButton.jsx` — handleExpand fallback to `[data-copy-scope]` (line ~65)
- `client/src/sections/CrossPITrendSection.jsx` — Added CopyButton import; restructured 4 chart card headers
- `client/src/sections/ScopeChangeSection.jsx` — Added CopyButton import; added expand/copy to both chart cards
- `client/src/sections/SettingsSection.jsx` — Role Mappings dropdown now reads custom roles dynamically
- `src/routes/defects.js` — Added `GET /api/defect-escape-by-quarter` route (lines 387–455)
- `client/src/api/hooks.js` — Added `useDefectEscapeByQuarter(year, team)` hook (~line 256)
- `client/src/constants.js` — Added `health` to NAV_ITEMS, ROLE_SECTIONS (all/exec/rte/pm/sm), SECTION_PAGES, POLICY_SCHEMA
- `client/src/App.jsx` — Imported `HealthSection`, added `case 'health':`

Files created:
- `client/src/sections/HealthSection.jsx` — Full Health page (KPI strip + 3 charts)

Work status:
- [x] Expand button fix (CopyButton.jsx)
- [x] Cross PI Trends expand/copy buttons
- [x] Scope Change expand/copy buttons
- [x] Role Mappings custom roles in dropdown
- [x] Server route `/api/defect-escape-by-quarter`
- [x] `useDefectEscapeByQuarter` hook
- [x] HealthSection.jsx created and wired up
- [x] Build passes (126 modules)
- [ ] **BUG**: `d.agingBuckets` in HealthSection is wrong — should be `d.defects.agingBuckets`
- [ ] **UNKNOWN**: Escape Ratio chart showing empty — might be API returning zeros, or chart data issue
- [ ] Feature Cycle Time: user reports "showing horizontal" — likely working correctly (by design) but needs verification

</work_done>

<technical_details>

**Data structure of `useFilteredDashboard`**:
- Returns `{ meta, features: {...}, defects: {...} }`
- `agingBuckets` is at `data.defects.agingBuckets` NOT `data.agingBuckets`
- `applyTeamFilter` (utils.js ~line 89) recalculates `agingBuckets` within the defects sub-object and returns `{ ...data, features: {...overridden}, defects: {...overridden including agingBuckets} }`
- CRITICAL BUG: HealthSection accesses `d.agingBuckets` instead of `d.defects?.agingBuckets` — this causes all-zero aging bars

**Defects aging bucket keys** (confirmed UTF-8 en-dash U+2013 = `E2 80 93`):
- `'0–7 days'`, `'8–14 days'`, `'15–30 days'`, `'31–60 days'`, `'60+ days'`
- Same keys in `dataProcessors.js`, `utils.js` (applyTeamFilter), and `HealthSection.jsx`

**`useDashboard` enabled guard**: `enabled = Array.isArray(pis) && pis.length > 0` — if pis is empty (not yet loaded), query is disabled and `data` is undefined; `isLoading` is false even though no data. This can cause charts to render with empty data without showing a loader.

**PageLoader condition bug in HealthSection**: `if (dashLoading && cycleLoading)` — uses `&&` so PageLoader only shows when BOTH are loading. If one loads from cache, the other's undefined data gets rendered as empty charts. Should be `||`.

**Mixed chart (bar + line) for Escape Ratio**: Uses `<Chart type="bar">` (not `<Bar>`) from react-chartjs-2 v5.3.1 with per-dataset `type` property. Requires both `BarElement` and `LineElement` registered in ChartJS.register() — both are present.

**Server route `/api/defect-escape-by-quarter`**:
- WIQL date format: `${year}-01-01T00:00:00.000Z` (ISO, same as existing defect-version-stats)
- Groups by quarter: `Math.ceil((month + 1) / 3)`
- Escape ratio formula (consistent with existing app): `inField / inHouse * 100` (not `inField / total`)
- Returns: `{ year, quarters: [{label, quarter, inHouse, inField, total, ratio}], inFieldLabel, fetchedAt }`

**`usePIStoryVelocity` breakage during hook insertion**: When inserting `useDefectEscapeByQuarter` before `usePIStoryVelocity`, the edit replaced the `export function usePIStoryVelocity(pis, team) {` line but didn't include it in the replacement, leaving orphaned function body code. Required a second fix to re-add the missing function declaration.

**API requires session auth**: `GET /api/defect-escape-by-quarter` returns 401 when called without a session cookie — cannot test via curl/PowerShell without auth token.

**`useCycleTimeDistribution(null, 4)`**: Calling with `null` teamPath sets `byTeam = true`. Returns `{ pis, values, avg, median, ..., byTeam: { teamName: { avg, median, p25, p75, total, stdDev, buckets[] } } }`. The `byTeam` key is at top level.

**Server start**: `node server.js` in project root; listens on port 3000. Was restarted to pick up new defect-escape-by-quarter route.

</technical_details>

<important_files>

- `client/src/sections/HealthSection.jsx`
  - Newly created Health page with all 3 charts
  - **BUG at ~line 34**: `AGING_LABELS` is correct but usage at ~line 143 is `d.agingBuckets?.[l]` — should be `d.defects?.agingBuckets?.[l]`
  - **BUG at ~line 247**: PageLoader condition `dashLoading && cycleLoading` should be `dashLoading || cycleLoading`
  - Chart 1: Feature Cycle Time (horizontal bar, `useCycleTimeDistribution(null, 4)`, `data.byTeam`)
  - Chart 2: Defect Aging (horizontal bar, `useFilteredDashboard` → `d.defects.agingBuckets`)
  - Chart 3: Escape Ratio (mixed bar+line, `useDefectEscapeByQuarter`, year selector + quarter pills)

- `src/routes/defects.js`
  - All defect-related server routes
  - New route added at lines 387–455: `GET /api/defect-escape-by-quarter`
  - Uses `fetchWorkItemDetails` with `howFoundField`, groups by quarter, returns per-quarter inHouse/inField/ratio

- `client/src/api/hooks.js`
  - All React Query hooks
  - `useDefectEscapeByQuarter` added at ~line 256
  - `useCycleTimeDistribution` at line 149 — when `teamPath=null`, sets `byTeam=true`

- `client/src/constants.js`
  - NAV_ITEMS: `health` added to "Delivery & Quality" group (~line 68)
  - ROLE_SECTIONS: `health` added to all/exec/rte/pm/sm (~lines 84–88)
  - SECTION_PAGES: `health: 1` added (~line 118)
  - POLICY_SCHEMA: `health` entry with 3 chart IDs added after test-coverage entry

- `client/src/App.jsx`
  - `HealthSection` imported and `case 'health':` added to section router (~lines 33, 69)

- `client/src/utils.js`
  - `applyTeamFilter` at line 89 — returns full `{ ...data, features, defects }` structure
  - `agingBuckets` computed at line 187, returned inside `defects` at line 278
  - Critical: aging data is at `result.defects.agingBuckets`, not `result.agingBuckets`

- `client/src/components/ui/CopyButton.jsx`
  - `handleExpand` at ~line 64–72 now has `[data-copy-scope]` fallback

</important_files>

<next_steps>

**Immediate bugs to fix in `HealthSection.jsx`**:

1. **Fix Defect Aging data path** (highest priority):
   Change `d.agingBuckets?.[l]` → `d.defects?.agingBuckets?.[l]` in the `agingChartData` useMemo. Also check other `d.` references — `d.stateCounts` etc. that should be `d.defects?.stateCounts`.

2. **Fix PageLoader condition**:
   Change `if (dashLoading && cycleLoading)` → `if (dashLoading || cycleLoading)` so charts don't render with undefined data.

3. **Investigate Escape Ratio empty chart**:
   After server restart the route should work. If still empty, check: (a) are there defects with `CreatedDate` in 2026? (b) Is the WIQL returning results? (c) Are all quarters showing 0 bars (data present but zero) or is the chart not rendering at all?

4. **Feature Cycle Time "showing horizontal"** — by design (indexAxis: 'y'). If user wants vertical, change to `indexAxis: 'x'` and swap axis labels. Get clarification from user.

5. **Add `isError` state handling** for escape ratio chart — if API errors, show an error message instead of "No defect data".

**After fixes, rebuild and test**:
```
npm run build  (in D:\views\AV Dashboard directory)
```
Server is already running on port 3000.

</next_steps>