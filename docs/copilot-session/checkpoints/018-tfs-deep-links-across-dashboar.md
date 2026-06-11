<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme (Node.js/Express backend + Vanilla HTML/JS/CSS frontend, Filament dark theme). This session focused on: (1) fixing velocity API team filtering (server not passing teamPath to WIQL), (2) adding TFS deep-links across all dashboard cards/tables so users can click through to view work items directly in TFS. The approach uses client-side WIQL construction based on current PI + team filter state, with links rendered as buttons in section headers and styled pill badges inline.
</overview>

<history>

1. **User reported velocity still showing 258 items when Avyay team selected**
   - Added debug logging to `/api/velocity` endpoint to print `teamPath received` and `filterPath used` and `PI-end WIQL`
   - Restarted server, user hit the URL; server logs revealed `teamPath received: null` on first request (no team selected) and `teamPath received: "Healthcare IT\\ICAP\\ISP"` on second — confirming server was receiving the path but iterationPath in WIQL was correct
   - User confirmed it's working after the fix; debug logs removed, server restarted cleanly

2. **User asked: add TFS deep-links to all charts/tables so users can click and view in TFS**
   - Added `buildTFSQueryUrl(wiql)`, `tfsQueryLink(wiql, label, asButton)`, `buildItemTFSLink(id)`, `_tfsAreaForQuery()`, `buildSectionTFSLink()`, `buildPITFSLink()`, `buildSprintTFSLink()` helper functions in `app.js`
   - Stored `state.iterationPath` and `state.areaPath` from `/api/config` response
   - Added TFS link slots to HTML section headers (features, defects, sprint trend)
   - Updated `renderFeaturesSection` and `renderDefectsSection` to inject bulk query links
   - Feature/defect table ID cells now use `buildItemTFSLink` (clickable `#id` → TFS work item)
   - Velocity PI summary cards get "View in TFS" link at card footer
   - Velocity table PI column headers get 🔗 icon link
   - Sprint trend table: per-sprint TFS link next to sprint label
   - `loadSprintTrend`: updates section header TFS link after data loads
   - Predictability table: `<a href="#">` fixed to real `buildItemTFSLink`

3. **User reported links not visible**
   - Root cause: section-header links were too small/faint (11px, opacity 0.75) and blended in
   - Fixed: section-header links now render as `btn btn-ghost btn-sm` (same style as existing `📋 Feature List` buttons) via `asButton=true` parameter
   - Inline links (velocity cards, table headers, sprint rows) styled as pill badges with blue border + tinted background (`rgba(20,146,255,.08)`)
   - `buildPITFSLink` uses `asButton = label !== '🔗'` to auto-select styling

4. **User asked: add TFS links to ALL possible cards**
   - Launched explore agent to audit every render function in `app.js`
   - Agent identified remaining link opportunities:
     - `renderWipSlip` — slip item IDs + bulk WIP query
     - `renderCriticalDefects` — individual ID cells missing links
     - `renderStaleFeatures` — card header bulk link slot
     - `renderTestUncoveredTable` — individual ID cells missing links
     - `renderDefectDelta` — individual defect IDs
     - `renderTeamCards` — per-team feature/defect links
     - `renderTeamScorecard` — per-team links in scorecard rows
     - Overview section header — bulk features+defects links
     - Executive section header — bulk link
   - Was in the middle of implementing when compaction occurred

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\public\app.js`
  - Added `state.iterationPath` and `state.areaPath` populated from `/api/config` in `loadConfig()`
  - Added TFS helper functions after `getTeamAreaPath()` (~line 4155):
    - `buildTFSQueryUrl(wiql)` — constructs `{tfsBaseUrl}/_workitems?_a=query&wiql=...`
    - `tfsQueryLink(wiql, label, asButton)` — returns anchor; `asButton=true` uses `btn btn-ghost btn-sm`
    - `buildItemTFSLink(id, label)` — links individual work item ID to edit page
    - `_tfsAreaForQuery()` — returns current team area path or `state.areaPath`
    - `buildSectionTFSLink(type, pis, label)` — bulk PI+area query, renders as button
    - `buildPITFSLink(pi, type, label)` — single PI query, auto button/pill based on label
    - `buildSprintTFSLink(pi, sprint, label)` — sprint-scoped query, inline pill
  - `renderFeaturesSection`: injects `buildSectionTFSLink('Feature', pis)` into `#featuresTFSLink`
  - `renderDefectsSection`: injects `buildSectionTFSLink('Defect', pis)` into `#defectsTFSLink`
  - `renderFeatureTable`: ID cells use `buildItemTFSLink(item.id)` 
  - `renderDefectTable`: ID cells use `buildItemTFSLink(item.id)`
  - `renderVelocityPISummaryCards`: added TFS link footer per PI card
  - `renderVelocityTable`: PI column headers include `buildPITFSLink(v.pi, 'Feature', '🔗')`
  - `renderSprintTrendTable`: sprint name cells include `buildSprintTFSLink(data.pi, s.sprint)`
  - `loadSprintTrend`: sets `#sprintTrendTFSLink` with `buildPITFSLink(trendData.pi, 'Feature', '🔗 View in TFS')`
  - `renderPredTable`: `<a href="#">` replaced with `buildItemTFSLink(f.id, String(f.id))`

- `D:\views\AV Dashboard\public\index.html`
  - Features section header: added `<span id="featuresTFSLink" class="tfs-link-slot"></span>`
  - Defects section header: added `<span id="defectsTFSLink" class="tfs-link-slot"></span>`
  - Sprint Trend section header: added `<span id="sprintTrendTFSLink" class="tfs-link-slot"></span>`

- `D:\views\AV Dashboard\public\style.css`
  - Added `.tfs-item-link` — monospace, primary-light color, hover underline
  - Added `.tfs-query-link` — inline pill with blue border/tint, opacity 0.85, hover brightens
  - Added `.tfs-link-slot` — inline-flex container for injected links

- `D:\views\AV Dashboard\server.js`
  - `/api/velocity`: removed extra `decodeURIComponent` (Express already decodes)
  - Debug logs added then removed

**Still to implement (was mid-task when compaction hit):**
- HTML: Add TFS link slot spans to stale features card, critical defects card, uncovered features card, teams section header, executive section header, team scorecard card header, WIP card header, overview section header
- JS: `renderWipSlip` — ID links + bulk WIP query link
- JS: `renderCriticalDefects` — ID cells from `#${item.id}` → `buildItemTFSLink`
- JS: `renderStaleFeatures` — bulk stale features link (already has individual links via old pattern)
- JS: `renderTestUncoveredTable` — ID cells + bulk uncovered features link
- JS: `renderDefectDelta` — `d.id` span → `buildItemTFSLink(d.id, String(d.id))`
- JS: `renderTeamCards` — per-team feature/defect links using team area path lookup
- JS: `renderTeamScorecard` — per-team links in scorecard rows
- JS: `renderExecutiveSection` + `renderAll` — update overview/exec TFS link slots

</work_done>

<technical_details>

**TFS URL format for WIQL queries:**
`{tfsBaseUrl}/_workitems?_a=query&wiql={encodeURIComponent(wiql)}`
where `tfsBaseUrl` = `https://tfsemea1.ta.philips.com/tfs/TPC_Region11/Healthcare IT`

**TFS URL for individual items:**
`{tfsBaseUrl}/_workitems/edit/{id}`

**WIQL construction pattern:**
```javascript
`SELECT [System.Id],[System.Title],[System.State] FROM WorkItems 
 WHERE [System.WorkItemType]='Feature' 
   AND [System.AreaPath] UNDER '${area}'
   AND ([System.IterationPath] UNDER '${iterBase}\\26-PI1' OR [System.IterationPath] UNDER '${iterBase}\\26-PI2')
 ORDER BY [System.Id]`
```

**State values in TFS:**
- `state.iterationPath` = `"Healthcare IT\ISP"` (from config)
- `state.areaPath` = `"Healthcare IT"` (from config) — this is the global area root
- `state.tfsBaseUrl` = `"https://tfsemea1.ta.philips.com/tfs/TPC_Region11/Healthcare IT"`

**Link rendering modes:**
- `asButton=true` → `<a class="btn btn-ghost btn-sm">` — used in section headers alongside other buttons
- `asButton=false` → `<a class="tfs-query-link">` — pill badge, used inline in cards/tables
- `buildPITFSLink` auto-selects: `asButton = label !== '🔗'` (full label = button, emoji-only = pill)

**`getTeamAreaPathByName(teamName)` — needed but not yet implemented:**
For team cards and scorecard rows, need to look up a team's full area path by name. Same logic as `getTeamAreaPath()` but takes a name parameter instead of reading `state.selectedTeam`. This requires finding an item in `state.data.features.items` whose `extractTeamFromPath(area)` matches, then extracting the team segment from the area path using `state.teamRootPath`.

**`renderStaleFeatures` already has individual item links** via old pattern (inline conditional, line ~2340). These use `style="color:var(--primary-light);text-decoration:none"` instead of the new `.tfs-item-link` class — should be normalized but is functional.

**`buildSectionTFSLink` fallback:** Returns `''` if `_tfsAreaForQuery()` returns empty. `_tfsAreaForQuery()` returns `getTeamAreaPath() || state.areaPath`. If `state.areaPath` is empty, link is not rendered. This shouldn't happen in practice since config always has an areaPath.

**Server PID:** Currently running as PID 52732 (started via `Start-Process`).

</technical_details>

<important_files>

- `D:\views\AV Dashboard\public\app.js`
  - Main frontend (~4700+ lines); all dashboard logic
  - TFS helper functions added after `getTeamAreaPath()` ~line 4155
  - `loadConfig()` ~line 178: now sets `state.iterationPath` and `state.areaPath`
  - `renderFeaturesSection` ~line 604, `renderDefectsSection` ~line 722: inject section TFS links
  - `renderFeatureTable` ~line 667, `renderDefectTable` ~line 820: ID cells now clickable
  - `renderVelocityPISummaryCards` ~line 2440: TFS link in card footer
  - `renderVelocityTable` ~line 2594: TFS link in PI column headers
  - `renderSprintTrendTable` ~line 2155: per-sprint TFS link in sprint cell
  - `renderPredTable` ~line 3968: feature IDs link to TFS

- `D:\views\AV Dashboard\public\index.html`
  - Section header slots: `#featuresTFSLink`, `#defectsTFSLink`, `#sprintTrendTFSLink`
  - Cards needing slots (not yet added): `staleFeaturesCard`, `criticalDefectsCard`, uncovered features, teams section, executive section, WIP card, overview section

- `D:\views\AV Dashboard\public\style.css`
  - `.tfs-item-link`, `.tfs-query-link`, `.tfs-link-slot` added ~line 567

- `D:\views\AV Dashboard\server.js`
  - `/api/velocity` ~line 866: reads `req.query.teamPath`, uses `filterPath` in WIQL
  - No pending server changes

</important_files>

<next_steps>

**Remaining work — "TFS links for all cards" task (mid-implementation):**

**HTML additions needed in `index.html`:**
1. Overview section header (`#section-overview`): add `<span id="overviewFeatTFSLink" class="tfs-link-slot"></span>` + `<span id="overviewDefTFSLink" class="tfs-link-slot"></span>`
2. WIP card header (card containing `#wipSlipPanel`): add `<span id="wipSlipTFSLink" class="tfs-link-slot"></span>`
3. `staleFeaturesCard` header: add `<span id="staleFeaturesTFSLink" class="tfs-link-slot"></span>`
4. `criticalDefectsCard` header (id=`criticalDefectsCard`): add `<span id="criticalDefectsTFSLink" class="tfs-link-slot"></span>`
5. Uncovered features card header (contains `#tcUncoveredBody`): add `<span id="uncoveredTFSLink" class="tfs-link-slot"></span>`
6. Teams section header (`#section-teams`): add `<span id="teamsTFSLink" class="tfs-link-slot"></span>`
7. Executive section header: add `<span id="execTFSLink" class="tfs-link-slot"></span>`
8. Team scorecard card header (contains `#scorecardTable`): add `<span id="scorecardTFSLink" class="tfs-link-slot"></span>`

**JS additions needed in `app.js`:**
1. Add `getTeamAreaPathByName(teamName)` helper — same as `getTeamAreaPath()` but takes name param
2. `renderWipSlip`: change `#${item.id}` span to `buildItemTFSLink`; update `#wipSlipTFSLink` with WIP features query (state IN Activated/Approved/In Progress)
3. `renderCriticalDefects` ~line 2287: `#${item.id}` → `buildItemTFSLink(item.id)`; update `#criticalDefectsTFSLink` with P1/P2 open defects WIQL
4. `renderStaleFeatures`: update `#staleFeaturesTFSLink` with stale (Forecasted/New) features WIQL; normalize existing individual links to use `.tfs-item-link` class
5. `renderTestUncoveredTable` ~line 4401: `#${item.id}` → `buildItemTFSLink(item.id)`; update `#uncoveredTFSLink`
6. `renderDefectDelta` ~line 4117: `<span style="color:var(--primary)">${d.id}</span>` → `buildItemTFSLink(d.id, String(d.id))`
7. `renderTeamCards` ~line 1349: add per-team feature + defect TFS link footer using `getTeamAreaPathByName`
8. `renderTeamScorecard` ~line 1842: add per-team TFS links in team name cell
9. `renderExecutiveSection` ~line 1779: update `#execTFSLink` and `#scorecardTFSLink`
10. `renderAll` ~line 398: call `updateOverviewTFSLinks()` to populate overview section links

</next_steps>