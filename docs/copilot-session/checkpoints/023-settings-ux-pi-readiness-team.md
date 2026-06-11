<overview>
The session focused on UX improvements, bug fixes, and new features for the AV Dashboard (Node.js/Express + React/Vite, Philips Filament dark theme, TFS integration). The user requested a series of targeted enhancements: field mapping audit, Settings page consolidation (merging Roles into Visibility tab), Saved Views placement, active view highlighting, PI Readiness team filtering, and a new presentation/docs update. The approach was surgical edits to existing components with immediate builds to validate each change.
</overview>

<history>

1. **User asked "what else pending"**
   - Queried session todos — found 2 in-progress (global snapshot backend/frontend) and 9 done
   - Identified pending: snap-global-backend and snap-global-frontend from earlier session

2. **User asked to audit field mapping and check for missing items + Roles/Visibility duplicate in Settings**
   - Launched explore agent `audit-fieldmap-settings`
   - Found: `team-priority-heatmap` and `team-priority-open` missing from POLICY_SCHEMA in `constants.js`
   - `cross-pi` section was in NAV_ITEMS/ROLE_SECTIONS but NOT in POLICY_SCHEMA
   - Settings had separate `roles` tab (RolesManager CRUD) and `policies` tab (Visibility) — user confirmed duplicate
   - **Fix**: Added missing chart IDs to POLICY_SCHEMA; added `cross-pi` section with 4 chart IDs; renamed `policies` → "Roles & Visibility"; removed standalone `roles` tab; embedded RolesManager at top of policies tab

3. **After merge, custom roles not appearing in Visibility Policies role selector**
   - Root cause: `ROLE_META` in the policies IIFE was hardcoded with only 6 built-in roles
   - **Fix**: Added loop over `cfg?.roles?.custom` to inject custom role IDs into `ROLE_META` before building role selector

4. **User: "Role management why we have Sections Access since we have policies below — bring better UX"**
   - Removed `SectionGrid` component entirely from RolesManager
   - Replaced with `VisibilityNote` callout pointing users to Visibility Policies below
   - New role creation no longer requires selecting sections (defaults to all sections)
   - Built-in role editor now shows section badges (read-only) instead of toggles
   - Custom role editor: name/icon only + delete button + VisibilityNote

5. **User: "when we create new role all policies disabled — admin will configure"**
   - Added `BUILT_IN_ROLE_IDS` set and `defaultPolicy()` helper
   - Built-in roles default to `{ hiddenPages: [], hiddenTabs: [], hiddenCharts: [] }` (fully visible)
   - Custom roles default to `ALL_HIDDEN` = all pages hidden (0/N in badge)
   - Fixed role badge count to use `defaultPolicy()` instead of hardcoded `{ hiddenPages: [] }`

6. **User: "why Save All Roles action again after Create Role"**
   - Refactored to auto-save: `persistRoles()` called immediately on create, delete, and on label/icon blur
   - Removed footer save bar entirely
   - Inline status (⏳/✅/❌) shown next to role identity for custom roles; count strip shown for built-in view

7. **User: "Saved Views should be visible at top"**
   - Moved Saved Views block from bottom of ConfigPanel to top of `.config-popup-body` (before PI section)
   - Removed the old duplicate block at the bottom

8. **User: "selected view not highlighted"**
   - Added `activeViewId` state to ConfigPanel
   - `applySavedView()` now sets `activeViewId = view.id`
   - Added `.saved-view-chip.active` CSS with blue border + background + `✓` prefix via `::before`

9. **User: "application not running"**
   - Server was stopped — restarted with `node server.js`
   - Confirmed responding at localhost:3000

10. **User: "PI Board page — only Dependency Tree content should be scrollable"**
    - Found Dependency Tree body `<div style={{ fontSize: 12 }}>` at line ~554
    - Added `overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 120`
    - Header, KPI strip, board grid remain in normal flow; only tree body scrolls

11. **User: "PI Readiness when team selected showing all teams data"**
    - Backend: `runChecks()` always used `cfg.tfs.areaPath` (root) — ignored teamPath
    - Frontend: `usePIReadiness()` didn't accept teamPath; section didn't pass selectedTeam
    - **Fix 1**: `usePIReadiness(pis, teamPath)` — added teamPath to queryKey + API call
    - **Fix 2**: PIReadinessSection reads `selectedTeam` from store, passes to hook
    - **Fix 3**: `runChecks(cfg, piLabels, fm, teamPath)` uses `teamPath || cfg.tfs.areaPath` as area in all 7 WIQL queries
    - Server restarted to pick up backend changes

12. **User: "still showing all teams" (follow-up)**
    - Verified server hadn't restarted — old code still running
    - Removed redundant post-fetch area filter (WIQL now scopes correctly)
    - Restarted server — confirmed working

13. **User: "it should be intelligent — single team shows detailed view in PI Readiness"**
    - When `selectedTeam` is set (`singleTeam = true`): renders team-specific inline view
      - Score hero with team name
      - Each criterion as expandable card with progress bar + pass/fail counts
      - Click failing criterion → inline table of failing features (no modal)
    - When no team selected: existing multi-team heatmap + popups unchanged
    - Built successfully ✅

14. **User: "create new presentation version + update all documents"**
    - Explored `D:\views\AV Dashboard\docs\Presentation\` — found existing `AV_Dashboard_Programme_Presentation.html` + Images folder with 17 screenshots
    - Explored all docs files — user-manual.html, design.html, implementation.html, etc.
    - **Task in progress** — presentation update not yet started; user asked what images are needed

</history>

<work_done>

Files modified:

- `client/src/constants.js`
  - Added `team-priority-heatmap`, `team-priority-open` chart IDs to Defects POLICY_SCHEMA
  - Added `cross-pi` section entry to POLICY_SCHEMA with 4 chart IDs
  - Build ✅

- `client/src/sections/SettingsSection.jsx`
  - Removed `roles` from ALL_TABS; renamed `policies` → "Roles & Visibility"
  - Removed standalone roles tab JSX block
  - Added RolesManager at top of policies tab with updated subtitle
  - Added `BUILT_IN_ROLE_IDS`, `ALL_HIDDEN`, `defaultPolicy()` for custom role default behavior
  - Fixed `ROLE_META` to include custom roles from `cfg.roles.custom`
  - Fixed role badge to use `defaultPolicy()` not hardcoded empty object
  - Build ✅

- `client/src/components/ui/RolesManager.jsx`
  - Removed `SectionGrid` and `SectionToggle` components entirely
  - Added `VisibilityNote` callout component
  - `handleCreateRole` → no longer requires sections, auto-saves via `persistRoles()`
  - `handleDeleteCustom` → auto-saves via `persistRoles()`
  - `updateCustomMeta` label/icon → auto-saves on blur via `handleCustomMetaBlur`
  - Removed footer "Save All Roles" bar; inline status shown in role editor
  - Built-in role editor: shows section badge chips (read-only) + VisibilityNote
  - Build ✅

- `client/src/components/ui/ConfigPanel.jsx`
  - Moved Saved Views section to top of `.config-popup-body`
  - Added `activeViewId` state
  - `applySavedView()` sets `activeViewId = view.id`
  - Chip gets `active` class when `activeViewId === view.id`
  - Build ✅

- `client/src/styles/main.css`
  - Added `.saved-view-chip.active` styles (blue border, blue bg, `✓` prefix via `::before`)

- `client/src/sections/ProgramBoardSection.jsx`
  - Dependency Tree body div: added `overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 120`

- `client/src/api/hooks.js`
  - `usePIReadiness(pis, teamPath)` — added teamPath param to queryKey and API call

- `client/src/sections/PIReadinessSection.jsx`
  - Added `selectedTeam` from store
  - Added `singleTeam` boolean
  - When `singleTeam`: renders detailed inline view (score hero + expandable criteria cards with failing feature tables)
  - When no team: existing multi-team heatmap unchanged
  - Added `expandedCheck` state for single-team view
  - Build ✅

- `src/routes/piReadiness.js` (backend)
  - `runChecks(cfg, piLabels, fm, teamPath)` — uses `teamPath || cfg.tfs.areaPath` as WIQL area in all 7 queries
  - Removed post-fetch area filter (redundant after WIQL fix)
  - Server restarted ✅

**Current state:**
- Server running on port 3000 (shellId: `av-server`)
- All frontend builds passing ✅
- Presentation update: **NOT STARTED** — needs new slides for Cross-PI Trends, Notification Center, Saved Views, Roles & Visibility consolidation, PI Readiness team detail view

</work_done>

<technical_details>

- **ROLE_META hardcoding bug**: The Visibility Policies IIFE had `ROLE_META` as a static object. Custom roles saved via RolesManager were never shown as role selectors in visibility. Fix: loop `cfg?.roles?.custom` and inject into ROLE_META before rendering.

- **New role default policy**: Custom roles must default to ALL_HIDDEN so admin explicitly grants access. Built-in roles remain fully visible by default. Implemented via `defaultPolicy(roleId)` using `BUILT_IN_ROLE_IDS` Set.

- **PI Readiness team filter — WIQL scope**: The key fix was passing `teamPath` into `runChecks()` so every WIQL query uses `UNDER '${teamPath}'` instead of `UNDER '${cfg.tfs.areaPath}'`. Post-fetch filtering was insufficient because `checkFails` counts were computed from all-teams data.

- **Single-team intelligent view**: `singleTeam = !!(selectedTeam && selectedTeam.trim())`. When true, the entire component renders a completely different layout (no Modal needed — inline expansion). `teams[0]` is used as the team entry since API now scopes to one team.

- **`selectedTeam` value format**: Stores full AreaPath like `Healthcare IT\ICAP\ISP\ISPM\Team-X`. The WIQL `UNDER` clause accepts this directly. Display name extracted via `.split('\\').pop()`.

- **Server must be restarted** after any backend (`src/`) change. Frontend changes only need `npm run build` in `client/`.

- **POLICY_SCHEMA** is the authoritative list of sections/tabs/charts for admin visibility control. Any new chart using `chartVisible('section', 'chart-id')` must be registered here or the visibility toggle won't appear in Settings.

- **ConfigPanel `activeViewId`** is component-local state (not in store). It resets if the component unmounts. This is intentional — it tracks the "most recently applied" view within the current popup session.

- **`teamRootPath` is an array** in config: `['Healthcare IT\\ICAP\\ISP', 'Healthcare IT\\AV On Cloud', ...]`. The `extractTeam()` helper uses it to strip the prefix from AreaPath to get team name.

- **Build chunk size warning** is pre-existing (>500KB) — not an error, can be ignored.

</technical_details>

<important_files>

- `client/src/constants.js`
  - POLICY_SCHEMA, NAV_ITEMS, ROLE_SECTIONS, ROLE_DEFS, SECTION_PAGES
  - Added: `team-priority-heatmap`, `team-priority-open`, `cross-pi` POLICY_SCHEMA entries
  - Key: any new chart/section must be registered here for admin visibility control

- `client/src/sections/SettingsSection.jsx`
  - Main settings page — 12 tabs, ALL_TABS array at line ~10
  - Roles & Visibility tab: RolesManager at top (~line 1683), then Visibility Policies IIFE (~line 1694)
  - `defaultPolicy()` + `BUILT_IN_ROLE_IDS` at ~line 1697–1704

- `client/src/components/ui/RolesManager.jsx`
  - Role CRUD component — no longer has SectionGrid
  - `persistRoles()` called on create/delete/blur for auto-save
  - `VisibilityNote` callout at top of component file

- `client/src/components/ui/ConfigPanel.jsx`
  - Config popup — Saved Views now at TOP of body
  - `activeViewId` state; `applySavedView()` sets it; chip gets `.active` class

- `client/src/styles/main.css`
  - Global styles — `.saved-view-chip.active` added after `:hover` rule (~line 2165)

- `client/src/sections/PIReadinessSection.jsx`
  - Dual-mode: single-team inline detail view vs multi-team heatmap
  - `singleTeam` boolean drives which layout renders
  - `expandedCheck` state for inline criterion expansion

- `client/src/api/hooks.js`
  - `usePIReadiness(pis, teamPath)` at ~line 302

- `src/routes/piReadiness.js`
  - Backend route — `runChecks(cfg, piLabels, fm, teamPath)` uses teamPath as WIQL area scope
  - All 7 WIQL queries now use `UNDER '${area}'` where area = teamPath or root

- `client/src/sections/ProgramBoardSection.jsx`
  - Dependency Tree body at ~line 554: `overflowY: 'auto', maxHeight: 'calc(100vh - 380px)'`

- `docs/Presentation/AV_Dashboard_Programme_Presentation.html`
  - Existing 79KB slide deck — needs new version with new features
  - Images folder has 17 screenshots

</important_files>

<next_steps>

**Immediate — Presentation update (user's last request, not started):**
- Create `AV_Dashboard_Programme_Presentation_v2.html` in `D:\views\AV Dashboard\docs\Presentation\`
- New slides needed for features added since last version:
  1. **Cross-PI Trends** — new sidebar section with KPI strip, density line, velocity, defects bar, doughnut, summary table
  2. **Notification Center** — bell icon in topbar, unread badge, history dropdown
  3. **Saved Filter Views** — top of Config popup, save/load/highlight active view
  4. **Roles & Visibility consolidated** — single tab, auto-save, new role = all-hidden default
  5. **PI Readiness — Smart team view** — inline criteria expansion when team selected
  6. **Defect Analytics** — new charts: Quarterly Raised vs Closed, Team×Priority Heatmap, Field Defects by Project, Open Defects by Team×Priority
  7. **PAT Login** improvements from earlier sessions

- **Images needed** (screenshots required from browser):
  1. Cross-PI Trends section (full page)
  2. Notification bell + dropdown open
  3. Config popup showing Saved Views at top
  4. Roles & Visibility tab (RolesManager + policies combined)
  5. PI Readiness — single team detail view with expanded criteria
  6. Defects Analysis tab showing new heatmap charts

**Also pending:**
- `snap-global-backend` todo: Expand snapshot POST to capture full dashboard data (features + defects + meta)
- `snap-global-frontend` todo: Move capture button to topbar + Browse/Capture modal

**Docs to update** (all in `D:\views\AV Dashboard\docs\`):
- `user-manual.html` — add new sections: Cross-PI Trends, Notification Center, Saved Views, PI Readiness smart view
- `design.html` — update architecture with new components
- `implementation.html` — update with new routes and components
- `settings-guide.html` — update Roles & Visibility consolidation

</next_steps>