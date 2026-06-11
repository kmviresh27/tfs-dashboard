<overview>
This session focused on polishing the KPI Tracker section of the AV Dashboard (Node.js + React app connecting to on-premise TFS). The main goals were: layout improvements (charts side by side), UX enhancements (heatmap popup, copy-to-clipboard, chart notes), and ensuring the KPI page uses the same icon/component conventions as other pages (health page pattern). All changes target `client/src/sections/KPISection.jsx` and its supporting files.
</overview>

<history>

1. **User asked: "KPI Values vs Target and Team Coverage Radar side by side"**
   - Found `KPIScoreBar` (bar chart, line ~699) and `TeamRadar` (radar chart, line ~788) were rendering stacked full-width
   - Wrapped both in a CSS grid: `gridTemplateColumns: !selectedTeam ? '1fr 420px' : '1fr'`
   - Added `inline` prop to both components to suppress their own `marginBottom` when inside grid
   - Changed chart heights to `flex: 1; minHeight: 280` so both fill equal height
   - When a team is selected, radar hides and bar chart expands full width automatically
   - Built successfully, server restarted (PID 16064)

2. **User asked: "progress bar is still not coming in kpi page"**
   - Investigated: `ProgressBar` component (8px) exists at bottom of each KPI card — uses inline styles only, no CSS dependency
   - `getProgressState` computes `fill %` correctly from numeric values returned by backend
   - Track uses `rgba(255,255,255,0.08)` — very subtle against dark bg
   - `--surface` CSS variable is used throughout but **not defined** in main.css (only `--surface-1`, `--surface-2` are defined); cards fall back to transparent
   - Investigation was interrupted by the next user request — no fix was applied

3. **User asked: "KPI Team Heatmap better to show on popup"**
   - Removed inline `<TeamHeatmap>` from the page body
   - Added `showHeatmap` state to `KPISection`
   - Added "📊 View Team Heatmap (N teams)" button in its place
   - Wrapped `TeamHeatmap` in a full-screen overlay modal (fixed position, dark backdrop, max-width 1100px, scrollable body, ✕ close + click-outside-to-close)
   - Stripped `TeamHeatmap`'s own outer container div (modal provides the container now) — fixed closing tag mismatch
   - Built successfully, server restarted (PID 44920)

4. **User asked: "Team Coverage Radar — have button to open heatmap; for both charts: copy to clipboard and add note"**
   - Added `useRef` and `useCallback` to React imports
   - Created three custom helpers inside `KPISection.jsx`:
     - `copyChartToClipboard(chartRef, setBtnLabel)` — offscreen canvas with dark bg → `navigator.clipboard.write`
     - `ChartNote({ note, onChange })` — inline textarea with save/cancel; shows italic note text with edit button
     - `ChartActionBar({ chartRef, onHeatmap })` — renders Heatmap + Copy buttons using emoji icons
   - Updated `KPIScoreBar`: added `chartRef`, `note` state, `ChartActionBar`, `<Bar ref={chartRef} ...>`, `<ChartNote>`
   - Updated `TeamRadar`: added `onHeatmap` prop, `chartRef`, `note` state, `ChartActionBar`, `<Radar ref={chartRef} ...>`, `<ChartNote>`
   - Passed `onHeatmap={() => setShowHeatmap(true)}` from `KPISection` to `TeamRadar`
   - Removed the standalone heatmap button (now in radar's action bar)
   - Built successfully, server restarted (PID 24536)

5. **User asked: "follow icons for add note and copy from other pages like health"**
   - Examined `HealthSection.jsx`: uses `CopyButton` from `components/ui/CopyButton.jsx` and `AnnotationButton`/`ChartAnnotations` from `components/ui/ChartAnnotations.jsx`
   - `CopyButton`: SVG clipboard/check icons; walks up DOM to `.card` or `[data-copy-scope]` to find canvas; also has expand/fullscreen button
   - `AnnotationButton`: SVG pencil icon (12px); opens `ChartAnnotations` popup
   - `ChartAnnotations`: persists notes via `/api/annotations` with `section/pi/team/sprint/text/color`; fetched via `useAnnotations` hook
   - Pattern: `<div className="card-actions"><AnnotationButton onClick=... /><CopyButton type="chart" /></div>`
   - **Updated imports**: added `CopyButton`, `ChartAnnotations`, `{ AnnotationButton }`, `useAnnotations`; removed `useCallback`
   - **Removed** the three custom helpers (`copyChartToClipboard`, `ChartNote`, `ChartActionBar`)
   - **⚠️ INCOMPLETE**: `KPIScoreBar` and `TeamRadar` still reference the deleted helpers in their JSX — build would fail at this point
   - Work was interrupted before updating the component JSX to use the new shared components

</history>

<work_done>

Files modified:
- `client/src/sections/KPISection.jsx` — all changes this session; last edit left it in a broken state (see below)

Work completed:
- [x] KPI Values vs Target + Team Coverage Radar rendered side by side (grid layout)
- [x] TeamHeatmap moved to popup modal (showHeatmap state + overlay)
- [x] Copy to clipboard added to both charts (custom impl, then replaced)
- [x] Add note feature added to both charts (custom impl, then replaced)
- [x] Heatmap button added to TeamRadar header
- [x] Custom helpers deleted (replaced by shared component imports)
- [ ] **BROKEN**: `KPIScoreBar` and `TeamRadar` JSX still use deleted `ChartActionBar` and `ChartNote` — build will fail
- [ ] `KPIScoreBar` needs: `data-copy-scope` on wrapper, `card-actions` div with `<AnnotationButton>` and `<CopyButton type="chart" />`
- [ ] `TeamRadar` needs: same pattern + heatmap button (since it's not `AnnotationButton` logic, needs a custom button for heatmap alongside the shared ones)
- [ ] `KPISection` main component needs: `annPopup` state, `openAnnPopup(labels)` function, `useAnnotations('kpi', pi, selectedTeam)` call, `<ChartAnnotations>` rendered at bottom
- [ ] `useRef` import still present but refs may need to be removed (CopyButton finds canvas via DOM, no ref needed)
- [ ] Progress bar visibility issue (thin 8px, `--surface` not defined) — never fixed

</work_done>

<technical_details>

- **CopyButton DOM-walk pattern**: `CopyButton` finds the chart canvas by walking up to the nearest `.card` or `[data-copy-scope]` ancestor and calling `container.querySelector('canvas')`. KPI chart wrappers need `data-copy-scope` attribute (they don't have `.card` class).

- **ChartAnnotations persistence**: Notes stored via `POST /api/annotations` with `{ section, pi, team, sprint, text, color }`. For KPI bar chart, `sprint` field = KPI name (axis label). For radar chart, no axis labels — sprints array empty → free-text input shown. Use `section='kpi'` and `section='kpi-radar'`.

- **AnnotationButton style**: SVG pencil icon, `border: '1px solid var(--border)'`, `color: 'var(--muted)'`, `padding: '2px 7px'` — no emoji.

- **CopyButton style**: SVG clipboard/check/expand icons, `background: none; border: none`, `color: var(--muted)` changing to success/danger on result. Also renders an expand (fullscreen) button for type='chart'.

- **`card-actions` CSS class**: used in Health page for the action icon row — should check if this class has CSS defined in main.css and reuse it, or use inline flex styles.

- **`--surface` variable undefined**: Used throughout KPISection but not in the CSS variable definitions (only `--surface-1: var(--bg-card)` and `--surface-2: var(--bg-card2)` exist). Cards get transparent background. This also affects the ProgressBar track visibility.

- **TeamRadar `onHeatmap` prop**: The heatmap button is not from the shared components — it's a custom button that needs to stay alongside `AnnotationButton` and `CopyButton` in the action row of the TeamRadar header.

- **`useRef` still in imports**: Was added for chart refs used by the now-deleted `ChartActionBar`. Since `CopyButton` uses DOM walk, refs are no longer needed — should be removed from imports if not used elsewhere.

- **Grid layout collapse**: When `selectedTeam` is truthy, the radar is hidden and the grid changes to `1fr` so the bar chart takes full width.

- **Server restart pattern**: `Get-Process -Name node | Stop-Process -Force`, then `Start-Process node server.js` with redirected output to `server.log`.

</technical_details>

<important_files>

- **`client/src/sections/KPISection.jsx`**
  - Core KPI UI — all charts, cards, modal, heatmap popup
  - **Currently broken**: deleted `ChartActionBar`/`ChartNote` but JSX in `KPIScoreBar` and `TeamRadar` still references them
  - Key sections: imports (~1-25), chart helpers (~96-200 now stripped), `KPIScoreBar` (~699), `TeamRadar` (~788), `KPISection` main component (~948+), heatmap modal (~1260+)

- **`client/src/components/ui/CopyButton.jsx`**
  - Shared copy-to-clipboard + fullscreen button component
  - SVG icons, DOM-walk to find canvas/table, `data-copy-scope` or `.card` as boundary
  - No changes needed — just needs to be used in KPISection

- **`client/src/components/ui/ChartAnnotations.jsx`**
  - Shared annotation popup + `AnnotationButton` export
  - Persists to `/api/annotations`; `useAnnotations` hook fetches them back
  - No changes needed — just needs to be used in KPISection

- **`client/src/api/hooks.js`**
  - Contains `useAnnotations(section, pi, team)` hook
  - Already imported in KPISection (added this session)

- **`client/src/sections/HealthSection.jsx`**
  - Reference implementation for the card-actions pattern
  - Pattern: `annPopup` state → `openAnnPopup(sprints)` → `<ChartAnnotations>` at bottom of component

</important_files>

<next_steps>

**Immediate fix required** — code is currently broken:

1. **Update `KPIScoreBar`** to use shared components:
   - Add `data-copy-scope` to the outer wrapper div
   - Replace `<ChartActionBar chartRef={chartRef} />` header section with `<div className="card-actions"><AnnotationButton onClick={() => openAnnBarPopup()} /><CopyButton type="chart" /></div>`
   - Remove `<ChartNote note={note} onChange={setNote} />` at bottom
   - Remove `chartRef` and `note` state from component (no longer needed)

2. **Update `TeamRadar`** similarly:
   - Add `data-copy-scope` to outer wrapper
   - Replace `<ChartActionBar chartRef={chartRef} onHeatmap={onHeatmap} />` with a `card-actions` div containing: custom heatmap button + `<AnnotationButton>` + `<CopyButton type="chart" />`
   - Remove `chartRef` and `note` state
   - Remove `useRef` from imports if unused

3. **Add annotation state to `KPISection` main component**:
   - `const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], section: 'kpi' })`
   - `const { data: annData } = useAnnotations('kpi', pi, selectedTeam)`
   - `function openAnnBarPopup() { setAnnPopup({ open: true, sprints: chartKpis.map(getShortLabel), section: 'kpi' }) }`
   - `function openAnnRadarPopup() { setAnnPopup({ open: true, sprints: [], section: 'kpi-radar' }) }`
   - Render `<ChartAnnotations section={annPopup.section} pi={pi} team={selectedTeam} sprints={annPopup.sprints} open={annPopup.open} setOpen={...} items={annData?.items || []} />` at bottom

4. **Pass `openAnnBarPopup` and `openAnnRadarPopup`** down via props to `KPIScoreBar` and `TeamRadar`

5. **Optional follow-up**: Fix `--surface` CSS variable (add `--surface: var(--bg-card)` to `:root`) to resolve ProgressBar track visibility

</next_steps>