<overview>
The session focused on two major deliverables for the AV Dashboard (Node.js/Express + React/Vite, TFS/Azure DevOps integration): (1) enriching the Weekly PI Health Digest with comprehensive programme metrics and TFS deep-links, and (2) creating a v2 presentation (`AV_Dashboard_Programme_Presentation_v2.html`) documenting all new features. The approach was surgical backend enrichment of `scheduler.js` followed by a large HTML presentation update, with the presentation work still in progress.
</overview>

<history>

1. **User asked what information is missing from the Weekly PI Health Digest**
   - Analyzed `src/scheduler.js` (457 lines) — current digest only sent 5 basic facts: done rate, open defects, P1/P2 count, velocity avg, forecast
   - Analyzed `src/routes/notifications.js`, `src/routes/dashboard.js`, `src/routes/defects.js`, `src/routes/piReadiness.js`, `src/helpers/dataProcessors.js`
   - Discovered rich data already available from existing APIs: `features.slippedFeatures`, `features.wipCount`, `features.teamBreakdown`, `defects.escapeRatio`, `defects.resolveRate`, `defects.severityBreakdown`, `defects.teamBreakdown`, PI readiness score + violations
   - Presented comprehensive list of missing items across: Delivery, Quality, PI Readiness, Sprint/Velocity, Changes Since Last Digest, and TFS Action Links

2. **User approved full implementation ("yes please")**
   - Added 2 imports to `scheduler.js`: `tfsPost` from `tfsClient` and `getFieldMappings` from helpers
   - Added new helper functions: `buildTfsQueryLink()`, `buildPiChecksLink()`, `computeTeamRates()`, `computeTopDefectTeams()`, `fetchChangesThisWeek()` (direct TFS WIQL)
   - `fetchChangesThisWeek()` runs 4 parallel WIQL calls: features done in last 7 days, new defects, new P1/P2 defects, defects resolved — returns counts + IDs
   - Updated `buildMessageCard()` signature to accept: `teamFacts`, `piReadinessFacts`, `changesFacts`, `tfsLinks` — added 4 new sections + O365 connector `potentialAction` buttons
   - Updated `buildAdaptiveCard()` — added all new sections + 5 action buttons: Dashboard, P1/P2 Defects, PI Readiness folder, Open Defects, Open Features
   - Completely rewrote `sendDigest()`: fetches PI readiness from `/api/pi-readiness`, builds per-team done rates (top 3 / bottom 3), severity breakdown facts, PI readiness top violations, "changes this week" via direct TFS WIQL, TFS deep-link URLs, velocity trend indicator (↗/↘/→)
   - Updated default `sections` in `sendDigest()` to include: `teamBreakdown: true`, `piReadiness: true`, `changes: true`
   - Updated `SettingsSection.jsx` default digestSections and added 3 new toggles: `👥 Team Breakdown`, `🔍 PI Readiness`, `📅 Changes This Week`
   - Built frontend — clean build ✅
   - Syntax-checked `scheduler.js` — no errors ✅
   - Server restarted successfully ✅

3. **User asked to continue with the v2 presentation**
   - The v2 file (`AV_Dashboard_Programme_Presentation_v2.html`) was copied from v1 earlier in the session; cover slide and title had already been updated
   - Updated Slide 2 (Overview) from "13 Sections" to "21 Sections · v2" with new cards for Cross-PI Trends (NEW), PI Readiness (SMART), Quality (ENHANCED), and pills for Notification Center, Saved Views, Roles & Visibility
   - Inserted NEW Slide: **Enhanced Defect Analytics** (slide 9/28) — 5 new charts: Quarterly Raised vs Closed, Net Defect Burn Rate, Team×Priority Heatmap, Field Defects by Project, Open Defects by Team×Priority stacked bar — all with inline CSS mockups
   - Inserted NEW Slide: **PI Readiness Intelligent Team View** (slide 16/28) — side-by-side layout showing all-teams heatmap vs single-team expandable criteria view with inline failing feature table
   - Inserted NEW Slide: **Cross-PI Trends** (slide 17/28) — KPI strip, chart list, PI-over-PI summary table mockup
   - **Still in progress** — have not yet inserted slides for: Notification Center + Saved Views, Weekly PI Health Digest enriched, Roles & Visibility, and updated closing slide

</history>

<work_done>

Files modified:

- `src/scheduler.js`
  - Added imports: `tfsPost` from `./tfsClient`, `getFieldMappings` from `./helpers/fieldMappings`
  - Added helpers: `buildTfsQueryLink()`, `buildPiChecksLink()`, `computeTeamRates()`, `computeTopDefectTeams()`, `fetchChangesThisWeek()`
  - Updated `buildMessageCard()` — new sections + O365 action buttons
  - Updated `buildAdaptiveCard()` — new sections + 5 TFS action buttons
  - Rewrote `sendDigest()` — now sends 8 sections with rich data + TFS links
  - `buildAlertAdaptiveCard()` and `buildAlertMessageCard()` unchanged
  - Server syntax-checked and running ✅

- `client/src/sections/SettingsSection.jsx`
  - Default `digestSections` updated: added `teamBreakdown: true`, `piReadiness: true`, `changes: true`
  - `digestSections` spread in form init updated
  - Digest section toggle list updated — 3 new entries added: `👥 Team Breakdown`, `🔍 PI Readiness`, `📅 Changes This Week`
  - Frontend built ✅

- `docs/Presentation/AV_Dashboard_Programme_Presentation_v2.html`
  - Copied from v1 at start of session
  - Title updated to "AV Dashboard v2"
  - Cover slide: added "v2" badge, version metadata row
  - Slide 2 (Overview): updated to "21 Sections · v2" with new section cards + new pills
  - **NEW** Slide inserted: Enhanced Defect Analytics (id="sDefectAnalytics", position 9/28)
  - Slide 10 (Teams): slide-number updated to "10 / 28"
  - **NEW** Slide inserted: PI Readiness Intelligent View (id="sPIReadinessSmart", position 16/28)
  - **NEW** Slide inserted: Cross-PI Trends (id="sCrossPI", position 17/28)
  - Slide 16 (Test Coverage): slide-number updated to "18 / 28"
  - **NOT YET DONE**: Slides for Notification Center + Saved Views, Enriched Digest, Roles & Visibility; closing slide update; remaining old slide numbers still say "xx / 22"

Current state:
- [x] Digest backend fully enriched
- [x] Digest settings UI updated
- [x] Server running on port 3000
- [x] Presentation v2 started — 3 of ~6 new slides inserted
- [ ] Presentation v2 — 3 more new slides to add
- [ ] Presentation v2 — closing slide update
- [ ] Presentation v2 — old slide numbers (still "xx / 22") not critical since JS counter is dynamic, but cosmetic

</work_done>

<technical_details>

**Digest enrichment architecture:**
- `sendDigest()` fetches 5 APIs in parallel: `insights/summary`, `dashboard`, `velocity`, `risks`, `pi-readiness`
- PI readiness violations aggregated by iterating `teams[].criteria[].fail` across all teams, grouped by check ID — gives programme-level violation counts
- `fetchChangesThisWeek()` uses `tfsPost` directly (not HTTP localhost) — avoids circular dependency, more efficient — 4 WIQL queries in `Promise.allSettled()`
- "Since date" = `new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]` — last 7 days from trigger time

**TFS deep-link URL format:**
- `${tfsBaseUrl}/_workitems?_a=query-edit&queryText=${encodeURIComponent(wiql)}` — opens TFS web access query editor with WIQL pre-populated
- PI Readiness folder: `${tfsBaseUrl}/_queries/${encodedFolderPath}` — same pattern as `piChecks.js`
- `cfg.tfs.baseUrl` = `https://tfsemea1.ta.philips.com/tfs/TPC_Region11/Healthcare%20IT`

**`computeTeamRates(teamBreakdown, fm)` logic:**
- Uses `fm.stateValues.featureDone` (default `'Done'`) and `fm.stateValues.featureRemoved` (default `'Removed'`)
- Rate = done / (total - removed) × 100, filtered to teams with `active > 0`, sorted descending
- Top 3 shown as `✅`, bottom 3 (if not already top 3) shown as `⚠️`

**Adaptive Card vs MessageCard:**
- O365 Connector URLs (`webhook.office.com`) → must use legacy `MessageCard` with `potentialAction` array for buttons
- Power Automate / Copilot Studio webhooks → use Adaptive Card with `card.actions` array
- `isO365Connector()` checks URL string for `webhook.office.com`

**Presentation slide numbering:**
- The `<div class="slide-number">XX / 22</div>` in each slide is static decoration only
- The actual "X / Y" counter shown to the user is dynamically computed in JS: `counter.textContent = (current + 1) + ' / ' + TOTAL` where `TOTAL = slides.length`
- So static labels being "xx / 22" vs "xx / 28" is cosmetic — JS counter is always correct

**New default digest sections:**
- `teamBreakdown: true`, `piReadiness: true`, `changes: true` are opt-in by default
- `risks: false`, `velocity: false` remain opt-out (too noisy by default)

**`processFeatures()` return structure** (what dashboard.features contains):
- `total`, `stateCounts` (Done/New/Approved/etc), `doneRate`, `wipCount`, `slippedFeatures.count`, `teamBreakdown` (by team → by state), `teamBreakdownByEffort`

**`processDefects()` return structure** (what dashboard.defects contains):
- `total`, `stateCounts`, `p1p2Count`, `escapeRatio`, `resolveRate`, `severityBreakdown`, `teamBreakdown`, `howFoundBreakdown`, `whereFoundBreakdown`

</technical_details>

<important_files>

- `src/scheduler.js`
  - Core digest engine — builds and sends Weekly PI Health Digest to Teams/Slack webhooks
  - Major rewrite: added 5 helper functions, rewrote `sendDigest()`, updated both card builders
  - Key sections: helpers at ~line 43–140, `buildMessageCard` ~line 160, `buildAdaptiveCard` ~line 205, `sendDigest` ~line 310
  - `buildAlertAdaptiveCard()` exported and used by `notifications.js` — unchanged

- `client/src/sections/SettingsSection.jsx`
  - Settings page — 12 tabs including "Roles & Visibility" (merged from prior session)
  - Digest section toggles at ~line where `{ key: 'delivery'... }` array is defined
  - Default `digestSections` object at `DEFAULT_NOTIFICATIONS` const at top of file
  - Updated: added 3 new section toggles + defaults

- `src/routes/notifications.js`
  - Express router for `/api/notifications/*` — calls `sendDigest()` from scheduler
  - `POST /digest/trigger` → manually trigger digest
  - Unchanged this session but depends on scheduler

- `src/routes/piReadiness.js`
  - Returns `{ programmeScore, totalFeatures, teams[], checkLabels[] }` per team with `criteria[]` (id, label, pass, fail, pct, failItems)
  - Called by enriched `sendDigest()` for PI readiness section
  - `runChecks()` takes `(cfg, piLabels, fm, teamPath)` — 7 parallel WIQL queries

- `src/helpers/dataProcessors.js`
  - `processFeatures()` and `processDefects()` — returns all aggregated data used in digest
  - `escapeRatio`, `resolveRate`, `severityBreakdown`, `teamBreakdown`, `slippedFeatures`, `wipCount` all come from here

- `docs/Presentation/AV_Dashboard_Programme_Presentation_v2.html`
  - v2 presentation — currently ~1500+ lines, 25 slides (3 new added, 3 more to add)
  - Target: 28 slides total
  - Uses pure CSS/HTML slide engine — no dependencies; inline styles only; JS handles slide transitions + counter
  - New slides use inline CSS mockups (no screenshots yet needed)

- `docs/Presentation/AV_Dashboard_Programme_Presentation.html`
  - Original v1 (79KB, 22 slides) — kept as-is, reference for v2

</important_files>

<next_steps>

**Immediately in progress — Presentation v2 (3 slides remaining):**

Need to insert after the Compare PIs slide (id="s18b") and before the Snapshots slide (id="s13"):

1. **NEW Slide: Notification Center + Saved Views** (target position ~23/28)
   - Topbar bell icon with unread badge + history dropdown layout
   - Config popup: Saved Views at top with named filter chips, active view highlighting (blue border + ✓)
   - Pattern: left column description, right column inline CSS mockup of the bell/dropdown + config popup

2. **NEW Slide: Enriched Weekly PI Health Digest** (target position ~24/28)
   - Show all 8 sections now in the digest
   - Inline mockup of Adaptive Card with Team Breakdown, PI Readiness, Changes This Week sections
   - Show TFS action buttons (P1/P2, PI Readiness, Open Features, Open Defects)

3. **NEW Slide: Roles & Visibility Management** (target position ~25/28, before Settings slide)
   - Merged tab: RolesManager at top + Visibility Policies below
   - Auto-save on role create/delete/blur — no save button
   - New role = ALL_HIDDEN by default; built-in roles = fully visible
   - Custom role editor: name + icon only; VisibilityNote callout pointing to policies section

4. **Update closing slide (slide 22/28)** — Update "13 Dashboard Sections" to "21 Sections", add new ★ entries for Cross-PI Trends, Enhanced Defect Analytics, Enriched Digest, Notification Center, Saved Views, Roles & Visibility

5. **Update remaining slide numbers** — cosmetic: change "xx / 22" to "xx / 28" in slides that haven't been updated (slides 3–8, 11–15, 19–22)

**After presentation is complete:**
- Update `docs/user-manual.html` — add sections for: Cross-PI Trends, Notification Center, Saved Views, PI Readiness smart view, Enriched Digest
- Update `docs/settings-guide.html` — Roles & Visibility consolidation documentation
- 2 in-progress todos from earlier: `snap-global-backend` and `snap-global-frontend` (global snapshot capture)

**Insertion point for remaining 3 slides:**
```
Find: <!-- ══════════════════════════════════════════
     SLIDE 18 — COMPARE PIs
After the closing </section> of Compare PIs (id="s18b"):
Insert: Notification Center, Digest, Roles slides
Then comes: Snapshots (id="s13"), Settings (id="s14"), Closing (id="s15")
```

</next_steps>