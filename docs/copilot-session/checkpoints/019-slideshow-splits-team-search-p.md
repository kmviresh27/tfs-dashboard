<overview>
This session focused on UX and slideshow improvements to the AV Dashboard (Node.js/Express + Vanilla HTML/JS/CSS, Filament dark theme). Work covered: (1) adding a search box to the team filter dropdown for easier nested team navigation, (2) splitting the Teams section in slideshow into multiple slides based on screen-width (preventing scroll), (3) fixing PI Readiness Checks card not appearing in slideshow, (4) splitting Velocity into 2 slides, and (5) moving the PI Readiness Checks card from the Features section to the Programme Health (Executive) section.
</overview>

<history>

1. **User: Team dropdown needs a search box — navigating nested tree is difficult**
   - Added `<input class="tf-search-input" id="teamFilterSearch">` and `<div id="teamFilterSearchResults">` into `#teamFilterPanel` in `index.html`
   - Rewrote `setupTeamFilter()` in `app.js` to: auto-focus search on open, filter flat list while typing with highlighted match + breadcrumb path, show full tree when query cleared, handle `Escape` key, prevent panel close when clicking inside search
   - Added CSS: `.tf-search-wrap`, `.tf-search-input`, `.tf-result-row`, `.tf-result-name`, `.tf-result-path`, `.tf-no-results`, `mark.tf-result-match`
   - Bumped `tf-panel` max-height from 380px to 420px

2. **User: Teams page in slideshow has scroll — split based on number of teams**
   - Added `const SLIDESHOW_TEAMS_PER_PAGE = 6` (later replaced by dynamic function)
   - Added `data-teams-group="1"` to charts grid in `index.html`
   - Updated `renderTeamCards` to assign `data-teams-group="N"` (group 2+) based on index
   - Added `teams` to `showSlideshowGroup` and `clearSlideshowGroups` attrMaps
   - Added `clearSlideshowGroups('teams')` to `stopSlideshow()`
   - Updated `buildSlideshowSlides()` to dynamically compute team card pages from actual team count

3. **User: At least two rows should be in each slide**
   - Replaced `SLIDESHOW_TEAMS_PER_PAGE` constant with `getTeamsPerPage()` function
   - `getTeamsPerPage()` computes cols from `(innerWidth - 92) / 274` (260px card + 14px gap), returns `cols * 2`
   - `renderTeamCards` uses `getTeamsPerPage()` for group assignment
   - `buildSlideshowSlides()` uses `tpp = getTeamsPerPage()` at slideshow start time

4. **User: 3 rows also possible max**
   - Changed `cols * 2` → `cols * 3` in `getTeamsPerPage()`

5. **User: PI Readiness card not showing in slideshow**
   - Root cause: card had `data-feat-group="table"` — never matched by numeric groups
   - Fixed by changing to `data-feat-group="3"` and adding a 3rd features slide in `buildSlideshowSlides()`: `{ section: 'features', mode: 'group', group: 3, label: '🚀 Features — PI Readiness Checks', chartPage: 3, chartTotal: 3 }`

6. **User: Velocity also needs to split in slideshow**
   - Changed `data-vel-group` in `index.html`:
     - PI summary cards + sprint charts: group 1 (unchanged)
     - Velocity trend chart: group 2 (was group 1)
     - PI-end summary table: group 3 (was group 1)
   - Updated `buildSlideshowSlides()` to 3 velocity slides

7. **User: Velocity trend and table can be on single slide**
   - Changed PI-end summary table back to `data-vel-group="2"` 
   - Reduced to 2 velocity slides: `{ group: 1, '⚡ Velocity — PI Summary & Sprint Charts' }`, `{ group: 2, '⚡ Velocity — Trend & PI-End Summary' }`

8. **User: Move PI Readiness to Overview or Programme Health**
   - Decided: Programme Health (Executive section) is the right home
   - Moved entire PI Readiness card HTML block from Features section to Executive section with `data-exec-group="2"`
   - Removed old block from Features section; reverted features back to 2 slides
   - Moved `fetchPIChecks()` call from `renderFeaturesSection` to `renderExecutiveSection`
   - Updated team-filter re-fetch from `section-features` to `section-executive`
   - Was in the middle of updating `buildSlideshowSlides()` for executive groups when compaction triggered

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\public\index.html`
  - Team filter panel: added search input + results div inside `#teamFilterPanel`
  - Teams section: added `data-teams-group="1"` to charts grid
  - Velocity section: `data-vel-group` split: group 1 (summary+charts), group 2 (trend+table)
  - Executive section: added PI Readiness card block with `data-exec-group="2"` before `</section>`
  - Features section: removed PI Readiness card block

- `D:\views\AV Dashboard\public\app.js`
  - `setupTeamFilter()` fully rewritten with search capability
  - `SLIDESHOW_TEAMS_PER_PAGE` constant removed; replaced with `getTeamsPerPage()` function (cols × 3, min 6)
  - `renderTeamCards()`: added `teamIdx` counter, sets `data-teams-group` per card
  - `showSlideshowGroup()` + `clearSlideshowGroups()`: added `'teams': 'data-teams-group'` entry
  - `stopSlideshow()`: added `clearSlideshowGroups('teams')`
  - `buildSlideshowSlides()`: dynamic team slides; features = 2 slides; velocity = 2 slides
  - `renderFeaturesSection`: `fetchPIChecks()` call removed (commented out)
  - `renderExecutiveSection`: `fetchPIChecks()` added after scorecard render
  - Team-filter re-fetch: changed `section-features` → `section-executive` for `fetchPIChecks(true)`

- `D:\views\AV Dashboard\public\style.css`
  - Added `.tf-search-wrap`, `.tf-search-input`, `.tf-result-row`, `.tf-result-name`, `.tf-result-path`, `.tf-no-results`, `mark.tf-result-match`
  - `tf-panel` max-height: 380px → 420px

**Current state:**
- ✅ Team filter search working
- ✅ Teams slideshow splits by screen width (3 rows per slide)
- ✅ Velocity split into 2 slides
- ✅ Features back to 2 slides (no PI Readiness)
- ✅ PI Readiness card moved to Executive section HTML + JS
- ⚠️ `buildSlideshowSlides()` still has `executive` as `mode: 'full'` — needs splitting into group 1 (health + scorecard) and group 2 (PI Readiness). **This was in progress when compaction hit.**

</work_done>

<technical_details>

**Team filter search — flat results from tree:**
- Tree nodes have `data-tf-val="ROOT:Healthcare IT\ICAP\ISP\Hercules\Avyay"` format
- Search filters tree's `[data-tf-val]` elements (skips empty `data-tf-val=""` = All Teams)
- Breadcrumb derived from the absolute path: strips `ROOT:` prefix, splits by `\`, shows all segments except last as `A › B › C` path
- Match highlighting uses `String.replace(/(query)/gi, '<mark>$1</mark>')`

**Slideshow group system:**
- Each section has its own `data-*-group` attribute: `data-feat-group`, `data-def-group`, `data-vel-group`, `data-tc-group`, `data-teams-group`, `data-exec-group`
- `showSlideshowGroup(section, N)` hides all elements in the section that don't match group N
- `clearSlideshowGroups(section)` restores all to visible
- Elements with `data-feat-group="table"` are intentionally excluded from slideshow (raw table views)
- When a new section is entered during slideshow (`currentSection !== slide.section`), `clearSlideshowGroups` is called on the previous section automatically

**`getTeamsPerPage()` formula:**
```javascript
const contentWidth = (window.innerWidth || 1280) - 92;
const cols = Math.max(1, Math.floor((contentWidth + 14) / 274)); // 260px card + 14px gap
return Math.max(cols * 3, 6); // 3 rows; floor at 6
```
- Called at `buildSlideshowSlides()` time (not card render time) for consistent page sizing per slideshow session
- Also called in `renderTeamCards()` for group assignment — these should stay in sync

**PI Readiness location:**
- Was in Features section, triggered by `renderFeaturesSection()`
- Moved to Executive (Programme Health) section, now triggered by `renderExecutiveSection()`
- `fetchPIChecks(force)` has its own key-based caching (`state.piChecksKey`) so it won't re-fetch unless PI or team changes
- `activateSection('executive')` already calls `renderExecutiveSection(view)`, so it auto-loads on nav

**Executive section slideshow — INCOMPLETE:**
- Currently `slides.push({ section: 'executive', mode: 'full' })` — shows everything at once
- Needs to be split: group 1 (health hero + committed/done + KPI strip + scorecard), group 2 (PI Readiness)
- The HTML already has `data-exec-group="2"` on the PI Readiness card
- The health hero, committed/done card, KPI strip, and scorecard do NOT yet have `data-exec-group` attributes — they need `data-exec-group="1"` added

**Server:**
- Running as background node process on port 3000
- Last known PID: 64300 (may have changed)

</technical_details>

<important_files>

- `D:\views\AV Dashboard\public\app.js`
  - Main frontend logic (~4800+ lines)
  - `setupTeamFilter()` ~line 3160: fully rewritten with search
  - `getTeamsPerPage()` ~line 3418: dynamic teams-per-slide calculation
  - `renderTeamCards()` ~line 1376: assigns `data-teams-group` per card
  - `buildSlideshowSlides()` ~line 3636: defines all slideshow slides — NEEDS exec group update
  - `showSlideshowGroup()` / `clearSlideshowGroups()` ~line 3550: now includes `teams` and `exec` attrMap entries (exec added partially)
  - `renderExecutiveSection()` ~line 1820: now calls `fetchPIChecks()`
  - `fetchPIChecks()` ~line 677: fetches and renders PI Readiness Checks

- `D:\views\AV Dashboard\public\index.html`
  - Executive section (~line 222–370): contains health hero, scorecard, and now PI Readiness card
  - PI Readiness card: `data-exec-group="2"` — ready for slideshow group
  - Health hero `#healthHero`, `#committedVsDoneCard`, `#execKpiStrip`, scorecard card: need `data-exec-group="1"` added
  - Velocity section (~line 862–910): split into groups 1 and 2
  - Teams section (~line 788–804): charts have `data-teams-group="1"`, cards get dynamic groups

- `D:\views\AV Dashboard\public\style.css`
  - Team search styles added ~line 1270 (before `.tf-wrap`)

</important_files>

<next_steps>

**Immediate — Executive slideshow split (was in progress):**

1. **`index.html`** — add `data-exec-group="1"` to the executive section elements that should show on slide 1:
   - `<div class="health-hero" id="healthHero">` → add `data-exec-group="1"`
   - `<div class="card mt-16" id="committedVsDoneCard">` → add `data-exec-group="1"`
   - `<div class="kpi-strip exec-kpi-strip" id="execKpiStrip">` → add `data-exec-group="1"`
   - `<div class="card mt-16 section-table-card">` (scorecard) → add `data-exec-group="1"`

2. **`app.js` `buildSlideshowSlides()`** — replace:
   ```javascript
   slides.push({ section: 'executive', mode: 'full' });
   ```
   with:
   ```javascript
   slides.push({ section: 'executive', mode: 'group', group: 1, label: '🏆 Programme Health — Score & Scorecard', chartPage: 1, chartTotal: 2 });
   slides.push({ section: 'executive', mode: 'group', group: 2, label: '🏆 Programme Health — PI Readiness Checks', chartPage: 2, chartTotal: 2 });
   ```

3. **`app.js` `showSlideshowGroup()` and `clearSlideshowGroups()`** — verify `'executive': 'data-exec-group'` is in both attrMaps (may have been partially added).

4. **`app.js` `stopSlideshow()`** — add `clearSlideshowGroups('executive')`.

</next_steps>