<overview>
The session focused on polishing and hardening the KPI Tracker section of the AV Dashboard (a Node.js + React app connecting to on-premise TFS). Key goals: fix WIQL URL length issues with dual TFS links, remove UI clutter (filter-chips-row, context-strip), fix the loading indicator, remove a redundant Refresh button, and make all KPI configuration (work item types, tags, attachment keywords, targets) driven from `config.json` and editable in the Settings page rather than hardcoded.
</overview>

<history>

1. **WIQL URL length fix for dual TFS links (in-flight from prior session)**
   - Root cause: "not followed" ID lists (e.g. 63 out of 65 features) created URLs too long for TFS
   - Added `smartIdWiql()` helper — always uses the **smaller** of `IN(set)` vs `NOT IN(complement)+area filter`
   - Added `KPI_MET_WIQL` map (override for say-do-ratio which KPI_WIQL_FN returns all, not just done)
   - Added `KPI_NOT_MET_WIQL` map — tag/state-based KPIs use `NOT CONTAINS 'Tag'` / `<> 'Done'` — **zero IDs in URL**
   - Replaced `kpiSets` (had `notMetIds`) with leaner version (only `metIds` + `allIds`); tag-based KPIs removed from kpiSets entirely
   - Updated RAG loop to branch: attachment-based → `smartIdWiql`; tag/state-based → `KPI_NOT_MET_WIQL` map
   - Rebuilt frontend; restarted server (PID 12252)

2. **Removed filter-chips-row and context-strip from all pages**
   - User: "filter-chips-row and context-strip not required in any page"
   - Replaced the `topContent` JSX block in `App.jsx` with `const topContent = null`
   - Deleted all CSS for `.filter-chips-row`, `.filter-chip`, `.chip-dismiss`, `.chip-clear-all`, `.context-strip`, `.ctx-item`, `.ctx-label`, `.ctx-value`, `.ctx-sep`
   - Rebuilt frontend successfully

3. **Fixed missing loading indicator on KPI page**
   - Root cause: `.skeleton` CSS class was missing — only the `@keyframes skeleton-shimmer` existed
   - Added `.skeleton` CSS rule with gradient shimmer animation
   - Also added `isFetching` to `useKPI` hook destructure in `KPISection.jsx`
   - Added "Refreshing…" spinner (shown when `isFetching && !isLoading`) next to the timestamp in the header
   - Rebuilt frontend successfully

4. **Removed redundant local Refresh button from KPI page**
   - User: "why have separate refresh for KPI since we have global"
   - Removed the `↻ Refresh` button from the KPI header
   - Kept `refetch` in the hook destructure (still used by the error state retry button)
   - Rebuilt frontend successfully

5. **Made KPI page fully config-driven (hardcoded → settings)**
   - User pointed out: "we dont have its Defect" — KPI was using hardcoded `'Bug'` but TFS work item type is `'Defect'` (per `fieldMappings.workItemTypes.defect`)
   - Also flagged all other hardcoded values: tags, attachment keywords, targets
   - Delegated to general-purpose agent with detailed instructions
   - **`src/routes/kpi.js`**: Added `getFieldMappings` import; moved `KPI_WIQL_FN`, `KPI_MET_WIQL`, `KPI_NOT_MET_WIQL` inside the route handler (so they close over config-resolved values); added `WIT_FEAT`, `WIT_DEFECT`, `DONE_STATE`, `DEFECT_CLOSED_SQL`, `TAGS`, `AKW`, `T`, `BASELINE_ANALYSIS_DAYS` — all read from config with fallbacks
   - **`src/routes/config.js`**: Added `kpi: cfg.kpi || {}` to GET response; added `if (body.kpi)` POST handler
   - **`config.json`**: Added `kpi` section with tags, attachmentKeywords, targets, defectAnalysisTimeBaseline
   - **`client/src/sections/SettingsSection.jsx`**: Added `kpiConfig` tab with Tags, Attachment Keywords, Targets, and Baseline sections
   - Build passed (273ms); server restarted (PID 40452)

</history>

<work_done>

Files modified:
- `src/routes/kpi.js` — WIQL URL fix (smartIdWiql, KPI_NOT_MET_WIQL); full config-driven refactor (WIT_FEAT/WIT_DEFECT/TAGS/AKW/T from config)
- `src/routes/config.js` — Added `kpi` to GET response and POST save handler
- `config.json` — Added `kpi` section with all defaults
- `client/src/sections/SettingsSection.jsx` — Removed filter-chips vars; added `kpiConfig` tab
- `client/src/App.jsx` — `topContent = null` (removed filter-chips-row and context-strip)
- `client/src/styles/main.css` — Added `.skeleton` class; removed filter-chips and context-strip CSS
- `client/src/sections/KPISection.jsx` — Fixed loading: added `.skeleton` usage; added `isFetching` spinner; removed local Refresh button

Current state:
- [x] WIQL URL length bug fixed — short URLs always regardless of set sizes
- [x] filter-chips-row and context-strip removed from all pages
- [x] KPI loading indicator works (skeleton on first load, spinner on re-fetch)
- [x] Local KPI Refresh button removed
- [x] All KPI hardcodes moved to config (Defect type, tags, keywords, targets)
- [x] New KPI Config tab in Settings for editing all KPI parameters
- [x] Frontend built (exit code 0)
- [x] Server running on PID 40452, port 3000

</work_done>

<technical_details>

- **`'Bug'` vs `'Defect'`**: TFS work item type for defects is `'Defect'` per `fieldMappings.workItemTypes.defect`. The KPI route was incorrectly using hardcoded `'Bug'`. Now uses `fm.workItemTypes.defect` via `getFieldMappings(cfg)`.

- **WIQL URL length strategy**: Tag-based KPIs use `NOT CONTAINS 'Tag'` (zero IDs). Attachment-based KPIs use `smartIdWiql` which always picks the smaller set: if metIds ≤ notMetIds → `IN(metIds)`; otherwise → `NOT IN(metIds)+area/iter filter`. This guarantees ≤ N/2 IDs worst case.

- **Module-level vs in-handler WIQL maps**: `KPI_WIQL_FN`, `KPI_MET_WIQL`, `KPI_NOT_MET_WIQL` are now defined **inside** the route handler so they close over `WIT_FEAT`, `WIT_DEFECT`, `TAGS`, `DEFECT_CLOSED_SQL` — all resolved from config per-request.

- **`isLoading` vs `isFetching`**: React Query's `isLoading` is only `true` on the very first fetch. On PI/team change with cached data, `isLoading` is `false` but `isFetching` is `true`. The KPI page now shows a spinner for `isFetching && !isLoading` (re-fetch) and skeletons for `isLoading` (first load). The `.skeleton` CSS class was accidentally deleted from main.css and has been restored.

- **`topContent` pattern**: `App.jsx` passes a `topContent` prop to the layout component. Setting it to `null` cleanly removes the filter-chips and context-strip from all pages without touching the layout.

- **`kpiSets` structure change**: Previously had `{ metIds, notMetIds, wiType }`. Now `{ metIds, allIds, wiType }` — `notMetIds` computed inline as `allIds.filter(id => !new Set(metIds).has(id))`.

- **`kwArr` helper**: Attachment keywords stored in config as comma-separated strings (e.g. `"mindmap, mind map, mind-map"`). `kwArr(val, fallback)` splits them; used in Phase 3 attachment detection.

- **`DEFECT_CLOSED_SQL`**: Derived from `fm.stateValues.defectClosed` array → `'Resolved','Closed'` format for inline WIQL `IN()` clauses.

- **Server startup**: Use `Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "..." -RedirectStandardOutput "server.log" -RedirectStandardError "server-err.log" -PassThru -WindowStyle Hidden` to create a truly detached process. Background job (`&`) doesn't persist.

</technical_details>

<important_files>

- **`src/routes/kpi.js`**
  - Core KPI backend route — all 15 KPI computations, RAG, dual TFS URL generation
  - Major refactor: now fully config-driven; WIQL maps moved inside handler; uses `getFieldMappings`
  - Key sections: helpers (lines ~1-75), route start/config resolution (lines ~120-165), Phase 1 WIQL queries (~165-170), Phase 3 attachment detection (~195-215), Phase 6b kpiSets (~244-253), Phase 7 KPI array (~255-400), RAG loop (~401-435), team breakdown (~440-477)

- **`src/routes/config.js`**
  - Config GET/POST route — exposes and saves all settings including new `kpi` section
  - Added `kpi: cfg.kpi || {}` to GET; `if (body.kpi)` block in POST

- **`config.json`**
  - Master config file with all settings including new `kpi` block
  - `kpi.tags`, `kpi.attachmentKeywords`, `kpi.targets`, `kpi.defectAnalysisTimeBaseline`
  - Also contains `fieldMappings.workItemTypes.defect = "Defect"` (the correct TFS type)

- **`client/src/sections/KPISection.jsx`**
  - Full KPI Tracker React component (~1060+ lines)
  - Loading: `isLoading` → skeleton grid; `isFetching && !isLoading` → spinner in header
  - Dual TFS link badges on cards (`✓ N` green / `✗ N` red); modal dual buttons
  - PI uses `selectedPIs[0] || currentPI`; team filter hides TeamRadar/TeamHeatmap

- **`client/src/sections/SettingsSection.jsx`**
  - Settings UI — added `kpiConfig` tab
  - New `KpiConfigTab` component: Tags, Attachment Keywords, Targets, Baseline sections
  - Saves via `POST /api/config` with `{ kpi: payload }`

- **`client/src/styles/main.css`**
  - Restored `.skeleton` class (was accidentally missing)
  - Removed filter-chips-row, filter-chip, context-strip CSS blocks

- **`client/src/App.jsx`**
  - `topContent = null` — removes filter chips and context strip from all pages

</important_files>

<next_steps>
No pending tasks from this session. All requested changes are complete and verified:
- WIQL URL length fix ✅
- Filter-chips / context-strip removed ✅
- KPI loading indicator restored ✅
- Redundant Refresh button removed ✅
- KPI fully config-driven (Defect type, tags, keywords, targets) ✅
- KPI Config tab in Settings ✅
- Frontend built, server running (PID 40452, port 3000) ✅
</next_steps>