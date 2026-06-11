<overview>
The user is building an AV Dashboard (Node.js backend + React frontend) connected to on-premise TFS. The current session focused on two distinct bodies of work: (1) implementing 8 KPI Tracker improvements that were planned in the prior session, and (2) debugging two annotation/notes bugs in FeaturesSection and DefectsSection. All KPI improvements have been implemented and the build is passing. The notes bugs were fully diagnosed but no fixes have been written yet.
</overview>

<history>

1. **User asked "any improvements you suggest in KPI tracker" (from prior session)**
   - Full codebase analysis of `KPISection.jsx` (1291 lines) and `src/routes/kpi.js` (545 lines) was completed
   - 10 improvements were presented; user selected items 1, 2, 3, 4, 6, 7, 8, 10
   - Rubber duck review identified two blocking issues: `pct()` returning `0` instead of `null`, and `previousValue` config-based approach
   - 14 precise edits were planned (6 backend, 8 frontend) — **no code written before compaction**

2. **This session: Implementing all planned KPI improvements**
   - **Backend `src/routes/kpi.js`** — 6 edits applied:
     - Added `getPILabel` to piHelpers import
     - Fixed `pct()` to return `null` instead of `0` when denominator is 0
     - Added `prevPIOf()` helper for automatic prior PI detection
     - Added sprint-level feature grouping from `System.IterationPath`
     - Added sprint values per KPI + `previousValue` from optional config
     - Added `previousPI` and `previousSummary` to `res.json`
   - **Frontend `client/src/sections/KPISection.jsx`** — 8 edits applied:
     - Added `Fragment` to React import
     - Added `computeRag`, `getGapInfo`, `getTrendArrow` helper functions
     - Added `SprintSparkline` SVG component (sprint trend dots with target line)
     - Added `QuickEditPanel` inline popover for manual KPI entry
     - Replaced `KPICard` with enhanced version (trend arrow, no-data reason, gap chip, sparkline)
     - Updated `SummaryBar` to show vs-prior-PI score delta
     - Updated `SummaryBar` call site with new props
     - Updated column board: added score % badge, RAG dot mini-bar per column, Fragment + QuickEditPanel in card list
   - Build failed initially — `KPIScoreBar` function declaration was consumed by the NoteStrip edit (the `function KPIScoreBar({` line was accidentally deleted). Fixed by restoring it.
   - **Build succeeded** after fix: 131 modules transformed, exit code 0

3. **User reported two notes/annotation bugs:**
   - "Notes even after saving not visible in features graph"
   - "In defects when I click note icon not opening popup"
   
   **Investigation of DefectsSection bug:**
   - `DefectsSection` component is the only export (line 67)
   - `annPopup` state (line 90), `openAnnPopup` function (line 105), `annItems` (line 97), `handleDeleteAnnotation` (line 100) are all inside `DefectsSection`
   - **Root cause**: `ChartAnnotations` (lines 2124–2133) is inside `VersionsTab` (a separate function component at line 1860), NOT inside `DefectsSection`'s main return (which ends at line 1845)
   - In `VersionsTab`, `annPopup`, `setAnnPopup`, `annItems`, `selectedPIs`, `selectedTeam`, `handleDeleteAnnotation` are all `undefined` (not passed as props, not in scope)
   - `annPopup.open` would be `undefined`, so `ChartAnnotations` never opens; worse, accessing `.open` on `undefined` would throw if `VersionsTab` is rendered

   **Investigation of FeaturesSection bug:**
   - `annItems` is fetched via `useAnnotations('features', activePi, selectedTeam)` at parent level (line 1719–1720)
   - `annItems` is passed to `ChartAnnotations` popup (lines 1788, 1837) but **never passed to `OverviewTab`**
   - `buildAnnotationLines` is not imported in FeaturesSection (line 21 only imports `ChartAnnotations` and `AnnotationButton`)
   - `annotationPlugin` from `chartjs-plugin-annotation` is NOT registered in FeaturesSection (line 30–33 only registers basic plugins)
   - Charts in `OverviewTab` have no `plugins.annotation` config
   - **Root cause**: notes are saved successfully to the API, but `annItems` is never passed down to charts, and the annotation plugin is not registered → nothing shows visually
   - Additional complication: Feature Lifecycle Funnel is a horizontal bar chart (`indexAxis: 'y'`), so `buildAnnotationLines` (which uses `xMin/xMax`) won't work on it → need `NoteStrip` text list for that chart
   - Team Summary chart is a regular bar chart (team names as x-axis) → `buildAnnotationLines` would work
   - CycleTimeDistributionCard has bucket labels as x-axis → `buildAnnotationLines` would work

   **Investigation stopped here** — no fixes written yet.

</history>

<work_done>

Files modified:
- **`src/routes/kpi.js`**: Fixed `pct()`, added `getPILabel` import, `prevPIOf()` helper, sprint extraction block, sprint values loop, previousValue loop, `previousPI`/`previousSummary` in response
- **`client/src/sections/KPISection.jsx`**: Added `Fragment` import, 3 helper functions, `SprintSparkline`, `QuickEditPanel`, replaced `KPICard`, updated `SummaryBar` + call site, updated column board with score badges/RAG bars/Fragment+QuickEditPanel

Work completed:
- [x] All 8 KPI Tracker improvements implemented (backend + frontend)
- [x] Build passing (`npm run build` exit code 0, 131 modules)
- [x] Diagnosed DefectsSection popup bug (ChartAnnotations inside wrong component)
- [x] Diagnosed FeaturesSection notes-not-visible bug (annItems not passed to charts, plugin not registered)
- [ ] **Fix DefectsSection**: Move `ChartAnnotations` from `VersionsTab` to `DefectsSection` main return
- [ ] **Fix FeaturesSection**: Import annotationPlugin + register, import buildAnnotationLines, pass annItems to OverviewTab, add annotation config to team summary chart, add NoteStrip for funnel chart, add annotation config to CycleTimeDistributionCard

</work_done>

<technical_details>

**KPI backend changes:**
- `pct(n, d)` now returns `null` (not `0`) when `d === 0` — critical for the "No TFS items" no-data reason chip in the frontend; team breakdown uses `data?.[field] ?? 0` so null safely falls back
- `prevPIOf('26-PI2')` → `'26-PI1'`; `prevPIOf('26-PI1')` → `'25-PI4'` (wraps year boundary)
- Sprint extraction strips PI prefix from iteration path last segment: `26-PI1 S1` → `S1`, `26-PI1 IP` → `IP`, `26-PI1` (PI-level) → `null` (excluded)
- Feature-based KPI sparklines work; bug-based KPIs (`scenario-gap-defects`, etc.) get `sprintValues: null` because bug iteration paths aren't fetched
- `aiTagIds` is a `Set`, `lateChgIds` is an `Array` — sprint value computation handles both
- Previous PI config: users set `kpi.previousValues['26-PI1']['exploratory-coverage'] = 65` in config.json; optional, nothing shows if not configured

**KPI frontend changes:**
- `computeRag` is a local helper (not using backend's RAG) — used by `SprintSparkline` to color dots
- `getGapInfo` returns `null` for count KPIs when value=0 (already green, no gap chip needed)
- `getTrendArrow` threshold of 0.5 prevents spurious arrows from rounding
- `QuickEditPanel` uses `kpi.isManual` flag; `isTimeBased` = `kpi.id === 'build-time-reduction'`
- `SprintSparkline` SVG: W=100, H=28, target as dashed line, dots colored by `computeRag`
- Build broke because the `NoteStrip` edit accidentally consumed `function KPIScoreBar({` declaration — fixed by restoring the function declaration

**DefectsSection bug — root cause:**
- `ChartAnnotations` is at line 2124 inside `VersionsTab` (separate function, starts line 1860)
- `DefectsSection`'s main return ends at line 1845 (`</div>` `);` `}`)
- Variables `annPopup`, `setAnnPopup`, `annItems`, `selectedPIs`, `selectedTeam`, `handleDeleteAnnotation` are all from `DefectsSection` scope — inaccessible in `VersionsTab`
- Fix: cut `ChartAnnotations` block (lines 2124–2133) from VersionsTab return, paste before `</div>` at line 1844

**FeaturesSection bug — root cause:**
- `annotationPlugin` is NOT imported or registered (only basic ChartJS plugins at line 30–33)
- `buildAnnotationLines` is NOT imported (line 21 only imports `ChartAnnotations, { AnnotationButton }`)
- `annItems` is available at parent level (line 1720) but `OverviewTab` doesn't receive it as a prop
- `OverviewTab` signature (line 63): `function OverviewTab({ features, store, pis, chartVisible, onAddNote })`
- Feature Lifecycle Funnel is `indexAxis: 'y'` (horizontal bar) — `buildAnnotationLines` uses `xMin/xMax` so won't work → use NoteStrip text list instead
- Team Summary chart is normal vertical bar with team names as x-axis → `buildAnnotationLines` works
- `CycleTimeDistributionCard` (line 369) has bucket labels (`BUCKET_LABELS = ['0–15d', ...]`) → `buildAnnotationLines` works
- `handleDeleteAnnotation` must also be passed to OverviewTab for delete-from-chart to work
- `annotationPlugin` registration is global when called once (idempotent), so registering in FeaturesSection won't conflict with KPISection's registration

**Architecture:**
- `ChartAnnotations` component is controlled via `{ open, setOpen }` props (not self-managed)
- `buildAnnotationLines(annotations, labels, onDelete)` creates chartjs-plugin-annotation config objects keyed by `ann_${id}`
- `useAnnotations(section, pi, team)` hook fetches annotations and returns `{ items: [] }`

</technical_details>

<important_files>

- **`src/routes/kpi.js`**
  - Backend KPI computation route
  - Modified: fixed `pct()`, added `getPILabel` import + `prevPIOf()`, sprint extraction, sprint values, previousValue, previousPI/previousSummary in response
  - Key lines: import line 6, `pct()` ~line 58, `prevPIOf()` ~line 62, sprint extraction ~line 272–283, sprint values loop ~line 505–535, `res.json` ~line 552–562

- **`client/src/sections/KPISection.jsx`**
  - Frontend KPI Tracker section — all 8 improvements applied
  - Modified: Fragment import, computeRag/getGapInfo/getTrendArrow helpers, SprintSparkline, QuickEditPanel, new KPICard, updated SummaryBar, updated column board
  - Key lines: imports line 1, helpers ~line 100–135, SprintSparkline ~line 784, QuickEditPanel ~line 822, KPICard ~line 554, SummaryBar ~line 690, column board ~line 1308

- **`client/src/sections/DefectsSection.jsx`**
  - Defects section — has annotation popup bug
  - NOT YET MODIFIED
  - Key issue: `ChartAnnotations` is at lines 2124–2133 inside `VersionsTab` (function at line 1860), not in `DefectsSection` return (ends line 1845)
  - Fix: move ChartAnnotations block to before `</div>` at line 1843 in DefectsSection's return

- **`client/src/sections/FeaturesSection.jsx`**
  - Features section — notes not visible on charts
  - NOT YET MODIFIED
  - Key lines: imports line 1–21, ChartJS.register line 30–33, `OverviewTab` signature line 63, `annItems` line 1720, `handleDeleteAnnotation` line 1723, AnnotationButton calls lines 332/353
  - Needs: annotationPlugin import + register, buildAnnotationLines import, annItems + onDeleteAnn passed to OverviewTab, annotation config on Team Summary chart, NoteStrip for Funnel chart, annotation config for CycleTimeDistributionCard

- **`client/src/components/ui/ChartAnnotations.jsx`**
  - Shared annotation component — popup for adding notes, `buildAnnotationLines` for chart config, `AnnotationButton`
  - No changes needed
  - Key: `buildAnnotationLines` (line 31) creates `xMin/xMax` vertical lines; only works on regular (non-horizontal) bar/line charts

</important_files>

<next_steps>

Remaining bugs to fix:

**Fix 1 — DefectsSection popup not opening (simple, 1 edit):**
- Cut `<ChartAnnotations .../>` block (lines 2124–2133) from inside `VersionsTab`'s return JSX
- Paste it before the closing `</div>` at line 1843 in `DefectsSection`'s main return
- `VersionsTab`'s return `</div>` at line 2134 becomes a plain closing div (remove the orphaned `</div>`)

**Fix 2 — FeaturesSection notes not visible (multiple edits):**
1. Add `annotationPlugin` import: `import annotationPlugin from 'chartjs-plugin-annotation';` after line 8
2. Register it: add `annotationPlugin` to `ChartJS.register(...)` at line 30–33
3. Add `buildAnnotationLines` to line 21 import: `import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';`
4. Update `OverviewTab` signature (line 63) to accept `annItems` and `onDeleteAnn` props
5. Update `OverviewTab` call sites (lines 1776, 1824) to pass `annItems={annItems}` and `onDeleteAnn={handleDeleteAnnotation}`
6. In `OverviewTab`: add `plugins.annotation.annotations: buildAnnotationLines(annItems, teams, onDeleteAnn)` to `teamChartOpts`
7. In `OverviewTab`: add a `NoteStrip` below the Feature Lifecycle Funnel chart (since it's horizontal bar, annotation lines won't work). Define a local `NoteStrip` component or show notes inline
8. Pass `annItems`/`onDeleteAnn` to `CycleTimeDistributionCard` (update its props at line 326 and its signature at line 369) and add annotation config to its chart options
9. Rebuild with `npm run build` and verify

</next_steps>