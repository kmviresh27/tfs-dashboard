<overview>
The session focused on productizing the AV Dashboard (multi-tenant Azure DevOps/TFS live programme dashboard) for reuse by any Azure DevOps team, while also fixing several runtime bugs discovered during testing. Key goals: (1) clean up stale/internal files, (2) add comprehensive documentation and interactive checklists, (3) build an in-app searchable help panel, (4) create proper packaging/setup scripts, (5) fix runtime bugs in roadmap and help content. The user also wants to investigate the roles/policies/section visibility system which was reported as broken.
</overview>

<history>

1. **User: Productize for any Azure DevOps user, clean up extra files**
   - Deleted 5 old standalone HTML files from root (defect-cycle-time.html, etc.)
   - Deleted all log files, `_backups/`, legacy root `snapshots/`, `releases/`, stray `-w` file
   - Deleted orphan `DeptAdminSection.jsx` (no longer imported)
   - Removed 7 internal planning docs from `docs/` (design, requirements, KPI_Plan, UX_Improvement_Plan, etc.)
   - Removed `docs/Presentation/` and `docs/Requirements/` internal folders
   - Updated `config.sample.json` to be generic (removed Philips-specific values, added `auth` block, inline comments)
   - Rewrote `README.md` to be product-grade, covering both ADO cloud and on-prem TFS
   - Updated `docs/index.html` to link only to user-facing docs (removed internal planning links, removed Philips/Healthcare branding)

2. **User chose: searchable doc panel (no API key), Windows zip installer**
   - Created `client/src/data/helpContent.js` — 35 help sections across 7 categories: Getting Started, Configuration, Multi-Tenant, Dashboard Sections, Troubleshooting, Deployment, FAQ
   - Created `client/src/components/ui/HelpPanel.jsx` — slide-in right panel with full-text search, category sidebar, accordion sections, search highlighting, Esc to close
   - Added `?` button to `Topbar.jsx` that opens `HelpPanel`
   - Added "Deployment Checklists" and "Documentation Hub" links to Topbar more-menu (…)
   - Fixed `scripts/package.ps1` — replaced legacy `snapshots/` creation with `data/departments/` skeleton
   - Fixed `scripts/deploy.ps1` — replaced `snapshots/` copy logic with `data/` copy logic
   - Created `scripts/setup.ps1` — interactive first-run wizard (config generation, data dir init, super-admin account creation)
   - Updated `scripts/README.md` to document setup.ps1

3. **User: Add checklists for migration and all scenarios**
   - Created `docs/checklists.html` — interactive checklist page with 6 checklists: Fresh Installation, TFS→ADO Migration, New Department Onboarding, Production Go-Live, Version Upgrade, User Onboarding
   - Features: localStorage persistence, progress bars per checklist, print support, sidebar nav with scroll highlight, clear buttons, completion badges
   - Added Checklists card to `docs/index.html`
   - Added Checklists category to `client/src/data/helpContent.js` (4 sections covering each checklist scenario)
   - This introduced a syntax error in helpContent.js (missing `{` and `id:` for FAQ category)

4. **User: `getPILabel is not defined` error in roadmap**
   - Found: `src/routes/roadmap.js` called `getPILabel()` on line 34 but only imported `getCurrentPIInfo`, `getAllPIsForYear`, `buildIterationClauses`
   - Fixed: added `getPILabel` to the destructured require
   - Also fixed syntax error in `helpContent.js` — missing `{ id: 'faq',` opening for FAQ category
   - Rebuilt client successfully

5. **User: Still getting same error — server needed restart**
   - Server was still running with old code (Node.js caches require)
   - Killed all node processes, restarted server
   - Verified `/api/roadmap` endpoint responds (401 = auth working, not crashing)

6. **User: Roadmap returns 607 features but all PIs show total: 0**
   - Root cause: `PI_REGEX = /\d{2}-PI\d/` on line 12 of roadmap.js only matches `26-PI1` style
   - ADO DCP dept uses `PI26.1`, `PI26.2` format — these don't match the regex
   - All features resolve to `piPart = 'Unknown'` and never count toward any PI
   - Fix: replaced `segs.find(s => PI_REGEX.test(s))` with `segs.find(s => piLabels.includes(s))` — uses computed piLabels list, works for any naming pattern
   - Removed the now-unused `PI_REGEX` constant
   - Restarted server

7. **User: Application not running — kill all and rerun**
   - Multiple stubborn node processes (PIDs 6444, 23676, 37128, 39812, 43132, 37132, 37324, 6860)
   - Used `[System.Diagnostics.Process]::GetProcessById().Kill()` to force-kill them
   - Verified port 3000 was free, started fresh server in async shell (shellId: av-server)
   - Server confirmed running: PID on port 3000

8. **User: Roles and visibility — when role changes, pages/sections should appear/disappear (was already working)**
   - Currently investigating — read `constants.js` to understand ROLE_SECTIONS, ROLE_DEFS, getEffectiveRoleSections
   - Found `App.jsx` line 265: `visibleSections = getEffectiveRoleSections(customRoles, roleOverrides)[activeRole] || NAVIGABLE_SECTIONS`
   - Next step: check `usePolicies.js`, `useStore.js` (activeRole state), and `SettingsSection.jsx` Policies tab

</history>

<work_done>

**Files created:**
- `client/src/data/helpContent.js` — 35 searchable help sections across 8 categories (including Checklists)
- `client/src/components/ui/HelpPanel.jsx` — slide-in searchable help panel component
- `scripts/setup.ps1` — first-run interactive setup wizard
- `docs/checklists.html` — interactive 6-checklist deployment guide with localStorage persistence

**Files modified:**
- `src/routes/roadmap.js` — added `getPILabel` to require import; replaced hardcoded `PI_REGEX` with `piLabels.includes(s)` for PI grouping
- `client/src/components/layout/Topbar.jsx` — added `?` help button, HelpPanel import/state, expanded more-menu with checklists + docs links
- `client/src/data/helpContent.js` — fixed syntax error (missing `{ id: 'faq',` opening for FAQ category after Checklists insert)
- `config.sample.json` — generic for any ADO user (no Philips values), added `auth` section and `_comment` fields
- `README.md` — complete rewrite to product-grade generic docs
- `docs/index.html` — complete rewrite, clean product hub (no internal/Philips content), links to 5 docs including Checklists
- `scripts/package.ps1` — replaced legacy `snapshots/` with `data/departments/` skeleton
- `scripts/deploy.ps1` — replaced `snapshots/` copy with `data/` copy logic
- `scripts/README.md` — documented setup.ps1

**Files deleted:**
- Root: defect-cycle-time*.html, feature-cycle-time.html, research-tracker.html, tfs-query-reference.html, all log files, `-w`, `_backups/`, `snapshots/`, `releases/`
- `docs/`: requirements.html, design.html, implementation.html, KPI_Page_Plan.html, MultiTenant_Architecture_Plan.html, UX_Improvement_Plan.html, av-dashboard-announcement-email.html, Presentation/, Requirements/
- `client/src/sections/DeptAdminSection.jsx` (orphan)

**Current state:**
- ✅ Server running (av-server shell, port 3000)
- ✅ Client built successfully (1,356 kB bundle, 8 categories in help)
- ✅ Roadmap `getPILabel` crash fixed
- ✅ Roadmap PI grouping fixed (piLabels.includes vs regex)
- ⚠️ Roles/policies section visibility — user reported it was previously working but needs investigation
- ⏳ In progress: investigating roles/policies/visibility system

</work_done>

<technical_details>

**Roadmap PI grouping bug:**
- `PI_REGEX = /\d{2}-PI\d/` only matches `26-PI1` format (TFS on-prem style)
- ADO cloud DCP dept uses `PI26.1`, `PI26.2` — completely different format, fails regex
- Fix: `segs.find(s => piLabels.includes(s))` — uses already-computed piLabels list, works universally
- Lesson: never hardcode PI name regex; always derive from `piNamingPattern` or compare against computed list

**Server restart requirement:**
- Node.js caches all `require()` calls at startup
- Editing a server-side `.js` file has no effect until server is restarted
- Multiple node processes were building up (from `Start-Process -NoNewWindow`) — each leaving a process on port 3000 or orphaned

**Port/process killing on Windows:**
- `Stop-Process -Id X` works only individually per PID (can't use `-Name` in restricted env)
- `[System.Diagnostics.Process]::GetProcessById(pid).Kill()` is a reliable alternative
- `netstat -ano | Select-String ":3000\s.*LISTENING"` finds port owner PID

**helpContent.js syntax:**
- Template literals with backtick strings inside JS object arrays are valid but the edit tool's `old_str` replacement can accidentally split array entries
- When inserting a new category before `{ id: 'faq', ...}`, must include the full opening `{` and `id:` field in the new insertion to avoid orphaning the existing object

**Roles/policies architecture (from reading constants.js + App.jsx):**
- `ROLE_DEFS` — defines role labels/icons (built-in: all, exec, rte, pm, sm)
- `ROLE_SECTIONS` — maps role ID → array of section IDs visible for that role
- `getEffectiveRoleSections(customRoles, roleOverrides)` — merges built-ins with per-dept overrides
- `App.jsx` line 265: `visibleSections = getEffectiveRoleSections(customRoles, roleOverrides)[activeRole] || NAVIGABLE_SECTIONS`
- `activeRole` comes from `useStore` (Zustand)
- `restrictedSection` — blocks nav if `!visibleSections.includes(activeSection)` (with special case for admin requiring isSuperAdmin)
- `customRoles` and `roleOverrides` come from somewhere (likely `usePolicies` hook or store) — not yet fully traced

**ADO DCP config:**
- `piNamingPattern: 'PI{yy}.{n}'` → `PI26.1`, `PI26.2`
- `sprintSubpathPattern: '{pi}-{sprint}'` → `PI26.1-SP1`
- `sprintLabels: ['SP1'...'SP6','IP']`
- `iterBase = 'DCP'` (project root)
- `apiVersion: '6.0'`

**Multi-tenant data storage:**
- All dept data: `data/departments/{id}/config.json`, `/snapshots/`, `/reports/`
- Users: `data/users.json`
- No legacy root `snapshots/` folder (was removed)

</technical_details>

<important_files>

- **`src/routes/roadmap.js`**
  - Fixed: added `getPILabel` to require import (line 7); replaced `PI_REGEX.test(s)` with `piLabels.includes(s)` for PI grouping (line ~68)
  - Critical for roadmap section working with any PI naming pattern

- **`client/src/App.jsx`**
  - Line 265: `visibleSections` computed from `getEffectiveRoleSections(customRoles, roleOverrides)[activeRole]`
  - Line 423: `restrictedSection` guard (admin requires isSuperAdmin, others check visibleSections)
  - Central to roles/section visibility — currently being investigated

- **`client/src/constants.js`**
  - `ROLE_SECTIONS` — built-in role→sections mapping (lines 89–95)
  - `getEffectiveRoleSections()` — merges built-ins with custom/override (lines 105–120)
  - `NAV_ITEMS` — all navigable sections with groups (lines 47–86)
  - `POLICY_SCHEMA` — per-section tab/chart visibility schema (lines 149–395)

- **`client/src/hooks/usePolicies.js`**
  - Not yet read — likely provides `customRoles`, `roleOverrides` to App.jsx
  - Key to understanding why role changes may not update visible sections

- **`client/src/store/useStore.js`**
  - Contains `activeRole` state — how/when it's updated determines if role switch reflects immediately
  - Not yet read in this session

- **`client/src/components/ui/HelpPanel.jsx`**
  - New file — slide-in searchable help panel
  - Reads from `helpContent.js` HELP_CATEGORIES and HELP_INDEX

- **`client/src/data/helpContent.js`**
  - New file — 8 categories, 39 sections of help content
  - Had syntax error (fixed): missing `{ id: 'faq',` after Checklists category insert

- **`client/src/components/layout/Topbar.jsx`**
  - Added: `showHelp` state, `?` button, HelpPanel render, expanded more-menu
  - Key: HelpPanel triggered from here

- **`docs/checklists.html`**
  - New file — 6 interactive checklists with localStorage, progress bars, print support
  - Available at `/docs/checklists.html`

- **`scripts/setup.ps1`**
  - New file — first-run wizard for new deployments
  - Creates config.json interactively, initialises data/, creates super-admin

- **`data/departments/ei-ci-dp-r-d/config.json`**
  - ADO DCP department config
  - `piNamingPattern: 'PI{yy}.{n}'`, `sprintSubpathPattern: '{pi}-{sprint}'`

</important_files>

<next_steps>

**Actively investigating:**
- Roles and visibility system — user says "was already working" implying it broke
- Need to read: `client/src/hooks/usePolicies.js`, `client/src/store/useStore.js`
- Need to trace: how `activeRole` is set when user changes their role in the UI, how `customRoles`/`roleOverrides` flow from policies API into `getEffectiveRoleSections`

**Likely issue area:**
- `usePolicies.js` may be fetching from `/api/d/:deptId/policies` — the new dept-scoped route added in prior session
- `activeRole` in Zustand store — when role changes in Settings → Policies or Settings → Members, does it trigger a re-render of visibleSections?
- Check if the `policies` tab in SettingsSection saves correctly and the store is updated

**Remaining productization tasks:**
- The `helpContent.js` syntax fix + roadmap fixes need the client rebuilt and served — already done (build passed)
- Verify checklists page is accessible at `/docs/checklists.html` in browser

**No blockers — immediate next action:**
- Read `usePolicies.js` and `useStore.js` to trace the roles/visibility flow
- Check the `SettingsSection.jsx` Policies tab for save logic and store update

</next_steps>