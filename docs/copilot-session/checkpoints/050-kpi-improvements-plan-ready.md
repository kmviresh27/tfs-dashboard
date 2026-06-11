<overview>
The user asked for improvement suggestions to the KPI Tracker section of an AV Dashboard (Node.js + React, on-premise TFS). After presenting 10 suggestions, the user selected items 1, 2, 3, 4, 6, 7, 8, and 10 for implementation. The session then involved deep codebase analysis of `KPISection.jsx` and `src/routes/kpi.js`, a rubber duck review of the implementation plan, and was in the process of writing all code changes when compaction occurred — **no code has been written yet**.
</overview>

<history>

1. **User asked: "Any improvements you suggest in KPI tracker?"**
   - Analyzed KPISection.jsx fully (reading lines 1–1291)
   - Analyzed the backend kpi.js route (lines 1–545)
   - Presented 10 categorized improvements (quick wins, medium, strategic)
   - User selected items: **1, 2, 3, 4, 6, 7, 8, 10**

2. **Codebase analysis phase**
   - Read full `KPISection.jsx` to understand current component structure
   - Read `src/routes/kpi.js` (545 lines) to understand backend KPI computation
   - Read `src/helpers/piHelpers.js` to find `getPILabel`, `getLastNPIs`, `sprintSortKey`
   - Key finding: `pct(n, 0)` returns `0` instead of `null` — causes misleading 0% values when no TFS items exist

3. **Rubber duck review of implementation plan**
   - Submitted detailed plan to rubber-duck agent
   - **Blocking issue 1**: `pct(n, d)` returns `0` when `d=0` — must change to `null` for no-data reason logic to work
   - **Blocking issue 2**: `previousValue` from config only works if someone manually stored snapshots — auto-computed KPIs will mostly be empty. Decided to keep config-based approach as optional infrastructure (user configures `kpi.previousValues` in config.json); gracefully shows nothing if not configured
   - **Non-blocking fixes**: use `getPILabel` from piHelpers for `prevPIOf()`, handle count KPI gap chip differently, use popover-style quick edit not inline card expansion, sprint extraction regex needs to handle PI-level features

4. **Implementation planning (in progress at compaction)**
   - Finalized all 14 precise edits needed (6 backend, 8 frontend)
   - **No code has been written yet** — was about to start writing edits

</history>

<work_done>

Files modified:
- **None** — all changes are planned but not yet implemented

Work completed:
- [x] User's improvement suggestions presented and selection received (items 1, 2, 3, 4, 6, 7, 8, 10)
- [x] Full codebase analysis of KPISection.jsx and kpi.js
- [x] Rubber duck review of implementation plan completed
- [x] All 14 precise edits planned in detail
- [ ] **Backend kpi.js changes** — NOT YET WRITTEN
- [ ] **Frontend KPISection.jsx changes** — NOT YET WRITTEN

</work_done>

<technical_details>

### Backend kpi.js — Planned Changes

**Edit 1 — Import `getPILabel`:**
```js
// Line 6: change
const { getDefaultPIs } = require('../helpers/piHelpers');
// to
const { getDefaultPIs, getPILabel } = require('../helpers/piHelpers');
```

**Edit 2 — Fix `pct()` (line 58):**
```js
// FROM: return d > 0 ? Math.round(n / d * 100) : 0;
// TO:
function pct(n, d) { return d > 0 ? Math.round(n / d * 100) : null; }
```
**Why critical**: every ratio KPI currently returns `0%` when there are no TFS items, making it look "active but bad" instead of "no data". This fix makes the no-data reason chip work in the frontend.

**Edit 3 — Add `prevPIOf()` helper after `pct()`:**
```js
function prevPIOf(piLabel, pisPerYear = 4) {
  const m = (piLabel || '').match(/^(\d{2})-PI(\d)$/);
  if (!m) return null;
  let yy = parseInt(m[1]), n = parseInt(m[2]);
  if (--n < 1) { yy--; n = pisPerYear; }
  return getPILabel(yy, n);
}
// Examples: '26-PI2' → '26-PI1', '26-PI1' → '25-PI4'
```

**Edit 4 — Sprint extraction after Phase 3 (after line ~262):**
Add after the existing `for (const feat of featDetails)` loop that computes `mindmapSet`, `fmeaSet`, etc.:
```js
// Sprint-level feature grouping
const sprintFeatMap = {};
for (const feat of featDetails) {
  const iterPath = feat.fields?.['System.IterationPath'] || '';
  const seg = iterPath.replace(/\//g, '\\').split('\\').pop() || '';
  const sprint = seg.replace(/^\d{2}-PI\d+\s*/i, '').trim().toUpperCase() || null;
  if (!sprint) continue;
  if (!sprintFeatMap[sprint]) sprintFeatMap[sprint] = new Set();
  sprintFeatMap[sprint].add(feat.id);
}
const sprintOrder = Object.keys(sprintFeatMap).sort((a, b) => {
  const key = s => s === 'IP' ? '\xFF' : `S${(s.slice(1) || '0').padStart(4, '0')}`;
  return key(a).localeCompare(key(b));
});
```
**Why**: `feat.fields['System.IterationPath']` is available because `fetchWithRelations` uses `$expand=relations` which returns all default fields. Sprint label is extracted by stripping the PI prefix (e.g. `26-PI1 S1` → `S1`, `26-PI1 IP` → `IP`, `26-PI1` → null for PI-level features).

**Edit 5 — Sprint values + previousValue computation** (after RAG/TFS URLs are attached to kpis array, around line 482, before Phase 8 team breakdown):
```js
// Sprint values for feature-based KPIs
for (const kpi of kpis) {
  if (kpi.isManual || !sprintOrder.length) { kpi.sprintValues = null; continue; }
  const val = ids => {
    const n = ids.size;
    switch (kpi.id) {
      case 'exploratory-coverage': return pct([...mindmapSet].filter(x => ids.has(x)).length, n);
      case 'fmea-coverage':        return pct([...fmeaSet].filter(x => ids.has(x)).length, n);
      case 'checklist-compliance': return pct([...checklistSet].filter(x => ids.has(x)).length, n);
      case 'cross-team-review':    return pct([...crossReviewSet].filter(x => ids.has(x)).length, n);
      case 'impact-assessment':    return pct([...impactSet].filter(x => ids.has(x)).length, n);
      case 'ai-assisted-usage':    return pct([...aiTagIds].filter(x => ids.has(x)).length, n);
      case 'late-changes':         return lateChgIds.filter(x => ids.has(x)).length;
      case 'say-do-ratio':         return pct([...doneFeats].filter(x => ids.has(x)).length, n);
      default: return null;
    }
  };
  const sv = sprintOrder.map(sprint => ({ sprint, value: val(sprintFeatMap[sprint]) }));
  kpi.sprintValues = sv.some(s => s.value != null) ? sv : null;
}

// Previous PI values (optional config-based)
const prevPiLabel = prevPIOf(pi);
const prevVals = cfg.kpi?.previousValues?.[prevPiLabel] || {};
for (const kpi of kpis) {
  kpi.previousValue = prevVals[kpi.id] != null ? Number(prevVals[kpi.id]) : null;
}
```
**Note**: Bug-based KPIs (`scenario-gap-defects`, `regression-defects`, `missed-standard-defects`, `post-integration-regression`, `defect-analysis-time`) will have `sprintValues: null` because bug iteration paths are not fetched. Feature-based KPIs get sparklines automatically.

**Edit 6 — Add to res.json (lines ~531–539):**
```js
res.json({
  pi,
  computedAt: new Date().toISOString(),
  totalFeatures: totalFeats,
  totalBugs: totalBugs,
  summary,
  kpis,
  teamBreakdown,
  previousPI: prevPiLabel || null,
  previousSummary: cfg.kpi?.previousSummaries?.[prevPiLabel] || null,
});
```
Users configure `kpi.previousValues['26-PI1']['exploratory-coverage'] = 65` and `kpi.previousSummaries['26-PI1'] = { green: 8, amber: 3, red: 2, unknown: 1 }` in `config.json` for trend/comparison to appear.

---

### Frontend KPISection.jsx — Planned Changes

**Edit 1 — Update import (line 1) to include `Fragment`:**
```js
import { useMemo, useState, Fragment } from 'react';
```

**Edit 2 — Add helpers after `clamp()` (after line 99):**
```js
function computeRag(value, target, dir) {
  if (value == null) return 'unknown';
  const v = Number(value), t = Number(target);
  if (dir === 'count') return v === 0 ? 'green' : v <= 3 ? 'amber' : 'red';
  if (dir === 'lte') return v <= t ? 'green' : v <= t * 1.2 ? 'amber' : 'red';
  if (!t) return v > 0 ? 'green' : 'amber';
  const ratio = v / t;
  return ratio >= 1 ? 'green' : ratio >= 0.9 ? 'amber' : 'red';
}

function getGapInfo(value, target, dir, unit) {
  if (value == null || target == null) return null;
  const v = Number(value), t = Number(target);
  if (dir === 'count') {
    return v === 0 ? null : { isGood: false, gap: -v, displayLabel: `${v} vs 0 target` };
  }
  const gap = dir === 'gte' ? v - t : t - v;
  if (Math.abs(gap) < 0.5) return null;
  const isGood = gap >= 0;
  const abs = Math.abs(gap);
  const label = unit === '%' ? `${Math.round(abs)}pp` : unit === 'days' ? `${abs.toFixed(1)}d` : `${Math.round(abs)}`;
  return { isGood, gap, displayLabel: (isGood ? '+' : '−') + label };
}

function getTrendArrow(value, previousValue, targetDir) {
  if (value == null || previousValue == null) return null;
  const delta = Number(value) - Number(previousValue);
  if (Math.abs(delta) < 0.5) return { arrow: '→', color: 'var(--muted)' };
  const improving = (targetDir === 'gte' && delta > 0) || (targetDir === 'lte' && delta < 0) || (targetDir === 'count' && delta <= 0);
  return { arrow: improving ? '↑' : '↓', color: improving ? '#068443' : '#eb3f3f' };
}
```

**Edit 3 — Add `SprintSparkline` component after `NoteStrip` (after line ~718):**
```jsx
function SprintSparkline({ sprintValues, target, targetDir, unit }) {
  if (!sprintValues || !sprintValues.length) return null;
  const numericVals = sprintValues.filter(sv => sv.value != null).map(sv => sv.value);
  if (!numericVals.length) return null;
  const W = 100, H = 28, PAD = 3;
  const maxV = unit === '%' ? 100 : Math.max(...numericVals, target != null ? Number(target) : 0, 1);
  const tgtY = target != null ? PAD + (1 - Math.min(Number(target), maxV) / maxV) * (H - 2 * PAD) : null;
  const sX = i => sprintValues.length === 1 ? W / 2 : PAD + (i / (sprintValues.length - 1)) * (W - 2 * PAD);
  const sY = v => PAD + (1 - Math.max(0, Math.min(v, maxV)) / maxV) * (H - 2 * PAD);
  let pathD = '';
  sprintValues.forEach((sv, i) => {
    if (sv.value == null) return;
    pathD += pathD ? ` L${sX(i)},${sY(sv.value)}` : `M${sX(i)},${sY(sv.value)}`;
  });
  return (
    <div style={{ marginTop: 5 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
        {tgtY != null && <line x1={PAD} y1={tgtY} x2={W-PAD} y2={tgtY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,2" />}
        {pathD && <path d={pathD} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
        {sprintValues.map((sv, i) => {
          if (sv.value == null) return null;
          const r = computeRag(sv.value, target, targetDir);
          const c = (RAG_STYLE[r] || RAG_STYLE.unknown).color;
          return <circle key={sv.sprint} cx={sX(i)} cy={sY(sv.value)} r="2.5" fill={c} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />;
        })}
        {sprintValues.map((sv, i) => (
          <text key={`l${sv.sprint}`} x={sX(i)} y={H} fill="rgba(255,255,255,0.3)" fontSize="5.5" textAnchor="middle" style={{ userSelect: 'none' }}>
            {sv.sprint}
          </text>
        ))}
      </svg>
    </div>
  );
}
```

**Edit 4 — Add `QuickEditPanel` component after `PipelineInputPanel` (after line ~520):**
```jsx
function QuickEditPanel({ kpi, pi, onSaved, onClose }) {
  const [baseline, setBaseline] = useState(kpi.pipelineConfig?.baseline ?? '');
  const [current, setCurrent] = useState(kpi.pipelineConfig?.current ?? '');
  const [stability, setStability] = useState(kpi.pipelineConfig?.stability ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isTimeBased = kpi.id === 'build-time-reduction';

  async function handleSave() {
    setSaving(true);
    try {
      const body = isTimeBased
        ? { pi, buildTimeBaseline: parseFloat(baseline) || null, buildTimeCurrent: parseFloat(current) || null }
        : { pi, buildStability: parseFloat(stability) || null };
      await apiFetch('/api/kpi/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose?.(); onSaved?.(); }, 1200);
    } finally { setSaving(false); }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none',
      borderLeft: `3px solid ${(RAG_STYLE[kpi.rag] || RAG_STYLE.unknown).color}`,
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick Enter</span>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>✕</button>
      </div>
      {isTimeBased ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>Baseline (min)<input type="number" value={baseline} onChange={e => setBaseline(e.target.value)} style={inputStyle} placeholder="e.g. 120" /></label>
          <label style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>Current (min)<input type="number" value={current} onChange={e => setCurrent(e.target.value)} style={inputStyle} placeholder="e.g. 90" /></label>
        </div>
      ) : (
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>Stability %<input type="number" min="0" max="100" value={stability} onChange={e => setStability(e.target.value)} style={inputStyle} placeholder="0–100" /></label>
      )}
      <button type="button" onClick={handleSave} disabled={saving}
        style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', alignSelf: 'flex-end', opacity: saving ? 0.7 : 1 }}>
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
```

**Edit 5 — Replace entire `KPICard` function (lines 522–614):**
New signature: `function KPICard({ kpi, onOpen, onQuickEdit })`

Key additions:
- `gapInfo = getGapInfo(kpi.value, kpi.target, kpi.targetDir, kpi.unit)`
- `trendArrow = getTrendArrow(kpi.value, kpi.previousValue, kpi.targetDir)`
- `noDataReason = hasValue ? null : kpi.isManual ? 'Not configured' : kpi.total === 0 ? 'No TFS items' : 'No data'`
- Row 2 wraps value + trend arrow in a flex div; shows `noDataReason` as 9px subtitle below `—`
- Row 3 adds gap chip: `{gapInfo && <span style={{ color: ragS.color }}>{gapInfo.displayLabel}</span>}` on right side of target label
- Row 4 (new): `{kpi.sprintValues?.length > 0 && <SprintSparkline ... />}`
- `isManual` cards get `✏ Edit` button (stops propagation, calls `onQuickEdit?.()`)

**Edit 6 — Update `SummaryBar` function (lines 616–693):**
New signature: `function SummaryBar({ summary, total, kpis, previousPI, previousSummary })`

Add before return:
```js
const prevScore = previousSummary && total
  ? Math.round(((previousSummary.green || 0) + (previousSummary.amber || 0) * 0.5) / total * 100)
  : null;
const scoreDelta = prevScore != null ? overallScore - prevScore : null;
```

Add at end of return JSX (after leading/lagging span):
```jsx
{previousPI && (
  <>
    <div style={{ width: 1, height: 28, background: 'var(--border)', flexShrink: 0 }} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>vs {previousPI}</span>
      {scoreDelta != null && (
        <span style={{ fontSize: 15, fontWeight: 700, color: scoreDelta >= 0 ? '#068443' : '#eb3f3f', lineHeight: 1 }}>
          {scoreDelta >= 0 ? '+' : ''}{scoreDelta}pp
        </span>
      )}
      {previousSummary && (
        <div style={{ display: 'flex', gap: 4, fontSize: 9 }}>
          <span style={{ color: '#068443', fontWeight: 700 }}>{previousSummary.green ?? 0}✓</span>
          <span style={{ color: '#f5cc00', fontWeight: 700 }}>{previousSummary.amber ?? 0}⚠</span>
          <span style={{ color: '#eb3f3f', fontWeight: 700 }}>{previousSummary.red ?? 0}✗</span>
        </div>
      )}
    </div>
  </>
)}
```

**Edit 7 — Update `SummaryBar` call site (line ~1118):**
```jsx
<SummaryBar summary={data?.summary} total={allKpis.length} kpis={allKpis}
  previousPI={data?.previousPI} previousSummary={data?.previousSummary} />
```

**Edit 8 — Replace the 4-column board section (lines ~1133–1178):**
Add after existing state declarations (`selectedKpiId`, `showHeatmap`, `annPopup`, `showInfo`):
```js
const [quickEditKpiId, setQuickEditKpiId] = useState(null);
```

In the `GROUP_COLS.map(gid => ...)` block, add computed RAG/score values after `allColKpis`:
```js
const colRed   = allColKpis.filter(k => k.rag === 'red').length;
const colAmber = allColKpis.filter(k => k.rag === 'amber').length;
const colGreen = allColKpis.filter(k => k.rag === 'green').length;
const colScore = allColKpis.length ? Math.round((colGreen + colAmber * 0.5) / allColKpis.length * 100) : null;
const colScoreColor = !colScore ? '#888' : colScore >= 80 ? '#068443' : colScore >= 60 ? '#f5cc00' : '#eb3f3f';
```

Column header updated to show score badge + RAG dot mini-bar:
```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
  <span style={{ fontSize: 15 }}>{meta.icon}</span>
  <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, flex: 1 }}>{meta.label}</span>
  {colScore != null && (
    <span style={{ fontSize: 10, fontWeight: 800, color: colScoreColor, padding: '1px 5px', background: `${colScoreColor}18`, border: `1px solid ${colScoreColor}40`, borderRadius: 3 }}>
      {colScore}%
    </span>
  )}
  <span style={{ fontSize: 10, minWidth: 18, textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 5px', color: 'var(--muted)', fontWeight: 700 }}>
    {allColKpis.length}
  </span>
</div>
{(colRed > 0 || colAmber > 0 || colGreen > 0) && (
  <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center' }}>
    {colRed > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: '#eb3f3f', display: 'flex', alignItems: 'center', gap: 2 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#eb3f3f', display: 'inline-block' }} />{colRed}</span>}
    {colAmber > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: '#f5cc00', display: 'flex', alignItems: 'center', gap: 2 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f5cc00', display: 'inline-block' }} />{colAmber}</span>}
    {colGreen > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: '#068443', display: 'flex', alignItems: 'center', gap: 2 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#068443', display: 'inline-block' }} />{colGreen}</span>}
  </div>
)}
{meta.desc && <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 3 }}>{meta.desc}</div>}
```

Cards section updated to use `Fragment` with key and render `QuickEditPanel`:
```jsx
<div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
  {allColKpis.map(kpi => (
    <Fragment key={kpi.id}>
      <KPICard
        kpi={kpi}
        onOpen={() => setSelectedKpiId(kpi.id)}
        onQuickEdit={kpi.isManual ? () => setQuickEditKpiId(quickEditKpiId === kpi.id ? null : kpi.id) : undefined}
      />
      {quickEditKpiId === kpi.id && (
        <QuickEditPanel kpi={kpi} pi={pi} onSaved={handlePipelineSaved} onClose={() => setQuickEditKpiId(null)} />
      )}
    </Fragment>
  ))}
  {allColKpis.length === 0 && (
    <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>
      No KPIs configured
    </div>
  )}
</div>
```

---

### Other Key Technical Notes

- `fetchWithRelations` uses `$expand=relations` which returns ALL default work item fields including `System.IterationPath` — no extra API call needed for sprint extraction
- Sprint label extraction: last path segment after stripping PI prefix. `26-PI1 S1` → `S1`, `26-PI1 IP` → `IP`, `26-PI1` (PI-level) → null (excluded from sparklines)
- `aiTagIds` is a `Set`, other sets are also `Set`s; `lateChgIds` is an `Array`. The sprint value computation correctly handles both
- Bug-based KPIs have no sprint sparklines (only feature IDs are fetched with full details)
- `pct(n, d)` fix is a behavioral change: team breakdown uses `data?.[field] ?? 0` so null values fall back to 0 safely
- `Fragment` import needed for keyed fragments in card list (React 17+ JSX transform doesn't include React auto-import for `React.Fragment`)
- Previous PI data is config-based: users set `kpi.previousValues['26-PI1']['exploratory-coverage'] = 65` in `config.json`. Optional — no data shown if not configured
- Count KPI gap chip: `late-changes` with value=0 shows no chip (already green). Value>0 shows `"N vs 0 target"` in red

</technical_details>

<important_files>

- **`client/src/sections/KPISection.jsx`**
  - Core file for all KPI UI — all 8 frontend improvements go here
  - **NOT YET MODIFIED**
  - Key sections: `clamp()` line 97 (add helpers after), `NoteStrip` line 696 (add `SprintSparkline` after), `PipelineInputPanel` line 452 (add `QuickEditPanel` after), `KPICard` lines 522–614 (replace entirely), `SummaryBar` lines 616–693 (update), column board lines 1133–1178 (replace)

- **`src/routes/kpi.js`**
  - Backend KPI computation route — 3 of 6 improvements require backend changes
  - **NOT YET MODIFIED**
  - Key sections: `pct()` line 58 (fix null), `getDefaultPIs` import line 6 (add `getPILabel`), Phase 3 attachment sets ending ~line 262 (add sprint extraction after), kpis array built lines 302–447 (add sprint values + prevValue after RAG attachment ~line 482), `res.json` lines 531–539 (add `previousPI`, `previousSummary`)

- **`src/helpers/piHelpers.js`**
  - Contains `getPILabel(yy, n)` used in `prevPIOf()` helper; also `sprintSortKey()` referenced but not needed directly
  - No changes needed — only reading from it

- **`client/src/styles/main.css`**
  - No changes needed for these improvements (sparklines are SVG, layout changes are inline styles)

</important_files>

<next_steps>

**Immediate next steps — implement all edits in order:**

**Backend (`src/routes/kpi.js`) — 6 edits:**
1. Change import line 6: add `getPILabel` to piHelpers destructure
2. Change `pct()` line 58: `0` → `null`
3. Add `prevPIOf()` after `pct()` (4 lines)
4. Add sprint extraction block after Phase 3 (~line 262)
5. Add sprint values + previousValue computation after RAG attachment (~line 482)
6. Add `previousPI` and `previousSummary` to `res.json` (~line 531)

**Frontend (`client/src/sections/KPISection.jsx`) — 8 edits:**
1. Update import line 1: add `Fragment`
2. Add `computeRag`, `getGapInfo`, `getTrendArrow` helpers after `clamp()` (~line 99)
3. Add `SprintSparkline` component after `NoteStrip` (~line 718)
4. Add `QuickEditPanel` component after `PipelineInputPanel` (~line 520)
5. Replace entire `KPICard` function (lines 522–614)
6. Update `SummaryBar` function: new props, `prevScore`/`scoreDelta` computation, PI comparison JSX
7. Update `SummaryBar` call site (line ~1118): add `previousPI` and `previousSummary` props
8. Replace column board section (lines ~1133–1178): add state, RAG/score variables, updated header, `Fragment`+`QuickEditPanel` in card list

**After writing:** rebuild (`npm run build` in client/) and restart server to verify.

**No blockers.** All implementation details are fully resolved.

</next_steps>