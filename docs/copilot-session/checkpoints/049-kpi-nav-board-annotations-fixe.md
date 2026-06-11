<overview>
This session continued iterative UX polish and feature work on the KPI Tracker section of the AV Dashboard (Node.js + React, on-premise TFS). The user drove five focused improvements: relocating the KPI Tracker in the sidebar nav, redesigning the KPI card layout into a 4-column Kanban board, fixing expand/collapse layout corruption, removing the expand button from KPI charts, and fixing annotations so saved notes are visibly rendered on charts. The session ended with the user asking for improvement suggestions (not yet answered).
</overview>

<history>

1. **User asked: "KPI tracker — which makes sense in left panel?"**
   - Analyzed current sidebar: KPI Tracker was in the "Analysis" group at the bottom — wrong mental model (KPIs are prescriptive, not exploratory)
   - Recommended moving to **Programme group** (after Executive Summary) as the "programme scorecard" — user agreed
   - In `constants.js`: moved `{ id: 'kpi', ... group: 'Analysis' }` → `{ id: 'kpi', ... group: 'Programme' }`, positioned as 2nd item after `executive`
   - Updated all role section arrays (`all`, `exec`, `rte`, `pm`) to place `kpi` right after `executive`; `sm` role unchanged (sprint-focused, doesn't need KPI)
   - Built and restarted server (PID 23192)

2. **User asked: "4 columns Quality, Process, Change Mgmt and AI/Auto — place all respective cards"**
   - Previous layout: sequential group sections (`groupedKpis.map(...)`) with filter tabs above
   - **Removed**: `activeGroup` state, `filteredKpis` useMemo, `groups` array, `groupedKpis` useMemo, filter buttons row
   - **Added**: `GROUP_COLS = ['quality', 'process', 'change', 'ai']` and `sortByRag` function inline
   - **Replaced** sequential render with a `display: grid; grid-template-columns: repeat(4, 1fr)` board
   - Each column: colored top border matching `GROUP_META[gid].color`, header with icon/label/count/desc, cards stacked vertically sorted red→amber→green
   - Ungrouped KPIs fall into the AI/Auto column
   - KPIScoreBar now uses `allKpis` directly (no filter needed)
   - Built and restarted (PID 20216)

3. **User reported: "KPI Values vs Target — expand fine, collapse causes big horizontal scroll"**
   - **Root cause**: When `.chart-expanded` is removed from a grid child, the chart canvas (sized to `100vw` by Recharts `ResizeObserver`) briefly stays wide while re-entering grid flow, causing overflow
   - **Fix layer 1** (`main.css`): Removed redundant `width: 100vw !important; height: 100vh !important` from `.chart-expanded` — `position: fixed; inset: 0` is sufficient
   - **Fix layer 2** (`main.css`): Added `overflow-x: hidden` to `.section` CSS — defensive backstop
   - **Fix layer 3** (`CopyButton.jsx`): On collapse, set `card.style.maxWidth = '100%'; card.style.overflow = 'hidden'` **before** removing the class, then clear on `requestAnimationFrame`
   - Built and restarted (PID 41924)

4. **User reported: "Scroll not coming but crossing screen — remove expand button for KPI charts"**
   - Added `expand` prop to `CopyButton` (default `true`) — only shows expand button when `type === 'chart' && expand`
   - Passed `expand={false}` to both `KPIScoreBar` and `TeamRadar` CopyButton usages
   - Initial edit accidentally swallowed closing `</div>` tags and `<Bar>` / `<Radar>` components in both components — fixed by restoring the complete JSX structure
   - Built and restarted (PID 43684)

5. **User reported: "Notes saving but not visible in KPI charts"**
   - **Bug 1**: Notes for TeamRadar were saved with `section: 'kpi-radar'` but `useAnnotations` only fetches `'kpi'` → radar notes were permanently lost
   - **Bug 2**: `annItems` was fetched but never passed to `KPIScoreBar` or `TeamRadar` components
   - **Bug 3**: No `onDelete` → delete button never appeared in the popup; `handleDeleteAnnotation` was missing
   - **Fixes**:
     - Changed radar `openAnnPopup([], 'kpi-radar')` → `openAnnPopup([])` (unified to section `'kpi'`)
     - Added `handleDeleteAnnotation(id)` that calls `DELETE /api/annotations/:id` and invalidates `['annotations', 'kpi']`
     - Fixed `ChartAnnotations` usage: `section="kpi"` hardcoded, added `onDelete={handleDeleteAnnotation}`
     - Added `NoteStrip` component: renders saved notes as colored pills below chart (color dot + sprint label + text)
     - Updated `KPIScoreBar({ ..., annItems = [] })` and `TeamRadar({ ..., annItems = [] })` signatures
     - Passed `annItems={annItems}` to both chart components at call sites
     - Added `<NoteStrip items={annItems} />` below Bar canvas in `KPIScoreBar` and below Radar canvas in `TeamRadar`
   - Had one JSX corruption during editing where `function TeamRadar` keyword was consumed — fixed
   - Built and restarted (PID 32884)

6. **User asked: "Any improvements you suggest in KPI tracker?"**
   - Was in the process of analyzing the full KPISection.jsx when session compaction occurred
   - No response delivered yet — this is the pending item

</history>

<work_done>

Files modified:
- `client/src/constants.js` — KPI Tracker moved to Programme group (2nd item); all role section arrays updated
- `client/src/styles/main.css` — `.chart-expanded` stripped of `width: 100vw` / `height: 100vh`; `overflow-x: hidden` added to `.section`
- `client/src/components/ui/CopyButton.jsx` — Added `expand` prop (default `true`); collapse handler now sets `maxWidth/overflow` before class removal
- `client/src/sections/KPISection.jsx` — Major restructure:
  - Removed: `activeGroup`, `filteredKpis`, `groups`, `groupedKpis`
  - Added: `GROUP_COLS`, `sortByRag`, 4-column board render
  - Added: `NoteStrip` component
  - Added: `handleDeleteAnnotation`
  - Fixed: annotation section unified to `'kpi'`; `annItems` passed to both charts; `onDelete` wired

Work completed:
- [x] KPI Tracker moved to Programme group in sidebar nav
- [x] 4-column Kanban board (Quality / Process / Change Mgmt / AI/Auto)
- [x] Expand/collapse horizontal scroll fixed (3-layer defence)
- [x] Expand button removed from KPI charts only (`expand={false}` prop)
- [x] Annotations visible below KPI charts (`NoteStrip`)
- [x] Delete button working in annotation popup
- [x] Radar notes no longer lost (unified to `'kpi'` section)
- [ ] Improvement suggestions for KPI Tracker — **pending, not yet answered**

</work_done>

<technical_details>

- **`.chart-expanded` CSS — `inset: 0` vs `width: 100vw`**: `position: fixed; inset: 0` stretches to fill viewport without needing `width/height`. Adding `width: 100vw` caused Recharts `ResizeObserver` to size the canvas to `100vw`. On collapse, the canvas briefly stayed `100vw` while re-entering grid flow, causing overflow. Removing `width: 100vw` eliminates the root cause.

- **CSS `overflow-x: hidden` on `.section`**: Defensive measure — even if any transient overflow occurs (e.g., from chart resize), no horizontal scrollbar appears. Previously `.section` had `overflow-y: auto` but no `overflow-x` constraint.

- **`CopyButton` collapse guard**: `card.style.maxWidth = '100%'` + `card.style.overflow = 'hidden'` set *before* removing `.chart-expanded` class. Cleared via `requestAnimationFrame` (after browser repaints). This prevents the chart canvas from "seeing" a wide container during the brief reflow window.

- **`expand` prop on `CopyButton`**: Defaults to `true` so all existing usages (Health, Features, etc.) are unaffected. Only KPI charts pass `expand={false}`. The condition is `type === 'chart' && expand` to show the expand button.

- **Annotation section unification**: KPIScoreBar used `'kpi'` section, TeamRadar used `'kpi-radar'`. `useAnnotations` was only called for `'kpi'`, so radar notes were fetched from wrong key and never invalidated correctly. Solution: both charts use `'kpi'` section — one fetch, one invalidation key, shared `annItems`.

- **`NoteStrip` pattern**: Notes are not time-series annotations (no sprint X-axis in KPI charts), so `buildAnnotationLines` (which draws vertical lines at sprint labels) doesn't apply. `NoteStrip` renders as a flex-wrapped strip of colored pills *below* the chart canvas. Each pill: color dot + sprint label (if any) + note text. Shown only when `items.length > 0`.

- **4-column board with ungrouped KPIs**: Ungrouped KPIs (those whose `group` isn't in `GROUP_COLS`) fall into the AI/Auto column by the logic `gid === 'ai' ? sortByRag(allKpis.filter(k => !GROUP_COLS.includes(k.group))) : []`.

- **JSX edit gotcha**: When using `edit` tool on JSX, if the `old_str` includes the end of one function and the start of another (like `...\n}\n\nfunction TeamRadar`), the replacement must include the `function TeamRadar` keyword too — otherwise the next function declaration is corrupted into `}({ props }) {` which is invalid JS. Always include function declarations when they're in the matched block.

- **`ValueDisplay` component**: Still exists in KPISection.jsx as dead code (~line 343) — was used in old KPICard before the compact tile redesign. Safe to remove later.

- **`--surface` CSS variable**: Undefined in `main.css` (only `--surface-1` and `--surface-2` exist). Cards fall back to transparent. Known unfixed issue affecting ProgressBar track visibility slightly.

</technical_details>

<important_files>

- **`client/src/sections/KPISection.jsx`**
  - Core file for all KPI UI — board, charts, modals, annotations
  - Major changes: removed filter tabs + sequential groups; added 4-column board; added `NoteStrip`; fixed annotations (unified section, added delete handler, wired `annItems` to charts)
  - Key sections:
    - `GROUP_META` / `GROUP_COLS` / `sortByRag`: ~lines 42–47, 968–970
    - `NoteStrip`: ~line 696
    - `KPIScoreBar` (with `annItems` prop + `NoteStrip`): ~line 718
    - `TeamRadar` (with `annItems` prop + `NoteStrip`): ~line 815
    - `handleDeleteAnnotation`: ~line 1008
    - 4-column board render: ~line 1107
    - `ChartAnnotations` (with `onDelete`): ~line 1252
    - `ValueDisplay` (dead code): ~line 343

- **`client/src/constants.js`**
  - Single source of truth for nav items and role section visibility
  - Change: `kpi` moved from `group: 'Analysis'` to `group: 'Programme'`, positioned as 2nd item; all `ROLE_SECTIONS` arrays updated
  - `NAV_ITEMS`: lines 47–82; `ROLE_SECTIONS`: lines 85–91

- **`client/src/components/ui/CopyButton.jsx`**
  - Shared copy + expand button used across all chart cards
  - Changes: `expand` prop added (default `true`); collapse handler enhanced with `maxWidth/overflow` guard + `requestAnimationFrame` clear
  - `handleExpand`: lines 59–75; `expand` prop: line 54

- **`client/src/styles/main.css`**
  - Global styles
  - Changes: `.chart-expanded` stripped of `width: 100vw/height: 100vh`; `.section` gained `overflow-x: hidden`
  - `.section`: ~line 488; `.chart-expanded`: ~line 602

- **`client/src/components/ui/ChartAnnotations.jsx`**
  - Popup for adding chart notes + `AnnotationButton` + `buildAnnotationLines`
  - No changes this session — but `NoteStrip` in KPISection is the visual counterpart that shows saved notes on the charts

</important_files>

<next_steps>

Pending work:
- **Improvement suggestions for KPI Tracker** — user asked "any improvements you suggest?" and session compacted before answering. Need to deliver a thoughtful response.

Suggested improvements to propose (analysis done before compaction):

**Data / Accuracy:**
1. **Trend indicator** on each KPI card — small ↑↓→ arrow showing change vs previous PI (currently only current value shown, no movement context)
2. **Last updated timestamp** on data freshness — users can't tell if data is stale
3. **PI comparison** — ability to overlay previous PI's KPI values in the Score Bar chart (like a ghost bar)

**UX / Navigation:**
4. **Column scroll sync** — columns have different heights; shorter columns waste space. Consider `align-items: start` (already done) but potentially a masonry-like layout
5. **Card click → modal** already exists but **keyboard shortcut** (e.g., `?` for help, `Esc` to close) would help power users
6. **Search/filter** — with 14 KPIs, a quick text filter above the board would help focus
7. **"Red only" view** — one-click to show only off-track KPIs across all columns (like an alert view)

**Insight:**
8. **At-a-glance team breakdown in cards** — show which teams are red/amber/green for each KPI right on the tile (small team mini-bars or sparkline dots), currently requires clicking through to the modal
9. **Overall score trend** — the donut shows current score but no history; a mini sparkline of last 3 PIs would add context

Immediate next steps:
- Present these suggestions clearly to the user
- Ask which ones they'd like implemented

</next_steps>