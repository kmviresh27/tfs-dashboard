<overview>
This session focused on polishing and improving the KPI Tracker section of the AV Dashboard (Node.js + React, on-premise TFS). The main goals were: fixing broken shared component wiring (from prior session), fixing a settings cache invalidation bug, and improving UX by reducing page scroll through compact layouts, view toggles, and moving secondary content to popups. All changes centered on `client/src/sections/KPISection.jsx` and `client/src/sections/SettingsSection.jsx`.
</overview>

<history>

1. **Resuming from broken state — wiring shared annotation/copy components**
   - Prior session had deleted custom `ChartActionBar`/`ChartNote` helpers but left `KPIScoreBar` and `TeamRadar` still referencing them → build failure
   - Fixed `KPIScoreBar`: removed `chartRef`/`note` state, added `data-copy-scope` wrapper, replaced action bar with `<div className="card-actions"><AnnotationButton onClick={onNote} /><CopyButton type="chart" /></div>`, added `onNote` prop
   - Fixed `TeamRadar`: same pattern, added custom SVG grid button for heatmap alongside `AnnotationButton` + `CopyButton`, removed `useRef` from imports
   - Added `annPopup` state + `openAnnPopup()` helper + `useAnnotations` call + `<ChartAnnotations>` at bottom of `KPISection` main component
   - Wired `onNote` callbacks to both charts, passing `filteredKpis.map(getShortLabel)` as sprints to bar chart, empty array to radar
   - Build passed, server restarted (PID 52612)

2. **"Impacts not updated if any field mapping" + "Leading/Lagging taking lot of space"**
   - **Settings cache bug**: `KpiConfigTab.saveKpiConfig` only invalidated `['config']` query after saving; `useKPI` has 15-min staleTime so KPI data stayed stale. Added `await queryClient.invalidateQueries({ queryKey: ['kpi'] })` after the config save
   - **Compact list view**: Added `KPIListRow` component (2-column grid layout, `~64px` per row) with: RAG-colored left border, name + type pill + group badge, inline progress bar, value/target display, TFS ✓/✗ links. Added `viewMode` state defaulting to `'list'` (persisted in `localStorage` with key `kpi-view-mode`). Added `☰ List` / `⊞ Cards` toggle buttons right-aligned in the group filter row. In list mode: one unified list (no separate Leading/Lagging sections). In cards mode: original two-section grid unchanged
   - Build passed, server restarted (PID 55028)

3. **"too much scroll since you added kpis one below another"**
   - Changed list container from `flex-direction: column` to `display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr))` — gives 2 columns on typical wide screen, halving vertical space (15 KPIs = 8 rows ≈ 512px)
   - Build passed, server restarted (PID 1640)

4. **"Delivery - Requirements Clarity and Prerequisites... better move to popup on click of icon"**
   - Added `showInfo` state to `KPISection`
   - Added circular `i` button (22×22px, `border-radius: 50%`) next to heading and KPI count badge
   - Created a full-screen overlay popup modal (`zIndex: 3000`) containing both blocks side by side with scrollable body
   - Removed both blocks from the inline page body (they only exist in the popup now)
   - Build passed, server restarted (PID 55680)

5. **"KPIs Numbers divs and RAG Health taking lot of space"**
   - Redesigned `SummaryBar` from large format (6 tiles at `minHeight: 84px` + 180×180px donut = ~100px total height) to compact single horizontal strip (~60px):
     - Mini 44×44px donut with `overallScore%` text centered inside
     - Vertical dividers
     - 4 compact RAG badge-pills (On Track / At Risk / Off Track / No Data) with count + label in `~32px` pill
     - Leading/Lagging count text
   - **Build not yet run** — edit was made but session ended before build/restart

</history>

<work_done>

Files modified:
- `client/src/sections/KPISection.jsx` — all UI changes; last edit (SummaryBar compaction) **not yet built**
- `client/src/sections/SettingsSection.jsx` — added `queryClient.invalidateQueries({ queryKey: ['kpi'] })` in `saveKpiConfig`

Work completed:
- [x] Fixed broken `KPIScoreBar` and `TeamRadar` (replaced deleted helpers with shared `AnnotationButton`, `CopyButton`, `ChartAnnotations`)
- [x] Fixed KPI cache not invalidating when settings saved
- [x] Added compact `KPIListRow` component (2-col grid)
- [x] Added `☰ List` / `⊞ Cards` view toggle (localStorage-persisted)
- [x] Moved "Delivery - Requirements Clarity" and "Prerequisites" blocks to `i` popup
- [x] Added `showInfo` state + info popup modal
- [ ] **PENDING BUILD**: `SummaryBar` redesign (compact strip) — edit applied but `npm run build` not yet run, server not restarted

</work_done>

<technical_details>

- **`useKPI` staleTime = 15 min**: This is intentional (relation fetches are expensive) but means settings changes don't reflect until explicit invalidation. Fix: always call `queryClient.invalidateQueries({ queryKey: ['kpi'] })` after any config save that affects KPI computation (tags, attachment keywords, targets)

- **`loadConfig()` reads from disk on every request**: No server-side caching of config — so server always uses latest `config.json` values. The 15-min stale issue is purely client-side React Query cache

- **`data-copy-scope` attribute**: `CopyButton` walks up the DOM to find the nearest `.card` or `[data-copy-scope]` ancestor, then calls `container.querySelector('canvas')` to find the chart canvas. KPI chart wrappers don't have `.card` class so `data-copy-scope` (no value needed, just presence) must be on the wrapper div

- **`ChartAnnotations` section naming**: Bar chart uses `section='kpi'`, radar chart uses `section='kpi-radar'`. Sprints array = KPI short labels for bar chart (used as axis identifiers), empty array for radar (shows free-text input)

- **`viewMode` localStorage key**: `'kpi-view-mode'`, values `'list'` | `'cards'`, defaults to `'list'`

- **`KPIListRow` click propagation**: TFS link `<a>` elements need `onClick={e => e.stopPropagation()}` (wrapped in a `role="presentation"` div) to prevent opening the detail modal when clicking TFS links

- **`SummaryBar` before/after**: Before = 6 tiles (`minHeight: 84`) + 180px donut in separate container ≈ 100–120px total height. After = single flex row with 44px mini donut + badge pills ≈ 48–60px total height. Score % shown inside mini donut center at `fontSize: 10`

- **`--surface` CSS variable**: Used throughout `KPISection` but not defined in `main.css` (only `--surface-1` and `--surface-2` exist as aliases of `--bg-card`/`--bg-card2`). Cards fall back to `transparent`. This is a known issue not yet fixed — affects ProgressBar track visibility

- **Server restart pattern**: Kill all node processes with `foreach ($p in $procs) { Stop-Process -Id $p.Id -Force }` then `Start-Process node -ArgumentList "server.js"` with redirected stdout/stderr to `server.log`/`server-err.log`

- **`KpiConfigTab` also needs fieldMappings invalidation**: The fieldMappings tab save at line ~974 does `queryClient.invalidateQueries({ queryKey: ['config'] })` and a full flush at line ~1052. Only `kpiConfig` tab save was missing the `['kpi']` invalidation — now fixed

</technical_details>

<important_files>

- **`client/src/sections/KPISection.jsx`**
  - Core file for all KPI UI — all charts, cards, list rows, modals, popups
  - **Last edit** (SummaryBar compaction, ~line 707–795) not yet built
  - Key sections:
    - Imports: lines 1–24 (includes `CopyButton`, `ChartAnnotations`, `AnnotationButton`, `useAnnotations`)
    - `ProgressBar`: ~321
    - `KPICard`: ~521
    - `KPIListRow`: ~610 (new compact row component)
    - `SummaryBar`: ~707 (just redesigned to compact strip — **needs build**)
    - `KPIScoreBar`: ~798 (uses `data-copy-scope`, `card-actions`, `AnnotationButton`, `CopyButton`)
    - `TeamRadar`: ~880 (same pattern + custom heatmap button)
    - `KPISection` main export: ~1067 (states: `activeGroup`, `selectedKpiId`, `showHeatmap`, `annPopup`, `viewMode`, `showInfo`)
    - Group filter + view toggle row: ~1203
    - List/Cards conditional render: ~1265
    - Heatmap popup modal: ~1310
    - Info popup modal (`showInfo`): ~1407

- **`client/src/sections/SettingsSection.jsx`**
  - Settings page — `KpiConfigTab` saves KPI config (tags, attachment keywords, targets)
  - **Change**: `saveKpiConfig` (line ~382) now also calls `queryClient.invalidateQueries({ queryKey: ['kpi'] })` to bust the 15-min KPI cache after saving

- **`client/src/components/ui/CopyButton.jsx`**
  - Shared copy-to-clipboard + fullscreen expand button
  - DOM-walk pattern: finds canvas via `.card` or `[data-copy-scope]` ancestor
  - No changes needed

- **`client/src/components/ui/ChartAnnotations.jsx`**
  - Shared annotation popup + `AnnotationButton` SVG pencil icon export
  - Persists notes to `/api/annotations`; `useAnnotations` hook fetches them back
  - No changes needed

- **`client/src/api/hooks.js`**
  - Contains `useKPI(pi, team)` hook at line ~328 with `staleTime: 15 * 60 * 1000`
  - Contains `useAnnotations(section, pi, team)` hook
  - No changes made

- **`src/routes/kpi.js`**
  - Backend KPI computation — reads `loadConfig()` fresh on every request (no server caching)
  - Reads `cfg.kpi.attachmentKeywords.impact` etc. for keyword matching
  - No changes made

</important_files>

<next_steps>

**Immediate — must do first:**
1. **Build and restart server** for the `SummaryBar` compact strip change:
   ```powershell
   cd "D:\views\AV Dashboard\client"; npm run build 2>&1 | Select-Object -Last 10
   # then restart node
   ```

**Known unfixed issue:**
- **`--surface` CSS variable undefined**: Used throughout `KPISection` (card backgrounds, input styles) but not defined in `main.css`. Only `--surface-1: var(--bg-card)` and `--surface-2: var(--bg-card2)` exist. Fix: add `--surface: var(--bg-card)` to `:root` in `main.css`. This also causes `ProgressBar` track to be transparent (very subtle against dark background).

**No other pending user requests at time of compaction.**

</next_steps>