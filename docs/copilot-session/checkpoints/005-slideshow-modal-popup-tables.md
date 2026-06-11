<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme, built with Node.js/Express backend and Vanilla HTML/JS/CSS frontend using the Philips Filament dark-mode design system. This session focused on slideshow UX improvements (virtual pagination → popup modal approach), fixing the Team Health Scorecard missing `<table>` tag bug, and making ALL table data accessible exclusively via 📋 popup modals (hidden inline by default) rather than shown directly in sections.
</overview>

<history>
1. **User requested slideshow pagination for large tables**
   - Original plan: split features/defects sections into "charts" slides and paginated "table" slides using `slideshow-charts`/`slideshow-table` CSS wrapper divs
   - Added `SLIDESHOW_ROWS_PER_PAGE = 12`, dynamic `buildSlideshowSlides()`, `slideshow.slides[]` array, `slideshow.currentSlide`
   - Updated `renderFeatureTable(items, slideshowPage)` and `renderDefectTable(items, slideshowPage)` to accept page number
   - Added `slideshowPageIndicator` floating pill showing "Page X / Y"
   - Added CSS `.slideshow-mode-charts .slideshow-table { display:none }` and vice versa
   - HTML: wrapped chart zones in `<div class="slideshow-charts">` and table zones in `<div class="slideshow-table">` in both features and defects sections

2. **User reported Team Health Scorecard showing only headers, no data**
   - Root cause: `<table class="data-table">` opening tag was completely missing in `index.html` — only `<thead>` and `<tbody>` were present as orphaned elements inside `.table-wrap`
   - Fix: added `<table class="data-table" id="scorecardTable">` wrapping element

3. **User asked about the slideshow pagination (what happened to it)**
   - The implementation was interrupted by the scorecard bug fix
   - Confirmed the implementation was fully in place and working

4. **User requested popup modal approach instead of slideshow pagination**
   - Changed strategy: slideshow shows charts-only for all sections, tables accessible via 📋 button opening a full-screen modal
   - Simplified `buildSlideshowSlides()` to show `features` and `defects` as `mode: 'charts'` only (no table slides)
   - Added 📋 buttons to Feature Lifecycle and Defect Analysis section headers
   - Added `<div id="tableModal">` modal overlay in HTML
   - Added CSS `.table-modal-overlay`, `.table-modal-panel`, `.table-modal-header`, `.table-modal-body` etc.
   - Added `openTableModal(type)`, `closeTableModal()`, `handleModalOverlayClick()`, `buildModalTable()` in JS
   - Added `Escape` key handler to close modal

5. **User asked if modal applied to ALL tables**
   - Only Feature List and Defect List had it; 6 others did not
   - Added 📋 buttons to: Team Health Scorecard, Stale Features, Critical Defects, Compare Summary, PI-End Velocity, Sprint Summary
   - Refactored `openTableModal(type)` → `openTableModal(tableId, title)` using DOM clone approach
   - Removed `buildModalTable()` — clone approach works for all tables universally
   - Shows row count in modal title: `"🚀 Feature List · 47 rows"`

6. **User requested tables hidden by default — only visible in modal**
   - Strategy: add `.section-table-card { display: none !important; }` CSS class to all table cards
   - Remove `slideshow-charts`/`slideshow-table` wrapper divs (no longer needed)
   - All sections now show charts/KPIs only; tables exclusively via 📋 modal
   - **IN PROGRESS when compaction occurred** — partially completed:
     - Features section: removed `slideshow-charts` wrapper, added `section-table-card` to `staleFeaturesCard` and Feature List card, removed `slideshow-table` wrapper ✅
     - Defects section: still has slideshow wrappers, criticalDefectsCard and Defect List card need `section-table-card` class ❌
     - Executive (scorecard), Compare, Velocity, Sprint-trend cards: still need `section-table-card` class ❌
     - CSS rule not added yet ❌
     - JS simplification not done yet ❌
</history>

<work_done>
Files modified:

- `D:\views\AV Dashboard\public\index.html`
  - Added `<table class="data-table" id="scorecardTable">` to fix Team Health Scorecard
  - Added 📋 buttons to all 8 table card headers
  - Features section: removed `slideshow-charts` wrapper, added `section-table-card` to `staleFeaturesCard` and Feature List card ✅
  - Defects section: still has `slideshow-charts`/`slideshow-table` wrappers — NOT yet cleaned up ❌
  - `criticalDefectsCard` still missing `section-table-card` class ❌
  - Other section table cards (scorecard, compare, velocity, sprint-trend) still missing `section-table-card` class ❌
  - Added `<div id="tableModal">` modal overlay before `</body>`
  - Added `<div id="slideshowPageIndicator">` before `</body>`

- `D:\views\AV Dashboard\public\style.css`
  - Added `.table-modal-overlay`, `.table-modal-panel`, `.table-modal-header`, `.table-modal-body` etc.
  - Added `.slideshow-mode-charts .slideshow-table { display: none !important; }` and `.slideshow-mode-table .slideshow-charts { display: none !important; }` (now irrelevant but harmless)
  - Added `.slideshow-page-indicator` floating pill styles
  - **Missing: `.section-table-card { display: none !important; }` — NOT yet added** ❌

- `D:\views\AV Dashboard\public\app.js`
  - `buildSlideshowSlides()`: features and defects use `mode: 'charts'` (no table slides)
  - `showSlideshowSlide()`: applies `slideshow-mode-charts`/`slideshow-mode-table` CSS classes (can be simplified)
  - `stopSlideshow()`: cleans up mode classes
  - `activateSection()`: passes `ssPage` to renderFeaturesSection/renderDefectsSection (can be simplified to null)
  - `openTableModal(tableId, title)`: DOM clone approach, shows row count
  - `closeTableModal()`, `handleModalOverlayClick()`: close modal
  - `buildModalTable()`: REMOVED (replaced by DOM clone)
  - `renderFeatureTable(items, slideshowPage = null)`: pagination param (always null now)
  - `renderDefectTable(items, slideshowPage = null)`: pagination param (always null now)
  - `Escape` key handler added to `setupKeyboardShortcuts()`

Work completed:
- [x] Team Health Scorecard missing `<table>` tag fixed
- [x] Slideshow pagination implemented then replaced with modal approach
- [x] Modal popup implemented with clone approach for all 8 tables
- [x] 📋 buttons added to all table card headers
- [x] Features section slideshow wrappers removed, section-table-card added
- [ ] Defects section: remove `slideshow-charts`/`slideshow-table` wrappers, add `section-table-card`
- [ ] Executive/Compare/Velocity/Sprint-trend: add `section-table-card` to table cards
- [ ] CSS: add `.section-table-card { display: none !important; }`
- [ ] JS: simplify `buildSlideshowSlides()`, `showSlideshowSlide()`, `stopSlideshow()`, `activateSection()` (remove now-unused mode class logic)
</work_done>

<technical_details>
- **DOM clone approach for modal**: `$(tableId).cloneNode(true)` copies the fully-rendered table (with all styling, badges, colors). Works even when the table card is `hidden`/`display:none` because the element is still in DOM. Row count via `sourceTable.querySelectorAll('tbody tr').length`. Cloned element gets `id` attribute removed to avoid duplicates.

- **`section-table-card` strategy**: Using `display: none !important` on a CSS class wins over inline styles (including `card.style.display = 'block'`). This means `renderStaleFeatures()` which toggles `card.style.display` won't conflict — the CSS `!important` wins. The table DOM is still populated (JS runs regardless of visibility), so clone approach works correctly.

- **Team Health Scorecard bug**: The `<table>` opening tag was missing — only orphaned `<thead>` and `<tbody>` existed. Browser rendered headers as plain text, `renderTeamScorecard()` appended rows to `tbody#scorecardBody` but they weren't displayed as table rows. Fixed by adding `<table class="data-table" id="scorecardTable">`.

- **Slideshow mode classes**: `slideshow-mode-charts` and `slideshow-mode-table` classes are applied to section elements before `activateSection()` is called. `activateSection()` only toggles `active` class, leaving mode classes intact. These classes are now vestigial but harmless since `section-table-card` will handle hiding.

- **`renderStaleFeatures()` visibility toggle**: At line ~1723 in app.js, the function calls `card.style.display = 'none'` or `card.style.display = ''` to show/hide `staleFeaturesCard`. With `section-table-card { display: none !important }`, the inline style is overridden and card stays hidden. The badge count (`staleCount`) still updates correctly.

- **Modal tables needing pre-render**: Velocity, Compare, and Sprint-trend tables only populate when those sections are visited. If user clicks 📋 before visiting, `openTableModal` shows "Table not loaded yet" alert. This is acceptable behavior.

- **`slideshow.currentSlide` reference**: Used in `activateSection()` via `ssPage` logic. With the new approach (always null), this can be simplified but currently works (ssPage is always null since no table slides exist in `buildSlideshowSlides()`).

- **`[hidden]` CSS override**: The CSS reset includes `[hidden] { display: none !important; }` because Filament's flex/block display rules override the HTML `hidden` attribute otherwise. The modal uses `hidden` attribute toggled by JS, so this rule is critical.
</technical_details>

<important_files>
- `D:\views\AV Dashboard\public\index.html`
  - Main HTML shell: all sections, table cards, modal overlay, 📋 buttons
  - **Features section (lines ~380-453)**: wrapper divs removed ✅, but verify `section-table-card` on both cards
  - **Defects section (lines ~455-558)**: still has `slideshow-charts`/`slideshow-table` wrappers — needs cleanup ❌
  - **Executive section (~line 268)**: Team Health Scorecard card needs `section-table-card` ❌
  - **Compare section (~line 608)**: Summary Table card needs `section-table-card` ❌
  - **Velocity section (~line 687)**: PI-End Velocity card needs `section-table-card` ❌
  - **Sprint-trend section (~line 806)**: Sprint Summary card needs `section-table-card` ❌
  - **Modal (~line 827)**: `<div id="tableModal" class="table-modal-overlay" hidden>`

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend logic ~2500+ lines
  - `openTableModal(tableId, title)` (~line 2395): DOM clone, shows row count
  - `buildSlideshowSlides()` (~line 2497): needs simplification (remove charts/table modes)
  - `showSlideshowSlide()` (~line 2458): needs simplification (remove mode class logic)
  - `activateSection()` (~line 114): needs simplification (remove ssPage logic)
  - `renderStaleFeatures()` (~line 1715): toggles card display — harmless with CSS !important

- `D:\views\AV Dashboard\public\style.css`
  - **Missing: `.section-table-card { display: none !important; }`** — must be added ❌
  - `.table-modal-overlay` and related: modal styles present ✅
  - `.slideshow-mode-charts/.slideshow-mode-table` rules: present but becoming vestigial
  - `.slideshow-page-indicator`: floating page pill (may become unused)
</important_files>

<next_steps>
Remaining work to complete the "tables hidden by default, popup only" feature:

**1. HTML — Defects section cleanup** (`index.html` ~lines 462-558):
- Remove `<div class="slideshow-charts">` opening (line ~462) and `</div><!-- /.slideshow-charts -->` closing (line ~513)
- Add `section-table-card` to `criticalDefectsCard`: `<div class="card mt-16 section-table-card" id="criticalDefectsCard">`
- Remove `<div class="slideshow-table">` opening and `</div><!-- /.slideshow-table -->` closing
- Add `section-table-card` to Defect List card: `<div class="card mt-16 section-table-card">`

**2. HTML — Other sections** (`index.html`):
- Executive: `<div class="card mt-16">` containing `👥 Team Health Scorecard` → add `section-table-card`
- Compare: `<div class="card mt-16">` containing `Summary Table` → add `section-table-card`
- Velocity: `<div class="card mt-16">` containing `🏁 PI-End Velocity Summary` → add `section-table-card`
- Sprint-trend: `<div class="card mt-16">` containing `Sprint Summary` → add `section-table-card`

**3. CSS** (`style.css`):
- Add after `.slideshow-page-indicator` or at end of slideshow section:
  ```css
  /* Tables always hidden in sections — accessible via 📋 modal only */
  .section-table-card { display: none !important; }
  ```

**4. JS simplification** (`app.js`) — optional cleanup, not functionally critical:
- `buildSlideshowSlides()`: change `features`/`defects` from `mode: 'charts'` to `mode: 'full'`, return simple flat array
- `showSlideshowSlide()`: remove `$$('.section').forEach(s => s.classList.remove('slideshow-mode-charts', 'slideshow-mode-table'))` and mode class setting block
- `stopSlideshow()`: remove `$$('.section').forEach(...)` mode class cleanup line
- `activateSection()`: remove `ssPage` constant and pass `null` directly (or remove tablePage param from renderFeaturesSection/renderDefectsSection)
</next_steps>