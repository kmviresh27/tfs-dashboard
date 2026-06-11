<overview>
This session segment focused on fixing three bugs in the KPI Tracker section of the AV Dashboard and then implementing a dual TFS link feature. The bugs were: (1) "Lessons Learnt" text showing on the KPI page, (2) PI selector not updating KPI data (always sending 26-PI2), (3) team selection not filtering KPI data to the selected team. After fixing those, the user requested two TFS deep-links per KPI — one for "followed" items (met the criterion) and one for "not followed" items (did not meet criterion). The last in-flight change (fixing URL length issues with large ID lists) was interrupted by compaction.
</overview>

<history>

1. **User reported "Lessons Learnt" text, PI always 26-PI2, and team not filtering**
   - Diagnosed: `KPISection` used `currentPI` (auto-detected, never changes) instead of `selectedPIs[0] || currentPI` (user-selected)
   - Diagnosed: "Lessons Learnt" text in two places — loading skeleton header (line 948) and main header chip (line 994)
   - Diagnosed: team filter worked in the backend (middleware strips `ROOT:`, `filterPath = teamPath || areaPath`), but the frontend `TeamRadar` and `TeamHeatmap` were always shown even when a team was selected — making it look like all-team data
   - Fixed `KPISection.jsx`:
     - Added `selectedPIs` to `useStore()` destructure
     - Added `const pi = (selectedPIs?.length ? selectedPIs[0] : null) || currentPI`
     - Changed `useKPI(currentPI, ...)` → `useKPI(pi, ...)`
     - Removed "Lessons Learnt" text from both locations
     - Changed `{data?.pi || currentPI}` → `{data?.pi || pi}` in info bar
     - Added `!selectedTeam &&` guard before `<TeamRadar>` and `<TeamHeatmap>` renders — they are hidden when a specific team is selected
   - Built frontend — 131 modules, 268ms, no errors

2. **User requested dual TFS links per KPI ("followed" and "not followed")**
   - Added `buildIdWiql(ids, wiType, notRemoved)` helper to `kpi.js` — builds `[System.Id] IN (...)` WIQL, capped at 500 IDs
   - Added `kpiSets` map (Phase 6b) in `kpi.js` — maps each KPI id to `{metIds, notMetIds, wiType}`
     - Attachment-based KPIs (exploratory, fmea, checklist, cross-review, impact): `notMetIds = featIds.filter(id => !set.has(id))`
     - Tag-based feature KPIs (ai-assisted, late-changes, say-do): same pattern with `featIds`
     - Tag-based defect KPIs (scenario-gap, regression, missed-standard, post-integration): same with `bugIds`
   - Updated KPI RAG loop to call `buildIdWiql` for both sets and add `tfsUrlMet`, `tfsUrlNotMet`, `metCount`, `notMetCount` to each KPI
   - Updated `KPISection.jsx` KPI card: replaced single `🔗 TFS` pill with two link badges — `✓ {metCount}` (green) and `✗ {notMetCount}` (red)
   - Updated modal footer: replaced single `🔗 TFS` button with `✓ Followed (N)` and `✗ Not Followed (N)` buttons
   - Built frontend successfully; restarted server (old server was running from before changes)

3. **Server was not running after restart attempt**
   - Background job approach (`&`) didn't persist the Node process
   - Fixed by using `Start-Process` with `-PassThru -WindowStyle Hidden` — PID 51628, confirmed listening on port 3000

4. **User reported: "when you have more ids wiql doesnt work in url"**
   - Root cause: For "not followed" sets (e.g., 63 out of 65 features missing mindmap), `[System.Id] IN (63 IDs)` makes the WIQL too long for URL encoding
   - Fix plan (interrupted by compaction): Replace `buildIdWiql` with a smart min-list approach:
     - **For tag-based KPIs**: use `NOT CONTAINS 'Tag'` WIQL — no IDs at all
     - **For attachment-based KPIs**: always use the *smaller* list — if the "not followed" set is large, use `NOT IN (small metIds)` + area/iteration filters instead of `IN (large notMetIds)`
     - Add `KPI_NOT_MET_WIQL` map for tag/state-based KPIs
     - Add `buildSmartUrlPair` helper that chooses `IN (smaller)` vs `NOT IN (other)` + area filter

</history>

<work_done>

Files modified:
- `client/src/sections/KPISection.jsx`
  - [x] Removed "Lessons Learnt" text (loading state + main header)
  - [x] Fixed PI: uses `selectedPIs[0] || currentPI`
  - [x] Team filter: `TeamRadar` and `TeamHeatmap` hidden when `selectedTeam` is set
  - [x] KPI card: dual `✓ N` / `✗ N` TFS link badges (replaced single `🔗 TFS`)
  - [x] Modal footer: dual `✓ Followed (N)` / `✗ Not Followed (N)` buttons
- `src/routes/kpi.js`
  - [x] Added `buildIdWiql` helper (500-ID cap)
  - [x] Added `kpiSets` map (Phase 6b) with metIds/notMetIds for all KPIs
  - [x] KPI RAG loop now sets `tfsUrlMet`, `tfsUrlNotMet`, `metCount`, `notMetCount`
  - [ ] **IN PROGRESS**: Fix URL length issue — need to replace ID-list approach with smart min-list + tag-based WIQL

Current state:
- Frontend: built and correct for dual links
- Backend: dual links work but URL is too long when the "not followed" set is large (e.g., 63 IDs)
- Server: running on PID 51628, port 3000
- **The URL-length fix was not yet implemented when compaction occurred**

</work_done>

<technical_details>

**PI selector vs currentPI:**
- `currentPI` in store = auto-detected "current" PI from backend (`piListData.currentPI`) — never changes interactively
- `selectedPIs` = user-selected PI array from top-bar PI selector
- All interactive sections (PIReadiness, Velocity) use `selectedPIs[0] || currentPI`. KPI was incorrectly using only `currentPI`

**Team filtering pattern:**
- Global Express middleware in `server.js` strips `ROOT:` prefix from `team` and `teamPath` query params before route handlers
- Backend sets `filterPath = teamPath || cfg.tfs.areaPath` — correct
- Frontend: when `selectedTeam` is set, TeamRadar and TeamHeatmap are hidden (they only make sense for cross-team view); KPI numbers already reflect the selected team via backend filter

**WIQL URL length problem (the in-flight fix):**
- `[System.Id] IN (id1, id2, ..., id63)` can create URLs >2000 chars, which TFS rejects
- Fix strategy:
  - **Tag-based KPIs** (scenario-gap, regression, missed-standard, post-integration, ai-assisted, late-changes): use `NOT CONTAINS 'Tag'` WIQL — zero IDs in URL
  - **State-based KPIs** (say-do, defect-analysis-time): use `[System.State] <> 'Done'` etc.
  - **Attachment-based KPIs** (exploratory, fmea, checklist, cross-review, impact): always use the **smaller** ID set:
    - If `metIds.length ≤ notMetIds.length`: use `IN (metIds)` for met link; use `NOT IN (metIds)` + area/iter for not-met link
    - If `notMetIds.length < metIds.length`: use `IN (notMetIds)` for not-met link; use `NOT IN (notMetIds)` + area/iter for met link
  - This guarantees the ID list is always ≤ N/2 in length (worst case ~30 IDs for 65 features)
  - TFS on-prem WIQL supports `[System.Id] NOT IN (...)` syntax

**buildSmartUrlPair design (pending implementation):**
```js
function buildSmartUrlPair(metIds, allIds, wiType, filterPath, iterQ, notRemoved, baseUrl) {
  const notMetIds = allIds.filter(id => !new Set(metIds).has(id));
  function wiqlForSet(targetIds, otherIds) {
    if (!targetIds.length) return null;
    if (targetIds.length <= otherIds.length) {
      return `... WHERE [System.Id] IN (${targetIds.join(',')}) AND ${notRemoved}`;
    }
    const excl = otherIds.length ? ` AND [System.Id] NOT IN (${otherIds.join(',')})` : '';
    return `... WHERE ... [System.AreaPath] UNDER '${filterPath}' AND ${iterQ} AND ${notRemoved}${excl}`;
  }
  return {
    tfsUrlMet:    metIds.length    ? buildTfsUrl(baseUrl, wiqlForSet(metIds, notMetIds))    : null,
    tfsUrlNotMet: notMetIds.length ? buildTfsUrl(baseUrl, wiqlForSet(notMetIds, metIds))    : null,
    metCount: metIds.length, notMetCount: notMetIds.length,
  };
}
```

**KPI_NOT_MET_WIQL map (pending implementation):**
```js
const KPI_NOT_MET_WIQL = {
  'scenario-gap-defects':        (ap, iq, nr) => `... Bug ... NOT [System.Tags] CONTAINS 'Scenario-Gap' ...`,
  'regression-defects':          (ap, iq, nr) => `... Bug ... NOT [System.Tags] CONTAINS 'Regression' ...`,
  'missed-standard-defects':     (ap, iq, nr) => `... Bug ... NOT [System.Tags] CONTAINS 'Missed-Standard' ...`,
  'post-integration-regression': (ap, iq, nr) => `... Bug ... NOT [System.Tags] CONTAINS 'Regression' ...`,
  'ai-assisted-usage':           (ap, iq, nr) => `... Feature ... NOT [System.Tags] CONTAINS 'AI-Assisted' ...`,
  'late-changes':                (ap, iq, nr) => `... Feature ... NOT [System.Tags] CONTAINS 'Late-Change' ...`,
  'say-do-ratio':                (ap, iq, nr) => `... Feature ... [System.State] <> 'Done' ...`,
  'defect-analysis-time':        (ap, iq, nr) => `... Bug ... [System.State] NOT IN ('Resolved','Closed') ...`,
};
```

**Server startup pattern:**
- Background job (`cmd &`) doesn't persist Node process in PowerShell
- Use `Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "..." -RedirectStandardOutput "server.log" -PassThru -WindowStyle Hidden`
- This creates a truly detached process with a stable PID

**`extractTeam` with team selection:**
- When `selectedTeam = Avyay` (a sub-team), `filterPath = Healthcare IT\ICAP\ISP\Hercules\Avyay`
- `extractTeam` extracts one level below root (`Healthcare IT\ICAP\ISP`), so returns `Hercules` — all Avyay features grouped under "Hercules"
- This is why hiding TeamBreakdown/Heatmap/Radar when team is selected is the right UX

</technical_details>

<important_files>

- `src/routes/kpi.js`
  - Core KPI backend route — all 15 KPI computations, RAG, TFS URL generation
  - **Needs the in-progress fix**: replace `buildIdWiql` + `kpiSets` approach with `buildSmartUrlPair` + `KPI_NOT_MET_WIQL` map
  - Key sections: helpers (~line 59-97), Phase 6b kpiSets (~line 218-240), RAG loop (~line 378-400)

- `client/src/sections/KPISection.jsx`
  - Full KPI Tracker React component (~1050+ lines)
  - Fully updated: dual TFS link badges on cards, modal dual buttons, PI fix, Lessons Learnt removed, team filter hides breakdown charts
  - Key sections: KPI card component (~line 490-560), modal footer (~line 260-300), main export (~line 908+)

- `client/src/api/hooks.js`
  - Contains `useKPI(pi, team)` hook at line ~328
  - Passes `teamPath: team` to `/api/kpi` endpoint
  - `staleTime: 15 * 60 * 1000`

- `client/src/store/useStore.js`
  - Contains `currentPI`, `selectedPIs`, `selectedTeam` state
  - `currentPI` = auto-detected; `selectedPIs` = user-selected (array)

- `server.js`
  - Has global middleware (line ~15-19) that strips `ROOT:` from `team` and `teamPath` query params
  - Registers `app.use('/api', require('./src/routes/kpi'))`

</important_files>

<next_steps>

**Immediate — in-flight fix needed:**

The WIQL URL length bug fix must be completed in `src/routes/kpi.js`:

1. Replace `buildIdWiql` function with `buildSmartUrlPair(metIds, allIds, wiType, filterPath, iterQ, notRemoved, baseUrl)` that:
   - Always uses `IN (smaller_set)` — so the ID list is never more than N/2
   - Uses `NOT IN (smaller_set)` + area/iteration filter for the larger set

2. Add `KPI_NOT_MET_WIQL` map (after `KPI_WIQL_FN`) for all tag/state-based KPIs using `NOT CONTAINS` and `<>` operators — no IDs needed at all

3. Update Phase 6b (`kpiSets`) and the RAG loop to:
   - Use `KPI_NOT_MET_WIQL[kpi.id]` for tag-based "not met" WIQLs
   - Use `buildSmartUrlPair` for attachment-based KPIs (exploratory, fmea, checklist, cross-review, impact)

4. Rebuild frontend (no frontend changes needed for this fix)

5. Restart server after backend change

</next_steps>