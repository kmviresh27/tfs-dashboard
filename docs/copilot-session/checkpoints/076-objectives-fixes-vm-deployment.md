<overview>
This session focused on fixing clipboard copy functionality (which required HTTPS), deploying the app to a production VM, cleaning up the VM, updating announcement HTML slides with problem statement and feature content, and implementing 4 team-reported fixes for the Objectives section: missing objectives from TFS, wrong sort order, broken number filter, and a new Postponed Impact panel for Business Owners. The user enforces a no-push rule — all git commits are manually handled by the user; the dev copy changes to `D:\views\tfs-dashboard` only.
</overview>

<history>

1. **Clipboard copy broken (flashes red)**
   - Root cause traced through 3 iterations: (1) dynamic `import('html2canvas')` expired Chrome's user-activation window; (2) `Promise<Blob>` passed to ClipboardItem still failed; (3) final diagnosis: `navigator.clipboard` is `undefined` on HTTP (non-localhost)
   - Fix: static import of `html2canvas`, `writeOrDownload()` helper that checks `navigator.clipboard?.write` availability before trying, falls back to PNG download
   - But user didn't want download fallback — wanted clipboard to work

2. **HTTPS added to server for clipboard support**
   - Installed `selfsigned` npm package
   - Added HTTPS server block to `server.js` using async `selfsigned.generate()` (v2 API returns Promise, not sync)
   - HTTP stays on port 3000, HTTPS on port 3443
   - Self-signed cert auto-generated to `ssl/` on first run, excluded from git via `.gitignore`
   - Tested locally — server started with `🔒 HTTPS available → https://localhost:3443`
   - User confirmed clipboard copy worked after accessing via HTTPS

3. **VM deployment to `\\INGBTCPIC6VWW76\AV Dashboard`**
   - User confirmed this is the production VM with shared path access
   - Copied `client/dist/`, `server.js`, `src/`, `package.json`, `package-lock.json` via robocopy
   - Initial restart failed: `Cannot find module 'swagger-ui-express'` — VM had only 102 node_modules vs local 144
   - User clarified: "VM is production env, we shouldn't put any code" — no manual node_modules copying
   - Proper fix: ran `npm install --omit=dev` on VM via WinRM (`Invoke-Command`)
   - Server restarted successfully — PID 19680, HTTPS cert generated, running on 3000 + 3443

4. **VM cleanup**
   - Identified files not needed in production: 5 dev HTML files, `-w` junk file, old log files, `scripts/` folder, `releases/` folder, `.gitignore`
   - User approved deletion; all 13 files + 2 folders removed via WinRM

5. **Announcement HTML — problem statement**
   - File: `D:\views\AV Dashboard\announcement-multi-tenant.html`
   - Added CSS for `.problem-box`, `.problem-list`, `.solution-bridge`
   - Changed eyebrow to "Problem → Solution · Multi-Tenant Release"
   - Added red-bordered problem box with 4 ✗ bullet points drawn from `av-dashboard-demo.html` slide 2
   - Added green "Solution" bridge divider before capability pills

6. **Announcement HTML — "What's New" section**
   - Replaced 8 generic checkmark items with 10 real features from `av-dashboard-demo.html` slides 3–10
   - Grouped into 4 colour-coded categories: 📊 Delivery, 🐛 Quality, ⚙️ Process, 🏢 Platform

7. **Objectives section — team feedback fixes (4 issues)**
   - User reported: (1) not all objectives showing, (2) wrong priority order, (3) filter by number broken, (4) Business Owners need postponed impact view
   - Explored codebase via explore agent to understand current implementation
   - Created 4 todos in session DB
   - Started implementing all 4 fixes simultaneously (in progress at compaction)

</history>

<work_done>

Files modified in `D:\views\AV Dashboard`:

- **`client/src/components/ui/CopyButton.jsx`**
  - Static import of `html2canvas`
  - `writeOrDownload()` helper: checks `navigator.clipboard?.write` availability, falls back to PNG download
  - Both canvas (Chart.js) and CSS (dumbbell) chart paths use `writeOrDownload`
  - Table copy path: tries `ClipboardItem` first, falls back to `writeText(tsv)`

- **`server.js`**
  - Added `fs`, `http`, `https` imports
  - HTTP server now created with `http.createServer(app)` instead of `app.listen()`
  - Async IIFE adds HTTPS server using `selfsigned.generate()` (async API)
  - Cert cached in `ssl/key.pem` + `ssl/cert.pem`, reused on restart
  - HTTPS_PORT = `cfg.app.httpsPort || PORT + 443` (default 3443)

- **`.gitignore`**
  - Added `ssl/` to prevent cert files from being committed

- **`package.json` / `package-lock.json`**
  - Added `selfsigned` as runtime dependency

- **`announcement-multi-tenant.html`**
  - Added problem statement section with CSS + HTML
  - Updated "What's New" with real features grouped by category

- **`src/routes/objectives.js`** (in progress)
  - WIQL: `ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC`
  - Iteration filter: includes objectives at root iteration path too (OR clause)
  - Added `Microsoft.VSTS.Common.StackRank` + `Priority` to fields fetched
  - Returns `stackRank` and `priority` in each objective object

- **`src/routes/objectivesPlan.js`** (in progress)
  - Same WIQL iteration fix (OR root path clause)
  - Sort: `ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.AreaPath] ASC, [System.Id] ASC`
  - Added `StackRank` + `Priority` to obj fields fetch
  - Returns `stackRank` and `priority` per objective
  - Added step 9: postponed impact analysis — identifies objectives with state in `{Removed, Postponed, Deferred, Cut}` or `ragStatus === 'Dropped'`, computes `bvAtRisk` per team, returns `postponedImpact` block in response

- **`client/src/sections/ObjectivesPlanningSection.jsx`** (in progress)
  - Default sort changed from `'rag'` to `'tfs'`
  - Added `showPostponed` state
  - `sortObjectives`: new `'tfs'` case sorts by `stackRank`
  - `getFiltered`: strips `#` prefix from search, uses exact ID match (`===`) for number searches
  - Added `postponedImpact` destructured from API data
  - Sort dropdown: added "Sort: TFS Priority Order" as first option
  - **Postponed Impact panel UI — NOT YET ADDED to JSX render**

All changes copied to `D:\views\tfs-dashboard` (no commit/push — user handles git).

**Completed:**
- [x] Clipboard copy working via HTTPS
- [x] HTTPS server with auto self-signed cert
- [x] VM deployment (npm install via WinRM, server running)
- [x] VM cleanup (13 files + 2 folders deleted)
- [x] Announcement HTML problem statement
- [x] Announcement HTML What's New features
- [x] objectives.js backend fixes (iteration filter, sort, fields)
- [x] objectivesPlan.js backend fixes (iteration filter, sort, fields, postponed impact data)
- [x] ObjectivesPlanningSection.jsx sort + filter fixes
- [ ] **Postponed Impact panel JSX UI not yet rendered in ObjectivesPlanningSection**
- [ ] Build not yet run after objectives changes
- [ ] Files not yet copied to tfs-dashboard after objectives changes

</work_done>

<technical_details>

- **`navigator.clipboard` requires HTTPS or localhost**: Clipboard API is completely unavailable (`undefined`) on plain HTTP non-localhost. The only fix is HTTPS. Self-signed cert works but Chrome shows cert warning — user must click "Advanced → Proceed" once per browser session.

- **`selfsigned` v2 async API**: `selfsigned.generate()` now returns a `Promise` (not synchronous). Must `await` it. Properties are `pems.private` and `pems.cert`. Wrapping the HTTPS block in an `async IIFE` `(async () => { ... })()` is the correct pattern alongside a synchronous `server.listen()`.

- **WinRM remote execution**: `Invoke-Command -ComputerName INGBTCPIC6VWW76` works for the VM. Use `Get-CimInstance Win32_Process` to find node processes. Cannot use `Stop-Process -Name`; must use `$proc.Kill()` or `Stop-Process -Id <pid>`. `Start-Process` with `-WorkingDirectory` and `-RedirectStandardOutput` for detached server.

- **`npm install --omit=dev` on VM**: Correct approach for production — installs only runtime deps. Do NOT manually copy node_modules. VM had only 102 modules vs 144 local (dev deps excluded).

- **VM app path**: `D:\AV Dashboard` on the VM machine (maps to `\\INGBTCPIC6VWW76\AV Dashboard` share).

- **HTTPS port formula**: `cfg.app.httpsPort || PORT + 443`. With default PORT=3000, HTTPS is 3443. This avoids conflict with standard 443 (which requires admin) while being memorable.

- **TFS WIQL objectives iteration issue**: `buildIterationClauses` generates `[System.IterationPath] UNDER 'Healthcare IT\ISP\26-PI1'`. Objectives set at the root iteration level (`Healthcare IT\ISP`) are excluded. Fix: `AND ([System.IterationPath] UNDER '...\PI' OR [System.IterationPath] = 'Healthcare IT\ISP')`.

- **TFS StackRank for priority**: Field `Microsoft.VSTS.Common.StackRank` is the TFS backlog ordering field. Lower value = higher priority. WIQL: `ORDER BY [Microsoft.VSTS.Common.StackRank] ASC`. This matches the order users see in TFS backlogs.

- **Postponed states in TFS**: Not a standard single state. Must check multiple: `Removed`, `Postponed`, `Deferred`, `Cut`. Also check `ragStatus === 'Dropped'` which is computed from `featureRemovedState`.

- **Search filter `#` prefix**: Users type `#12345` to reference a TFS work item. The fix strips the leading `#` before comparing. Also changed from `includes()` to `===` for exact ID match to avoid false positives (e.g., searching "123" matching ID "12345").

- **Git workflow**: Dev work in `D:\views\AV Dashboard`. Copy to `D:\views\tfs-dashboard` for commit/push. User handles all git operations. Never push directly — only copy files.

- **`data-copy-scope` attribute**: Must be on the chart container div for `CopyButton` to find the right container via `btn.closest('[data-copy-scope]')`.

</technical_details>

<important_files>

- **`D:\views\AV Dashboard\server.js`**
  - Entry point; now runs HTTP (3000) + HTTPS (3443) simultaneously
  - HTTPS block is async IIFE using `selfsigned.generate()` 
  - Key lines: HTTP server ~185, HTTPS async block ~193–230

- **`D:\views\AV Dashboard\client\src\components\ui\CopyButton.jsx`**
  - Handles copy for all charts and tables
  - `writeOrDownload()` helper ~82–95: checks clipboard API availability
  - Static `html2canvas` import at top; used for CSS dumbbell chart
  - `handleCopy` ~97–172

- **`D:\views\AV Dashboard\src\routes\objectives.js`**
  - Backend for `/api/objectives` (used by executive view)
  - Fixed: iteration clause now includes root path, sort by StackRank, returns stackRank/priority
  - ~32–54 for WIQL and fields

- **`D:\views\AV Dashboard\src\routes\objectivesPlan.js`**
  - Backend for `/api/objectives-plan` (used by planning section)
  - Fixed: same iteration + sort fixes; added `postponedImpact` block in response (~258–300)
  - Key new section: step 9 postponed impact ~258–285

- **`D:\views\AV Dashboard\client\src\sections\ObjectivesPlanningSection.jsx`**
  - Main objectives UI, ~500+ lines
  - Fixed: `sortObjectives` has new `'tfs'` case; `getFiltered` strips `#` and exact-matches IDs
  - Default sort now `'tfs'`; `postponedImpact` destructured from data
  - **Postponed Impact panel JSX not yet added to the render section**
  - Sort dropdown ~390–404; filter logic ~303–316

- **`D:\views\AV Dashboard\announcement-multi-tenant.html`**
  - Presentation slide for multi-tenant release announcement
  - Problem statement block with CSS added ~316–352
  - "What's New" section fully rewritten with real features ~547–576

- **`D:\views\AV Dashboard\src\helpers\piHelpers.js`**
  - `buildIterationClauses()` ~89–93: generates WIQL iteration filter
  - Output: `[System.IterationPath] UNDER 'base\PI-label'` — this is what was excluding root-level objectives

</important_files>

<next_steps>

**Immediately pending (was mid-implementation at compaction):**

1. **Add Postponed Impact panel UI to ObjectivesPlanningSection.jsx**
   - Backend data is ready (`postponedImpact.total`, `bvAtRisk`, `byTeam`, `objectives`)
   - Need to render a collapsible panel/section after the main objectives list
   - Should show: total postponed count, total BV at risk, table per team with postponed objectives + linked features
   - Toggle controlled by `showPostponed` state (already added)
   - Target: Business Owner audience — should be visually prominent with red/amber warning styling

2. **Build the client after objectives changes**
   ```
   cd "D:\views\AV Dashboard\client" && npm run build
   ```

3. **Copy all changed files to tfs-dashboard**
   ```powershell
   Copy-Item "D:\views\AV Dashboard\src\routes\objectives.js" "D:\views\tfs-dashboard\src\routes\objectives.js" -Force
   Copy-Item "D:\views\AV Dashboard\src\routes\objectivesPlan.js" "D:\views\tfs-dashboard\src\routes\objectivesPlan.js" -Force
   Copy-Item "D:\views\AV Dashboard\client\src\sections\ObjectivesPlanningSection.jsx" "D:\views\tfs-dashboard\client\src\sections\ObjectivesPlanningSection.jsx" -Force
   ```

4. **Deploy to VM** (after copy to tfs-dashboard and user commits):
   - Copy `src/routes/objectives.js`, `src/routes/objectivesPlan.js` to VM
   - Copy new `client/dist/` build to VM
   - Restart server via WinRM

**Also pending from session todos:**
- `obj-all-items` — ✅ backend done, needs testing
- `obj-priority-sort` — ✅ backend + frontend done
- `obj-filter-fix` — ✅ frontend done
- `obj-postponed-impact` — backend done, **frontend panel not yet built**

</next_steps>