<overview>
The session continued work on the AV Dashboard (Node.js/Express + React/Vite), focusing on two major features: (1) completing per-chart annotation scoping so notes don't bleed across charts sharing the same sprint labels, and (2) a full rewrite of the `GlobalSearch` component to search all sections, tabs, and charts — not just features/defects — with policy and role awareness. A rendering bug was subsequently found and fixed where `NavRow`/`TFSRow` were defined as inner components causing React to remount them on every render.
</overview>

<history>

1. **Background agent `per-chart-annotations` completed (carried over from previous session)**
   - Agent had been running to scope chart annotations by `chartId` so notes saved on one chart don't appear on other charts in the same section
   - Agent completed successfully; build passed ✅
   - Old notes without a `chartId` remain backward-compatible (still show everywhere until re-saved)

2. **User requested search bar be expanded beyond features/defects**
   - Original `GlobalSearch.jsx` only searched TFS features and defects from the react-query dashboard cache
   - User wanted: type any keyword → get suggestions for sections, charts, tabs too; navigate to any of them
   - Consulted rubber-duck agent before implementing; key feedback:
     - Tab/chart results should only navigate to their parent section (tabs are local state, can't deep-link yet)
     - Search index must be filtered by current role/policy visibility
     - `POLICY_SCHEMA` is not identical to `NAV_ITEMS` — some entries exist in one but not the other (e.g. `compare` in POLICY_SCHEMA has no NAV_ITEM)
     - Avoid the existing early-return pattern that required dashboard cache to be present before showing any results
   - User also clarified: **"this also should be based on policy don't show everything"**

3. **GlobalSearch complete rewrite**
   - Built `BASE_INDEX` as a module-level IIFE from `POLICY_SCHEMA`, skipping any pages without a matching `NAV_ITEMS` entry
   - Added `usePolicies()` hook to get `tabVisible`/`chartVisible` functions
   - Added `getEffectiveRoleSections` to compute `visibleSectionIds` from the store's `activeRole`/`customRoles`/`roleOverrides`
   - Search effect: 1 char min for nav items (sections/tabs/charts), 2 char min for TFS items
   - Results grouped into "Navigation" (PAGE/TAB/CHART badges) and "TFS Items" (Feature/Defect badges)
   - Direct label matches ranked above parent-section breadcrumb-only matches
   - TFS features/defects only shown if their section is visible for the current role
   - Build passed ✅

4. **User reported "No results for Feature Lifecycle Funnel"**
   - Investigated the code; found two bugs:
     - **Primary bug**: `NavRow` and `TFSRow` were defined as function components **inside** the `GlobalSearch` component body. React creates a new function reference on every render → treats them as new component types → unmounts/remounts every render cycle, causing rendering failures
     - **Secondary**: `found.length >= 10` cap in the nav loop could cut off results for queries that match many items before reaching the target
   - Fix: moved `NavRow` and `TFSRow` to **module level** (above `GlobalSearch`), passing `hovered`, `onHover`, `onNavigate`, and `tfsBaseUrl` as explicit props
   - Removed the `found.length >= 10` early-break on the nav loop entirely
   - Also removed `SearchIcon` inline component (was similarly defined inside component); replaced with inline SVG
   - Build passed ✅

</history>

<work_done>

Files modified:
- **`client/src/components/ui/GlobalSearch.jsx`** — Complete rewrite:
  - Module-level `BASE_INDEX` IIFE from `POLICY_SCHEMA` + `NAV_ITEMS`
  - Module-level `KIND_CFG` color/badge config
  - Module-level `NavRow` component (props: `r`, `idx`, `hovered`, `onHover`, `onNavigate`)
  - Module-level `TFSRow` component (props: `r`, `idx`, `hovered`, `onHover`, `onNavigate`, `tfsBaseUrl`)
  - Imports added: `useMemo`, `usePolicies`, `useAuth`, `NAV_ITEMS`, `POLICY_SCHEMA`, `getEffectiveRoleSections`
  - `visibleSectionIds` computed via `useMemo` from store role state
  - `policies` + `role` used as proxy deps for `tabVisible`/`chartVisible` in search effect
  - Search effect: 1-char threshold for nav, 2-char for TFS
  - Grouped result rendering with "Navigation" and "TFS Items" section headers
  - Updated placeholder text to "Search sections, charts, tabs, features, defects…"
  - Updated footer hint

- **All annotation sections** (via `per-chart-annotations` agent — completed this session):
  - `buildAnnotationLines` updated to accept `chartId` as 4th param with backward-compat filter
  - `ChartAnnotations` component accepts `chartId` prop, passes it on save
  - All section files updated to pass unique chart IDs in `openAnnPopup` and `buildAnnotationLines` calls

Work completed:
- [x] Per-chart annotation scoping (agent completed, build passed)
- [x] GlobalSearch expanded to search sections/tabs/charts
- [x] Policy and role filtering in search results
- [x] Grouped results UI (Navigation + TFS Items)
- [x] Bug fix: NavRow/TFSRow moved to module level (fixes "no results" rendering failure)
- [x] Removed nav result cap that could truncate matches
- [x] Build verified ✅ after all changes

</work_done>

<technical_details>

- **React anti-pattern: components defined inside components** — When `NavRow` was defined inside `GlobalSearch`, React assigned it a new function identity on every render of the parent. React's reconciliation compares component types by reference; a new reference = unmount old + mount new on every render. This caused the results list to fail to render correctly. Always define components at module scope.

- **`BASE_INDEX` as module-level IIFE** — Since `POLICY_SCHEMA` and `NAV_ITEMS` are static imports, the index can safely be built once at module load. No `useMemo` needed. The guard `if (!navItem) continue` ensures only navigable pages (those in `NAV_ITEMS`) are indexed — this skips `compare` which exists in `POLICY_SCHEMA` but not `NAV_ITEMS`.

- **Two-layer visibility system**:
  1. **Role/section visibility**: `getEffectiveRoleSections(customRoles, roleOverrides)[activeRole]` → returns array of visible section IDs for the current UI role (user-switchable via topbar). Used to compute `visibleSectionIds` Set.
  2. **Policy visibility**: `usePolicies()` → returns `pageVisible`, `tabVisible`, `chartVisible` functions based on `policies` object + authenticated `role` from `useAuth`. Used to filter tabs/charts within visible sections.

- **Proxy deps for `tabVisible`/`chartVisible`**: These functions are new instances on every render (created inline in `usePolicies`). Adding them to `useEffect` deps would cause infinite re-runs. Instead, `policies` and `role` are added as deps — when they change, the effect re-runs and captures fresh function closures. This is the standard pattern for hook-derived functions.

- **`activeRole` (store) vs `role` (useAuth)**: Two different things. `activeRole` is the UI-switchable role selected in the topbar (defaults `'all'`). `role` from `useAuth` is the server-authenticated user role. Sidebar/section visibility uses `activeRole`; `usePolicies` uses `useAuth`'s `role`.

- **Per-chart annotation backward compat**: Filter logic in `buildAnnotationLines` is `if (chartId && a.chartId && a.chartId !== chartId) return` — only enforces the match if BOTH the call and the stored annotation have a chartId. Old notes (no stored chartId) continue appearing on all charts of their section.

- **Search result ordering**: Nav results sorted: direct `label` matches (score=1) before `sectionLabel`-only matches (score=0). TFS results appended after, capped at 20 total. Nav results are uncapped (full BASE_INDEX traversal).

- **`POLICY_SCHEMA` vs `NAV_ITEMS` divergence**: `compare` exists in POLICY_SCHEMA (line ~311) but not in NAV_ITEMS. Also, `settings` may appear in app navigation but not in POLICY_SCHEMA. The guard `NAV_ITEMS.find(n => n.id === page.id)` correctly handles this.

</technical_details>

<important_files>

- **`client/src/components/ui/GlobalSearch.jsx`**
  - Central file for this session's work — fully rewritten
  - Module-level: `BASE_INDEX` (IIFE), `KIND_CFG`, `NavRow`, `TFSRow`
  - Component: imports `usePolicies`, `useAuth`, `getEffectiveRoleSections`; computes `visibleSectionIds` via `useMemo`
  - Search effect at ~line 73; result rendering at ~line 205+

- **`client/src/constants.js`**
  - `POLICY_SCHEMA` (line 145) — source of truth for all pages/tabs/charts; drives BASE_INDEX
  - `NAV_ITEMS` (line 47) — ordered list of navigable sections with icons/groups
  - `ROLE_SECTIONS` (line 85) — built-in role → section arrays
  - `getEffectiveRoleSections` (line 101) — merges built-in roles with customRoles + roleOverrides

- **`client/src/hooks/usePolicies.js`**
  - Returns `pageVisible`, `tabVisible`, `chartVisible` functions
  - Uses `useAuth().role` + `useStore(s => s.policies)` to derive hidden items
  - `chartVisible` has special slideshow mode logic (only whitelisted charts during slideshow)

- **`client/src/hooks/useAuth.js`**
  - Returns `role` from `/api/auth/me` query; defaults to `'all'` during loading or on error
  - `role` is the server-authenticated role (different from store's `activeRole`)

- **`client/src/components/ui/ChartAnnotations.jsx`**
  - Exports `ChartAnnotations` (popup), `AnnotationButton`, `buildAnnotationLines`
  - `buildAnnotationLines(annotations, labels, onDelete, chartId)` — 4th param added this session for per-chart scoping
  - Backward-compat filter: only enforces chartId match if both sides have it

</important_files>

<next_steps>

Remaining work:
- [ ] Verify GlobalSearch in browser: "Feature Lifecycle Funnel" should now show a CHART result navigating to Features section
- [ ] Verify per-chart annotations: adding a note to one chart should not appear on sibling charts in the same section
- [ ] 3 pending todos in session database — query with `SELECT * FROM todos WHERE status = 'pending'` to review

No active blockers. The build is passing. The main follow-up is browser testing of both features.

</next_steps>