<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme (Node.js/Express backend + Vanilla HTML/JS/CSS with Filament dark theme). This session focused on five areas: (1) removing local PI selectors from Sprint Trend and Team Velocity sections so they use the global PI filter, (2) fixing the slideshow to split Features/Defects into separate pages instead of scrolling, (3) defaulting to the current PI on load, (4) auto-selecting the matching snapshot for the current PI, and (5) applying the same group-page splitting to Team Velocity and Test Coverage (in progress when compaction occurred).
</overview>

<history>

1. **User asked to remove local PI selectors from Sprint Trend and Team Velocity, fix slideshow pagination for Features/Defects**
   - Removed `#sprintTrendPISelect` + `#sprintTrendLoadBtn` from Sprint Trend HTML; replaced with `#sprintTrendPILabel` subtitle
   - Removed `#velPICheckGrid` + `#velLoadBtn` from Velocity HTML; kept only metric radio toggle
   - Rewrote `setupSprintTrend()` to no-op; `initSprintTrend()` now uses `state.selectedPIs[0]`
   - Rewrote `initVelocity()` to use `state.selectedPIs` directly, always reloads fresh
   - Updated `piFilterApply` to clear `state.velData` and reload Sprint Trend/Velocity if active
   - Updated `setupTeamFilter` to call `initSprintTrend()` / `initVelocity()` directly
   - Fixed `activateSection` to always call `initVelocity()` (not cached render)
   - Implemented `buildSlideshowSlides()` with multi-page table slides (later replaced)
   - Implemented `showSlideshowSlide()` with scroll-based approach (later replaced)
   - Fixed syntax error: `setupSlideshow` function body was split from its declaration

2. **User reported slideshow indicator updates but pages don't actually split**
   - Root cause: scroll target was `#main` but `.section` is the actual scrollable container (`overflow-y: auto; height: calc(100vh - var(--topbar-h))`)
   - Fixed to use `$('section-features')` / `$('section-defects')` as scroll target
   - Used `getBoundingClientRect()` for accurate relative scroll position
   - Added 80ms `scrollDelay` when section first changes to let Chart.js settle

3. **User asked to create separate pages instead of scroll slides**
   - Pivot: abandon scroll approach entirely; use CSS `display:none` group filtering
   - Added `data-feat-group` attributes to each content block in Features section:
     - Group 1: `.charts-grid-2` (Funnel + Team)
     - Group 2: `#featAnchor2` (Throughput + WIP + Donut)
     - Group 3: `#featAnchor3` + `#predictabilityPanel` (Cycle Time + Predictability)
     - Group `stale`: `#staleFeaturesCard`
     - Group `table`: Feature list card
   - Added `data-def-group` attributes to Defects section:
     - Group 1: `.kpi-strip` + first `.charts-grid-3` (KPIs + Trend + State)
     - Group 2: `#defAnchor2` (How/Where Found + Severity)
     - Group 3: `#defAnchor3` (Aging + Injection + Found-In)
     - Group 4: `#defectDensityTrendCard` + `#defectDeltaPanel` (Density + Delta)
     - Group `crit`: `#slaBreachCard` + `#criticalDefectsCard`
   - Added `showSlideshowGroup(section, groupVal)` and `clearSlideshowGroups(section)` helper functions
   - Updated `activateSection()` to call `clearSlideshowGroups(name)` — ensures normal navigation never shows filtered groups
   - Rewrote `buildSlideshowSlides()` — no table slides, only `mode: 'group'` slides
   - Rewrote `showSlideshowSlide()` — just calls `showSlideshowGroup()`, no scrolling
   - Rewrote `stopSlideshow()` — calls `clearSlideshowGroups` for both sections
   - Fixed garbled kpi-strip HTML (previous edit accidentally dropped `kpi-d-new` card opening tag)
   - Fixed syntax error: `setupSlideshow` body was split again after helper insertion

4. **User reported syntax error in app.js**
   - `node --check` found error at line 3231: unexpected `}`
   - Root cause: inserting helpers before `function setupSlideshow() {` left the function body (addEventListener line + `}`) dangling
   - Fixed by wrapping with `function setupSlideshow() { ... }`

5. **User asked: remove table slides entirely — use popup buttons for full lists**
   - Already done as part of step 3 (buildSlideshowSlides has no table slides)
   - Confirmed: "📋 Feature List" / "📋 Defect List" buttons in section headers open modal popups

6. **User asked to set current PI as default and auto-select matching snapshot**
   - Changed `loadPIList()`: `state.selectedPIs = [state.currentPI]` (was using `data.defaultPIs` which returned previous PIs)
   - Added `async function autoSelectSnapshot()`: fetches `/api/snapshots`, finds most recent snapshot whose `pis[]` overlaps `state.selectedPIs`, calls `setActiveSnapshot()`
   - Called `autoSelectSnapshot()` after `renderAll(data)` in `fetchDashboard()`
   - In `piFilterApply`: added `setActiveSnapshot(null)` before `fetchDashboard()` so new PI triggers fresh auto-select

7. **User asked same group-page splitting for Team Velocity and Test Coverage (IN PROGRESS)**
   - This was the last request when compaction occurred
   - Velocity section content blocks identified:
     - Controls card (metric toggle) — stays always visible (not a slide group)
     - `#velPISummary` (PI summary cards) — group 1
     - `.charts-grid-2.mt-16` (Sprint velocity + Story Points charts) — group 1 or 2
     - `.card.mt-16` (Velocity trend line chart) — group 2
     - `.card.mt-16.section-table-card` (PI-End summary table) — group 3 or popup
   - Test Coverage section content blocks identified:
     - `.velocity-controls.card` (PI selector) — stays always visible
     - `.kpi-strip.mt-16` (KPI cards) — group 1
     - `.charts-grid-2.mt-16` (Automation donut + Team bar) — group 1
     - `.charts-grid-2.mt-16` (Test Runs + Feature Coverage) — group 2
     - `.card.mt-16` (Unit Tests placeholder) — group 2
     - `.card.mt-16.section-table-card` (Uncovered features table) — popup/group 3
   - NO changes made yet — need to add `data-vel-group` and `data-tc-group` attributes to HTML, update `showSlideshowGroup`/`clearSlideshowGroups` to handle these sections, update `buildSlideshowSlides` to add velocity/test-coverage group slides

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\public\index.html`
  - Removed `#sprintTrendPISelect` + `#sprintTrendLoadBtn` from Sprint Trend section; added `#sprintTrendPILabel`
  - Removed `#velPICheckGrid` + `#velLoadBtn` from Velocity section; kept metric radio toggle only
  - Added `data-feat-group` (1, 2, 3, stale, table) to Features section content blocks
  - Added `data-def-group` (1, 2, 3, 4, crit) to Defects section content blocks
  - Fixed garbled kpi-strip (group 1) — `kpi-d-new` card opening tag was lost in previous edit
  - Added anchor IDs: `featAnchor2`, `featAnchor3`, `defAnchor2`, `defAnchor3`

- `D:\views\AV Dashboard\public\app.js`
  - `activateSection()`: now calls `clearSlideshowGroups(name)` on entry
  - `setupSprintTrend()`: now no-op
  - `initSprintTrend()`: uses `state.selectedPIs[0] || state.currentPI`
  - `loadSprintTrend()`: removed `btn` reference; updates `#sprintTrendPILabel`
  - `initVelocity()`: uses `state.selectedPIs` directly, no PI grid
  - `setupTeamFilter()`: calls `initSprintTrend()` / `initVelocity()` instead of stale references
  - `piFilterApply`: calls `setActiveSnapshot(null)` + clears `state.velData` before fetchDashboard
  - `loadPIList()`: `state.selectedPIs = [state.currentPI]` (always current PI)
  - Added `autoSelectSnapshot()` — finds best snapshot for selectedPIs, called after fetchDashboard
  - Added `showSlideshowGroup(section, groupVal)` — hides all `[data-*-group]` except active
  - Added `clearSlideshowGroups(section)` — restores all group elements to visible
  - `buildSlideshowSlides()`: Features has 4 group slides (1,2,3,stale); Defects has 5 group slides (1,2,3,4,crit); no table slides
  - `showSlideshowSlide()`: calls `showSlideshowGroup()` for `mode:'group'`; `clearSlideshowGroups` on section change; no scroll logic
  - `stopSlideshow()`: calls `clearSlideshowGroups('features')` + `clearSlideshowGroups('defects')`
  - Fixed syntax error: `setupSlideshow` function body restored

Current state:
- ✅ Server running at http://localhost:3000
- ✅ Sprint Trend uses global PI (no local selector)
- ✅ Velocity uses global PI (no local selector)
- ✅ Both reload on global PI filter change and team filter change
- ✅ Current PI selected by default on load
- ✅ Matching snapshot auto-selected on load / PI change
- ✅ Slideshow: Features split into 4 group slides (no scrolling)
- ✅ Slideshow: Defects split into 5 group slides (no scrolling)
- ✅ Syntax error fixed
- ❌ NOT DONE: Velocity slideshow group pages
- ❌ NOT DONE: Test Coverage slideshow group pages

</work_done>

<technical_details>

**Slideshow group page architecture:**
- Each `.section` element has `overflow-y: auto; height: calc(100vh - var(--topbar-h))` — it IS the scrollable container, NOT `#main`
- Group filtering uses `data-feat-group` / `data-def-group` attributes on top-level content blocks
- `showSlideshowGroup(section, groupVal)` sets `el.style.display = 'none'` on non-matching groups
- `clearSlideshowGroups(section)` resets all to `el.style.display = ''`
- `activateSection()` calls `clearSlideshowGroups(name)` so normal sidebar navigation always shows full content
- Section renders fully (all charts) first, THEN group filter applied — ensures Chart.js sees correct canvas sizes
- Subsequent group slides on same section skip `activateSection()` call — only group visibility changes

**Section attribute naming convention:**
- Features: `data-feat-group="1|2|3|stale|table"`
- Defects: `data-def-group="1|2|3|4|crit"`
- Velocity: `data-vel-group` (to be added)
- Test Coverage: `data-tc-group` (to be added)
- `showSlideshowGroup` and `clearSlideshowGroups` need to handle the new attr names

**`showSlideshowGroup` current implementation only handles 'features' and 'defects':**
```js
const attr = section === 'features' ? 'data-feat-group' : 'data-def-group';
```
This needs extending for 'velocity' and 'test-coverage'.

**Default PI fix:**
- `getDefaultPIs()` in server.js returns all PREVIOUS PIs (e.g., PI1 when in PI2)
- Frontend now ignores this: `state.selectedPIs = [state.currentPI]`
- `state.currentPI` comes from `data.currentPI` in `/api/pi-list` response

**Auto-snapshot selection:**
- `/api/snapshots` returns list sorted newest-first
- Each snapshot has `pis: string[]` array
- `autoSelectSnapshot()` finds first snapshot where any PI in `s.pis` overlaps `state.selectedPIs`
- Only runs when `state.activeSnapshotId` is null
- PI filter change calls `setActiveSnapshot(null)` first to enable re-auto-selection

**Syntax error pattern:**
- When inserting new functions before `function setupSlideshow() {`, the function body (addEventListener + closing `}`) becomes dangling orphan code
- Fix: always include the full function including body in replacement edits

**Sprint Trend is single-PI only** — uses `state.selectedPIs[0]`, not the full array
**Velocity supports multiple PIs** — uses full `state.selectedPIs` array

</technical_details>

<important_files>

- `D:\views\AV Dashboard\public\app.js`
  - Main frontend logic (~3900+ lines)
  - `activateSection()` ~line 146: now calls `clearSlideshowGroups(name)`
  - `loadPIList()` ~line 185: `state.selectedPIs = [state.currentPI]`
  - `fetchDashboard()` ~line 350: calls `autoSelectSnapshot()` after render
  - `piFilterApply` ~line 240: clears snapshot + velData before fetch
  - `autoSelectSnapshot()`: near `setActiveSnapshot()` ~line 3480
  - `showSlideshowGroup()` / `clearSlideshowGroups()`: before `setupSlideshow()`
  - `buildSlideshowSlides()`: defines all slides — needs velocity + TC groups added
  - `showSlideshowSlide()`: calls `showSlideshowGroup()` for group slides
  - `initSprintTrend()` ~line 1968: uses `state.selectedPIs[0]`
  - `initVelocity()` ~line 2298: uses `state.selectedPIs` directly

- `D:\views\AV Dashboard\public\index.html`
  - Dashboard HTML structure
  - Features section ~line 393: `data-feat-group` on all content blocks (1,2,3,stale,table)
  - Defects section ~line 577: `data-def-group` on all content blocks (1,2,3,4,crit)
  - Velocity section ~line 785: needs `data-vel-group` attributes added
  - Test Coverage section ~line 989: needs `data-tc-group` attributes added
  - Sprint Trend ~line 932: `#sprintTrendPILabel` replaces old selector

- `D:\views\AV Dashboard\server.js`
  - Express backend; all TFS API routes
  - `getDefaultPIs()` ~line 70: returns previous PIs (frontend ignores this now)
  - `GET /api/snapshots` ~line 1348: returns `{ snapshots: [{id, pis[], label, capturedAt, ...}] }` sorted newest-first

- `D:\views\AV Dashboard\public\style.css`
  - `.section { overflow-y: auto; height: calc(100vh - var(--topbar-h)); }` — sections ARE the scroll containers
  - `.slideshow-page-indicator` styles exist

</important_files>

<next_steps>

**Immediately pending: Apply group-page splitting to Velocity and Test Coverage**

**Velocity section groups (proposed):**
- Group 1: `#velLoading` + `#velPISummary` + `.charts-grid-2.mt-16` (Sprint velocity + Story Points)
- Group 2: `.card.mt-16` (Velocity trend line chart) + `.card.mt-16.section-table-card` (PI-End summary table — or make this popup via existing "📋 Velocity Table" button)
- The `.velocity-controls.card` (metric toggle) should stay always visible (no group attr)

**Test Coverage section groups (proposed):**
- Group 1: `.kpi-strip.mt-16` + first `.charts-grid-2.mt-16` (Automation donut + Team bar)
- Group 2: second `.charts-grid-2.mt-16` (Test Runs + Feature Coverage) + `.card.mt-16` (Unit Tests placeholder)
- Group 3 or popup: `.card.mt-16.section-table-card` (Uncovered features — existing "📋 Uncovered" button opens modal)
- The `.velocity-controls.card` (PI selector) should stay always visible

**Implementation steps:**
1. Add `data-vel-group="N"` to Velocity section HTML content blocks
2. Add `data-tc-group="N"` to Test Coverage section HTML content blocks
3. Update `showSlideshowGroup()` attr lookup to handle 'velocity' → `data-vel-group` and 'test-coverage' → `data-tc-group`
4. Update `clearSlideshowGroups()` similarly
5. Add group slides for velocity and test-coverage in `buildSlideshowSlides()`

**Also note:** The `.velocity-controls.card` (metric toggle) and `.velocity-controls.card` (TC PI selector) must NOT get group attributes — they should always show in their sections.

</next_steps>