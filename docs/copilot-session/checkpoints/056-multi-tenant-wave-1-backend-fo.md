<overview>
The session focused on implementing Wave 1 (Backend Foundation) of the multi-tenant architecture for the AV Dashboard (Node.js/Express + React/Vite). The user requested multi-tenant support after a backup was created. The approach follows the approved `docs/MultiTenant_Architecture_Plan.html` design: path-based tenancy (`/d/:deptId/`), per-dept data folders, auto-migration from single-tenant, and backward-compatible old `/api/*` routes pointing to a "default" dept.
</overview>

<history>

1. **Session resumed — read full MultiTenant_Architecture_Plan.html**
   - Read lines 400–810 (previously unread sections): URL design, auth model, key decisions, wireframes, all 5 delivery waves, migration path, open questions
   - Key architecture decisions confirmed: path-based tenancy `/d/:deptId/`, JSON files per dept in `data/departments/{id}/`, registry `data/departments.json`, backward compat via `default` dept

2. **Explored existing backend structure**
   - `src/config.js`: `loadConfig()` reads from `config.json` at PROJECT ROOT (not `data/config.json` — important)
   - `src/middleware/auth.js`: TFS PAT login and Azure AD login, calls `loadConfig()` at module/function level
   - `src/routes/` — 25+ route files, all calling `loadConfig()` inside handlers
   - `data/` folder: `annotations.json`, `retro-actions.json`, `user-pats.json`
   - `snapshots/` folder: at project root (`D:\views\AV Dashboard\snapshots`), hardcoded in `src/helpers/snapshots.js`
   - `server.js`: all routes at `/api`; special sub-prefix mounts: `app.use('/api/reports', ...)`, `app.use('/api/notifications', ...)`, `app.use('/api/insights', ...)`
   - Routes with hardcoded data file paths: `annotations.js`, `retro.js`, `config.js`, `kpi.js`, `snapshot.js`, `scopeChange.js`

3. **Rubber duck consultation before implementing**
   - Key blocking issues found:
     - Legacy config is `config.json` at ROOT, not `data/config.json`
     - The `reports`, `notifications`, `insights` routes have sub-prefixes that must be preserved when adding `/api/d/:deptId` mounts
     - `user-pats.json` should remain GLOBAL (not per-dept) — PATs are user credentials
     - Need dept ID validation (`^[a-z0-9][a-z0-9-]{0,63}$`) against path traversal
     - Wave 1 is namespacing only — no auth isolation until Wave 2
     - Auth/session settings stay global (use default dept config for Wave 1)
   - Adopted all blocking findings; non-blocking suggestions noted

4. **Wave 1 implementation started — new files created**
   - `src/helpers/deptPaths.js` ✅ — central path helper
   - `src/helpers/migration.js` ✅ — auto-migration on first start
   - `src/config.js` updated ✅ — `loadConfig(deptId='default')`, `saveConfig(cfg, deptId)`
   - `src/middleware/dept.js` ✅ — `deptIdMiddleware` parses `req.path` to set `req.deptId`
   - `src/routes/departments.js` ✅ — dept CRUD API (admin only)
   - `src/helpers/snapshots.js` updated ✅ — `getSnapshotsDir(deptId)`, all functions accept optional `deptId`
   - `src/routes/annotations.js` updated ✅ — uses `getDeptDataFile(req.deptId, 'annotations.json')`
   - `src/routes/retro.js` updated ✅ — uses `getDeptDataFile(req.deptId, 'retro-actions.json')`
   - `src/routes/config.js` partially updated — imports changed, GET handler started; **NOT COMPLETE**

</history>

<work_done>

Files created:
- `src/helpers/deptPaths.js` — `getDeptDir`, `getDeptDataFile`, `getSnapshotsDir`, `getDepartments`, `saveDepartments`, `isValidDeptId`; path traversal guard
- `src/helpers/migration.js` — one-time auto-migration; copies root `config.json`, `data/annotations.json`, `data/retro-actions.json`, `snapshots/*.json` → `data/departments/default/`; idempotent per-file
- `src/middleware/dept.js` — `deptIdMiddleware`: parses `req.path`, validates deptId slug regex + registry, sets `req.deptId`
- `src/routes/departments.js` — GET/POST/PUT/DELETE + `/test-connection`; admin guard

Files modified:
- `src/config.js` — complete rewrite: `loadConfig(deptId='default')` reads from `data/departments/{deptId}/config.json`, falls back to root `config.json` ONLY for `default` dept; `saveConfig(cfg, deptId)` writes to dept folder; imports `deptPaths.js` helpers
- `src/helpers/snapshots.js` — added `getSnapshotsDir(deptId)` function; `ensureSnapshotsDir(deptId)`, `listSnapshotFiles(deptId)`, `readSnapshot(id, deptId)` accept optional deptId; SNAPSHOTS_DIR legacy const preserved; exports updated to include `getSnapshotsDir`
- `src/routes/annotations.js` — removed hardcoded `DATA_FILE`; `readAll(deptId)` / `writeAll(items, deptId)` helper functions; all route handlers use `req.deptId`
- `src/routes/retro.js` — same pattern as annotations; `getDataFile(deptId)` helper; all handlers use `req.deptId`
- `src/routes/config.js` — **PARTIALLY DONE**: imports changed (`saveConfig` instead of `CFG_PATH`, removed `fs`); GET handler updated to `loadConfig(req.deptId)`; POST handler still has `fs.writeFileSync(CFG_PATH, ...)` on line 174 — NOT YET UPDATED

Work completed:
- [x] Architecture plan fully read and understood
- [x] Rubber duck consultation — blocking issues fixed
- [x] `deptPaths.js` helper (foundation for everything)
- [x] `migration.js` (auto-migrate on first start)
- [x] `config.js` updated (loadConfig/saveConfig dept-aware)
- [x] `dept.js` middleware
- [x] `departments.js` CRUD route
- [x] `snapshots.js` helper updated
- [x] `annotations.js` updated
- [x] `retro.js` updated
- [ ] `config.js` route POST handler — finish replacing `fs.writeFileSync(CFG_PATH, ...)` with `saveConfig(current, req.deptId)` (line 174)
- [ ] `kpi.js` — replace `CFG_PATH` with `saveConfig(cfg, req.deptId)` (lines 602, 614)
- [ ] `snapshot.js` — pass `req.deptId` to all snapshot helpers
- [ ] `scopeChange.js` — pass `req.deptId` to snapshot helpers; update `scopeFile()` to use `getSnapshotsDir(req.deptId)`
- [ ] All 20+ other routes — replace `loadConfig()` with `loadConfig(req.deptId)`
- [ ] `server.js` — add migration call, `deptIdMiddleware`, new `/api/d/:deptId` route mounts
- [ ] Build verification

</work_done>

<technical_details>

**Legacy config path**: `config.json` lives at the PROJECT ROOT (`D:\views\AV Dashboard\config.json`), NOT in `data/`. `src/config.js` had `path.join(__dirname, '..', 'config.json')`. Migration copies this to `data/departments/default/config.json`.

**deptIdMiddleware approach**: Runs for ALL `/api/*` requests. Uses `req.path.match(/^\/d\/([^/]+)/)` to detect dept-scoped requests. For `/api/d/foo/teams`, `req.path` at the `/api` middleware level is `/d/foo/teams` — the middleware correctly extracts `foo`. For `/api/teams`, no match → `req.deptId = 'default'`.

**Why duplicate route mounts work**: When Express matches `app.use('/api/d/:deptId', router)`, the router sees the path AFTER `/api/d/:deptId` is stripped. So `/api/d/foo/teams` → router sees `/teams`. The same route handler modules can be mounted at both `/api` and `/api/d/:deptId`. `req.deptId` is already set before handlers run (by `deptIdMiddleware` at `/api` level). `req.params.deptId` is NOT needed since `req.deptId` is used everywhere.

**Special sub-prefix routes**: `reports`, `notifications`, `insights` must be mounted as:
- `app.use('/api/reports', routerA)` AND `app.use('/api/d/:deptId/reports', routerA)`
- (not just `app.use('/api', routerA)` or it would serve wrong paths)

**user-pats.json stays GLOBAL**: `src/helpers/userPatStore.js` reads from `data/user-pats.json`. PATs are user credentials that work across TFS servers — do NOT copy to per-dept folders during migration.

**Wave 1 is namespacing only**: Any authenticated user who knows a deptId can access its data. Auth isolation (checking user's dept membership) is Wave 2. Document this as a known limitation.

**snapshots.js SNAPSHOTS_DIR**: Legacy constant at project root kept for backward compat; new `getSnapshotsDir(deptId)` returns dept-specific path OR falls back to legacy root when `deptId` is falsy. All exported functions now accept optional `deptId` param.

**config.js route line 174**: Still has `fs.writeFileSync(CFG_PATH, ...)` — must be replaced with `saveConfig(current, req.deptId)`.

**Migration is idempotent**: Checks if each target file exists before copying. Gated on absence of `data/departments.json` (registry) — if registry exists, migration is skipped entirely.

**loadConfig fallback**: Only falls back to root `config.json` when `deptId === 'default'`. For any other deptId, missing config throws an error immediately (no silent wrong-dept fallback).

**`notifications-log.json`**: Exists at project root — not handled by migration. Likely global, not per-dept. Leave as-is.

</technical_details>

<important_files>

- **`src/helpers/deptPaths.js`** (NEW)
  - Foundation for all multi-tenant paths
  - Exports: `getDeptDir(deptId)`, `getDeptDataFile(deptId, filename)`, `getSnapshotsDir(deptId)`, `getDepartments()`, `saveDepartments(depts)`, `isValidDeptId(id)`
  - Has path traversal guard (ensures resolved path starts within `data/departments/`)

- **`src/helpers/migration.js`** (NEW)
  - Auto-migration on first start; gated on `data/departments.json` absence
  - Copies: `config.json` (root), `data/annotations.json`, `data/retro-actions.json`, `snapshots/*.json` → `data/departments/default/`
  - `user-pats.json` intentionally NOT copied (stays global)

- **`src/config.js`**
  - Updated: `loadConfig(deptId='default')` + `saveConfig(cfg, deptId)`
  - Fallback to root `config.json` ONLY for deptId === 'default'

- **`src/middleware/dept.js`** (NEW)
  - `deptIdMiddleware` — sets `req.deptId` for all `/api/*` routes by parsing `req.path`

- **`src/routes/departments.js`** (NEW)
  - Dept CRUD: GET/POST/PUT/DELETE `/api/departments` + POST `/api/departments/:id/test-connection`
  - Admin-only guard

- **`src/helpers/snapshots.js`**
  - Updated to accept `deptId` param in `ensureSnapshotsDir`, `listSnapshotFiles`, `readSnapshot`
  - New export: `getSnapshotsDir(deptId)`
  - Legacy `SNAPSHOTS_DIR` kept for backward compat

- **`src/routes/config.js`**
  - PARTIALLY updated — imports changed, GET handler uses `loadConfig(req.deptId)`
  - POST handler line 174 still writes to `CFG_PATH` — MUST fix before server.js update

- **`src/routes/kpi.js`**
  - Lines 602, 614: still uses `CFG_PATH` and `fs.writeFileSync` — needs `saveConfig(cfg, req.deptId)`

- **`server.js`**
  - NOT YET UPDATED — needs: `require('./src/helpers/migration').runMigration()`, `deptIdMiddleware` use, all routes re-mounted at `/api/d/:deptId`
  - Special sub-prefix routes: `app.use('/api/reports', ...)`, `app.use('/api/notifications', ...)`, `app.use('/api/insights', ...)` must also be mounted at their dept-scoped equivalents

</important_files>

<next_steps>

Remaining Wave 1 tasks (in order):

1. **Finish `src/routes/config.js`** — POST handler line 174: replace `fs.writeFileSync(CFG_PATH, JSON.stringify(current, null, 2))` with `saveConfig(current, req.deptId)`. Also update `loadConfig()` → `loadConfig(req.deptId)` on line 83 (the `POST /api/config` handler reads current config first).

2. **Update `src/routes/kpi.js`** lines 601–614:
   - Line 602: remove `const { CFG_PATH } = require('../config')` and `const fs = require('fs')` inside handler
   - Line 606: `loadConfig()` → `loadConfig(req.deptId)`
   - Line 614: `fs.writeFileSync(CFG_PATH, ...)` → `saveConfig(cfg, req.deptId)`
   - Add `const { saveConfig } = require('../config')` to top of file

3. **Update `src/routes/snapshot.js`**:
   - Replace `{ SNAPSHOTS_DIR, ensureSnapshotsDir, listSnapshotFiles, readSnapshot, ... }` imports with `{ getSnapshotsDir, ensureSnapshotsDir, listSnapshotFiles, readSnapshot, ... }`
   - Replace `path.join(SNAPSHOTS_DIR, ...)` with `path.join(getSnapshotsDir(req.deptId), ...)`
   - Update calls: `ensureSnapshotsDir()` → `ensureSnapshotsDir(req.deptId)`, `listSnapshotFiles()` → `listSnapshotFiles(req.deptId)`, `readSnapshot(id)` → `readSnapshot(id, req.deptId)`
   - `loadConfig()` → `loadConfig(req.deptId)`

4. **Update `src/routes/scopeChange.js`**:
   - Replace `{ SNAPSHOTS_DIR, readSnapshot }` imports → `{ getSnapshotsDir, readSnapshot }`
   - `scopeFile(snapshotId)` function uses `SNAPSHOTS_DIR` → update to `getSnapshotsDir(req.deptId)`
   - Since `scopeFile` is called in handlers that have `req`, refactor it to accept `deptId` param
   - `loadConfig()` → `loadConfig(req.deptId)`, `readSnapshot(id)` → `readSnapshot(id, req.deptId)`

5. **Update ALL remaining routes** — mechanical `loadConfig()` → `loadConfig(req.deptId)` change in: `blockers.js`, `cycleTime.js`, `dashboard.js`, `defects.js`, `dependencies.js`, `github.js`, `insights.js`, `notifications.js`, `objectives.js`, `objectivesPlan.js`, `piChecks.js`, `piDelivery.js`, `piReadiness.js`, `predictability.js`, `progress.js`, `releaseHealth.js`, `reports.js`, `risks.js`, `roadmap.js`, `sprint.js`, `sprintCapacity.js`, `storyMetrics.js`, `teamCapacities.js`, `testCoverage.js`, `velocity.js`
   - Note: `auth.js` routes — keep as `loadConfig()` (global auth, no dept context)

6. **Update `server.js`** — the most critical step:
   ```js
   const { runMigration } = require('./src/helpers/migration');
   const { deptIdMiddleware } = require('./src/middleware/dept');
   
   runMigration(); // before app setup
   
   // After auth routes, before requireAuth:
   app.use('/api', deptIdMiddleware);
   
   // After requireAuth, add departments CRUD:
   app.use('/api', require('./src/routes/departments'));
   
   // For every existing app.use('/api', routeModule):
   //   also add: app.use('/api/d/:deptId', routeModule)
   // For special sub-prefix routes:
   //   app.use('/api/reports', reportsRoute)  → also app.use('/api/d/:deptId/reports', reportsRoute)
   //   app.use('/api/notifications', notifRoute) → also app.use('/api/d/:deptId/notifications', notifRoute)
   //   app.use('/api/insights', insightsRoute) → also app.use('/api/d/:deptId/insights', insightsRoute)
   ```

7. **Run `npm run build`** in `client/` to verify no frontend breakage, then start server and test:
   - `GET /api/config` should work (backward compat)
   - `GET /api/departments` should return `[{id: 'default', ...}]`
   - `data/departments/default/config.json` should be created on first start

</next_steps>