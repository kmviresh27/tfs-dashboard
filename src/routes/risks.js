'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { parsePILabels, buildIterationClauses } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

const UNROAMED_STATES = new Set(['Open', 'Identified']);
const ACTIVE_STATES   = new Set(['Open', 'Identified', 'Owned', 'Accepted']);

const PRIO_ORDER = { 'P1-Critical': 0, 'P2-High': 1, 'P3-Medium': 2, 'P4-Low': 3, Unknown: 4 };

function priorityLabel(p) {
  const labels = { 1: 'P1-Critical', 2: 'P2-High', 3: 'P3-Medium', 4: 'P4-Low' };
  return labels[p] || 'Unknown';
}

function extractRMMGroups(tags) {
  if (!tags) return ['Untagged'];
  const groups = tags
    .split(/;\s*/)
    .map(t => t.trim())
    .filter(t => /RMM$/i.test(t));
  return groups.length ? groups : ['Untagged'];
}

router.get('/risks', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const piLabels = parsePILabels(req.query);
    const teamPath = req.query.teamPath || null;

    const iterClause = piLabels && piLabels.length
      ? buildIterationClauses(cfg.tfs.iterationPath, piLabels)
      : '';
    const iterPart = iterClause ? ` AND ${iterClause}` : '';
    const teamPart = teamPath   ? ` AND [System.AreaPath] UNDER '${teamPath}'` : '';

    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] IN ('${fm.workItemTypes.risk}', '${fm.workItemTypes.productRisk}')
        AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
        ${iterPart}${teamPart}
      ORDER BY [System.Id]`
    };

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const result  = await tfsPost(wiqlUrl, wiql, cfg.tfs.pat);
    const ids     = (result.workItems || []).map(w => w.id);

    if (!ids.length) {
      return res.json({
        meta: { fetchedAt: new Date().toISOString(), pis: piLabels || [], total: 0 },
        total: 0, unroamedCount: 0, activeCount: 0,
        byState: {}, byROAM: {}, byPriority: {}, byType: {}, byTeam: {}, byRMM: {},
        byCategory: { Release: { total:0,unroamed:0,open:0,owned:0,accepted:0,mitigated:0,resolved:0,byState:{},byPriority:{},byTeam:{} }, Team: { total:0,unroamed:0,open:0,owned:0,accepted:0,mitigated:0,resolved:0,byState:{},byPriority:{},byTeam:{} }, Unknown: { total:0,unroamed:0,open:0,owned:0,accepted:0,mitigated:0,resolved:0,byState:{},byPriority:{},byTeam:{} } },
        items: [], openItems: []
      });
    }

    const items = await fetchWorkItemDetails(ids, [
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', 'System.CreatedDate',
      'System.ChangedDate', 'System.Tags', 'System.WorkItemType',
      fm.fields.priorityField, fm.fields.hcTypeField,
    ], cfg);

    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const byState    = {};
    const byType     = {};
    const byPriority = {};
    const byTeam     = {};
    const byRMM      = {};
    const riskItems  = [];
    const openItems  = [];

    // Per-category (Release / Team) aggregations for Risk work items
    const makeCatBucket = () => ({ total: 0, unroamed: 0, open: 0, owned: 0, accepted: 0, mitigated: 0, resolved: 0, byState: {}, byPriority: {}, byTeam: {} });
    const byCategory = { Release: makeCatBucket(), Team: makeCatBucket(), Unknown: makeCatBucket() };

    for (const item of items) {
      const f        = item.fields;
      const st       = f['System.State']        || 'Unknown';
      const type     = f['System.WorkItemType'] || fm.workItemTypes.risk;
      const prioKey  = priorityLabel(f[fm.fields.priorityField]);
      const team     = extractTeam(f['System.AreaPath'] || '', teamRoot);
      const iter     = f['System.IterationPath'] || '';
      const hcType   = (f[fm.fields.hcTypeField] || '').trim();

      byState[st]         = (byState[st]         || 0) + 1;
      byType[type]        = (byType[type]        || 0) + 1;
      byPriority[prioKey] = (byPriority[prioKey] || 0) + 1;

      if (!byTeam[team]) byTeam[team] = { open: 0, owned: 0, accepted: 0, mitigated: 0, resolved: 0, total: 0 };
      byTeam[team].total++;
      if      (UNROAMED_STATES.has(st)) byTeam[team].open++;
      else if (st === 'Owned')          byTeam[team].owned++;
      else if (st === 'Accepted')       byTeam[team].accepted++;
      else if (st === 'Mitigated')      byTeam[team].mitigated++;
      else if (st === 'Resolved')       byTeam[team].resolved++;

      // Per-category aggregation (Risk items only)
      if (type === fm.workItemTypes.risk) {
        const cat = (hcType === 'Release' || hcType === 'Team') ? hcType : 'Unknown';
        const cb = byCategory[cat];
        cb.total++;
        cb.byState[st]         = (cb.byState[st]         || 0) + 1;
        cb.byPriority[prioKey] = (cb.byPriority[prioKey] || 0) + 1;
        if (!cb.byTeam[team]) cb.byTeam[team] = { open: 0, owned: 0, accepted: 0, mitigated: 0, resolved: 0, total: 0 };
        cb.byTeam[team].total++;
        if      (UNROAMED_STATES.has(st)) { cb.open++; cb.unroamed++; cb.byTeam[team].open++; }
        else if (st === 'Owned')          { cb.owned++;     cb.byTeam[team].owned++;     }
        else if (st === 'Accepted')       { cb.accepted++;  cb.byTeam[team].accepted++;  }
        else if (st === 'Mitigated')      { cb.mitigated++; cb.byTeam[team].mitigated++; }
        else if (st === 'Resolved')       { cb.resolved++;  cb.byTeam[team].resolved++;  }
      }

      // Product Risk: extract RMM team tag
      let rmmTeam = null;
      if (type === fm.workItemTypes.productRisk) {
        const rmmGroups = extractRMMGroups(f['System.Tags']);
        rmmTeam = rmmGroups[0] !== 'Untagged' ? rmmGroups[0] : null;
        for (const grp of rmmGroups) {
          if (!byRMM[grp]) byRMM[grp] = { total: 0, open: 0, owned: 0, accepted: 0, mitigated: 0, resolved: 0 };
          byRMM[grp].total++;
          if      (UNROAMED_STATES.has(st)) byRMM[grp].open++;
          else if (st === 'Owned')          byRMM[grp].owned++;
          else if (st === 'Accepted')       byRMM[grp].accepted++;
          else if (st === 'Mitigated')      byRMM[grp].mitigated++;
          else if (st === 'Resolved')       byRMM[grp].resolved++;
        }
      }

      const assignee = typeof f['System.AssignedTo'] === 'object'
        ? (f['System.AssignedTo']?.displayName || '')
        : (f['System.AssignedTo'] || '');
      const riskItem = {
        id:          item.id,
        title:       f['System.Title'],
        state:       st,
        type,
        category:    type === fm.workItemTypes.risk ? ((hcType === 'Release' || hcType === 'Team') ? hcType : 'Unknown') : null,
        rmmTeam,
        team,
        priority:    prioKey,
        iter:        iter.split('\\').pop(),
        assignedTo:  assignee,
        created:     f['System.CreatedDate'],
        changed:     f['System.ChangedDate'],
        createdDate: f['System.CreatedDate'],
        changedDate: f['System.ChangedDate'],
        tags:        f['System.Tags'] || ''
      };
      riskItems.push(riskItem);

      if (UNROAMED_STATES.has(st)) {
        openItems.push(riskItem);
      }
    }

    openItems.sort((a, b) => {
      const pd = (PRIO_ORDER[a.priority] ?? 4) - (PRIO_ORDER[b.priority] ?? 4);
      return pd !== 0 ? pd : new Date(a.createdDate) - new Date(b.createdDate);
    });

    const byROAM = {
      R: byState['Resolved']   || 0,
      O: byState['Owned']      || 0,
      A: byState['Accepted']   || 0,
      M: byState['Mitigated']  || 0,
      unroamed: (byState['Open'] || 0) + (byState['Identified'] || 0)
    };

    const unroamedCount = byROAM.unroamed;
    const activeCount   = Object.entries(byState)
      .filter(([s]) => ACTIVE_STATES.has(s))
      .reduce((sum, [, n]) => sum + n, 0);

    res.json({
      meta: { fetchedAt: new Date().toISOString(), pis: piLabels || [], total: items.length },
      total: items.length,
      unroamedCount,
      activeCount,
      byState,
      byROAM,
      byPriority,
      byType,
      byTeam,
      byRMM,
      byCategory,
      items: riskItems,
      openItems: openItems.slice(0, 50)
    });
  } catch (e) {
    console.error('[risks]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
