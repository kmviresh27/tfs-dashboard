<overview>
This session focused on a series of UX polish and layout fixes for the KPI Tracker section of the AV Dashboard (Node.js + React, on-premise TFS). The user was iteratively improving the KPI page's visual density, consistency, and professionalism. The main themes were: removing unnecessary padding across sections, resizing the RAG health donut, fixing a missing loading indicator, redesigning the KPI card/list layout from scratch, and fixing a grid corruption bug caused by native browser fullscreen API.
</overview>

<history>

1. **Build and restart server** (pending from prior session)
   - The `SummaryBar` compaction edit had been applied but not built
   - Ran `npm run build` — succeeded; restarted Node server (PID 42696)

2. **"padding: 24px is not required for KPI section first div"**
   - Found `padding: 24` on the outer `<div>` in all three KPI render paths: loading state, error state, and main return
   - Removed `style={{ padding: 24 }}` from all three root divs in `KPISection.jsx`
   - Built and restarted server (PID 43796)

3. **"in health page padding: 16px 24px not required"**
   - Found `padding: '16px 24px'` on the root div in `HealthSection.jsx` line 312
   - Removed the padding property, left other styles intact
   - Built and restarted (PID 26796)

4. **"for RAG health keep width and height 100px instead of 44px"**
   - Found the mini donut at `width: 44, height: 44` in `SummaryBar` component (~line 757 of KPISection.jsx)
   - Changed to `width: 100, height: 100`; bumped center label `fontSize` from 10 to 13
   - Also bumped strip padding from `'8px 14px'` to `'10px 14px'` to accommodate taller donut
   - Built and restarted (PID 31580)

5. **"loading indicator not coming when loading data in kpi page"**
   - Root cause: `isLoading` only fires on first-ever load (no cached data); React Query's 15-min staleTime means subsequent visits return cached data instantly — neither `isLoading` nor the existing tiny `isFetching` spinner (14×14px) was noticed
   - **Fix 1**: Added `import { PageLoader } from '../components/ui/PageLoader.jsx'` to KPISection
   - **Fix 2**: Replaced the custom inline skeleton block with `<PageLoader label="Loading KPI data…" />` for `isLoading`
   - **Fix 3**: Replaced the tiny 14×14px `isFetching` spinner with a full-width animated progress bar (3px tall blue sliding bar) + "⟳ Refreshing KPI data…" text label below the page header
   - Added `@keyframes kpi-loading-bar` to `main.css` (sliding animation: 0→60%→100% travel)
   - Built and restarted (PID 54656)

6. **"I am still not convinced with KPI cards vs list" + "think like 25 years UX developer"**
   - **Analysis**: The toggle was a design smell — neither view was optimal. Cards were 156px tall with wasted whitespace. List rows had misaligned columns. Leading/Lagging separation was arbitrary (users scan by risk, not indicator type).
   - **Decision**: Kill the toggle entirely. One decisive layout — compact metric tiles grouped by domain, sorted by RAG (red-first within each group).
   - **Changes to KPISection.jsx**:
     - Removed `KPIListRow` component entirely
     - Redesigned `KPICard` into a compact ~96px tile: name (12px bold, ellipsis) + TFS links in row 1; big value (28px, RAG color) + RAG/type pills stacked right in row 2; progress bar + target label in row 3; hover state with subtle background lift
     - Removed `viewMode` state and `setViewMode` function
     - Removed `leadingKpis`/`laggingKpis` derived variables
     - Added `RAG_ORDER` constant `{ red: 0, amber: 1, green: 2, unknown: 3 }`
     - Added `GROUP_ORDER` array `['quality', 'process', 'change', 'ai']`
     - Added `groupedKpis` useMemo: groups KPIs by domain with RAG sort within each group; handles `activeGroup !== 'all'` case; appends ungrouped KPIs under 'Other'
     - Replaced cards/list conditional render with group-header + tile-grid render: thin domain divider (icon + label + count + desc), then `repeat(auto-fill, minmax(200px, 1fr))` grid of `KPICard` tiles
     - Removed the List/Cards toggle buttons from the group filter row
     - Removed the standalone `activeGroup !== 'all'` group header block (now inline in the grouped render)
   - Built and restarted (PID 54848)

7. **"KPI Values vs Target when I expand and collapse it's taking full width so Team Coverage Radar will be hidden"**
   - **Root cause**: `CopyButton`'s expand function called `card.requestFullscreen()` (native browser fullscreen API) on the `[data-copy-scope]` grid child. When exiting fullscreen (`exitFullscreen()` or Esc), Chromium has a known bug where the grid item can retain or temporarily expand to full width, hiding adjacent grid columns (i.e., the TeamRadar at 420px)
   - **Fix**: Replaced native `requestFullscreen`/`exitFullscreen` in `CopyButton.jsx` with a CSS class toggle approach:
     - On expand: `card.classList.add('chart-expanded')` + `setIsExpanded(true)`
     - On collapse: `card.classList.remove('chart-expanded')` + `setIsExpanded(false)`
     - Removed `useEffect` for `fullscreenchange` event listener (no longer needed)
     - Removed `useEffect` import
     - The `.chart-expanded` CSS class needs to be added to `main.css` (using `position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9000`) — **this CSS was not yet added and not yet built**

</history>

<work_done>

Files modified:
- `client/src/sections/KPISection.jsx` — padding removed; PageLoader added; loading bar added; KPICard redesigned; KPIListRow removed; toggle removed; groupedKpis logic added; grouped tile render added
- `client/src/sections/HealthSection.jsx` — removed `padding: '16px 24px'` from root div
- `client/src/styles/main.css` — added `@keyframes kpi-loading-bar` keyframe
- `client/src/components/ui/CopyButton.jsx` — replaced `requestFullscreen` with CSS class toggle (`chart-expanded`); removed `useEffect`/`fullscreenchange` listener

Work completed:
- [x] Removed padding from KPI section root divs (all 3 states)
- [x] Removed padding from Health section root div
- [x] Resized RAG health donut to 100×100px
- [x] Fixed loading indicator: `PageLoader` for `isLoading`, animated bar for `isFetching`
- [x] Redesigned KPI view: removed toggle, compact tiles, domain groups, RAG-sorted
- [x] Fixed CopyButton to use CSS class toggle instead of native fullscreen API

**PENDING — NOT YET BUILT:**
- [ ] Add `.chart-expanded` CSS rule to `main.css`:
  ```css
  .chart-expanded {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 9000;
    overflow: auto;
    background: var(--bg-card);
    padding: 24px;
  }
  ```
- [ ] Build (`npm run build`) and restart server after adding CSS

</work_done>

<technical_details>

- **Native `requestFullscreen` on CSS grid children is broken in Chromium**: When a grid child calls `requestFullscreen()`, it goes fullscreen fine. On exit (`exitFullscreen()` or Esc), Chromium may leave the element with incorrect width, causing it to span the full grid width and hide sibling columns. Fix: use CSS `position: fixed` overlay via a class toggle instead — the element stays in the DOM flow so the grid is never affected.

- **`isLoading` vs `isFetching` in React Query**: `isLoading` = true only when `status === 'pending'` AND `fetchStatus === 'fetching'` (i.e., no cached data at all, first ever load). After first load with staleTime=15min, subsequent page visits return cached data instantly — `isLoading` never fires again. `isFetching` = true on any background refetch. Both need visible indicators; `isFetching` needs to be prominent enough to notice.

- **`@keyframes kpi-loading-bar`**: The sliding progress bar animation added to `main.css`. Uses `margin-left` + `width` to create a traveling shimmer effect: `0% { width:0%; margin-left:0 }`, `50% { width:60%; margin-left:20% }`, `100% { width:0%; margin-left:100% }`. Applied to the inner div of a 3px-tall track div.

- **`groupedKpis` memo structure**: Returns array of `{ id, meta, kpis }`. When `activeGroup !== 'all'`, returns single-element array for that group (filtered KPIs, RAG-sorted). When `activeGroup === 'all'`, returns all groups in `GROUP_ORDER` order plus any ungrouped KPIs. `filteredKpis` (group-filtered) is passed to `KPIScoreBar` and `TeamRadar` but `allKpis` is used for group construction when `activeGroup === 'all'`.

- **`ValueDisplay` component is now unused**: After the KPICard redesign, `ValueDisplay` (which was used in the old card) is no longer called anywhere. It remains in the file as dead code — safe to remove later.

- **`--surface` CSS variable is undefined**: Used throughout KPISection (card backgrounds, inputs) but only `--surface-1: var(--bg-card)` and `--surface-2: var(--bg-card2)` exist in `main.css`. Cards fall back to transparent. This is a known unfixed issue that slightly affects ProgressBar track visibility.

- **KPICard `onOpen` pattern**: Old `KPICard` passed `kpi` object as arg to `onOpen(kpi)`. New compact tile calls `onOpen?.()` with no args. `setSelectedKpiId(kpi.id)` is passed as the callback so no argument needed.

- **Group filter buttons still use `filteredKpis`** for KPIScoreBar/TeamRadar charts (correct — shows filtered view in charts). But tile grid uses `allKpis` via `groupedKpis` (which re-groups `allKpis`, not `filteredKpis`, when `activeGroup === 'all'`). This is intentional: when "All" is selected, all groups show; when a specific group is selected, `groupedKpis` uses `filteredKpis` (already group-filtered).

- **Server restart pattern**: `foreach ($p in $procs) { Stop-Process -Id $p.Id -Force }` then `Start-Process node -ArgumentList "server.js"` with stdout/stderr redirected to `server.log`/`server-err.log`.

</technical_details>

<important_files>

- **`client/src/sections/KPISection.jsx`**
  - Core file for all KPI UI — all charts, tiles, modals, popups
  - Major changes this session: padding removed, PageLoader added, loading bar, KPICard redesign, KPIListRow removed, toggle removed, groupedKpis logic, grouped tile render
  - Key sections:
    - Imports: lines 1–26 (includes `PageLoader`)
    - `GROUP_META`: line 42
    - `RAG_STYLE`, `TYPE_BADGE`: lines 49–59
    - `ProgressBar`: ~line 322
    - `KPICard` (new compact tile): ~line 522
    - `ValueDisplay` (now dead code): ~line 343
    - `SummaryBar` (100px donut): ~line 708
    - `KPIScoreBar`: ~line 696
    - `TeamRadar`: ~line 789
    - Main export `KPISection`: ~line 957
    - `RAG_ORDER`, `GROUP_ORDER`, `groupedKpis` memo: ~lines 1006–1023
    - Group filter buttons row: ~line 1103
    - Chart grid (KPIScoreBar + TeamRadar): ~line 1130
    - Grouped tile render: ~line 1148

- **`client/src/sections/HealthSection.jsx`**
  - Health overview section
  - Change: removed `padding: '16px 24px'` from root div (line 312)

- **`client/src/styles/main.css`**
  - Global styles
  - Change: added `@keyframes kpi-loading-bar` after `@keyframes spin` (lines 6–11)
  - **Pending**: needs `.chart-expanded` CSS rule for CopyButton expand feature

- **`client/src/components/ui/CopyButton.jsx`**
  - Shared copy-to-clipboard + chart expand button used across all chart cards
  - Change: replaced `requestFullscreen`/`exitFullscreen` with `classList.add/remove('chart-expanded')`; removed `useEffect`/`fullscreenchange` listener; `isFullscreen` state renamed to `isExpanded`
  - **The `.chart-expanded` CSS class does not yet exist in `main.css`** — expand button works (toggles class) but chart won't visually expand until CSS is added

- **`client/src/components/ui/PageLoader.jsx`**
  - Shared full-page loading spinner component
  - No changes — just imported and used in KPISection

</important_files>

<next_steps>

**Immediate — must do first:**

1. Add `.chart-expanded` CSS to `main.css` so the expand button actually works:
   ```css
   .chart-expanded {
     position: fixed;
     top: 0;
     left: 0;
     right: 0;
     bottom: 0;
     z-index: 9000;
     overflow: auto;
     background: var(--bg-card);
     padding: 24px;
   }
   ```

2. Build and restart server:
   ```powershell
   cd "D:\views\AV Dashboard\client"; npm run build 2>&1 | Select-Object -Last 8
   # then restart node
   ```

**Known unfixed issues:**
- `ValueDisplay` component in KPISection.jsx is now dead code (no longer used after KPICard redesign) — safe to remove
- `--surface` CSS variable is undefined in `main.css` — only `--surface-1` and `--surface-2` exist. Affects ProgressBar track and card backgrounds slightly.

</next_steps>