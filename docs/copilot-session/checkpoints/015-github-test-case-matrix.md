<overview>
The AV Dashboard is a live TFS monitoring dashboard for Philips Healthcare IT ISP Programme (Node.js/Express + Vanilla HTML/JS/CSS, Filament dark theme). This session focused on integrating GitHub unit test data into the Test Coverage section. The approach evolved from trying to fetch CI artifacts (blocked by GitHub SAML SSO) → to scanning test files directly from repo trees (no CI run needed) → to counting actual test cases by reading blob contents to build a live test case matrix.
</overview>

<history>

1. **User reported 401 from GitHub API (session carry-over)**
   - Previous session had implemented `/api/github-coverage` endpoint fetching CI artifacts
   - Fine-grained PAT (`github_pat_...`) was giving 401 Bad Credentials
   - Diagnosed: `philips-internal` org enforces SAML SSO; fine-grained PATs need org-admin approval
   - Advised user to create Classic PAT (`ghp_...`) + Configure SSO → Authorize philips-internal

2. **User reported 404 errors after token update**
   - User had updated to Classic PAT `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` via Settings UI
   - Discovered branch filter `&branch=main` was wrong — PR check workflows run on feature branches
   - `av-apps/unit-tests.yml` didn't exist; correct workflow is `av_common_pr_check.yml`
   - Fixed: removed branch filter, updated av-apps workflow name in config.json

3. **User reported 403 SAML enforcement**
   - Error changed to: "Resource protected by organization SAML enforcement"
   - Direct test confirmed Classic PAT also gives 403 with full SAML error message
   - Root cause: even Classic PAT needs **Configure SSO → Authorize philips-internal** step
   - Provided exact steps with URL

4. **User asked to "look for test files instead of artifacts"**
   - Pivot: instead of downloading CI artifacts (requires workflow changes + SSO), scan repo tree directly
   - Implemented `scanTestFiles()` on server: uses GitHub Trees API (`?recursive=1`) to list all files
   - Filter by pattern: `*.spec.ts` for Angular, `*Tests.cs`/`*Test.cs` for .NET
   - No CI workflow changes needed; only requires PAT with SSO authorization
   - Replaced artifact-based endpoint with test-file scanning approach
   - Updated UI: new cards show test file count + module breakdown
   - Updated `index.html`: new table headers (Test Files, Modules, Scanned At)
   - **Result**: All 3 repos returned data — GfnApps 75 files/36 modules, SystemServices 51 files, AV Apps truncated (7 files)

5. **User asked for a test case matrix**
   - Extend scan to count actual test METHOD counts per file/module by reading blob contents
   - Added `countBlobTestMethods()`: batches blob reads (10 at a time), counts `it(` (Angular) or `[TestMethod]/[Test]/[Fact]/[Theory]` (.NET)
   - Updated `scanTestFiles()` to call method counter and return `testCaseCount` per module
   - Updated `renderGithubCoverage()` with full matrix UI: repo header rows + module rows + density bar
   - Added `densityBar()` helper: mini progress bar showing cases/file ratio (RAG coloured)
   - Updated table headers: Repository/Module | Status | Test Files | Test Cases | Density | Scanned At
   - **Result**: GfnApps 196 test cases, SystemServices 407 test cases, AV Apps still truncated

6. **AV Apps truncation fix — in progress**
   - `av-apps` root tree truncated → updated `searchPath` from none → `"av"` → `"av/Applications/Src"`
   - Sub-tree navigation implemented: walks path segments, finds SHA at each level, uses subtree for recursive scan (avoids root truncation)
   - With `"av/Applications/Src"`: truncated=false but 0 files — filename pattern wrong
   - Investigated: test files named `Given_*.cs` inside `FcmrTests/Specs/` — NOT named `*Tests.cs`
   - Verified they DO use `[TestMethod]` (MSTest); detection issue is purely the **filename filter**
   - Fix needed: detect dotnet test files by **folder path** (files inside `*Tests/` dirs) rather than filename
   - **Currently in progress** — code fix not yet applied

</history>

<work_done>

Files modified:

- `D:\views\AV Dashboard\server.js`
  - Removed artifact-based approach entirely (removed `normaliseCoverage`, `AdmZip` usage)
  - Added `countBlobTestMethods(owner, repo, files, hdrs, type)` — reads blob contents in batches of 10, counts test methods via regex
  - Added `scanTestFiles(owner, repo, hdrs, type, searchPath)` — gets repo tree, navigates sub-tree via path segments to avoid truncation, filters test files, calls method counter, groups by module
  - Updated `/api/github-coverage` endpoint to call `scanTestFiles` and return `test_scan` or `no_tests` status
  - **Pending fix**: file detection pattern for dotnet currently `[Tt]ests?\.cs$` — needs to also match `.cs` files inside `*Tests*/` directories (for av-apps BDD-style tests)

- `D:\views\AV Dashboard\config.json`
  - Updated `github.repos` — removed `workflowFile`, `artifactName`, `branch` fields
  - Added `type` field (`"angular"` or `"dotnet"`) to each entry
  - Added `searchPath` to scope tree scanning: GfnApps→`"illumeo/GfnApps/Src/I4App"`, SystemServices→`"illumeo/SystemServices"`, AV Apps→`"av/Applications/Src"`
  - Token is currently `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` (Classic PAT, needs SSO authorization)

- `D:\views\AV Dashboard\public\app.js`
  - Replaced `renderGithubCoverage()` — now handles `test_scan`/`no_tests`/`api_error` statuses, renders KPI cards with test case counts (RAG coloured), renders matrix table with repo + module rows
  - Added `densityBar(cases, files)` helper function
  - Updated `clearGithubCoverage()` — colspan changed from 7 → 6

- `D:\views\AV Dashboard\public\index.html`
  - Updated `ghCoveragePanel` card title → "🧪 Unit Test Inventory (GitHub)"
  - Updated `ghCoverageDetailPanel` card title → "🧪 Unit Test Case Matrix"
  - Updated table headers: Repository/Module | Status | Test Files | Test Cases | Density | Scanned At
  - Updated default tbody → colspan=6

Current state:
- ✅ GfnApps: 75 spec files, 196 test cases, 36 modules — fully working
- ✅ SystemServices: 51 test files, 407 test cases, 2 modules — fully working
- ❌ AV Apps: 0 test files found — filename detection pattern needs fix (files named `Given_*.cs` inside `FcmrTests/Specs/`, not `*Tests.cs`)
- ⚠️ SAML SSO: token `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` still giving 403 — needs "Configure SSO → Authorize philips-internal" step by user. (Copilot CLI tools work because they have separate auth)

</work_done>

<technical_details>

**GitHub SAML SSO enforcement:**
- `philips-internal` org enforces SAML SSO at enterprise (`royal-philips`) level
- Fine-grained PATs (`github_pat_...`) → need org admin approval (user cannot self-approve)
- Classic PATs (`ghp_...`) → need "Configure SSO → Authorize" which user CAN do themselves
- Even Classic PATs return 403 "Resource protected by organization SAML enforcement" until SSO authorized
- GitHub returns 404 for private resources when auth fails (security through obscurity) — this caused initial confusion
- Copilot CLI tools can access `philips-internal` repos because they use Copilot's own separate auth

**Test file detection — av-apps structure:**
- av-apps source code is all under `av/` subdirectory
- Test projects: `av/Applications/Src/FcmrTests`, `SpatialTests`, `LafcmrTests`, `MappingTests`, `PreProcessingJobTests`, `TemporalTests`
- Test FILES inside these projects are in `Specs/` subfolder and named `Given_*.cs` (BDD-style)
- BUT they use standard MSTest (`[TestClass]` + `[TestMethod]`) internally
- Current detection pattern `[Tt]ests?\.cs$` matches file NAMES → misses `Given_*.cs`
- Fix: match `.cs` files that have `*Tests*/` anywhere in their path: `/[Tt]ests?\//.test(f.path)`
  - This correctly matches `FcmrTests/Specs/Given_...cs` (contains `Tests/` from `FcmrTests/`)
  - Does NOT match `TestFramework/Helper.cs` (char after `Test` is `F` not `/`)

**GitHub Trees API truncation:**
- Recursive tree API truncates at ~100k files or large repo size
- `av-apps` root tree is truncated; even `av/` subtree is truncated
- Fix: navigate into sub-tree SHA segment by segment before requesting `?recursive=1`
- `av/Applications/Src` (3 levels deep) works without truncation
- Sub-tree navigation: for each path segment, get parent tree (non-recursive), find entry SHA, repeat

**Module grouping heuristic:**
- Groups test files by `parts[parts.length - 3]` (3rd-from-last path segment)
- For `FcmrTests/Specs/Given_...cs` → groups under `FcmrTests` ✅
- For `SystemServices/Tests/SomeTests.cs` → groups under `Tests` (less ideal, but works)
- For Angular `src/app/controls/foo/foo.spec.ts` → groups under `controls` ✅

**Test case counting:**
- Angular: counts `\bit\s*\(` occurrences in blob content (each `it(` = one test case)
- .NET: counts `[TestMethod]`, `[Test]`, `[Fact]`, `[Theory]` attribute occurrences
- Blobs fetched via `GET /repos/{owner}/{repo}/git/blobs/{sha}` (SHA from tree entry)
- Content returned as base64 — must strip newlines before decoding: `.replace(/\n/g, '')`
- Batched 10 at a time with `Promise.all` to avoid rate limits

**Density bar:**
- Visual bar: 20 cases/file = 100% width
- Green ≥60%, Amber ≥25%, Red <25%
- Shows cases/file average as tooltip

**Settings UI updates config.json:**
- When user saves GitHub settings via Settings UI, `POST /api/config` updates config.json
- This is why `ghp_5VFkqBp...` token appeared in config.json (user had updated via UI)

</technical_details>

<important_files>

- `D:\views\AV Dashboard\server.js`
  - Main backend — Node.js/Express server
  - Contains `scanTestFiles()` (~line 1684), `countBlobTestMethods()` (~line 1686), `/api/github-coverage` endpoint (~line 1743)
  - **Pending change**: line ~1766 file filter `pat.test(f.path)` needs to change from filename-only to path-aware detection for dotnet

- `D:\views\AV Dashboard\public\app.js`
  - Main frontend logic (~4400+ lines)
  - `renderGithubCoverage()` — renders KPI cards + matrix table (~line 4359)
  - `densityBar()` — mini density bar helper (after renderGithubCoverage)
  - `clearGithubCoverage()` — clears the UI (~line 4318)
  - `loadGithubCoverage()` — fetches API + calls render (~line 4327)

- `D:\views\AV Dashboard\public\index.html`
  - `#ghCoveragePanel` (data-tc-group="2") ~line 1071: overview card with KPI strip
  - `#ghCoverageDetailPanel` (data-tc-group="5") ~line 1098: matrix table with 6-column header
  - `#ghCoverageBody`: tbody for matrix rows

- `D:\views\AV Dashboard\config.json`
  - Contains `github` section with token + 3 repo entries
  - Each repo: `owner`, `repo`, `label`, `type`, `searchPath`
  - Current token: `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` (needs SSO authorization)

</important_files>

<next_steps>

**Immediate — fix av-apps test file detection:**

In `server.js` `scanTestFiles()`, line ~1766, change:
```javascript
const files = (tree || []).filter(f => f.type === 'blob' && pat.test(f.path));
```
To path-aware detection for dotnet:
```javascript
const files = (tree || []).filter(f => {
  if (f.type !== 'blob') return false;
  if (type === 'angular') return /\.spec\.(ts|js)$/i.test(f.path);
  // dotnet: files named *Tests.cs OR any .cs inside a *Tests*/ directory
  return /\.cs$/i.test(f.path) &&
    (/[Tt]ests?\.cs$/i.test(f.path) || /[Tt]ests?\//.test(f.path));
});
```
Also remove the now-unused `const pat = type === 'angular' ? ... : ...` line from `scanTestFiles` (keep it only in `countBlobTestMethods`).

**After code fix — retest av-apps:**
- Should now find `FcmrTests/Specs/Given_*.cs` files
- Should count `[TestMethod]` correctly
- Verify truncated=false with `av/Applications/Src` searchPath

**Remaining concern — SAML SSO:**
- User's token still giving 403 until they complete SSO authorization
- Copilot CLI tools work independently — test results above used CLI auth, not user's PAT
- Once user completes SSO step: `github.com/settings/tokens` → find `ghp_5VFkqBp...` → Configure SSO → Authorize → philips-internal

**Also check:** `av/Suites` may contain additional test projects (ViewerTests, MRCardiacCommonTests, QFlowTests, CcaTests not yet found in Applications/Src). May need a second repo entry or `searchPaths` array support.

</next_steps>