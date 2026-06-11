import { RAG_LOWER_IS_BETTER, PI_BADGE_COLORS, FEATURE_STATES, DEFECT_STATES } from './constants.js';

/**
 * Returns a sort key for sprint labels/iteration paths so that:
 * S1, S2, S3 … sort numerically, and IP always sorts last.
 * Works with full paths ("Healthcare IT\...\26-PI2 S1") or bare labels ("S1", "IP").
 */
export function sprintSortKey(iterPathOrLabel = '') {
  const seg = iterPathOrLabel.replace(/\//g, '\\').split('\\').pop() || iterPathOrLabel;
  // Strip PI prefix e.g. "26-PI2 S1" → "S1", "26-PI2 IP" → "IP"
  const label = seg.replace(/^\d{2}-PI\d+\s*/i, '').trim().toUpperCase();
  if (label === 'IP') return '\xFF'; // always last
  const m = label.match(/^S(\d+)$/);
  if (m) return `S${m[1].padStart(4, '0')}`; // S0001, S0002 …
  return label; // fallback alphabetic
}

export function extractTeamFromPath(areaPath) {
  if (!areaPath) return 'Unknown';
  const normalized = areaPath.replace(/\//g, '\\');
  const parts = normalized.split('\\').filter(Boolean);
  return parts[parts.length - 1] || 'Unknown';
}

export function shortIter(iterPath) {
  if (!iterPath) return '–';
  const parts = iterPath.replace(/\//g, '\\').split('\\');
  return parts.slice(-2).join(' › ');
}

export function formatDate(iso) {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch { return '–'; }
}

export function formatTime(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function getRAG(value, metric, ragThresholds) {
  const t = ragThresholds[metric];
  if (!t || value === null || value === undefined || isNaN(value)) return 'neutral';
  if (RAG_LOWER_IS_BETTER.includes(metric)) {
    if (value <= t.green) return 'green';
    if (value <= t.amber) return 'amber';
    return 'red';
  } else {
    if (value >= t.green) return 'green';
    if (value >= t.amber) return 'amber';
    return 'red';
  }
}

export function ragClass(rag) {
  return rag === 'green' ? 'rag-green' : rag === 'amber' ? 'rag-amber' : rag === 'red' ? 'rag-red' : 'rag-neutral';
}

export function ragSymbol(rag) {
  return rag === 'green' ? '🟢' : rag === 'amber' ? '🟡' : rag === 'red' ? '🔴' : '⚪';
}

export function extractPIFromIter(iterPath) {
  if (!iterPath) return '';
  const m = iterPath.replace(/\//g, '\\').match(/(\d{2}-PI\d)/);
  return m ? m[1] : '';
}

export function piBadgeStyle(piLabel) {
  const n = parseInt((piLabel.match(/PI(\d)/) || [])[1] || '1') - 1;
  const c = PI_BADGE_COLORS[n % PI_BADGE_COLORS.length];
  return { background: `${c}22`, color: c, border: `1px solid ${c}55`, borderRadius: '4px', padding: '1px 6px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' };
}

// ── Client-side team filter (mirrors old app applyTeamFilter) ──────────────

export function teamMatchesFilter(areaPath, filter) {
  if (!filter) return true;
  const norm = (areaPath || '').replace(/\//g, '\\');
  if (filter.startsWith('ROOT:')) return norm.startsWith(filter.slice(5));
  return norm.split('\\').pop() === filter;
}

export function applyTeamFilter(data, selectedTeam) {
  if (!data || !selectedTeam) return data;

  const now = new Date();

  // ── Features ────────────────────────────────────────────────────────────
  const featItems = (data.features?.items || []).filter(i => teamMatchesFilter(i.area, selectedTeam));
  const fSC = {};
  const fTB = {};
  const fTBE = {}; // teamBreakdownByEffort
  FEATURE_STATES.forEach(s => (fSC[s] = 0));
  featItems.forEach(i => {
    if (fSC[i.state] !== undefined) fSC[i.state]++;
    const t = extractTeamFromPath(i.area);
    if (!fTB[t]) { fTB[t] = {}; fTBE[t] = {}; FEATURE_STATES.forEach(s => { fTB[t][s] = 0; fTBE[t][s] = 0; }); }
    if (fTB[t][i.state] !== undefined) {
      fTB[t][i.state]++;
      fTBE[t][i.state] = (fTBE[t][i.state] || 0) + (Number(i.size) || 0);
    }
  });
  const wipCount = (fSC.Activated || 0) + (fSC.Approved || 0) + (fSC['In Progress'] || 0);
  const fDone    = fSC.Done || 0;
  const fActive  = featItems.length - (fSC.Removed || 0);
  const doneRate = fActive > 0 ? Math.round((fDone / fActive) * 100) : 0;
  const slippedItems = (data.features?.slippedFeatures?.items || []).filter(i => teamMatchesFilter(i.area, selectedTeam));

  // Throughput by iteration (Done features only)
  const throughputByIteration = {};
  featItems.filter(i => i.state === 'Done').forEach(i => {
    if (i.iter) throughputByIteration[i.iter] = (throughputByIteration[i.iter] || 0) + 1;
  });

  // Total by iteration (for sprint progress — effort + count, team-filtered)
  const totalByIteration = {};
  featItems.filter(i => i.state !== 'Removed').forEach(i => {
    if (!i.iter) return;
    if (!totalByIteration[i.iter]) totalByIteration[i.iter] = { total: 0, done: 0, totalEffort: 0, doneEffort: 0 };
    const eff = Number(i.size) || 0;
    totalByIteration[i.iter].total++;
    totalByIteration[i.iter].totalEffort += eff;
    if (i.state === 'Done') {
      totalByIteration[i.iter].done++;
      totalByIteration[i.iter].doneEffort += eff;
    }
  });

  // Cycle time (Created → Done)
  const ctArr = featItems
    .filter(i => i.state === 'Done' && i.stateChangeDate && i.created)
    .map(i => ({
      team: extractTeamFromPath(i.area),
      days: Math.max(0, Math.floor((new Date(i.stateChangeDate) - new Date(i.created)) / 86400000)),
    }));
  const ctByTeam = {};
  ctArr.forEach(({ team, days }) => {
    if (!ctByTeam[team]) ctByTeam[team] = [];
    ctByTeam[team].push(days);
  });
  const cycleTime = {
    count: ctArr.length,
    avg:   ctArr.length ? Math.round(ctArr.reduce((s, c) => s + c.days, 0) / ctArr.length) : null,
    min:   ctArr.length ? Math.min(...ctArr.map(c => c.days)) : null,
    max:   ctArr.length ? Math.max(...ctArr.map(c => c.days)) : null,
    byTeam: Object.fromEntries(Object.entries(ctByTeam).map(([t, vals]) => [t, {
      avg:   Math.round(vals.reduce((s, d) => s + d, 0) / vals.length),
      min:   Math.min(...vals),
      max:   Math.max(...vals),
      count: vals.length,
    }])),
  };

  // Feature age buckets (non-Done/Removed items)
  const AGE_BUCKETS = ['<7d', '7-14d', '15-30d', '31-60d', '60+d'];
  const featureAgeBuckets = Object.fromEntries(AGE_BUCKETS.map(b => [b, 0]));
  const featureAgeItems   = [];
  for (const i of featItems) {
    if (i.state === 'Done' || i.state === 'Removed') continue;
    const sd   = i.stateChangeDate || i.changed;
    const days = sd ? Math.floor((now - new Date(sd)) / 86400000) : 0;
    if      (days < 7)  featureAgeBuckets['<7d']++;
    else if (days < 14) featureAgeBuckets['7-14d']++;
    else if (days < 30) featureAgeBuckets['15-30d']++;
    else if (days < 60) featureAgeBuckets['31-60d']++;
    else                featureAgeBuckets['60+d']++;
    if (days > 30) featureAgeItems.push({ id: i.id, title: i.title, state: i.state, team: extractTeamFromPath(i.area), days, iter: i.iter });
  }
  featureAgeItems.sort((a, b) => b.days - a.days);
  const featureAge = { buckets: featureAgeBuckets, staleItems: featureAgeItems.slice(0, 20) };

  // ── Defects ─────────────────────────────────────────────────────────────
  const defItems = (data.defects?.items || []).filter(i => teamMatchesFilter(i.area, selectedTeam));
  const dSC = {};
  const dTB = {};
  const howFoundBreakdown    = {};
  const whereFoundBreakdown  = {};
  const severityBreakdown    = {};
  const foundInBreakdown     = {};
  const injectionByIteration = {};
  const agingBuckets    = { '0–7 days': 0, '8–14 days': 0, '15–30 days': 0, '31–60 days': 0, '60+ days': 0 };
  const agingByPriority = {};
  const slaBreachesArr  = [];
  DEFECT_STATES.forEach(s => (dSC[s] = 0));

  defItems.forEach(i => {
    if (dSC[i.state] !== undefined) dSC[i.state]++;
    const t = extractTeamFromPath(i.area);
    if (!dTB[t]) { dTB[t] = {}; DEFECT_STATES.forEach(s => (dTB[t][s] = 0)); }
    if (dTB[t][i.state] !== undefined) dTB[t][i.state]++;

    if (i.state !== 'Removed') {
      if (i.howFound)   howFoundBreakdown[i.howFound]     = (howFoundBreakdown[i.howFound]     || 0) + 1;
      if (i.whereFound) whereFoundBreakdown[i.whereFound] = (whereFoundBreakdown[i.whereFound] || 0) + 1;
      if (i.severity)   severityBreakdown[i.severity]     = (severityBreakdown[i.severity]     || 0) + 1;
      const fk = i.foundIn != null ? String(i.foundIn) : 'Unknown';
      foundInBreakdown[fk] = (foundInBreakdown[fk] || 0) + 1;
    }

    // Injection by iteration
    const iterKey = i.iter || 'Unknown';
    if (!injectionByIteration[iterKey]) injectionByIteration[iterKey] = { total: 0, open: 0 };
    injectionByIteration[iterKey].total++;
    if (!['Resolved', 'Closed', 'Removed'].includes(i.state)) injectionByIteration[iterKey].open++;

    // Aging (open defects only)
    if (!['Resolved', 'Closed', 'Removed'].includes(i.state)) {
      const ageDays = i.created ? Math.floor((now - new Date(i.created)) / 86400000) : 0;
      if      (ageDays <=  7) agingBuckets['0–7 days']++;
      else if (ageDays <= 14) agingBuckets['8–14 days']++;
      else if (ageDays <= 30) agingBuckets['15–30 days']++;
      else if (ageDays <= 60) agingBuckets['31–60 days']++;
      else                    agingBuckets['60+ days']++;

      const prioKey = i.priority != null ? String(i.priority) : 'null';
      if (!agingByPriority[prioKey]) agingByPriority[prioKey] = { count: 0, totalDays: 0, avgDays: 0 };
      agingByPriority[prioKey].count++;
      agingByPriority[prioKey].totalDays += ageDays;
      agingByPriority[prioKey].avgDays = Math.round(
        agingByPriority[prioKey].totalDays / agingByPriority[prioKey].count
      );

      const slaThreshold = i.priority === 1 ? 7 : i.priority === 2 ? 14 : 30;
      if (ageDays > slaThreshold) {
        slaBreachesArr.push({ id: i.id, title: i.title, priority: i.priority, state: i.state, team: t, ageDays, slaThreshold });
      }
    }
  });

  slaBreachesArr.sort((a, b) => b.ageDays - a.ageDays);

  const escaped     = howFoundBreakdown['Found In Field'] || 0;
  const caught      = Object.entries(howFoundBreakdown)
    .filter(([k]) => k !== 'Found In Field')
    .reduce((s, [, v]) => s + v, 0);
  const escapeRatio = caught > 0 ? Math.round(escaped / caught * 100) : 0;
  const p1p2Count   = defItems.filter(i =>
    (i.priority === 1 || i.priority === 2) && !['Resolved', 'Closed', 'Removed'].includes(i.state)
  ).length;
  const dResolved   = (dSC.Resolved || 0) + (dSC.Closed || 0);
  const dActive     = defItems.length - (dSC.Removed || 0);
  const resolveRate = dActive > 0 ? Math.round((dResolved / dActive) * 100) : 0;

  return {
    ...data,
    features: {
      ...data.features,
      items:               featItems,
      total:               featItems.length,
      stateCounts:         fSC,
      teamBreakdown:       fTB,
      teamBreakdownByEffort: fTBE,
      wipCount,
      doneRate,
      throughputByIteration,
      totalByIteration,
      cycleTime,
      featureAge,
      slippedFeatures: { ...data.features?.slippedFeatures, items: slippedItems, count: slippedItems.length },
    },
    defects: {
      ...data.defects,
      items:               defItems,
      total:               defItems.length,
      stateCounts:         dSC,
      teamBreakdown:       dTB,
      howFoundBreakdown,
      whereFoundBreakdown,
      severityBreakdown,
      foundInBreakdown,
      injectionByIteration,
      agingBuckets,
      agingByPriority,
      slaBreaches:         slaBreachesArr.slice(0, 50),
      escapeRatio,
      p1p2Count,
      escaped,
      caught,
      resolveRate,
    },
  };
}
