<overview>
The session focused on bug fixes and new features for the TFS Dashboard (Node.js/Express + React/Vite). Work covered: fixing expand/copy button functionality across missing chart sections, fixing the roles dropdown to show custom roles, and beginning a new "Health" page with Feature Cycle Time, Defect Aging, and Defect Escape Ratio per quarter. The approach was surgical — find root causes quickly, fix in the minimal right place, rebuild and verify.
</overview>

<history>

1. **Sprint-wise Feature Delivery expand button not working**
   - Root cause: `handleExpand` in `CopyButton.jsx` only searched for `.card` ancestor via `closest('.card')`, but Sprint-wise Feature Delivery chart container used `data-copy-scope` attribute (no `.card` class)
   - Fix: Added `|| e.currentTarget.closest('[data-copy-scope]')` fallback to `handleExpand`, matching the pattern already used by the copy handler
   - This also fixed expand buttons in Compare, Risks, and Velocity sections which had the same structure
   - Build passed

2. **Cross PI Trends and Scope Change pages missing expand/copy buttons entirely**
   - Root cause: Neither `CrossPITrendSection.jsx` nor `ScopeChangeSection.jsx` imported or used `<CopyButton type="chart" />` at all
   - Fix for `CrossPITrendSection.jsx`: Added `CopyButton` import; restructured 4 chart card headers from plain `<div style={{padding...}}>` to `<div className="card-header">` flex layout with `<div className="card-actions"><CopyButton type="chart" /></div>` on the right
   - Fix for `ScopeChangeSection.jsx`: Added `CopyButton` import; added `<div className="card-actions"><CopyButton type="chart" /></div>` to both chart card headers ("Scope Points Comparison" and "Change Breakdown")
   - Build passed

3. **Custom roles not appearing in Role Mappings dropdown (Settings → Role Mappings tab)**
   - Root cause: The "Role" `<select>` dropdown in the Role Mappings table (Settings → Role Mappings tab) had a **hardcoded** array `['admin', 'all', 'exec', 'rte', 'pm', 'sm']` — never read custom roles
   - The Visibility Policies section already correctly read `cfg?.roles?.custom` dynamically (line 1698-1699) — only this dropdown was broken
   - Fix: Replaced hardcoded array with dynamic list that appends `(cfg?.roles?.custom || []).map(r => ({ id: r.id, label: r.label || r.id }))` to the base role list
   - `cfg` is already available in scope from `useConfig()` at component top
   - Build passed

4. **New "Health" page — user requested, currently in progress**
   - User requested: Feature Cycle Time per team (bar chart, X=team, Y=avg days), Defect Aging (duplicate from Defects page is fine), Defect Escape Ratio per quarter (in-house vs customer, with year/quarter selector defaulting to current quarter)
   - Explored codebase: found existing `/api/cycle-time-distribution?byTeam=true` returns `byTeam: { teamName: { avg, total, ... } }` — usable directly
   - Existing `useFilteredDashboard` already returns `d.agingBuckets` — can reuse for Defect Aging
   - Existing `/api/defect-field-stats` returns byQuarter raised/closed but NOT split by in-house vs customer — need new API endpoint `/api/defect-escape-by-quarter`
   - Was in the middle of exploring when compaction occurred — had not yet started writing code

</history>

<work_done>

Files modified:
- `client/src/components/ui/CopyButton.jsx` — Fixed `handleExpand` to fall back to `[data-copy-scope]` ancestor (line 65)
- `client/src/sections/CrossPITrendSection.jsx` — Added `CopyButton` import; restructured 4 chart card headers (Defect Density Trend, Velocity Trend, Live Defects per PI, Portfolio Mix) to include expand/copy buttons
- `client/src/sections/ScopeChangeSection.jsx` — Added `CopyButton` import; added expand/copy to "Scope Points Comparison" and "Change Breakdown" chart cards
- `client/src/sections/SettingsSection.jsx` — Fixed Role Mappings "Role" dropdown (line ~1646) to dynamically append custom roles from `cfg?.roles?.custom`

Work completed:
- [x] Sprint-wise Feature Delivery expand button fix
- [x] Cross PI Trends — all 4 chart cards get expand/copy buttons
- [x] Scope Change — both chart cards get expand/copy buttons
- [x] Role Mappings dropdown shows custom/created roles
- [ ] Health page — not yet started (was exploring APIs when compaction occurred)

Current state: Build is passing, server running at localhost:3000.

</work_done>

<technical_details>

- **`CopyButton` expand vs copy ancestor lookup**: The copy handler (`handleCopy`) already had a 3-way fallback: `.card || .table-modal-panel || [data-copy-scope]`. The expand handler (`handleExpand`) only had `.card`. Root cause of multiple expand button failures. Fixed with a 2-way fallback: `.card || [data-copy-scope]`.

- **`data-copy-scope` pattern**: Chart containers that are NOT `.card` elements (e.g., Sprint-wise Feature Delivery, Compare, Risks, Velocity inline charts) use `data-copy-scope` attribute on their wrapper div. These still get `<CopyButton type="chart" />` but need the fallback ancestor lookup.

- **`card-header` + `card-actions` CSS**: `.card-header` is `display:flex; align-items:center; justify-content:flex-start`. `.card-actions` has `margin-left:auto; display:flex; align-items:center; gap:6px` — this pushes buttons to the right side automatically. Pattern for adding buttons to any chart card header.

- **Role Mappings dropdown**: `cfg` from `useConfig()` is available at the top of `SettingsSection` (line 389). The Visibility Policies IIFE at line 1696 already correctly iterates `cfg?.roles?.custom`. The Role Mappings section did not — a simple oversight.

- **Health page — available APIs**:
  - Feature Cycle Time: `GET /api/cycle-time-distribution?byTeam=true` → `{ byTeam: { "TeamName": { avg, median, p25, p75, total, stdDev, buckets[] } } }`. Hook: `useCycleTimeDistribution(null, 4)` (passing `null` teamPath + piCount).
  - Defect Aging: `useFilteredDashboard` → `d.agingBuckets` with keys `'0–7 days', '8–14 days', '15–30 days', '31–60 days', '60+ days'`. Already has chart options in `DefectsSection.jsx` (agingBarOpts, AGING_COLORS).
  - Defect Escape Ratio per quarter: **NO existing API** — need new `GET /api/defect-escape-by-quarter?year=2026&quarter=2` that returns `{ inHouse: N, inField: N, ratio: R, byQuarter: {...} }`. The `howFoundField` and `defectFieldFoundValue` are in field mappings config. Need to add to `src/routes/defects.js` and register as new hook.

- **Quarter logic**: `DefectsSection.jsx` already has `quarterToDateRange(label)` at line 26-36 converting `"2026-Q2"` → `{ start, end }` ISO dates. Reusable utility.

- **Current quarter calculation**: `Math.ceil((new Date().getMonth() + 1) / 3)` gives current quarter number.

- **How escape ratio is computed** (from `dataProcessors.js` line 279-283): `escaped = howFoundBreakdown[inFieldVal]`, `caught = sum of all other values`, `escapeRatio = escaped / caught * 100`. "In Field" means customer-found; everything else is in-house.

- **NAV_ITEMS and ROLE_SECTIONS in constants.js**: Adding a new page requires adding to `NAV_ITEMS` array (gives it a sidebar entry), `ROLE_SECTIONS` (adds to default role visibility), and `App.jsx` switch/case (renders the component). Also `SECTION_PAGES` if it has multiple slideshow pages.

</technical_details>

<important_files>

- `client/src/components/ui/CopyButton.jsx`
  - Core expand/copy button used in ALL chart cards
  - Key fix: line 65, `handleExpand` now has `[data-copy-scope]` fallback
  - Line 79-81: `handleCopy` ancestor lookup (3-way, already correct)
  - Line 64-72: `handleExpand` function

- `client/src/sections/CrossPITrendSection.jsx`
  - Cross-PI Trends section — now has CopyButton in all 4 chart cards
  - Import added at line ~19; 4 chart headers restructured around line 421, 431, 449, 459
  - Chart containers use `.card` class — expand button works via primary `.card` lookup

- `client/src/sections/ScopeChangeSection.jsx`
  - Scope Change section — now has CopyButton in both chart cards
  - Import added; both `card-header` divs (~line 287, 298) updated with `card-actions`

- `client/src/sections/SettingsSection.jsx`
  - Very large settings file (~1700+ lines)
  - Key fix: Role Mappings "Role" dropdown (~line 1643-1647) — now dynamic
  - Visibility Policies role selector (~line 1697-1701) — was already correct
  - `cfg` available from `useConfig()` at line 389

- `client/src/sections/DefectsSection.jsx`
  - Contains reusable Defect Aging chart code (`agingBarOpts`, `agingChartData`, `AGING_COLORS`) at lines 264-274, 584-605
  - Contains `quarterToDateRange` utility at lines 26-36
  - Contains escape ratio display patterns — useful reference for Health page

- `client/src/api/hooks.js`
  - All React Query hooks — `useCycleTimeDistribution` at line 149, `useDefectFieldStats` at line 228
  - New `useDefectEscapeByQuarter` hook needs to be added here

- `src/routes/defects.js`
  - Server-side defect API routes — `/api/defect-field-stats`, `/api/defect-density-trend`, `/api/defect-version-stats`
  - New `/api/defect-escape-by-quarter` route needs to be added here

- `client/src/constants.js`
  - `NAV_ITEMS` array (line 47-80): add `{ id: 'health', icon: '❤️', label: 'Health', group: 'Delivery & Quality' }`
  - `ROLE_SECTIONS` (line 83-89): add `'health'` to appropriate roles

- `client/src/App.jsx`
  - Section router switch/case (lines 48-68): add `case 'health': return <HealthSection />;`
  - Import of new section component needed

</important_files>

<next_steps>

Remaining work — **Health page** (not started):

1. **Server: Add `/api/defect-escape-by-quarter` to `src/routes/defects.js`**
   - Params: `year` (default current year), `quarter` (default current quarter, 1-4)
   - Query TFS for all defects in that quarter's date range with `howFound` field
   - Split into `inHouse` (any howFound ≠ fieldFoundValue) vs `inField` (= fieldFoundValue)
   - Also return all quarters for the selected year as `allQuarters: { "2026-Q1": { inHouse, inField, ratio }, ... }` for trend chart
   - Use existing `fm.fields.howFoundField` and `fm.stateValues.defectFieldFoundValue`

2. **Client: Add `useDefectEscapeByQuarter(year, quarter)` hook to `hooks.js`**

3. **Client: Create `client/src/sections/HealthSection.jsx`** with:
   - **Chart 1 — Feature Cycle Time per Team**: Horizontal bar chart, Y=team name, X=avg days. Use `useCycleTimeDistribution(null, 4)` → `data.byTeam`. Sort by avg days descending. Color bars by TEAM_COLORS.
   - **Chart 2 — Defect Aging**: Reuse `agingBarOpts` and `agingChartData` patterns from `DefectsSection.jsx`. Use `useFilteredDashboard` → `d.agingBuckets`. Horizontal bar, 5 buckets, AGING_COLORS.
   - **Chart 3 — Defect Escape Ratio per Quarter**: Grouped bar chart (In House vs In Field), with year dropdown and Q1/Q2/Q3/Q4 tab/button selector defaulting to current quarter. Use `useDefectEscapeByQuarter`.

4. **Client: Register in `constants.js`** — add to `NAV_ITEMS` under "Delivery & Quality" group, add to `ROLE_SECTIONS` for all/rte/pm/exec roles

5. **Client: Register in `App.jsx`** — import + add `case 'health':`

6. **Rebuild and test**

</next_steps>