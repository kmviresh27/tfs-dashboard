<overview>
The session focused on: (1) fixing the border-radius on the Toggle (column switch) button in Super Admin, (2) creating a team announcement HTML slide for the multi-tenant release, (3) removing all "Philips" company-specific references from the codebase to make it generic and publishable on GitHub, and (4) fixing the Feature Cycle Time chart which was broken for both the on-prem TFS department and the Azure DevOps department. The approach was systematic source code scrubbing, `.gitignore` hardening, and root-cause debugging of two separate cycle time bugs.
</overview>

<history>

1. **User: "border-radius: 16px for Super Admin column switch button"**
   - Found `Toggle` component in `AdminSection.jsx` at line 502
   - Changed `borderRadius: 0` → `borderRadius: 16` for the toggle pill shape only
   - Rebuilt client successfully

2. **User: "want to publish multi-tenant feature to team — create nice HTML single slide"**
   - Created `D:\views\AV Dashboard\announcement-multi-tenant.html`
   - Full-screen dark-theme slide with animated grid background, glow orbs, feature cards, architecture diagram showing Dept A (TFS) + Dept B (ADO Cloud) tenants, stats row, "What's New" checklist, fade-in animations
   - Opened in browser

3. **User: "make sure no where Philips is mentioned — planning to generalize for public use"**
   - User asked to see where Philips was used first before removing
   - Full scan found references in: snapshot JSONs, `config.json`, `users.json`, `user-pats.json`, source code CSS class names (`brand-philips`, `topbar-philips`), JS/JSX files (hardcoded TFS field names like `Philips.Planning.Release`, `Philips.Defects.*`, placeholder URLs), and documentation HTML/MD files
   - User confirmed snapshots won't be committed to GitHub

4. **User: "snapshots anyway will not be uploading to github right?"**
   - Checked `.gitignore` — only had `node_modules/`, `config.json`, `*.log`, `.env`
   - Snapshots live in `data/departments/*/snapshots/` — NOT excluded!
   - Recommended adding `data/` to `.gitignore`

5. **User: "go ahead make sure it will not break existing functionality"**
   - Delegated full Philips scrub to general-purpose agent
   - Agent made all changes: `.gitignore` updated, CSS classes renamed, field mapping defaults cleared, WIQL queries made dynamic, docs updated
   - Build passed ✅
   - Post-build scan showed remaining references only in docs and `config.json` (live data, excluded by `.gitignore`)
   - Manually fixed all doc HTML files (`settings-guide.html`, `user-manual.html`, `ado-upgrade-guide.html` in both root and `docs/`) and `TFS-FIELD-DICTIONARY.md`
   - Final scan: zero Philips references in any source/doc file (only `config.json` which is in `data/` and excluded)

6. **User: "application not running"**
   - All old shell sessions had exited
   - Killed stray node processes, restarted server → running at `http://localhost:3000` ✅

7. **User: "Feature Cycle Time per Team — No cycle time data available. Features need to be in Done state."**
   - Found bug in `cycleTime.js` line 48: `getLastNPIs(n, fm.piStructure.piNamingPattern)` — passing pattern string as `pisPerYear` number (wrong arg order)
   - `getLastNPIs(n, pisPerYear, pattern)` — should be `getLastNPIs(n, fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern)`
   - When wrapping across years (PI1 → previous year), `curPI` became the pattern string `'{yy}-PI{n}'` instead of `4`, generating garbage PI labels
   - Also fixed hardcoded `'Done'` state → `fm.stateValues.featureDone`
   - Restarted server

8. **User: "still not working for ADO department"**
   - Checked ADO snapshot: 859 Done features exist with iteration paths like `DCP\PI26.2\PI26.2-SP2`
   - Added debug logging, restarted → API now returns 587 values with avg 158 days
   - Root cause: `stateChangeDateField` (`Microsoft.VSTS.Common.StateChangeDate`) returning null for ADO features → all items skipped at `if (!created || !stateDate) continue`
   - Fixed: now falls back to `Microsoft.VSTS.Common.ClosedDate` then `System.ChangedDate`

9. **User: "still not worked" — (byTeam still empty)**
   - User pasted full API response: data has 587 values but `byTeam: {}` and all features in `misassigned`
   - Root cause: `teamRootPath` is empty string `''` for ADO dept
   - `fetchLeafTeams` returns empty Set when `teamRootPath` is empty (line 16: `if (!teamRoots.length) return new Set()`)
   - `underRoot` always `false` → everything goes to `misassigned`
   - Fixed `cycleTime.js`: fall back to `cfg.tfs.areaPath` when `teamRootPath` not set
   - Restarted → **still not working** (pending resolution)
   - Discovered second problem: `fetchLeafTeams` itself also early-returns empty Set when `teamRootPath` is empty — the fix in `cycleTime.js` patches `underRoot` but `fetchLeafTeams` still returns empty Set, so `leafTeams.has(team)` is always false

</history>

<work_done>

Files modified:

- `client/src/sections/AdminSection.jsx` — Toggle borderRadius: 0 → 16
- `D:\views\AV Dashboard\announcement-multi-tenant.html` — Created (team announcement slide)
- `.gitignore` — Added `data/` and `dist/`
- `client/src/styles/main.css` — `.brand-philips` → `.brand-company`, `.topbar-philips` → `.topbar-company`
- `client/src/components/layout/Sidebar.jsx` — className `brand-philips` → `brand-company`
- `client/src/components/layout/Topbar.jsx` — className `topbar-philips` → `topbar-company`
- `src/helpers/fieldMappings.js` — All `Philips.*` field defaults → `''`
- `client/src/sections/SettingsSection.jsx` — Same field defaults cleared, description texts genericized
- `client/src/sections/AdminSection.jsx` — Placeholder URLs/org names genericized
- `src/routes/dashboard.js` — `|| 'Philips.Generic04'` → `|| ''`
- `src/helpers/dataProcessors.js` — `|| 'Philips.Rank'` and `|| 'Philips.Generic04'` → `|| ''`
- `src/routes/defects.js` — `|| 'Philips.Rank'` → `|| ''`
- `src/routes/insights.js` — `'Philips.Rank'` hardcoded → `df.rankField`
- `src/routes/snapshot.js` — `'Philips.Rank'` → `fm.fields.rankField`
- `client/src/data/helpContent.js` — `(Philips-style)` → `(short-year-style)`
- `client/src/sections/DefectsSection.jsx` — WIQL queries use configured field names (`_classFld`, `_projFld`, `_whereFld`) conditionally
- `client/src/sections/ReleaseHealthSection.jsx` — Shows configured `releaseField` from `useConfig()` instead of hardcoded string
- `client/src/store/useStore.js` — Default `appSubtitle: 'ISP Programme'` → `''`
- `data.example/` — Created with README.md, departments.json, users.json, user-pats.json
- `docs/settings-guide.html`, `settings-guide.html` — Philips refs → generic
- `docs/user-manual.html`, `user-manual.html` — Philips refs → generic
- `docs/ado-upgrade-guide.html` — Philips refs → generic  
- `docs/TFS-FIELD-DICTIONARY.md` — Philips field names → `Custom.*`
- `src/routes/cycleTime.js` — **Multiple fixes** (see technical details)

Current state:
- ✅ Server running (av-main5)
- ✅ Client built with all changes
- ✅ On-prem TFS cycle time fixed (wrong getLastNPIs arg order)
- ✅ ADO cycle time returns 587 values (date fallback fix)
- ❌ ADO byTeam still empty — `fetchLeafTeams` returns empty Set when `teamRootPath` not configured (fix partially applied but incomplete)

</work_done>

<technical_details>

**Philips scrub approach:**
- Philips-specific TFS field names (`Philips.Planning.Release`, `Philips.Defects.Classification`, etc.) were used as DEFAULTS in `fieldMappings.js`. These were cleared to `''`. Existing users' `config.json` in `data/` has explicit values, so they're unaffected.
- WIQL queries in frontend (DefectsSection, ReleaseHealthSection) used hardcoded `[Philips.*]` field names. Fixed to use configured values from `useConfig()` with conditional inclusion if field is empty.
- CSS class names `brand-philips`/`topbar-philips` were cosmetic only — renamed to `brand-company`/`topbar-company`.

**Cycle time bug 1 (on-prem TFS — wrong arg order):**
- `getLastNPIs(n, pisPerYear, pattern)` was called as `getLastNPIs(n, fm.piStructure.piNamingPattern)` — passing the pattern string as `pisPerYear`
- When wrapping from PI1 to previous year, `curPI = pisPerYear` set `curPI` to `'{yy}-PI{n}'` (string), generating broken PI labels like `'25-PI{yy}-PI{n}'`
- Fix: `getLastNPIs(n, fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern)`

**Cycle time bug 2 (ADO — missing dates):**
- `Microsoft.VSTS.Common.StateChangeDate` returned null for ADO features
- All items were silently dropped at `if (!created || !stateDate) continue`
- Fix: fallback chain: `stateChangeDateField` → `Microsoft.VSTS.Common.ClosedDate` → `System.ChangedDate`

**Cycle time bug 3 (ADO byTeam empty — incomplete fix):**
- `teamRootPath` is `''` for ADO dept
- `fetchLeafTeams()` has early return `if (!teamRoots.length) return new Set()` — returns empty Set
- `cycleTime.js` was fixed to use `areaPath` as fallback for `underRoot` check, but `fetchLeafTeams` STILL returns empty Set
- `leafTeams.has(team)` is always false → everything goes to `misassigned`
- **Root fix needed**: `fetchLeafTeams` must also fall back to `areaPath` when `teamRootPath` is empty

**`fetchLeafTeams` behavior:**
- Fetches `/_apis/wit/classificationnodes/areas?$depth=10` from TFS/ADO
- Finds root node matching `teamRootPath`, then collects leaf nodes (nodes with no children)
- Returns Set of leaf node names (e.g. `{"Butterflies", "Avengers", "Ravens", ...}`)
- When `teamRootPath` is empty, returns empty Set immediately without fetching

**ADO dept config:**
- `baseUrl: https://dev.azure.com/ALMP-ORG-P01/DCP`
- `iterationPath: DCP`, `areaPath: DCP`
- `piNamingPattern: 'PI{yy}.{n}'` → `PI26.2`, `PI26.1`, etc.
- `teamRootPath: ''` (not set — this is the root cause of byTeam being empty)
- Area paths look like: `DCP\IMS\Butterflies`, `DCP\Scanners\Avengers`, `DCP\Enterprise Pathology\Ravens`

</technical_details>

<important_files>

- **`src/routes/cycleTime.js`**
  - Feature Cycle Time API endpoint
  - Bug 1 fixed (getLastNPIs arg order), Bug 2 fixed (date fallback)
  - Bug 3 partially fixed: `underRoot` now falls back to `areaPath`, but `fetchLeafTeams` still returns empty Set
  - Line 48: `getLastNPIs` call, Line 55: featureDoneState, Lines 112-135: team extraction logic

- **`src/helpers/teamsHelper.js`**
  - `fetchLeafTeams(cfg)` — fetches area classification tree from TFS/ADO
  - **Line 16**: `if (!teamRoots.length) return new Set()` — **THIS IS THE REMAINING BUG** — must be fixed to fall back to `areaPath`
  - Returns Set of leaf team names used by cycleTime for byTeam breakdown

- **`src/helpers/fieldMappings.js`**
  - Backend field mapping defaults — all Philips.* defaults cleared to `''`
  - Existing users' config.json in `data/` has explicit values, so not affected

- **`client/src/sections/DefectsSection.jsx`**
  - WIQL queries now use `cfg?.fieldMappings?.fields?.defectClassificationField` etc. from `useConfig()`
  - Conditional inclusion: field clause only added if field name is non-empty

- **`client/src/sections/ReleaseHealthSection.jsx`**
  - Now uses `cfg?.fieldMappings?.fields?.releaseField` from `useConfig()` for display text and WIQL
  - Line 81: `openTFS` function uses `releaseField` variable

- **`data.example/`**
  - New folder with sample structure (README, departments.json, users.json, user-pats.json)
  - Shows new users what `data/` should contain

- **`announcement-multi-tenant.html`**
  - Team announcement slide for multi-tenant release
  - Standalone HTML file, dark theme, full-screen, animated

</important_files>

<next_steps>

**Immediate — fix remaining byTeam bug:**

The core issue is in `src/helpers/teamsHelper.js` line 16:
```js
if (!teamRoots.length) return new Set();
```
When `teamRootPath` is empty (ADO dept), this returns empty Set immediately. Fix needed:
```js
// Fall back to areaPath when teamRootPath not configured
const effectiveRoots = teamRoots.length ? teamRoots
  : cfg.tfs.areaPath ? [cfg.tfs.areaPath] : [];
if (!effectiveRoots.length) return new Set();
```
Then use `effectiveRoots` instead of `teamRoots` in the rest of the function.

After this fix, rebuild is NOT needed (server-side only change), just restart server.

**Other pending:**
- Verify the cycle time per-team chart actually renders once `byTeam` is populated
- Check if there are other places that use `teamRootPath` with the same empty-fallback gap (e.g. `insights.js`, `dashboard.js` team extraction)

</next_steps>