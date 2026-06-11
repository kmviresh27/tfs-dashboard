<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme, built with Node.js/Express backend and Vanilla HTML/JS/CSS frontend using the Philips Filament dark-mode design system. This session focused on: completing the "tables hidden by default, popup modal only" feature; fixing the velocity auto-load; adding 6 new metrics (defect aging, feature slip, throughput, injection rate, found-in, WIP); adding card zoom/expand functionality; fixing UI issues (team filter text contrast, sprint velocity empty charts using ChangedDate instead of IterationPath). The user also asked to audit all date range queries in the backend.
</overview>

<history>
1. **Completing tables-hidden-by-default feature** (was in-progress at compaction)
   - Removed stray `slideshow-charts`/`slideshow-table` wrappers from Defects section in HTML
   - Added `section-table-card` CSS class to all 8 table cards (Team Health Scorecard, Aging Features, Feature List, Critical Defects, Defect List, PI Compare Summary, PI-End Velocity, Sprint Summary)
   - Added `.section-table-card { display: none !important; }` to style.css
   - Simplified `buildSlideshowSlides()`, `showSlideshowSlide()`, `stopSlideshow()` — removed chart/table mode class logic
   - Simplified `activateSection()` — removed `ssPage` logic

2. **Fixed 📋 buttons not visible** (buttons were inside hidden `section-table-card` divs)
   - Moved all 📋 buttons OUTSIDE the hidden cards to visible locations:
     - Executive: button in "Committed vs Delivered" card header → 📋 Team Health
     - Features section-header: 📋 Aging Features + 📋 Feature List
     - Defects section-header: 📋 Critical Defects + 📋 Defect List
     - Compare section-header: 📋 Summary Table
     - Velocity "Velocity Trend" card header: 📋 Velocity Table
     - Sprint Trend section-header: 📋 Sprint Summary
   - Removed duplicate buttons from inside hidden cards

3. **Fixed Team Velocity not auto-loading**
   - `initVelocity()` was setting up UI but never triggering a load
   - Added auto-load at end of `initVelocity()` using `state.selectedPIs` (fallback to past+current PIs)

4. **User asked what other metrics to add** — agreed on all 6:
   - Defect Aging + SLA Breach alerts
   - Feature Slip/Spillover tracking
   - Throughput trend (features/sprint)
   - Defect Injection Rate
   - Found In breakdown chart
   - WIP count

5. **Implemented 6 new metrics** via general-purpose agent
   - **Backend (server.js)**: Added `Microsoft.VSTS.Build.FoundIn` to defect fetch fields and `itemSummary()`; added to `processDefects()`: `foundInBreakdown`, `agingBuckets` (5 buckets), `agingByPriority`, `slaBreaches` (P1>7d, P2>14d, P3+>30d), `injectionByIteration`; added to `processFeatures()`: `wipCount`, `throughputByIteration`, `slippedFeatures`
   - **Frontend (index.html)**: Added 3-column row in Features section (Throughput chart, WIP&Slip panel, Feature State donut); Added 3-column row in Defects section (Aging horizontal bar, Injection stacked bar, Found-In donut); Added SLA Breach Alert card with 📋 modal button
   - **Frontend (app.js)**: 7 new render functions + calls in `renderFeaturesSection`/`renderDefectsSection`; `applyTeamFilter` recomputes all 8 new metrics from filtered items
   - **style.css**: WIP/Slip panel styles added

6. **Fixed new charts appearing on all pages** (stray `</div>` in HTML)
   - Root cause: extra `</div>` at line 525 in index.html was closing `<section id="section-defects">` early
   - All new cards (aging, injection, found-in, SLA breach, critical defects, defect list) were outside the section → showing on every slide
   - Removed the stray `</div>`

7. **Fixed empty data in new charts**
   - Server hadn't been restarted with new code
   - Stopped old node processes, restarted server (PID 29584, then 48344)

8. **Added card zoom (expand to fullscreen popup)**
   - Initially added collapse/minimize (▼/▶) but user clarified they wanted zoom out = fullscreen popup
   - Replaced with zoom: `⤢` button on every card header opens card in fixed fullscreen with dark backdrop
   - `⤡` / backdrop click / Escape closes it
   - Charts auto-resize via `chart.resize()` after 50ms
   - MutationObserver handles dynamically rendered cards
   - `setupCardCollapse()` function retained as name (calls `injectZoomBtn` internally)

9. **Fixed team filter dropdown text readability**
   - Active state was yellow text on near-transparent background (hard to read)
   - Changed to dark `#1a1a1a` text on solid yellow `var(--caution)` background
   - Options retain normal dark-mode colours

10. **WIP always showing 0**
    - FEATURE_STATES = ['Forecasted', 'New', 'Approved', 'Done', 'Removed'] — no 'In Progress' or 'Active'
    - Fixed: added `'Approved'` as WIP-equivalent state in both server.js and applyTeamFilter
    - Added: hide WIP&Slip panel entirely when both values are 0

11. **Sprint Velocity / Story Points charts empty**
    - Root cause: used `ChangedDate` date ranges to find Done features per sprint — `ChangedDate` updates on ANY field change, not just state-to-Done transitions
    - Fixed: replaced date range queries with `IterationPath UNDER iterBase\piLabel\piLabel sprintLabel` (e.g. `Healthcare IT\ISP\26-PI1\26-PI1 S1`)
    - Removed `getSprintDateRanges()` dependency from the velocity route sprint-level queries
    - Server restarted

12. **User asked to audit all date range usage in backend**
    - Ran grep for `ChangedDate|CreatedDate|dateRange|getSprintDateRanges`
    - Results showed: `CreatedDate` and `ChangedDate` are used only as **fetched fields** (not as WIQL filter conditions) in the dashboard/features/defects routes — this is fine (they're display data, not query filters)
    - `getSprintDateRanges` function still exists in server.js but is now unused (the velocity route no longer calls it)
    - **PENDING**: Remove `getSprintDateRanges` function (now dead code) and confirm no other routes use date-based filtering inappropriately
</history>

<work_done>
Files modified:

- `D:\views\AV Dashboard\public\index.html`
  - All 8 table cards have `section-table-card` class (hidden by default)
  - All 📋 buttons moved outside hidden cards to visible section headers / chart card headers
  - Defects section: removed stray `</div>` that was closing the section early
  - New 3-col chart rows added to Features and Defects sections
  - SLA Breach Alert card added in Defects section

- `D:\views\AV Dashboard\public\style.css`
  - `.section-table-card { display: none !important; }` added
  - Card zoom styles: `.card-zoom-btn`, `.card-zoom-backdrop`, `.card--zoomed`
  - WIP/Slip panel styles: `.wip-slip-panel`, `.wip-kpi-row`, `.wip-kpi`, etc.
  - Team filter active state: dark text on solid yellow background

- `D:\views\AV Dashboard\public\app.js`
  - Slideshow simplified (no more chart/table mode classes)
  - `activateSection()` simplified (no ssPage logic)
  - Velocity auto-load on first visit
  - 7 new render functions (throughput, wip/slip, feature progress donut, defect aging, injection, found-in, SLA breach)
  - `applyTeamFilter` recomputes all 8 new metrics
  - `setupCardCollapse()` → now implements zoom (⤢/⤡) with backdrop and MutationObserver
  - WIP counts `Approved` state; hides panel when both 0
  - Escape key closes zoomed card

- `D:\views\AV Dashboard\server.js`
  - `processFeatures()`: added `wipCount` (includes Approved), `throughputByIteration`, `slippedFeatures`
  - `processDefects()`: added `foundInBreakdown`, `agingBuckets`, `agingByPriority`, `slaBreaches`, `injectionByIteration`
  - `itemSummary()`: added `foundIn` field (`Microsoft.VSTS.Build.FoundIn`)
  - `/api/velocity` route: sprint-level queries now use `IterationPath UNDER sprint-path` instead of `ChangedDate` ranges
  - WIP detection: `Approved` added as in-progress state

Work completed:
- [x] Tables hidden by default, all accessible via 📋 modal
- [x] All 📋 buttons visible outside hidden cards
- [x] Velocity auto-loads on section visit
- [x] 6 new metrics implemented and wired up
- [x] New charts visible only in correct section (stray div fixed)
- [x] Card zoom expand/restore feature
- [x] Team filter text contrast fixed
- [x] WIP showing correct data (Approved state)
- [x] Sprint velocity using IterationPath (not ChangedDate)
- [ ] `getSprintDateRanges()` function still in server.js as dead code — should be removed
- [ ] Audit result pending action: confirm no other date-range WIQL filters exist
</work_done>

<technical_details>
- **TFS Iteration path format**: `Healthcare IT\ISP\26-PI1\26-PI1 S1` — PI label prefixed to sprint label. Sprint velocity queries must use `IterationPath UNDER 'iterBase\piLabel\piLabel sprintLabel'`
- **`ChangedDate` pitfall**: TFS `ChangedDate` updates on ANY field change (comments, assignments, etc.) — not just state transitions. Never use it as a sprint window proxy. Use `IterationPath` instead.
- **`section-table-card` + DOM clone**: Hidden cards (`display:none !important`) still exist in DOM, so `cloneNode(true)` in `openTableModal()` works correctly — the table data is populated but invisible
- **FEATURE_STATES in this TFS**: `['Forecasted', 'New', 'Approved', 'Done', 'Removed']` — `Approved` is the in-flight/WIP state (no 'In Progress' or 'Active')
- **`applyTeamFilter`**: When `state.selectedTeam` is null, returns `data` as-is (server-computed values). When a team IS selected, it re-computes ALL metrics from filtered items array — including the 8 new metrics. Critical for team filter to work with new charts.
- **Card zoom**: Uses `position: fixed` on the card element itself (no DOM move). Charts auto-resize via `chart.resize()` after 50ms delay. MutationObserver watches for dynamically rendered cards.
- **`fetchWorkItemDetails`**: Automatically strips unknown fields on 400 and retries — adding new fields like `Microsoft.VSTS.Build.FoundIn` is safe even if not all TFS instances support it
- **WIP&Slip panel**: Hidden entirely (panel `display:none`) when both wipCount and slipCount are 0 — avoids "0/0" noise
- **`getSprintDateRanges()`**: Still exists in server.js at line ~56 but is now dead code since velocity route no longer calls it. Should be removed.
- **SLA thresholds**: P1 > 7 days, P2 > 14 days, P3/P4/null > 30 days — hardcoded in both server.js processDefects and applyTeamFilter frontend
- **Stray `</div>` bug**: Was at line 525 (after How Found/Where Found/Severity row in Defects section), closing the `<section>` tag early. All subsequent cards were rendered outside the section and showed on every slideshow slide.
</technical_details>

<important_files>
- `D:\views\AV Dashboard\server.js`
  - Main Express backend, all TFS API calls, data processing
  - `processFeatures()` (~line 198): now returns wipCount, throughputByIteration, slippedFeatures
  - `processDefects()` (~line 271): now returns foundInBreakdown, agingBuckets, agingByPriority, slaBreaches, injectionByIteration
  - `itemSummary()` (~line 386): returns foundIn field
  - `/api/velocity` route (~line 802): sprint-level now uses IterationPath
  - `getSprintDateRanges()` (~line 56): dead code, should be removed

- `D:\views\AV Dashboard\public\index.html`
  - Main HTML shell with all sections, cards, modals
  - All 8 table cards have `section-table-card` class
  - 📋 buttons all in visible locations (section headers / visible card headers)
  - New chart rows in Features (~line 407) and Defects (~line 527) sections
  - SLA Breach card in Defects section (~line 552)

- `D:\views\AV Dashboard\public\app.js`
  - Full frontend logic (~2900+ lines)
  - `renderFeaturesSection()` (~line 494): calls 7 render functions
  - `renderDefectsSection()` (~line 575): calls 7 render functions
  - New render functions (~lines 728-1010): throughput, wip/slip, feature donut, aging, injection, found-in, SLA breach
  - `applyTeamFilter()` (~line 2560): recomputes all metrics for team filtering
  - `setupCardCollapse()` (~line 2834): implements card zoom
  - `openZoomedCard()` / `closeZoomedCard()`: zoom open/close logic
  - `initVelocity()` (~line 1782): auto-loads velocity on first section visit

- `D:\views\AV Dashboard\public\style.css`
  - All Filament dark-mode styles
  - `.section-table-card` rule (~line 1123)
  - Card zoom styles (~line 1125)
  - WIP/Slip panel styles
  - Team filter active state (~line 1249)
</important_files>

<next_steps>
Remaining work:

1. **Remove dead code**: `getSprintDateRanges()` function in server.js (~line 56) is now unused — safe to delete
2. **Date range audit result**: The grep showed `CreatedDate`/`ChangedDate` are only used as **fetched fields** (for display/computation), not as WIQL WHERE clause filters — no other routes have the same date-range-filtering bug as the old velocity sprint query. This is clean.
3. **Verify new metrics with live data**: User should refresh the dashboard and confirm Throughput, Aging, Injection Rate, Found In, WIP, Slip, and SLA Breach cards all show real data
4. **Sprint velocity test**: User should visit Velocity section and confirm "Sprint Velocity — Features Done" and "Story Points Delivered" charts now show data per sprint

Immediate next step:
- Remove `getSprintDateRanges()` dead code from server.js and confirm to user that audit found no other date-range query issues
</next_steps>