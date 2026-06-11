<overview>
This session focused on iterative improvements to the AV Dashboard (Node.js/React application) — covering GitHub commit/repo management, Swagger API documentation, branding enhancements (logo upload), layout changes (topbar/sidebar), and Health section bug fixes. The user (KM Viresh) made incremental UI/UX requests and the assistant implemented, built, and pushed each change to `https://github.com/philips-internal/av-tfs-dashboard`. The final task in progress was adding the GitHub Coverage card from TestCoverageSection into HealthSection with a "Unit Test Coverage" title.
</overview>

<history>

1. **GitHub commit — cleanup of root HTML files**
   - After initial push of 172 files, user noted root HTML files shouldn't be committed
   - Removed `announcement-multi-tenant.html`, `settings-guide.html`, `user-manual.html` via `git rm` + push
   - User then asked to remove `av-dashboard-demo.html` too → removed and pushed
   - User renamed repo to `av-tfs-dashboard` → updated remote URL with `git remote set-url`

2. **Added Swagger UI (`/api-docs`)**
   - Installed `swagger-ui-express` + `swagger-jsdoc`
   - Created `src/swagger.js` — comprehensive static OpenAPI 3.0 spec covering 100+ endpoints across 25 tags
   - Mounted at `/api-docs` in `server.js` with Philips blue topbar branding
   - Both `/api` and `/api/d/{deptId}` server variants documented
   - Reusable parameter components: `piFilter`, `teamPath`, `sprint`, `deptId`
   - Committed and pushed

3. **Branding: SVG logo upload**
   - User: "Logo SVG is supported I should be able to upload on branding page"
   - Added `useRef` import to `SettingsSection.jsx`
   - Added `svgFileRef`, hidden file input, "📁 Upload .svg file" button, SVG preview box, Clear button
   - Added `title={branding.companyName}` to SVG span and img in `Sidebar.jsx`

4. **Branding: support PNG and JPEG too**
   - User: "either svg, png or jpeg"
   - Changed `accept` to `.svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg`
   - SVG → `readAsText` → stored in `logoSvg`; PNG/JPEG → `readAsDataURL` → stored in `logoUrl`
   - Clear button handles both cases; label changed to "Logo Image"

5. **Layout: move logo to topbar, remove from sidebar**
   - User: "topbar-company here use logo and remove brand-logo"
   - `Topbar.jsx`: logo (SVG/img) rendered inside `topbar-company` span, 24×24
   - `Sidebar.jsx`: removed entire `brand-logo` div block

6. **Topbar: logo only, no company text**
   - User: "topbar-company in this remove text and provide only height for img"
   - Removed company name text from `topbar-company`
   - Logo renders at `height: 28px, width: auto` (aspect ratio preserved)
   - Separator `|` only shown when logo exists

7. **Sidebar: remove brand-company**
   - User: "brand-company better remove this"
   - Removed `<div className="brand-company">` from Sidebar brand-text block

8. **Health section: KPI cards not updating on team selection**
   - User: "Q2 2026 Escape Ratio, Defects Aging 30+ Days and Avg Cycle Time (all teams) not getting updated"
   - Root cause 1: `avgCycleAll` always averaged ALL teams (`useCycleTimeDistribution(null, 4)` with no team), never filtered by `selectedTeam`
   - Root cause 2: `aging30Plus` useMemo missing `selectedTeam` dependency
   - Root cause 3: Escape Ratio KPI showed blank `—` silently during re-fetch; no loading indicator
   - Fix: Added `activeTeamName` derived from `selectedTeam`; `avgCycleAll` now filters `cycleData.byTeam` by `activeTeamName`; added `selectedTeam` to aging deps; added `…` spinner for `escapeLoading`
   - KPI labels now show team name dynamically: `"Q2 2026 Escape Ratio · Team Alpha"`

9. **Escape Ratio chart: dots only + 15% threshold**
   - User: "show instead of line just show dot for escape ratio percentage" + "15% is threshold"
   - Changed escape ratio dataset: `showLine: false`, `pointRadius: 7`, dots turn red when > 15%
   - Added data labels above each dot showing the % value
   - Added red dashed annotation line at 15% on `yRatio` axis with label "15% threshold"

10. **Escape Ratio chart: hide future quarters**
    - User: "if we are in Q2 why are you showing dot 0% for future quarters?"
    - Fixed `quarterRows` useMemo: for current year, filter to `q.quarter <= defaultQuarter`; past years show all 4; future years show none

11. **Health section: add GitHub Coverage (in progress)**
    - User: "from test coverage section add GitHub Coverage to Health section title should be Unit test coverage"
    - Began by reading `GitHubCoverageCard` component in `TestCoverageSection.jsx` (lines 41–165+)
    - **NOT YET COMPLETED** — summary was triggered mid-task

</history>

<work_done>

Files modified in `D:\views\AV Dashboard`:

- `server.js` — Added Swagger UI mount (`/api-docs`); previously removed cacheMiddleware
- `src/swagger.js` — **Created** — Full OpenAPI 3.0 spec, 100+ endpoints, 25 tags
- `client/src/sections/SettingsSection.jsx` — Added `useRef`, SVG/PNG/JPEG file upload, live preview, clear button; label changed to "Logo Image"
- `client/src/components/layout/Sidebar.jsx` — Removed `brand-logo` div; removed `brand-company` div; added `title={companyName}` on logo elements (then logo rendering removed when moved to topbar)
- `client/src/components/layout/Topbar.jsx` — Logo (SVG/img, `height:28, width:auto`) rendered in `topbar-company`; no company text; separator only when logo exists
- `client/src/sections/HealthSection.jsx`:
  - Added `activeTeamName` useMemo
  - Fixed `avgCycleAll` to filter by `activeTeamName`
  - Added `selectedTeam` to `aging30Plus` deps
  - Added `…` spinner when `escapeLoading`
  - KPI labels now show team name
  - Escape ratio dataset: `showLine: false`, dots only, red when > 15%
  - 15% threshold annotation line
  - `quarterRows`: hides future quarters for current year

All changes committed and pushed to `https://github.com/philips-internal/av-tfs-dashboard` (main branch).

Work completed:
- [x] GitHub repo cleanup (removed root HTML files)
- [x] Repo renamed to `av-tfs-dashboard`, remote URL updated
- [x] Swagger UI at `/api-docs`
- [x] Branding: SVG/PNG/JPEG logo upload
- [x] Topbar logo-only, no company text
- [x] Sidebar brand-logo and brand-company removed
- [x] Health KPI cards respond to team selection
- [x] Escape ratio: dots + 15% threshold line
- [x] Escape ratio: hide future quarters
- [ ] **IN PROGRESS**: Add GitHub Coverage card to Health section (titled "Unit Test Coverage")

</work_done>

<technical_details>

- **Git repo**: `D:\views\tfs-dashboard` is the cloned GitHub repo used for all pushes. `D:\views\AV Dashboard` is the working dev copy. Files must be manually copied between them before committing.
- **Remote URL**: `https://github.com/philips-internal/av-tfs-dashboard.git` (renamed from `tfs-dashboard`)
- **Push pattern**: Copy file(s) from `D:\views\AV Dashboard\...` to `D:\views\tfs-dashboard\...`, then `git add`, `git commit`, `git push`
- **React build**: `cd "D:\views\AV Dashboard\client" && npm run build` — required after every JSX change before testing in browser
- **Server**: Running on port 3000 (multiple stale node processes can accumulate — use `netstat -ano | findstr ":3000.*LISTEN"` to find PID)
- **Swagger**: Static spec in `src/swagger.js` (not JSDoc-based). Served at `/api-docs`. The `swagger-ui-express` mount is placed BEFORE auth middleware so it's always accessible.
- **Logo storage**: SVG stored as inline text in `branding.logoSvg`; PNG/JPEG stored as base64 data URL in `branding.logoUrl`. `logoUrl` takes priority over `logoSvg` in render logic.
- **selectedTeam format**: Stored in Zustand store as `'ROOT:Healthcare IT\ISP\Team Alpha'` when selected via TeamFilter tree. `ROOT:` prefix is stripped by server middleware for API calls. Client-side `teamMatchesFilter` handles both `ROOT:` and non-`ROOT:` formats.
- **avgCycleAll bug**: `cycleData.byTeam` keys are SHORT team names (last path segment only, e.g. "Team Alpha"). `activeTeamName` is derived by splitting the full path and taking `.pop()`.
- **Future quarters bug**: Backend always returns all 4 quarters for the requested year, even future ones with 0 data. Frontend must filter `q.quarter <= defaultQuarter` for the current year.
- **Chart.js annotation plugin**: Used for both the 15% threshold line and user-created annotation lines. The `annotations` object must merge `threshold15` with `buildAnnotationLines(...)` result using spread operator.
- **GitHub 3 vulnerabilities**: Dependabot flagged 2 high + 1 moderate on `main` branch — not yet addressed.
- **`GitHubCoverageCard`**: Self-contained function component in `TestCoverageSection.jsx` (lines 41–165+). Uses `useGithubCoverage` hook. Renders loading/unconfigured/data states. Contains horizontal bar charts for test cases by repo, test files by repo, and top modules.

</technical_details>

<important_files>

- **`D:\views\AV Dashboard\client\src\sections\HealthSection.jsx`**
  - Central to the in-progress task; contains all Health section KPI cards and charts
  - Recent changes: `avgCycleAll` team filter, `aging30Plus` deps, escape ratio dots/threshold, future quarter filter
  - `GitHubCoverageCard` needs to be imported and added near end of the JSX return (after the escape ratio chart row)

- **`D:\views\AV Dashboard\client\src\sections\TestCoverageSection.jsx`**
  - Contains `GitHubCoverageCard` component (lines 41–165+) and `useGithubCoverage` import (line 12)
  - `GH_COLORS` constant used by the card — needs to be either imported or duplicated in HealthSection
  - `AnnotationButton` used inside the card

- **`D:\views\AV Dashboard\client\src\components\layout\Topbar.jsx`**
  - Logo rendered in `topbar-company` at `height:28, width:auto`
  - No company name text; separator `|` only when logo present

- **`D:\views\AV Dashboard\client\src\components\layout\Sidebar.jsx`**
  - `brand-logo` and `brand-company` removed; only `brand-name` and `brand-sub` remain

- **`D:\views\AV Dashboard\client\src\sections\SettingsSection.jsx`**
  - Branding tab: "Logo Image" upload (SVG/PNG/JPEG), preview, clear button
  - `svgFileRef` on line ~854; upload handler branches on file type

- **`D:\views\AV Dashboard\src\swagger.js`**
  - Full static OpenAPI 3.0 spec; served at `/api-docs` via `swagger-ui-express`

- **`D:\views\AV Dashboard\server.js`**
  - Swagger UI mounted before auth middleware; no cacheMiddleware

- **`D:\views\tfs-dashboard\`**
  - Cloned GitHub repo used for all commits/pushes; files manually copied from `D:\views\AV Dashboard`

</important_files>

<next_steps>

**Immediate — complete in-progress task:**

Add `GitHubCoverageCard` from `TestCoverageSection.jsx` to `HealthSection.jsx`:

1. Add `useGithubCoverage` to the imports from `'../api/hooks.js'`
2. Copy/import `GH_COLORS` constant (or reference it from a shared location)
3. Either import `GitHubCoverageCard` from TestCoverageSection OR copy the component inline into HealthSection
4. Add `const { data: ghData } = useGithubCoverage();` near the other data fetches
5. Add the card at the bottom of the Health section JSX, changing the title from `🐙 GitHub Coverage` to `🧪 Unit Test Coverage`
6. Build React client (`npm run build`)
7. Copy to `tfs-dashboard` repo, commit and push

**Approach for the component**: Since `GitHubCoverageCard` uses `AnnotationButton` and `GH_COLORS` defined in `TestCoverageSection.jsx`, the cleanest approach is to either:
- Extract it to a shared component file (`client/src/components/ui/GitHubCoverageCard.jsx`), OR
- Import it directly from TestCoverageSection (if exported), OR
- Duplicate the relevant parts inline in HealthSection with the title changed

The simplest approach: add `useGithubCoverage` hook call + render the card inline in HealthSection with the title override.

</next_steps>