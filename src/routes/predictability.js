'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { readSnapshot } = require('../helpers/snapshots');

const router = express.Router();

// ─── GET /api/predictability ──────────────────────────────────────────────────
// Compare live TFS data against a snapshot's feature list (effort-based).
router.get('/predictability', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const { snapshotId, teamPath } = req.query;
    if (!snapshotId) return res.status(400).json({ error: 'snapshotId is required' });

    const snapshot = readSnapshot(snapshotId, req.deptId);
    if (!snapshot) return res.status(404).json({ error: `Snapshot '${snapshotId}' not found` });

    // Support both old (snapshot.features) and new (snapshot.data.features.items) formats
    const snapFeatures = snapshot.data?.features?.items || snapshot.features || [];
    const snapDefects  = snapshot.data?.defects?.items  || [];
    const allIds       = [...new Set([
      ...snapFeatures.map(f => f.id),
      ...snapDefects.map(d => d.id)
    ])];
    const sizeField    = cfg.sizeField || 'Microsoft.VSTS.Scheduling.Effort';
    const teamRoot     = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const filterPath   = teamPath ? decodeURIComponent(teamPath) : null;

    const liveItems = allIds.length
      ? await fetchWorkItemDetails(allIds, ['System.Id','System.State','System.AreaPath', sizeField], cfg)
      : [];

    // Build live map (with optional team filter)
    const liveMap = {};
    liveItems.forEach(i => {
      const area = (i.fields['System.AreaPath'] || '').replace(/\//g, '\\');
      if (filterPath && !area.startsWith(filterPath.replace(/\//g, '\\'))) return;
      liveMap[i.id] = {
        state: i.fields['System.State'],
        size:  i.fields[sizeField] ?? null,
        team:  extractTeam(area, teamRoot)
      };
    });

    const isDone = s => s === 'Done';
    const summary = { Planned: { totalEffort: 0, doneEffort: 0, count: 0, doneCount: 0, unestimated: 0 },
                      Stretch: { totalEffort: 0, doneEffort: 0, count: 0, doneCount: 0, unestimated: 0 } };
    const byTeam = {};
    const featureRows = [];

    snapFeatures.forEach(sf => {
      // Removed at snapshot time = not in PI plan, exclude from measure
      if (sf.state === 'Removed') return;

      const live = liveMap[sf.id];
      if (!live) return;
      const type      = sf.type || 'Planned';
      const rawEffort = live.size ?? sf.size ?? 0;
      // Use raw effort for display; use max(rawEffort, 1) for % calc so unestimated
      // features still count in the denominator and can't inflate the ratio to 100%.
      const effCalc   = rawEffort > 0 ? rawEffort : 1;
      const done      = isDone(live.state);
      const team      = live.team;

      if (!summary[type]) summary[type] = { totalEffort: 0, doneEffort: 0, count: 0, doneCount: 0, unestimated: 0 };
      summary[type].totalEffort += rawEffort;  // actual effort for display
      summary[type].count++;
      if (!rawEffort) summary[type].unestimated++;
      if (done) { summary[type].doneEffort += rawEffort; summary[type].doneCount++; }

      // effective totals for % calculation (separatred so display stays clean)
      if (!summary[type]._effTotal) summary[type]._effTotal = 0;
      if (!summary[type]._effDone)  summary[type]._effDone  = 0;
      summary[type]._effTotal += effCalc;
      if (done) summary[type]._effDone += effCalc;

      if (!byTeam[team]) byTeam[team] = {
        Planned: { totalEffort: 0, doneEffort: 0, _effTotal: 0, _effDone: 0 },
        Stretch: { totalEffort: 0, doneEffort: 0, _effTotal: 0, _effDone: 0 }
      };
      if (!byTeam[team][type]) byTeam[team][type] = { totalEffort: 0, doneEffort: 0, _effTotal: 0, _effDone: 0 };
      byTeam[team][type].totalEffort += rawEffort;
      byTeam[team][type]._effTotal   += effCalc;
      if (done) { byTeam[team][type].doneEffort += rawEffort; byTeam[team][type]._effDone += effCalc; }

      featureRows.push({
        id: sf.id, title: sf.title, type,
        snapshotState: sf.state,
        liveState:     live.state,
        effort: rawEffort, done, team
      });
    });

    // ── Defect comparison ────────────────────────────────────────────────
    const escapedStates = new Set(cfg.defectEscapeRatio?.escapedStates || ['New','Accepted','Investigated']);
    const caughtStates  = new Set(cfg.defectEscapeRatio?.caughtStates  || ['Resolved','Closed']);

    const calcEscape = items => {
      const escaped = items.filter(d => escapedStates.has(d.liveState)).length;
      const caught  = items.filter(d => caughtStates.has(d.liveState)).length;
      return (escaped + caught) > 0 ? Math.round(escaped / (escaped + caught) * 100) : null;
    };
    const calcEscapeSnap = items => {
      const escaped = items.filter(d => escapedStates.has(d.snapshotState)).length;
      const caught  = items.filter(d => caughtStates.has(d.snapshotState)).length;
      return (escaped + caught) > 0 ? Math.round(escaped / (escaped + caught) * 100) : null;
    };

    const defectRows = [];
    snapDefects.forEach(sd => {
      const live = liveMap[sd.id];
      if (!live) return;
      defectRows.push({
        id:            sd.id,
        title:         sd.title,
        team:          live.team || sd.team || '',
        snapshotState: sd.state,
        liveState:     live.state,
        changed:       sd.state !== live.state
      });
    });

    const snapEscapeRatio = calcEscapeSnap(defectRows);
    const liveEscapeRatio = calcEscape(defectRows);
    const resolvedNow     = defectRows.filter(d => caughtStates.has(d.liveState)).length;
    const defectSummary   = {
      snapshotTotal:  snapDefects.length,
      liveTotal:      defectRows.length,
      resolvedNow,
      snapEscapeRatio,
      liveEscapeRatio,
      escapeDelta:    (snapEscapeRatio != null && liveEscapeRatio != null)
                       ? liveEscapeRatio - snapEscapeRatio : null
    };

    // calcPct uses _effTotal/_effDone (which ensure min 1 per feature) so unestimated
    // features are never invisible in the denominator.
    const calcPct = s => s._effTotal > 0 ? Math.round(s._effDone / s._effTotal * 100) : null;
    const p = summary.Planned;
    const s = summary.Stretch;

    const overallEffTotal = (p._effTotal || 0) + (s._effTotal || 0);
    const overallEffDone  = (p._effDone  || 0) + (s._effDone  || 0);

    // Flatten byTeam for the frontend: { plannedPct, stretchPct, ... }
    const byTeamFlat = {};
    for (const [team, td] of Object.entries(byTeam)) {
      const pl = td.Planned || {};
      const st = td.Stretch || {};
      byTeamFlat[team] = {
        plannedTotal:  pl.totalEffort || 0,
        plannedDone:   pl.doneEffort  || 0,
        stretchTotal:  st.totalEffort || 0,
        stretchDone:   st.doneEffort  || 0,
        plannedPct:    pl._effTotal > 0 ? Math.round(pl._effDone / pl._effTotal * 100) : null,
        stretchPct:    st._effTotal > 0 ? Math.round(st._effDone / st._effTotal * 100) : null,
      };
    }

    res.json({
      snapshotId, pis: snapshot.pis || [snapshot.pi], label: snapshot.label, capturedAt: snapshot.capturedAt,
      planned: { ...p, predictabilityPct: calcPct(p) },
      stretch: { ...s, predictabilityPct: calcPct(s) },
      overall: {
        totalEffort:  p.totalEffort + s.totalEffort,
        doneEffort:   p.doneEffort  + s.doneEffort,
        unestimated: (p.unestimated || 0) + (s.unestimated || 0),
        predictabilityPct: overallEffTotal > 0
          ? Math.round(overallEffDone / overallEffTotal * 100) : null
      },
      byTeam: byTeamFlat, features: featureRows,
      defects: defectRows, defectSummary
    });
  } catch (e) {
    console.error('[predictability]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
