'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { parsePILabels, getDefaultPIs, buildIterationClauses } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

function extractSprint(iterPath) {
  const segs = (iterPath || '').replace(/\//g, '\\').split('\\').filter(Boolean);
  return segs.pop() || 'Unknown';
}

// ─── GET /api/story-metrics ───────────────────────────────────────────────────
// Query params:
//   pis[]    — e.g. ?pis[]=26-PI1 (default: completed PIs of current year)
//   teamPath — optional AreaPath filter
router.get('/story-metrics', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = parsePILabels(req.query);
    if (!piLabels || !piLabels.length) piLabels = getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern);

    const teamPath = req.query.teamPath || null;
    const storyPointsField = fm.fields.storyPointsField;
    const sizeField = fm.fields.effortField;
    const storyDoneStates = new Set(fm.stateValues.storyDone);

    const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
    const iterPart   = iterClause ? ` AND ${iterClause}` : '';
    const teamPart   = teamPath   ? ` AND [System.AreaPath] UNDER '${teamPath}'` : '';

    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = '${fm.workItemTypes.story}'
        AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
        ${iterPart}${teamPart}
      ORDER BY [System.Id]`
    };

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const result  = await tfsPost(wiqlUrl, wiql, cfg.tfs.pat);
    const ids     = (result.workItems || []).map(w => w.id);

    const fields = [...new Set([
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo',
      'System.CreatedDate', 'System.ChangedDate',
      fm.fields.closedDateField,
      storyPointsField, sizeField
    ])];

    const items    = await fetchWorkItemDetails(ids, fields, cfg);
    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const now      = new Date();

    const bySprintAcceptance = {};
    let totalDone = 0;

    for (const item of items) {
      const sprint = extractSprint(item.fields['System.IterationPath']);
      const state  = item.fields['System.State'] || '';
      if (!bySprintAcceptance[sprint]) bySprintAcceptance[sprint] = { total: 0, done: 0, rate: 0 };
      bySprintAcceptance[sprint].total++;
      if (storyDoneStates.has(state)) {
        bySprintAcceptance[sprint].done++;
        totalDone++;
      }
    }
    for (const sprint of Object.keys(bySprintAcceptance)) {
      const s = bySprintAcceptance[sprint];
      s.rate = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    }
    const total          = items.length;
    const acceptanceRate = total > 0 ? Math.round((totalDone / total) * 100) : 0;

    const allCycleDays   = [];
    const byTeamCycleRaw = {};

    for (const item of items) {
      const state = item.fields['System.State'] || '';
      if (!storyDoneStates.has(state)) continue;
      const created    = item.fields['System.CreatedDate'];
      const closedDate = item.fields[fm.fields.closedDateField];
      if (!created || !closedDate) continue;
      const days = Math.max(0, Math.floor((new Date(closedDate) - new Date(created)) / 86400000));
      const team = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
      allCycleDays.push(days);
      if (!byTeamCycleRaw[team]) byTeamCycleRaw[team] = [];
      byTeamCycleRaw[team].push(days);
    }

    const cycleTimeOverall = allCycleDays.length
      ? {
          avg:   Math.round(allCycleDays.reduce((s, d) => s + d, 0) / allCycleDays.length),
          min:   Math.min(...allCycleDays),
          max:   Math.max(...allCycleDays),
          count: allCycleDays.length
        }
      : { avg: null, min: null, max: null, count: 0 };

    const byTeamCycleTime = Object.fromEntries(
      Object.entries(byTeamCycleRaw).map(([team, vals]) => [team, {
        avg:   Math.round(vals.reduce((s, d) => s + d, 0) / vals.length),
        min:   Math.min(...vals),
        max:   Math.max(...vals),
        count: vals.length
      }])
    );

    const unestimatedItems = [];
    const agingItems       = [];

    for (const item of items) {
      const sp     = item.fields[storyPointsField] ?? item.fields[sizeField];
      const state  = item.fields['System.State'] || '';
      const team   = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
      const sprint = extractSprint(item.fields['System.IterationPath']);

      if (!sp) {
        unestimatedItems.push({ id: item.id, title: item.fields['System.Title'], team, sprint, state });
      }

      if (state === 'New' || state === 'Forecasted' || state === 'Approved') {
        const created = item.fields['System.CreatedDate'];
        if (created) {
          const days = Math.floor((now - new Date(created)) / 86400000);
          if (days > 30) {
            agingItems.push({ id: item.id, title: item.fields['System.Title'], team, sprint, days, state });
          }
        }
      }
    }
    agingItems.sort((a, b) => b.days - a.days);

    const ipSprintItems = [];
    const ipByTeam      = {};
    const lastSprintLabel = (fm.piStructure.sprintLabels[fm.piStructure.sprintLabels.length - 1] || 'IP').toLowerCase();

    for (const item of items) {
      const sprint = extractSprint(item.fields['System.IterationPath']);
      if (!sprint.toLowerCase().endsWith(lastSprintLabel)) continue;
      const state = item.fields['System.State'] || '';
      const team  = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
      ipSprintItems.push({ id: item.id, title: item.fields['System.Title'], state, type: fm.workItemTypes.story, team, sprint });
      if (!ipByTeam[team]) ipByTeam[team] = { total: 0, done: 0, doneRate: 0 };
      ipByTeam[team].total++;
      if (storyDoneStates.has(state)) ipByTeam[team].done++;
    }
    for (const team of Object.keys(ipByTeam)) {
      const t = ipByTeam[team];
      t.doneRate = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
    }
    const ipTotal    = ipSprintItems.length;
    const ipDone     = ipSprintItems.filter(i => storyDoneStates.has(i.state)).length;
    const ipDoneRate = ipTotal > 0 ? Math.round((ipDone / ipTotal) * 100) : 0;

    res.json({
      meta: { fetchedAt: new Date().toISOString(), pis: piLabels, total },
      total,
      done: totalDone,
      acceptanceRate,
      bySprintAcceptance,
      cycleTime: { ...cycleTimeOverall, byTeam: byTeamCycleTime },
      backlogHealth: {
        unestimated:      unestimatedItems.length,
        unestimatedItems: unestimatedItems.slice(0, 30),
        aging:            agingItems.length,
        agingItems:       agingItems.slice(0, 30)
      },
      ipSprint: {
        total:    ipTotal,
        done:     ipDone,
        doneRate: ipDoneRate,
        items:    ipSprintItems,
        byTeam:   ipByTeam
      }
    });
  } catch (e) {
    console.error('[story-metrics]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


