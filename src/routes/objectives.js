'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { parsePILabels, getDefaultPIs, buildIterationClauses } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ─── GET /api/objectives ──────────────────────────────────────────────────────
// Query params:
//   pis[]    — e.g. ?pis[]=26-PI1 (default: completed PIs of current year)
//   teamPath — optional AreaPath filter
router.get('/objectives', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = parsePILabels(req.query);
    if (!piLabels || !piLabels.length) piLabels = getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern);

    const teamPath = req.query.teamPath || null;
    const businessValueField = fm.fields.businessValueField;

    const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
    // Include objectives at the PI iteration level OR at the area root (no iteration set)
    const iterPart = iterClause
      ? ` AND (${iterClause} OR [System.IterationPath] = '${cfg.tfs.iterationPath}')`
      : '';
    const teamPart = teamPath ? ` AND [System.AreaPath] UNDER '${teamPath}'` : '';

    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = '${fm.workItemTypes.objective}'
        AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
        ${iterPart}${teamPart}
      ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC`
    };

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const result  = await tfsPost(wiqlUrl, wiql, cfg.tfs.pat);
    const ids     = (result.workItems || []).map(w => w.id);

    const fields = [
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo',
      businessValueField,
      fm.fields.stateChangeDateField,
      'System.CreatedDate',
      'Microsoft.VSTS.Common.StackRank',
      'Microsoft.VSTS.Common.Priority',
    ];

    const items   = await fetchWorkItemDetails(ids, fields, cfg);
    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;

    const objectives = items.map(item => ({
      id:            item.id,
      title:         item.fields['System.Title'],
      state:         item.fields['System.State'],
      team:          extractTeam(item.fields['System.AreaPath'] || '', teamRoot),
      iter:          item.fields['System.IterationPath'],
      assignedTo:    item.fields['System.AssignedTo']
        ? (item.fields['System.AssignedTo'].displayName || item.fields['System.AssignedTo'])
        : null,
      businessValue: item.fields[businessValueField] ?? null,
      stackRank:     item.fields['Microsoft.VSTS.Common.StackRank'] ?? null,
      priority:      item.fields['Microsoft.VSTS.Common.Priority'] ?? null,
    }));

    const total    = objectives.length;
    const done     = objectives.filter(o => o.state === 'Done').length;
    const approved = objectives.filter(o => o.state === 'Approved').length;
    const removed  = objectives.filter(o => o.state === 'Removed').length;
    const active   = total - removed;
    const attainmentPct = active > 0 ? Math.round((done / active) * 100) : 0;

    const bvPlanned = objectives
      .filter(o => o.state !== 'Removed')
      .reduce((s, o) => s + (o.businessValue || 0), 0);
    const bvDelivered = objectives
      .filter(o => o.state === 'Done')
      .reduce((s, o) => s + (o.businessValue || 0), 0);
    const bvAttainmentPct = bvPlanned > 0 ? Math.round((bvDelivered / bvPlanned) * 100) : 0;

    const byTeam = {};
    for (const obj of objectives) {
      const t = obj.team;
      if (!byTeam[t]) byTeam[t] = { total: 0, done: 0, removed: 0, bvPlanned: 0, bvDelivered: 0, attainmentPct: 0 };
      byTeam[t].total++;
      if (obj.state === 'Done')    byTeam[t].done++;
      if (obj.state === 'Removed') byTeam[t].removed++;
      if (obj.state !== 'Removed') byTeam[t].bvPlanned   += (obj.businessValue || 0);
      if (obj.state === 'Done')    byTeam[t].bvDelivered += (obj.businessValue || 0);
    }
    for (const team of Object.keys(byTeam)) {
      const t = byTeam[team];
      const teamActive = t.total - t.removed;
      t.attainmentPct = teamActive > 0 ? Math.round((t.done / teamActive) * 100) : 0;
      delete t.removed;
    }

    res.json({
      meta: { fetchedAt: new Date().toISOString(), pis: piLabels, total },
      objectives,
      total,
      done,
      approved,
      removed,
      active,
      attainmentPct,
      bvPlanned,
      bvDelivered,
      bvAttainmentPct,
      byTeam
    });
  } catch (e) {
    console.error('[objectives]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


