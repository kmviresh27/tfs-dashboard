<overview>
The user is building an AV Dashboard (Node.js/Express backend + React/Vite frontend) connected to on-premise TFS for tracking features, defects, and KPIs across PI planning cycles. This session focused on: (1) fixing bugs diagnosed in the prior session — annotation notes not showing on charts and the DefectsSection popup scope bug; (2) UX improvements — removing padding from 5 section containers, fixing keyboard shortcuts 1–9 to follow sidebar order; and (3) a new requirement that chart notes be scoped per-chart (not shared across all charts in a section). A background agent is currently running to implement the per-chart annotation scoping.
</overview>

<history>

1. **User reported notes not visible on charts in multiple sections** (Sprint health, Teams, Release health, Test coverage, Health, Scope change, Risks, Cross-PI trends, Features, Defects)
   - Investigation confirmed the root cause: only KPISection, VelocitySection, PIDeliverySection correctly call `buildAnnotationLines()` on chart options; all other sections save/fetch annotations but never wire them into chart options
   - Also confirmed DefectsSection bug: `<ChartAnnotations>` was rendered inside `VersionsTab` sub-component (its own function) where `annPopup`, `annItems`, etc. from `DefectsSection` are out of scope
   - FeaturesSection additionally missing: `annotationPlugin` not registered, `buildAnnotationLines` not imported, `annItems` not passed to `OverviewTab`
   - Launched background agent `fix-annotations-all-sections` to fix all 10 sections systematically
   - Agent completed successfully — build passed ✅ — added `buildAnnotationLines` to all affected sections, fixed DefectsSection scope bug, registered `annotationPlugin` in FeaturesSection, skipped ReleaseHealthSection (horizontal bar charts)

2. **User asked to remove padding from parent div within active section div for 5 sections** (PI Readiness, PI Delivery, Blocker Board, Retro Action Items, Cross-PI Trends)
   - Removed `padding: 20` / `padding: 24` from the outermost return `<div>` in all 5 sections
   - PIReadinessSection had two return paths (team view + programme view) — both fixed
   - CrossPITrendSection had 3 return paths (error, empty, main) — all fixed

3. **User reported keyboard shortcuts 1–9 not working in correct order**
   - Found `SECTION_KEYS` was hardcoded: `'1': 'executive', '2': 'features', '3': 'defects'` etc. — did not match actual `NAV_ITEMS` order (which has kpi=2, roadmap=3, etc.)
   - First fix: changed to `Object.fromEntries(NAV_ITEMS.slice(0, 9).map(...))` — still wrong because `visibleSections` is role-filtered; if user's role hides a section, the key maps to a non-visible target → silently does nothing
   - Second fix (correct): removed `SECTION_KEYS` entirely, replaced with dynamic index lookup: `const numKey = parseInt(e.key, 10); const target = visibleSections[numKey - 1]` — pressing `1` always goes to the 1st visible sidebar item regardless of role
   - Also added `!inInput` guard that was missing from the number key branch
   - Built successfully ✅

4. **User asked for notes to be saved per chart** (not shared across all charts in a section)
   - Root cause: all charts in a section share one `annItems` pool; `buildAnnotationLines` filters by label match only, so charts with same labels (e.g., 3 sprint charts all with S1/S2/S3) show the same notes
   - Backend already supports `chartId` field (stored since initial design, line 50 of `annotations.js`)
   - Fix requires: `buildAnnotationLines` to accept `chartId` as 4th param and filter by it; `ChartAnnotations` to accept+pass `chartId`; every section's `openAnnPopup` + `AnnotationButton` calls to pass chart-specific IDs; `buildAnnotationLines` calls in every section to pass matching chart IDs
   - Launched background agent `per-chart-annotations` — **currently running**

</history>

<work_done>

Files modified:
- **`client/src/sections/PIReadinessSection.jsx`**: Removed `padding: 20` from both return paths (team view line 89, programme view line 185)
- **`client/src/sections/PIDeliverySection.jsx`**: Removed `padding: 20` from main return (line 227)
- **`client/src/sections/BlockerBoardSection.jsx`**: Removed `padding: 20` from main return (line 98)
- **`client/src/sections/RetroSection.jsx`**: Removed `padding: 20` from main return (line 129)
- **`client/src/sections/CrossPITrendSection.jsx`**: Removed `padding: 24` from all 3 return paths (main, error, empty state)
- **`client/src/App.jsx`**: Replaced hardcoded `SECTION_KEYS` map with dynamic `visibleSections[numKey - 1]` index lookup; updated `?` hint overlay text
- **All annotation sections** (via `fix-annotations-all-sections` agent): Added `buildAnnotationLines` to SprintSection, CrossPITrendSection, TeamsSection, HealthSection, TestCoverageSection, ScopeChangeSection, RisksSection; fixed DefectsSection popup scope; registered annotationPlugin + wired annItems in FeaturesSection

Work completed:
- [x] Notes visible on charts across all sections (annotation lines rendered)
- [x] DefectsSection popup scope bug fixed
- [x] FeaturesSection annotationPlugin registered
- [x] Padding removed from 5 section containers
- [x] Keyboard shortcuts 1–9 follow visible sidebar order (role-aware)
- [ ] Per-chart annotation scoping — **agent currently running**

</work_done>

<technical_details>

- **`annotationPlugin` global registration**: Once any section calls `ChartJS.register(annotationPlugin)`, it's globally available for all charts in the app. Only FeaturesSection was missing it; all other sections benefit from KPISection's registration. Adding it to FeaturesSection is idempotent (safe duplicate).

- **`buildAnnotationLines` label filtering**: The function at `client/src/components/ui/ChartAnnotations.jsx` line 31 already filters `annotations.forEach(a => { if (!labels.includes(a.sprint)) return; ... })`. This prevents cross-section bleed but NOT same-section/same-labels bleed (e.g., 3 sprint charts).

- **`chartId` already in backend**: `src/routes/annotations.js` POST handler already extracts and stores `chartId` (line 41, 50). GET handler does NOT filter by chartId — returns all for section (frontend filters). No backend changes needed for the per-chart fix.

- **Per-chart fix backward compatibility**: The `buildAnnotationLines` chartId filter must be: `if (chartId && a.chartId && a.chartId !== chartId) return;` — only enforces match when BOTH sides have a chartId. Notes saved before this fix (no chartId stored) continue to show everywhere until re-saved.

- **Keyboard shortcut `inInput` guard**: The original number-key branch was missing the `!inInput` check. Fixed in the rewrite — number keys inside input fields are now correctly ignored.

- **`visibleSections` vs `NAV_ITEMS`**: `visibleSections = getEffectiveRoleSections(customRoles, roleOverrides)[activeRole]` is role-filtered. `NAV_ITEMS` is the full list. Keyboard shortcuts must use `visibleSections` order to match what the user actually sees in the sidebar.

- **ReleaseHealthSection annotations**: Skipped for `buildAnnotationLines` because its charts are horizontal bar charts (`indexAxis: 'y'`). The function creates `xMin/xMax` vertical lines which don't work on horizontal charts. Notes still save/show in popup.

- **useMemo + annotation deps**: CrossPITrendSection's `lineOptions`, `velocityOptions`, `barOptions` were wrapped in `useMemo(…, [])`. When adding `buildAnnotationLines(annItems, ...)` inside them, `annItems` must be added to the deps array, otherwise annotations won't update when notes are added/deleted.

- **DefectsSection VersionsTab bug**: `ChartAnnotations` was inside `VersionsTab` (a separate function component starting ~line 1860), but `annPopup`, `setAnnPopup`, `annItems`, `handleDeleteAnnotation` are defined in `DefectsSection`. These variables were undefined in `VersionsTab` scope. Fix: move `<ChartAnnotations>` to `DefectsSection`'s main return.

</technical_details>

<important_files>

- **`client/src/components/ui/ChartAnnotations.jsx`**
  - Core annotation component used by all sections
  - Exports: default `ChartAnnotations` (popup), `AnnotationButton`, `buildAnnotationLines`
  - `buildAnnotationLines(annotations, labels, onDelete, chartId)` — 4th param being added by current agent
  - Key lines: `buildAnnotationLines` at line 31, component props at line 79, POST body at line 95

- **`client/src/routes/annotations.js`** (backend)
  - File-based JSON store at `data/annotations.json`
  - GET: filters by `section`, `pi`, `team` — does NOT filter by `chartId` (frontend handles that)
  - POST: already stores `chartId` (line 50) — no changes needed
  - DELETE: by id

- **`client/src/App.jsx`**
  - Contains `SECTION_KEYS` (now removed) and keyboard `handleKey` function
  - Keyboard shortcut fix: `const target = visibleSections[numKey - 1]` using role-filtered sections
  - Key lines: keyboard handler ~line 95, `visibleSections` derivation, `?` hint overlay

- **`client/src/constants.js`**
  - `NAV_ITEMS` — ordered list of all navigation sections (21 items in 6 groups)
  - `ROLE_SECTIONS` — maps role names to allowed section IDs
  - Current nav order: executive, kpi, roadmap, objectives-plan, pi-readiness, pi-board, features, defects, sprint, velocity, teams, pi-delivery, release-health, test-coverage, health, scope-change, blockers, risks, retro, cross-pi, insights

- **`client/src/sections/SprintSection.jsx`**
  - Has 3+ charts all using same `sprintLabels` — prime example of per-chart annotation bleed
  - Chart IDs being assigned: `sprint-overview`, `sprint-done-rate`, `sprint-escape-ratio`, `sprint-capacity`, `sprint-stories`

- **`client/src/sections/CrossPITrendSection.jsx`**
  - Uses `useMemo` for chart opts — needs `annItems` in deps
  - Padding removed from all 3 return paths
  - Chart IDs: `crosspi-density`, `crosspi-velocity`, `crosspi-bar`, `crosspi-ratio`

- **`client/src/sections/DefectsSection.jsx`**
  - Had scope bug (ChartAnnotations inside VersionsTab) — fixed by agent
  - Annotations now also wired to chart options

- **`client/src/sections/FeaturesSection.jsx`**
  - Was missing `annotationPlugin` import+register — fixed
  - `OverviewTab` sub-component needed `annItems` + `onDeleteAnn` props added

</important_files>

<next_steps>

Remaining work:
- [ ] **Per-chart annotation scoping** — background agent `per-chart-annotations` is currently running. It will:
  - Add `chartId` param to `buildAnnotationLines` (with backward-compat logic)
  - Add `chartId` prop to `ChartAnnotations` component
  - Update all 16 section files to pass chart-specific IDs in `openAnnPopup` and `buildAnnotationLines`
  - Run `npm run build` to verify

After agent completes:
- Verify build passes
- Test that adding a note to one chart does NOT appear on other charts in same section
- Notes saved before this fix (no chartId) will still show everywhere — acceptable as backward compat
- Consider adding a migration if user wants old notes cleaned up

Potential follow-up items from prior sessions (from todos):
- 3 pending todos in the session database — query with `SELECT * FROM todos WHERE status = 'pending'` to review

</next_steps>