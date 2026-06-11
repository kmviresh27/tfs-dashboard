'use strict';

const express = require('express');
const { loadConfig }            = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { parsePILabels, buildIterationClauses } = require('../helpers/piHelpers');
const { extractTeam }           = require('../helpers/dataProcessors');

const router = express.Router();

const BLOCKED_FIELDS = [
  'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
  'System.IterationPath', 'System.AssignedTo', 'System.ChangedDate',
  'System.Tags', 'System.WorkItemType', 'System.CreatedDate',
];

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── GET /api/blockers ─────────────────────────────────────────────────────────
router.get('/blockers', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const piLabels = parsePILabels(req.query);
    const teamPath = req.query.teamPath || null;

    const iterClause = piLabels?.length
      ? buildIterationClauses(cfg.tfs.iterationPath, piLabels)
      : '';
    const iterPart   = iterClause ? ` AND ${iterClause}` : '';
    const teamPart   = teamPath   ? ` AND [System.AreaPath] UNDER '${teamPath}'` : '';
    const areaPart   = ` AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'`;

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;

    // Items explicitly tagged as blocked
    const tagQuery = {
      query: `SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] IN ('Feature','Story','Bug')
          AND [System.Tags] CONTAINS 'blocked'
          ${areaPart}${iterPart}${teamPart}
          AND [System.State] NOT IN ('Done','Removed','Closed','Resolved')
        ORDER BY [System.ChangedDate] ASC`,
    };

    // Items that are targets of Dependency-Forward links (blocked by)
    const depQuery = {
      query: `SELECT [System.Id] FROM WorkItemLinks
        WHERE [Source].[System.WorkItemType] IN ('Feature','Story','Bug')
          AND [Source].[System.AreaPath] UNDER '${cfg.tfs.areaPath}'
          AND [System.Links.LinkType] = 'System.LinkTypes.Dependency-Forward'
          AND [Source].[System.State] NOT IN ('Done','Removed','Closed','Resolved')
          ${iterPart ? `AND [Source].[System.IterationPath] ${iterPart.replace(/^.*UNDER/, 'UNDER')}` : ''}
        ORDER BY [System.Id] MODE (MustContain)`,
    };

    const [tagRes, depRes] = await Promise.allSettled([
      tfsPost(wiqlUrl, tagQuery, cfg.tfs.pat),
      tfsPost(wiqlUrl, depQuery, cfg.tfs.pat),
    ]);

    const tagIds = tagRes.status === 'fulfilled'
      ? (tagRes.value.workItems || []).map(w => w.id) : [];

    // For dep query: source IDs (the blocked items), plus build blockedBy map
    const blockedByMap = {};
    if (depRes.status === 'fulfilled') {
      (depRes.value.workItemRelations || []).forEach(rel => {
        if (rel.source?.id && rel.target?.id) {
          const srcId = rel.source.id;
          if (!blockedByMap[srcId]) blockedByMap[srcId] = [];
          blockedByMap[srcId].push(rel.target.id);
        }
      });
    }
    const depIds = Object.keys(blockedByMap).map(Number);

    // Merge + deduplicate
    const allIds = [...new Set([...tagIds, ...depIds])];
    if (!allIds.length) return res.json({ items: [], fetchedAt: new Date().toISOString() });

    const details = await fetchWorkItemDetails(allIds.slice(0, 200), BLOCKED_FIELDS, cfg);

    const items = details.map(i => {
      const flds      = i.fields;
      const wid       = i.id;
      const changed   = flds['System.ChangedDate'];
      const created   = flds['System.CreatedDate'];
      const tags      = (flds['System.Tags'] || '').split(/;\s*/).map(t => t.trim()).filter(Boolean);
      return {
        id:          wid,
        title:       flds['System.Title'],
        type:        flds['System.WorkItemType'],
        state:       flds['System.State'],
        team:        extractTeam(flds['System.AreaPath'], cfg.tfs.teamRootPath),
        areaPath:    flds['System.AreaPath'],
        iterPath:    flds['System.IterationPath'],
        assignedTo:  flds['System.AssignedTo']
          ? (flds['System.AssignedTo'].displayName || flds['System.AssignedTo']) : null,
        tags,
        daysSinceChanged: daysSince(changed),
        daysSinceCreated: daysSince(created),
        source: tagIds.includes(wid) ? 'tag' : 'link',
        blockedByIds: blockedByMap[wid] || [],
      };
    });

    // Sort by age desc
    items.sort((a, b) => (b.daysSinceChanged || 0) - (a.daysSinceChanged || 0));

    res.json({ items, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('[blockers]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
