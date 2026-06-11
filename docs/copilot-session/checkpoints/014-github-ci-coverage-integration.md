<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme (Node.js/Express + Vanilla HTML/JS/CSS, Filament dark theme). This session had three main goals: (1) complete the team tree dropdown fix (LCP-based area path tree), (2) finish TC PI selector removal and global filter integration, and (3) add a new GitHub CI unit test coverage feature that fetches coverage artifacts from `philips-internal/cmr-apps-AVW15` and `philips-internal/av-apps` GitHub repos and displays them in the Test Coverage section. The approach was to analyze both GitHub repos to understand their tech stack, then design a full-stack integration (CI workflows + server endpoint + dashboard UI).
</overview>

<history>

1. **Session resumed — completing team tree fix and TC PI selector removal (carried over)**
   - Fixed `buildAreaTree()` to use LCP (longest-common-path-prefix) approach instead of configured roots
   - Rewrote function signature from `buildAreaTree(items, roots)` to `buildAreaTree(items)` — no longer depends on `teamRootPath` config
   - Fixed `setupTeamFilter` to call `initTestCoverage()` instead of the removed `#tcPICheckGrid` reference
   - Added `if (activeSection === 'test-coverage') initTestCoverage()` to `piFilterApply`
   - Removed dead `#tcPICheckGrid` sync block from `loadTestCoverage`
   - Verified syntax clean, server responding 200

2. **User provided two GitHub repos for unit test coverage analysis**
   - Repos: `philips-internal/cmr-apps-AVW15` and `philips-internal/av-apps`
   - Explored repo structures, CI workflows, test projects
   - Found: both repos are C# / MSBuild (.NET) based on Windows self-hosted runners
   - `cmr-apps-AVW15` has two components:
     - **GfnApps/I4App**: Angular app with Karma + `karma-coverage-istanbul-reporter` — CI workflow already runs `npm run coverage` with `-WithCoverage "1"` flag; output copied to `artifacts\coverage\i4-app\` but NOT uploaded as GitHub artifact
     - **SystemServices**: C# with OpenCover script locally (`RunCoverageMsTest.cmd`) but OpenCover is NOT in CI, only vstest runs in `SystemServices-PR-check.yml`
   - `av-apps` has 11 test `.csproj` files (`FcmrTests`, `ViewerTests`, `SpatialTests`, `MRCardiacCommonTests`, `QFlowTests`, `CcaTests`, `LaFcmrTests`, etc.) but **no test/coverage step in any CI workflow**
   - Coverage data is not currently accessible via GitHub API — no artifacts exist

3. **User chose: add OpenCover/coverlet to CI workflows and upload artifacts**
   - Designed standardized `coverage-summary.json` format compatible with both Istanbul (Angular) and OpenCover (C#)
   - Installed `adm-zip` npm package for ZIP artifact extraction in dashboard server
   - Added `"github"` section to `config.json` with token placeholder and 3 repo entries
   - Added `GET /api/github-coverage` endpoint to `server.js` — fetches latest workflow run → finds artifact → downloads ZIP → parses JSON → normalises format
   - Added `normaliseCoverage()` helper — handles both Istanbul json-summary format (`total.lines.pct`) and custom OpenCover-derived format (`lines`, `branches`, `functions`)
   - Updated `GET /api/config` to expose `github.token` masked + `github.repos`
   - Updated `POST /api/config` to save `github.token` and `github.repos`
   - Replaced "Unit Tests not tracked in TFS" placeholder card (group 2) in index.html with live GitHub coverage overview card
   - Added new `#ghCoverageDetailPanel` (group 5) with full breakdown table
   - Added "GitHub Coverage" settings card to Settings section with PAT input + repos JSON editor
   - Added `loadGithubCoverage()`, `renderGithubCoverage()`, `clearGithubCoverage()`, `fmtCov()`, `ragCovPct()` functions to app.js
   - Called `loadGithubCoverage()` at end of `loadTestCoverage()` so it auto-loads when TC section opens
   - Added GitHub form submit handler in `setupSettingsForms()`
   - Updated `loadSettingsForm()` to populate GitHub token placeholder and repos JSON
   - Updated `buildSlideshowSlides()` to add group 5 slide conditionally when GitHub is configured
   - Generated 4 CI workflow files saved to session artifacts folder
   - Improved error response to include GitHub's error message body (not just HTTP status)

4. **User reported 401 error from GitHub API**
   - Token was present (`github_pat_...` fine-grained PAT, length 93)
   - Direct API test confirmed: `"Bad credentials"` from GitHub
   - Diagnosed: `philips-internal` org uses SAML SSO; fine-grained PATs require org admin approval OR classic PAT needs SSO authorization
   - Updated server to return full GitHub error message in response (not just HTTP status code)
   - Provided fix instructions: use Classic PAT with `repo` scope + SSO authorize for `philips-internal`

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\public\app.js`
  - `buildAreaTree(items)` — rewritten with LCP algorithm, no configured roots required
  - `populateTeamFilter()` — updated to call `buildAreaTree(allItems)` without roots arg
  - `setupTeamFilter()` — fixed TC reload to call `initTestCoverage()` instead of `#tcPICheckGrid`
  - `piFilterApply()` — added `if (activeSection === 'test-coverage') initTestCoverage()`
  - `loadTestCoverage()` — removed dead `#tcPICheckGrid` sync block; added `loadGithubCoverage()` call at end
  - `buildSlideshowSlides()` — TC now has dynamic slide count; group 5 added when `state.ghCoverageData?.configured`
  - `loadSettingsForm()` — populates GitHub token placeholder and repos JSON
  - `setupSettingsForms()` — added `githubForm` submit handler
  - Added: `clearGithubCoverage()`, `loadGithubCoverage()`, `renderGithubCoverage()`, `ragCovPct()`, `fmtCov()` at end of file

- `D:\views\AV Dashboard\public\index.html`
  - Replaced "Unit Tests Not tracked in TFS" placeholder card with `#ghCoveragePanel` (`data-tc-group="2"`)
  - Added `#ghCoverageDetailPanel` (`data-tc-group="5"`) with full breakdown table `#ghCoverageTable`/`#ghCoverageBody`
  - Added "GitHub Coverage (Unit Tests)" settings card with `#githubForm`, `#s-ghToken`, `#s-ghRepos`, `#githubFormStatus`

- `D:\views\AV Dashboard\server.js`
  - Updated `GET /api/config` to expose `github.token` (masked) and `github.repos`
  - Updated `POST /api/config` to save `github.token` and `github.repos`
  - Added `normaliseCoverage(raw)` helper function
  - Added `GET /api/github-coverage` endpoint
  - Improved error reporting: returns GitHub's error message body in `api_error` status

- `D:\views\AV Dashboard\config.json`
  - Added `"github"` section with token (currently set to a bad-credential fine-grained PAT) and 3 repo entries

- `D:\views\AV Dashboard\package.json`
  - Added `adm-zip` dependency (installed)

Session artifact files created:
- `session-state/files/ci-workflows/cmr-apps-AVW15-GfnApps-PR-check-with-coverage.yml`
- `session-state/files/ci-workflows/cmr-apps-AVW15-SystemServices-PR-check-with-coverage.yml`
- `session-state/files/ci-workflows/av-apps-unit-tests.yml`
- `session-state/files/ci-workflows/karma-conf-js-patch.md`

Current state:
- ✅ Team tree dropdown: LCP algorithm works for any area paths including multi-root paths
- ✅ TC PI selector removed; uses global PI filter
- ✅ `piFilterApply` reloads TC when active
- ✅ GitHub coverage server endpoint implemented and responding
- ✅ Dashboard UI shows GitHub coverage overview + detail table
- ✅ Settings form for GitHub token/repos
- ✅ Slideshow includes group 5 when GitHub configured
- ❌ GitHub API returning 401 "Bad credentials" — PAT needs to be replaced with a Classic PAT that has SSO authorization for `philips-internal` org
- ❌ CI workflows not yet PRed to the repos — artifacts don't exist yet (separate work item)

</work_done>

<technical_details>

**Team tree LCP algorithm:**
- `buildAreaTree(items)` collects all unique normalized area paths from items
- Finds longest common path-segment prefix segment-by-segment across all paths
- Strips one extra level so the first diverging node is the tree root (e.g., all share `Healthcare IT\ICAP\ISP` → tree starts at `Hercules`, `Apollo`, etc.)
- `pathToAbs[relKey]` maps relative trie key → full absolute path for filter use
- `tf-toggle` click → expand/collapse only; clicking node row label → selects as filter
- Filter values use `ROOT:fullAbsolutePath` prefix; `teamMatchesFilter` handles via `startsWith`

**GitHub coverage API flow:**
- `GET /api/github-coverage` → for each configured repo:
  1. `GET /repos/{owner}/{repo}/actions/workflows/{workflowFile}/runs?status=completed&branch={branch}&per_page=5` → get latest run
  2. `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` → find artifact by name
  3. `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip` → download ZIP (node-fetch follows redirects)
  4. `new AdmZip(buffer)` → extract `coverage-summary.json` → `normaliseCoverage()`
- Uses `node-fetch` v2 (CommonJS): `.buffer()` method for ZIP download
- `adm-zip` handles in-memory ZIP extraction without temp files

**`coverage-summary.json` standard format (for CI workflows to produce):**
```json
{
  "timestamp": "...", "runNumber": 42, "sha": "abc12345",
  "lines": 85.3, "branches": 72.1, "functions": 80.5, "statements": 84.9,
  "modules": [{ "name": "...", "lines": 85.3, "branches": 72.1, "functions": 80.5 }]
}
```
- `normaliseCoverage()` also handles Istanbul json-summary format (from Angular Karma): `{ total: { lines: { pct: 85.3 } } }`

**GitHub 401 "Bad credentials" root cause:**
- `philips-internal` organization uses SAML SSO
- Fine-grained PATs (`github_pat_...`) require **org admin approval** in org settings → Personal access tokens → Pending requests
- Classic PATs need **SSO authorization**: GitHub → Settings → Developer settings → PAT → Configure SSO → Authorize `philips-internal`
- Required scopes for Classic PAT: `repo` (includes actions:read for private repos)

**CI workflow requirements (not yet implemented in repos):**
- **cmr-apps-AVW15/GfnApps**: Also needs `karma.conf.js` change to add `'json-summary'` to `coverageIstanbulReporter.reports` array
- **cmr-apps-AVW15/SystemServices**: OpenCover is already in repo at `CT_SW_Tools\OpenCover\OpenCover.Console.exe`
- **av-apps**: New `unit-tests.yml` workflow needed; build target path in msbuild command needs verification against actual project structure
- All workflows: use `-register:user` for OpenCover (avoids admin requirement on self-hosted runners)

**Slideshow group assignment (Test Coverage section):**
- Group 1: KPI strip + Automation/Team charts
- Group 2: Test Runs + Feature Coverage + GitHub coverage overview card (`#ghCoveragePanel`)
- Group 3: Uncovered Features table
- Group 4: TC vs Snapshot delta (only when snapshot active)
- Group 5: GitHub coverage detail breakdown table (`#ghCoverageDetailPanel`)
- `buildSlideshowSlides` dynamically counts total based on `hasGHCov` and `hasTCSnap`

**`state.ghCoverageData`** — stored after first `loadGithubCoverage()` call, used by slideshow to determine if group 5 should be included.

</technical_details>

<important_files>

- `D:\views\AV Dashboard\public\app.js`
  - Main frontend logic (~4380 lines)
  - `buildAreaTree` ~line 2750: LCP-based tree builder (no roots arg)
  - `renderTeamTree` ~line 2810: renders trie to HTML
  - `setupTeamFilter` ~line 2855: panel events + TC reload fix
  - `populateTeamFilter` ~line 2900: calls `buildAreaTree(allItems)`
  - `piFilterApply` ~line 240: now reloads TC when active
  - `buildSlideshowSlides` ~line 3221: TC groups 1-5 with dynamic total
  - `loadGithubCoverage` / `renderGithubCoverage` / `clearGithubCoverage`: added at end of file (~line 4290+)
  - `setupSettingsForms`: GitHub form handler added at end (~line 1483)
  - `loadSettingsForm`: GitHub token placeholder + repos JSON (~line 1386)

- `D:\views\AV Dashboard\public\index.html`
  - TC section ~line 997: group 2 now has `#ghCoveragePanel` (replaced placeholder)
  - `#ghCoverageDetailPanel` with `data-tc-group="5"`: added after uncovered features table, before tcDeltaPanel
  - Settings section: GitHub Coverage card with `#githubForm`, `#s-ghToken`, `#s-ghRepos`

- `D:\views\AV Dashboard\server.js`
  - `normaliseCoverage()` + `GET /api/github-coverage`: added before `app.listen` (~line 1670)
  - `GET /api/config`: now includes `github` section (~line 468)
  - `POST /api/config`: handles `body.github` (~line 493)

- `D:\views\AV Dashboard\config.json`
  - Contains `"github"` section with token (currently invalid — needs replacement with SSO-authorized Classic PAT) and 3 repo entries

- `C:\Users\320043346\.copilot\session-state\205afd8b-9376-4f51-8b1d-28a7575f85ec\files\ci-workflows\`
  - 4 files: workflow YAMLs + karma patch notes — ready to PR to the GitHub repos

</important_files>

<next_steps>

**Immediate blocker — GitHub 401:**
- User must replace the current fine-grained PAT with a **Classic PAT** having `repo` scope
- After creating classic PAT: click **Configure SSO** → **Authorize** for `philips-internal` org
- Paste new token in **Settings → GitHub Coverage** on the dashboard

**CI workflow PRs (separate work — user needs to do):**
1. PR `cmr-apps-AVW15-GfnApps-PR-check-with-coverage.yml` to replace `GfnApps-PR-check.yml`
   - Also edit `illumeo/GfnApps/Src/I4App/i4-app/karma.conf.js`: change `reports: ['html', 'lcovonly']` → `reports: ['html', 'lcovonly', 'json-summary']`
2. PR `cmr-apps-AVW15-SystemServices-PR-check-with-coverage.yml` to replace `SystemServices-PR-check.yml`
3. PR `av-apps-unit-tests.yml` as new file `.github/workflows/unit-tests.yml` — **verify the msbuild target path** (`av\CT_SW_Tools\Build\ISP.Targets_.proj`) before merging

**After workflows produce artifacts:**
- Dashboard will auto-load coverage when Test Coverage tab is opened
- Slideshow will gain group 5 slide automatically

**Potential future enhancements:**
- Coverage trend over time (store last N artifact runs)
- Coverage threshold alerts (red badge in nav if coverage drops below RAG thresholds)
- Test pass/fail counts from TRX artifacts

</next_steps>