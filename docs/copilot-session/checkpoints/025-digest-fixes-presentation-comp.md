<overview>
The session covered three areas: (1) completing the AV Dashboard v2 presentation with the final 3 slides, (2) debugging and fixing the "Send Digest" button returning 500 then 403 errors, and (3) starting work on section persistence (first login → first page, refresh → last visited section). The app is a Node.js/Express + React/Vite TFS dashboard for ICAP ISP programme management.
</overview>

<history>

1. **User asked to continue with v2 presentation (3 remaining slides)**
   - Inserted **Slide 24/28 — Notification Center & Saved Views**: bell icon mockup with unread badge, notification history list, Saved Views config with active blue-border chip highlighting
   - Inserted **Slide 25/28 — Enriched Weekly Digest**: 8 configurable sections table, Adaptive Card mockup with Team Breakdown + Changes This Week, 5 TFS action buttons
   - Inserted **Slide 26/28 — Roles & Visibility Management**: role chips + custom role inline editor, visibility policy grid, "new role = all hidden" callout
   - Updated **Slide 27/28** (Settings) and **Slide 28/28** (Closing): closing slide updated from "13 Sections" to "21 Sections · v2" with ★ entries for all 6 new features
   - Ran PowerShell to remap all remaining "xx / 22" labels to "xx / 28"
   - Verified: 28 total slides, 0 remaining "/ 22" occurrences, file size 116.7 KB

2. **User clicked "Send Digest" and got 500 Internal Server Error**
   - Investigated: found `tfsAuth.enabled = true` in config.json
   - Root cause: `sendDigest()` makes internal self-calls to `/api/dashboard`, `/api/velocity`, `/api/insights/summary` — these have no session cookie, so `requireAuth` blocks them with 401 → `Promise.all` rejects → 500
   - Fix: Created `src/internalToken.js` (random 64-char hex secret per process start)
   - Updated `src/scheduler.js` `fetchJson()` to send `x-internal-service-token` header
   - Updated `src/middleware/auth.js` `requireAuth()` to check the token first and grant admin pass-through
   - Server restarted — 500 resolved

3. **User got 403 "Webhook POST failed" from Teams**
   - Investigated: webhook URL is `philips.webhook.office.com` → correctly detected as O365 Connector (MessageCard)
   - Root cause 1: `teamFacts` had `{ title: '─── Defect load ───', value: '' }` — **empty string value** in MessageCard fact; O365 Connector rejects this
   - Root cause 2: `potentialAction` URLs contained full WIQL queries (500+ chars each) — O365 Connector has URL length limits → 403
   - Fix: Removed the separator fact with empty value; merged defect team entries inline
   - Fix: Replaced long WIQL deep-link URLs in `potentialAction` with a short TFS base `/_workItems` URL
   - Added 22KB payload size guard (O365 limit ~24KB) + better error logging with payload size
   - Server restarted — digest sent successfully to Teams ✅

4. **User asked: first login → load first page; on refresh → restore previously selected section**
   - Identified the mechanism: `activeSection` defaults to `'features'` in zustand store (hardcoded)
   - URL params are read on mount (`useEffect(() => {}, [])`) — on refresh URL has `?section=xxx` so it's read correctly
   - After login: `window.location.href = '/'` clears URL → section resets to default `'features'`
   - The fix needs: read `localStorage('av-last-section')` on init; write to localStorage on every `setActiveSection`; first login (no localStorage key) → use first visible nav section
   - **Work in progress** — not yet implemented when compaction occurred

</history>

<work_done>

Files created:
- `src/internalToken.js` — NEW: generates random 64-char hex token per server process for internal scheduler→API auth bypass

Files modified:
- `src/middleware/auth.js` — Added `INTERNAL_TOKEN`/`INTERNAL_HEADER` import; added token check at top of `requireAuth()` to bypass session auth for scheduler self-calls
- `src/scheduler.js` — Added `INTERNAL_TOKEN`/`INTERNAL_HEADER` import; updated `fetchJson()` to pass internal token header; removed empty-value fact (`'─── Defect load ───'`); replaced long WIQL potentialAction URLs with short TFS base URL; added 22KB payload guard; improved error logging with payload size
- `docs/Presentation/AV_Dashboard_Programme_Presentation_v2.html` — Added slides 24, 25, 26; updated slides 27, 28; renumbered all "xx / 22" to "xx / 28" — now 116.7 KB, 28 slides complete

Work completed:
- [x] Presentation v2 — all 28 slides complete
- [x] Digest 500 error fixed (internal auth bypass)
- [x] Digest 403 error fixed (empty fact value + long URLs in O365 connector)
- [x] Digest works end-to-end — user confirmed ✅
- [ ] Section persistence: first login → first page; refresh → last visited section (IN PROGRESS, not yet implemented)

</work_done>

<technical_details>

**Internal Auth Bypass Pattern:**
- `tfsAuth.enabled = true` → `requireAuth` blocks ALL requests without session cookies including self-calls
- Solution: `crypto.randomBytes(32).toString('hex')` in a module-level singleton (`internalToken.js`) — unique per process restart, not guessable from outside
- `requireAuth` checks `req.headers['x-internal-service-token'] === INTERNAL_TOKEN` before session check

**O365 Connector (webhook.office.com) Restrictions:**
- Detected by `isO365Connector(url)` checking for `webhook.office.com` substring
- Uses legacy `MessageCard` format (NOT Adaptive Card)
- **Rejects empty string fact values** — `{ name: 'X', value: '' }` causes 403
- **Rejects long URLs in potentialAction** — embedded WIQL queries (500+ chars) in OpenUri cause 403
- **Payload limit ~24KB** — guard added: if `JSON.stringify(card).length > 22000`, trim to first 5 sections
- Power Automate / logic.azure.com webhooks use Adaptive Card format

**Section Persistence Architecture (pending fix):**
- `activeSection` lives in zustand store, defaults to `'features'`
- URL approach: `replaceState` writes `?section=xxx` when authenticated; mount effect reads URL params
- Problem: `window.location.href = '/'` after TFS login clears URL → defaults to `'features'`
- Fix needed in `client/src/store/useStore.js`: initialize `activeSection` from `localStorage.getItem('av-last-section') || 'features'`; in `setActiveSection`: `localStorage.setItem('av-last-section', section)` before `set({ activeSection })`
- First login detection: if no `av-last-section` key in localStorage → first page (first visible nav section for role)

**Digest sections added since last checkpoint:**
- `teamBreakdown`, `piReadiness`, `changes` all default `true`
- `risks`, `velocity` remain `false` by default (too noisy)
- `changesFacts` has `since` guard — only rendered if `changes.since` is truthy

**`fetchChangesThisWeek` uses `tfsPost` directly** (not HTTP self-call) — avoids the auth issue entirely; 4 `Promise.allSettled` WIQL calls

</technical_details>

<important_files>

- `src/internalToken.js`
  - NEW file — singleton random token for scheduler→API internal calls
  - Module-level `crypto.randomBytes(32).toString('hex')` runs once per process start

- `src/middleware/auth.js`
  - Session/auth middleware — TFS PAT login, Azure AD OIDC, role mapping
  - Modified: added internal token import + check at line ~125 in `requireAuth()`
  - Key: token check must be FIRST before `loadConfig()` and session checks

- `src/scheduler.js`
  - Core digest engine — builds/sends Weekly PI Health Digest; threshold alerts; cron scheduling
  - Modified: internal token in `fetchJson()` (~line 164); empty fact fix in `teamFacts` (~line 522); MessageCard `potentialAction` shortened (~line 237); payload size guard added (~line 245); error logging in `postWebhook()` (~line 178)
  - `buildMessageCard()` → O365 Connector (MessageCard format)
  - `buildAdaptiveCard()` → Power Automate / generic webhooks
  - `isO365Connector()` → checks URL for `webhook.office.com`

- `client/src/store/useStore.js`
  - Zustand store — all global state: activeSection, selectedPIs, selectedTeam, theme, roles, branding
  - **NOT YET MODIFIED** — needs section persistence fix
  - `activeSection` at line 12, defaults to `'features'`
  - `setActiveSection` at line 55 — needs `localStorage.setItem` call added
  - `theme` at line 13 already uses localStorage pattern — copy this pattern for section

- `client/src/App.jsx`
  - Main app component — auth guard, URL param read/write, keyboard shortcuts, section rendering
  - URL param reading: `useEffect(() => {}, [])` at line ~116 reads `?section=` on mount
  - URL param writing: effect at line ~130 writes `replaceState` when `authenticated` changes
  - After section persistence fix, `setActiveSection` call in URL-read effect should remain (URL overrides localStorage — deep-link behaviour)

- `docs/Presentation/AV_Dashboard_Programme_Presentation_v2.html`
  - 116.7 KB, 28 slides complete — fully updated v2 presentation
  - Slides 24-28: Notification Center+Saved Views, Enriched Digest, Roles & Visibility, Settings, Closing
  - JS counter is dynamic (`slides.length`) so always shows correct X/28

</important_files>

<next_steps>

**Immediately in progress — Section Persistence:**

In `client/src/store/useStore.js`:
1. Change `activeSection` default: `localStorage.getItem('av-last-section') || 'features'`
2. Update `setActiveSection` action to also call `localStorage.setItem('av-last-section', activeSection)` before `set()`

In `client/src/App.jsx`:
3. After auth completes for the **first time** (new login, no localStorage key), navigate to first visible section for the user's role — detect by checking if `localStorage.getItem('av-last-section')` was null before the store initialized

Edge cases to handle:
- If stored section is no longer visible for user's role → fall back to first visible section
- URL `?section=` param should override localStorage (existing behaviour preserved)
- After `window.location.href = '/'` on login, localStorage key ensures section is restored

**Other pending todos (from session database):**
- `snap-global-backend`: Expand snapshot POST to capture full dashboard data; update `/api/predictability` to read features from snapshot
- `snap-global-frontend`: Move capture button to topbar; build modal with Capture + Browse tabs

</next_steps>