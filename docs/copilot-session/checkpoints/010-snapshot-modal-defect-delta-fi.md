<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme, built with Node.js/Express backend and Vanilla HTML/JS/CSS (Filament dark-mode). This session focused on: (1) making the global snapshot system work correctly as a popup modal with topbar integration, (2) extending snapshot comparison to include defects alongside features, (3) removing PI Comparison in favour of snapshot-based comparison, (4) making all filters (team, PI, snapshot) fully reactive across all dashboard sections, and (5) fixing Planned/Stretch classification to use `System.Tags` with proper Removed-state exclusion.
</overview>

<history>

1. **Resuming from prior checkpoint — snapshot modal was mid-implementation**
   - Prior work had captured snapshot in a Features-panel modal; needed to move to global topbar
   - Added `📸 Snapshot` button to topbar next to `↻ Refresh`
   - Built global `#snapshotModal` with two tabs: Capture (PI checkboxes + label + revision) and Browse (list with delete + compare buttons)
   - Removed old `#captureModal` and `#predCaptureBtn` from Features panel
   - Server was already running; static files only needed browser refresh

2. **Server not starting — `showNotification is not defined`**
   - Error triggered when user tried to capture a snapshot
   - `showNotification` was called in snapshot functions but never defined; only `showToast` existed (scoped inside keyboard handler)
   - Added global `showNotification(msg, type)` function near top of `app.js` — creates a fixed bottom-right toast element with green/red styling and 3.5s auto-fade

3. **Snapshot UX redesign: popup, global indicator, remove Predictability dropdown**
   - User wanted: (a) proper popup modal not a drawer, (b) show which snapshot is selected somewhere global, (c) remove the dropdown from Predictability panel, (d) team filter change should auto-refresh Predictability
   - Added `.modal-overlay` / `.modal-box` CSS (previously only `.table-modal-overlay` had styles)
   - Added `#activeSnapChip` green pill in topbar showing active snapshot label with ✕ clear button
   - Replaced `#predSnapshotSel` dropdown in Predictability panel with `#predSnapInfo` status text
   - Added `state.activeSnapshotId` + `state.activeSnapshotLabel` to global state
   - Added `setActiveSnapshot(id, label)` function that updates topbar chip, panel status text, and triggers `loadPredictability()`
   - `useSnapshotForPredictability(id, label)` now calls `setActiveSnapshot()` and navigates to Features
   - `setupTeamFilter()` now calls `loadPredictability(state.activeSnapshotId)` on team change

4. **Full filter reactivity across all sections**
   - User wanted team, PI, and snapshot changes to update ALL graphs and tables
   - **Audit found gaps**: Sprint Trend and PI Comparison APIs hardcoded `cfg.tfs.areaPath` (no `teamPath` support); `initSprintTrend()` only loaded if table was empty; `activateSection` didn't re-render overview on navigate; Compare section not reactive to team filter
   - **Server changes**: Added `teamPath` query param to `/api/sprint-trend`, `/api/pi-comparison`, and `/api/sprint-burndown` — all now use `filterPath = teamPath || cfg.tfs.areaPath`
   - **Client changes**:
     - `activateSection()` now re-renders overview KPIs+charts on navigate
     - `initSprintTrend()` always reloads (removed "only if empty" guard)
     - `loadSprintTrend(pi)` passes `teamPath` param
     - `fetchAndRenderComparison(piLabels)` passes `teamPath` param
     - `initCompareSection()` always re-fetches (not skip if built)
     - `setupTeamFilter()` now also re-triggers Sprint Trend and Compare if active

5. **Remove PI Comparison, extend snapshot to include Defect Delta**
   - User decided PI Comparison is redundant since snapshot comparison does the same job
   - Removed `📈 Compare PIs` nav link and `#section-compare` HTML entirely
   - Removed `initCompareSection` from `activateSection` and team filter handler
   - **Extended `/api/predictability`** to also return defect comparison:
     - Reads `snapshot.data.defects.items` alongside features
     - Fetches live states for ALL IDs (features + defects) in one batch
     - Returns `defects[]` array and `defectSummary` (snapshotTotal, liveTotal, resolvedNow, snapEscapeRatio, liveEscapeRatio, escapeDelta)
   - **Added `#defectDeltaPanel`** card in Features section (below Predictability):
     - 6 KPI cards: Snapshot Defects, Live Defects, Now Resolved, Snapshot Escape Ratio, Live Escape Ratio, Escape Ratio Δ (RAG coloured)
     - Hidden table `#defectDeltaTable` with popup button
   - Added `renderDefectDelta(defects, summary)` in `app.js`
   - `renderPredictability()` now calls `renderDefectDelta()` with defect data
   - `clearPredictability()` now also clears defect delta KPIs and table

6. **Move comparison tables to popup modal**
   - User wanted Feature Comparison and Defect Comparison tables to open as popups (same pattern as other tables), not inline
   - Replaced both inline `<div class="table-wrap">` sections with hidden `<div hidden>` containing the tables
   - Added `card-footer-row` with count summary text + `📋 Feature Comparison` / `📋 Defect Comparison` buttons calling `openTableModal()`
   - `renderPredTable()` now updates `#predFeatureCount` text (e.g. "24 features · 18 done · 6 not done")
   - `renderDefectDelta()` now updates `#defectDeltaCount` text (e.g. "31 defects · 12 state changed")
   - Added `.card-footer-row` CSS

7. **Fix Planned/Stretch classification using System.Tags + Removed exclusion**
   - User clarified: Planned vs Stretch determined by `System.Tags` containing "Stretch" tag (not a custom field)
   - Features in `Removed` state at snapshot = not in PI plan → exclude from predictability denominator
   - Features in `New` state at snapshot = planned but not started → include
   - **Server `POST /api/snapshot`**: Added `System.Tags` to `featFields`, replaced `psField`-based type with tag parsing: `tags.split(';').map(t=>t.trim()).includes('stretch') ? 'Stretch' : 'Planned'`
   - Removed `psField` / `plannedStretchField` dependency entirely
   - **Server `GET /api/predictability`**: Added `if (sf.state === 'Removed') return;` skip at start of forEach loop

8. **User requested: Defect Density Trend (snapshot start vs actual)**
   - Requested a density trend chart in Defects section showing density at PI start (from snapshot) vs actual (live)
   - *This was the last request when compaction occurred — not yet implemented*

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\public\index.html`
  - Added `📸 Snapshot` button + `#activeSnapChip` indicator to topbar
  - Added global `#snapshotModal` with Capture + Browse tabs before `</body>`
  - Removed `📈 Compare PIs` nav link
  - Removed entire `#section-compare` HTML block
  - Replaced Predictability toolbar dropdown with `#predSnapInfo` status text
  - Replaced inline feature comparison table-wrap with hidden table + footer row + popup button
  - Added `#defectDeltaPanel` card with KPI strip + hidden table + footer row + popup button

- `D:\views\AV Dashboard\public\app.js`
  - Added global `showNotification(msg, type)` toast function (~line 60)
  - Added `state.activeSnapshotId` and `state.activeSnapshotLabel` to state object
  - Added `setActiveSnapshot(id, label)` — updates chip, status text, triggers predictability
  - Replaced `setupPredictability()` — now no-op (dropdown removed)
  - Replaced `openCaptureModal/closeCaptureModal` with `openSnapshotModal/closeSnapshotModal`
  - Added `switchSnapTab()`, `_buildSnapPIGrid()`, `onSnapRevisionToggle()`, `loadSnapshotBrowser()`, `useSnapshotForPredictability()`, `deleteSnapshot()`
  - `refreshSnapshotList()` — now no-op (dropdown removed)
  - `setupTeamFilter()` — triggers Sprint Trend, Compare (removed), Predictability on team change
  - `activateSection()` — added overview re-render on navigate; removed compare case
  - `initSprintTrend()` — always reloads (removed "only if empty" guard)
  - `loadSprintTrend(pi)` — passes `teamPath` query param
  - `fetchAndRenderComparison()` — passes `teamPath` (kept for potential future use)
  - `initCompareSection()` — always re-fetches (kept but unreachable from UI)
  - `renderPredictability()` — now calls `renderDefectDelta()`
  - `clearPredictability()` — now clears defect delta KPIs + table
  - `renderPredTable()` — updates `#predFeatureCount` summary text
  - Added `renderDefectDelta(defects, summary)` — KPIs + count text + table render
  - Added `.card-footer-row` CSS

- `D:\views\AV Dashboard\public\style.css`
  - Added `.modal-overlay`, `.modal-box`, `.modal-header`, `.modal-body`, `.modal-footer` CSS (proper popup)
  - Added `.active-snap-chip`, `.active-snap-text`, `.active-snap-clear` CSS
  - Added `.snap-item`, `.snap-item-info`, `.snap-item-label`, `.snap-item-meta`, `.snap-item-actions` CSS
  - Added `.pi-check-btn` (duplicate of existing but scoped to snapshot modal)
  - Added `.card-footer-row` CSS

- `D:\views\AV Dashboard\server.js`
  - `/api/sprint-trend`: Added `teamPath` param → `filterPath = teamPath || cfg.tfs.areaPath`
  - `/api/pi-comparison`: Added `teamPath` param + inline WIQL (no longer uses `wiqlFeatures()` helper to allow `filterPath`)
  - `/api/sprint-burndown`: Added `teamPath` param
  - `POST /api/snapshot`: Removed `psField`, added `System.Tags` to `featFields`, classify type via tag parsing
  - `GET /api/predictability`: Merged feature+defect ID batches into single `fetchWorkItemDetails` call; added defect comparison logic; returns `defects[]` + `defectSummary`; added `if (sf.state === 'Removed') return` to exclude removed features

**Current state:**
- Server running at http://localhost:3000 (async shell `srv`) ✅
- All syntax checks pass ✅
- Snapshot modal works as proper popup ✅
- Global snapshot chip in topbar ✅
- Team filter triggers all sections ✅
- Defect Delta panel implemented ✅
- Planned/Stretch via System.Tags ✅
- Removed features excluded from predictability ✅
- **In progress**: Defect Density Trend chart (not yet started)

</work_done>

<technical_details>

**Snapshot System Architecture:**
- Files stored in `D:\views\AV Dashboard\snapshots\{id}.json`
- ID format: `{PI1}_{PI2}-{ISO-timestamp-sanitized}`
- Schema: `{ id, pis[], label, capturedAt, isRevision, parentId, data: { meta, features: { items[], ... }, defects: { items[], ... } } }`
- Old format (features-only) still supported via fallback: `snapshot.data?.features?.items || snapshot.features`
- `POST /api/snapshot` reuses same WIQL queries + `processFeatures` + `processDefects` as dashboard

**Planned/Stretch Classification (confirmed by user):**
- Source field: `System.Tags` (comma or semicolon separated)
- Logic: `tags.split(';').map(t=>t.trim()).includes('stretch')` → Stretch, else Planned
- Case-insensitive check (`.toLowerCase()` applied before split)
- No `plannedStretchField` config needed anymore

**Predictability Denominator Rules (confirmed by user):**
- `Removed` state at snapshot time → excluded (feature was pulled from PI plan)
- `New` state at snapshot time → included (planned but not started = still committed)
- All other states → included
- Effort-based (not count-based): uses `Microsoft.VSTS.Scheduling.Effort`
- Target: 80–100% = green zone

**Filter Reactivity Matrix:**
| Filter | Overview | Features | Defects | Teams | Executive | Sprint Trend | Velocity | Test Coverage | Predictability |
|--------|----------|----------|---------|-------|-----------|-------------|----------|---------------|----------------|
| Team | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ re-fetches | ✅ | ✅ re-fetches | ✅ |
| PI | ✅ full reload | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Snapshot | – | ✅ | ✅ (delta) | – | – | – | – | – | ✅ |

**Modal CSS Pattern:**
- Dashboard uses TWO modal systems: `.table-modal-overlay` (existing, for table popups) and `.modal-overlay` (new, for snapshot modal)
- `.modal-overlay` CSS was missing until this session — caused snapshot modal to not display as popup
- `.modal-overlay[hidden] { display: none !important; }` required to override default hidden attribute behavior

**Defect Delta API:**
- Uses single `fetchWorkItemDetails` call for both feature + defect IDs (merged batch)
- Escape ratio calculated both from snapshot states and live states for comparison
- `escapeDelta = liveEscapeRatio - snapEscapeRatio`: negative = improvement (green), positive = regression (red)

**Table Popup Pattern:**
- All tables are hidden in DOM (`<div hidden>`)
- `openTableModal(tableId, title)` clones the table and inserts into `#tableModalBody`
- Footer row pattern: `<div class="card-footer-row">` with count text + 📋 button
- Count text updated by render functions (e.g. `#predFeatureCount`, `#defectDeltaCount`)

**Known Issues / Warnings:**
- Existing snapshots captured before this session have `type: 'Planned'` for all features (psField was null). Must re-capture snapshots for correct Planned/Stretch classification via tags.
- `fetchAndRenderComparison` and `initCompareSection` still exist in app.js but are unreachable from UI (PI Comparison section removed). Can be cleaned up later.
- `.pi-check-btn` CSS defined twice (once in main section ~line 323, once in snapshot section ~line 1463). The snapshot-specific one overrides with different colours. Should consolidate.

</technical_details>

<important_files>

- `D:\views\AV Dashboard\server.js`
  - Main Express backend; all TFS API routes and data processing
  - `POST /api/snapshot` ~line 1192: captures full dashboard data, classifies by System.Tags
  - `GET /api/predictability` ~line 1309: returns features + defects comparison vs snapshot; excludes Removed features
  - `GET /api/sprint-trend` ~line 695: now accepts `teamPath` param
  - `GET /api/pi-comparison` ~line 768: now accepts `teamPath` param (kept, UI removed)
  - `GET /api/sprint-burndown` ~line 958: now accepts `teamPath` param
  - `listSnapshotFiles()` ~line 1174, `readSnapshot()` ~line 1184: snapshot I/O helpers

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend logic (~3700+ lines)
  - `showNotification()` ~line 60: global toast
  - `state` object ~line 40: includes `activeSnapshotId`, `activeSnapshotLabel`
  - `setActiveSnapshot(id, label)` ~line 3278: global snapshot selection handler
  - `openSnapshotModal()` / `switchSnapTab()` / `loadSnapshotBrowser()` ~line 3290+
  - `submitSnapshot()` ~line 3330: captures snapshot with multi-PI selection
  - `setupTeamFilter()` ~line 2558: triggers all sections on team change
  - `activateSection()` ~line 146: re-renders correct section on navigation
  - `renderPredictability()` ~line 3485: calls both `renderPredTable` + `renderDefectDelta`
  - `renderDefectDelta()` ~line 3615: renders defect KPIs + count + hidden table

- `D:\views\AV Dashboard\public\index.html`
  - Dashboard HTML structure
  - Topbar `#snapshotBtn` + `#activeSnapChip` ~line 179
  - `#predictabilityPanel` in Features section ~line 476: pred toolbar, KPIs, gauges
  - `#defectDeltaPanel` ~line 521: defect delta KPIs, footer row, hidden table
  - `#snapshotModal` ~line 1105: global snapshot modal with Capture/Browse tabs
  - `#tableModal` ~line 1067: existing table popup (used by all sections)

- `D:\views\AV Dashboard\public\style.css`
  - `.modal-overlay` / `.modal-box` ~line 1495+: proper popup CSS (added this session)
  - `.active-snap-chip` ~line 1480+: topbar snapshot indicator
  - `.snap-item` ~line 1439+: snapshot browser list items
  - `.card-footer-row` ~line 1477: footer row with count + button

- `D:\views\AV Dashboard\config.json`
  - `sizeField`: `Microsoft.VSTS.Scheduling.Effort` (used for predictability effort calculation)
  - `plannedStretchField`: no longer needed (removed from snapshot capture)
  - `defectEscapeRatio.escapedStates` / `caughtStates`: used in defect delta calculation

</important_files>

<next_steps>

**Last request (not yet implemented):**
- User asked: "defects I should have density trend when starting PI and actual"
- This means: a **Defect Density Trend** chart in the Defects section showing per-PI:
  - **Baseline density** (at PI start) = from earliest snapshot for each PI: `defectCount / featureCount`
  - **Actual density** (live) = current live defect count / feature count per PI

**Planned implementation approach:**

1. **New server endpoint `GET /api/defect-density-trend?pis[]=...`**:
   - Read all snapshots from `listSnapshotFiles()`
   - For each requested PI, find the **earliest** snapshot covering that PI (sort by `capturedAt`)
   - Baseline density = `snapshot.data.defects.items.length / snapshot.data.features.items.length`
   - Live density: reuse `/api/pi-comparison` logic or fetch live counts per PI
   - Return: `[{ pi, baselineDensity, liveDensity, baselineLabel, baselineCapturedAt }]`

2. **HTML** — add new card in `#section-defects` after existing charts:
   ```html
   <div class="card mt-16" id="defectDensityTrendCard">
     <div class="card-header"><span class="card-title">📈 Defect Density Trend</span>
       <span class="card-sub">Snapshot baseline vs live · defects per feature</span></div>
     <div class="chart-wrap"><canvas id="defectDensityTrendChart"></canvas></div>
   </div>
   ```

3. **app.js** — add `loadDefectDensityTrend()` called from `renderDefectsSection()` and on team/PI filter change:
   - Grouped bar chart (Chart.js): X-axis = PIs, two bars per PI: "Baseline (Snapshot)" vs "Actual (Live)"
   - Colors: baseline = `#1492ff` (blue), actual = `#eb3f3f` (red) or `#068443` (green if improved)
   - If no snapshot exists for a PI, show only the live bar

**Blockers:**
- Need snapshots captured per-PI to show baseline. If no snapshots exist, only live bars shown.

</next_steps>