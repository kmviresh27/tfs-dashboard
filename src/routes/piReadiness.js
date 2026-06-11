'use strict';

const express = require('express');
const { loadConfig }            = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { parsePILabels, buildIterationClauses } = require('../helpers/piHelpers');
const { extractTeam }           = require('../helpers/dataProcessors');
const { getFieldMappings }      = require('../helpers/fieldMappings');

const router = express.Router();

const FEATURE_FIELDS = [
  'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
  'System.IterationPath', 'System.AssignedTo',
  'Microsoft.VSTS.Scheduling.StoryPoints',
  'Microsoft.VSTS.Scheduling.Effort',
];

// ── Readiness checks (each returns { pass: id[], fail: id[] }) ────────────────
// We run these checks at the programme level and bucket by team client-side
// to avoid N×7 TFS round trips.

async function runChecks(cfg, piLabels, fm, teamPath) {
  const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const area    = teamPath || cfg.tfs.areaPath;
  const iterBase = cfg.tfs.iterationPath;
  const sizeField = fm.sizeField || 'Microsoft.VSTS.Scheduling.StoryPoints';

  const iterClause = piLabels?.length
    ? `AND ${buildIterationClauses(iterBase, piLabels)}` : '';

  // 1. All planned features in the PI
  const allFeatQuery = {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Feature'
        AND [System.AreaPath] UNDER '${area}'
        AND [System.State] NOT IN ('Removed')
        ${iterClause}
      ORDER BY [System.Id]`,
  };

  // 2. Features WITHOUT effort/story-points (fail only if BOTH fields are empty/zero)
  // Exclude Forecasted — those features are not yet planned
  const effortField = 'Microsoft.VSTS.Scheduling.Effort';
  const noEstimateQuery = {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Feature'
        AND [System.AreaPath] UNDER '${area}'
        AND [System.State] NOT IN ('Removed', 'Forecasted')
        ${iterClause}
        AND ([${sizeField}] = '' OR [${sizeField}] = 0)
        AND ([${effortField}] = '' OR [${effortField}] = 0)
      ORDER BY [System.Id]`,
  };

  // 3. Features still in Forecasted state
  const forecastedQuery = {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Feature'
        AND [System.AreaPath] UNDER '${area}'
        AND [System.State] = 'Forecasted'
        ${iterClause}
      ORDER BY [System.Id]`,
  };

  // 4. Features not assigned to any sprint — exclude Forecasted
  const noSprintQuery = {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Feature'
        AND [System.AreaPath] UNDER '${area}'
        AND [System.State] NOT IN ('Removed', 'Forecasted')
        ${iterClause}
        AND [System.IterationPath] NOT UNDER '${iterBase}'
      ORDER BY [System.Id]`,
  };

  // 5. Features unassigned (no AssignedTo) — exclude Forecasted
  const unassignedQuery = {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Feature'
        AND [System.AreaPath] UNDER '${area}'
        AND [System.State] NOT IN ('Removed', 'Forecasted')
        ${iterClause}
        AND [System.AssignedTo] = ''
      ORDER BY [System.Id]`,
  };

  // 6. Features that have child Stories WITH no estimates — via WorkItemLinks
  // Fail only if BOTH StoryPoints AND Effort are empty/zero; exclude Forecasted features
  const storiesNoEstimateQuery = {
    query: `SELECT [System.Id] FROM WorkItemLinks
      WHERE [Source].[System.WorkItemType] = 'Feature'
        AND [Source].[System.AreaPath] UNDER '${area}'
        AND [Source].[System.State] NOT IN ('Removed', 'Forecasted')
        ${iterClause ? iterClause.replace(/^AND /, 'AND [Source].') : ''}
        AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward'
        AND [Target].[System.WorkItemType] = 'Story'
        AND ([Target].[${sizeField}] = '' OR [Target].[${sizeField}] = 0)
        AND ([Target].[${effortField}] = '' OR [Target].[${effortField}] = 0)
      ORDER BY [System.Id] MODE (MustContain)`,
  };

  // 7. Features that have NO child stories — exclude Forecasted
  const featWithStoriesQuery = {
    query: `SELECT [System.Id] FROM WorkItemLinks
      WHERE [Source].[System.WorkItemType] = 'Feature'
        AND [Source].[System.AreaPath] UNDER '${area}'
        AND [Source].[System.State] NOT IN ('Removed', 'Forecasted')
        ${iterClause ? iterClause.replace(/^AND /, 'AND [Source].') : ''}
        AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward'
        AND [Target].[System.WorkItemType] = 'Story'
      ORDER BY [System.Id] MODE (MustContain)`,
  };

  const [allRes, noEstRes, forecastRes, noSprintRes, unassignedRes, storiesNoEstRes, featWithStoriesRes]
    = await Promise.allSettled([
      tfsPost(wiqlUrl, allFeatQuery,        cfg.tfs.pat),
      tfsPost(wiqlUrl, noEstimateQuery,     cfg.tfs.pat),
      tfsPost(wiqlUrl, forecastedQuery,     cfg.tfs.pat),
      tfsPost(wiqlUrl, noSprintQuery,       cfg.tfs.pat),
      tfsPost(wiqlUrl, unassignedQuery,     cfg.tfs.pat),
      tfsPost(wiqlUrl, storiesNoEstimateQuery, cfg.tfs.pat),
      tfsPost(wiqlUrl, featWithStoriesQuery,   cfg.tfs.pat),
    ]);

  const ids = r => r.status === 'fulfilled'
    ? (r.value.workItems || []).map(w => w.id)
    : [];
  const relSourceIds = r => r.status === 'fulfilled'
    ? [...new Set((r.value.workItemRelations || []).filter(x => x.source?.id).map(x => x.source.id))]
    : [];

  const allIds            = ids(allRes);
  const noEstimateIds     = ids(noEstRes);
  const forecastedIds     = ids(forecastRes);
  const noSprintIds       = ids(noSprintRes);
  const unassignedIds     = ids(unassignedRes);
  const storyNoEstSrcIds  = relSourceIds(storiesNoEstRes);   // feature IDs with unsized stories
  const withStoryIds      = new Set(relSourceIds(featWithStoriesRes));
  const noStoryIds        = allIds.filter(id => !withStoryIds.has(id));

  return {
    allIds,
    checks: [
      { id: 'estimate',       label: 'Features have effort/estimate', failIds: noEstimateIds,  weight: 2 },
      { id: 'stories',        label: 'Features have child stories',   failIds: noStoryIds,     weight: 2 },
      { id: 'not-forecasted', label: 'Features not Forecasted',       failIds: forecastedIds,  weight: 1 },
      { id: 'sprint',         label: 'Features assigned to sprint',   failIds: noSprintIds,    weight: 1 },
      { id: 'assigned',       label: 'Features have owner assigned',  failIds: unassignedIds,  weight: 1 },
      { id: 'story-estimate', label: 'Stories have estimates',        failIds: storyNoEstSrcIds, weight: 1 },
    ],
  };
}

// ── GET /api/pi-readiness ─────────────────────────────────────────────────────
router.get('/pi-readiness', async (req, res) => {
  try {
    const cfg    = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const piLabels  = parsePILabels(req.query);
    const teamPath  = req.query.teamPath || '';
    const fm        = getFieldMappings(cfg);

    const { allIds, checks } = await runChecks(cfg, piLabels, fm, teamPath);
    if (!allIds.length) return res.json({ teams: [], checks: checks.map(c => c.label), fetchedAt: new Date().toISOString() });

    // Fetch full details for all features to get area path → team
    const details = await fetchWorkItemDetails(allIds.slice(0, 500), FEATURE_FIELDS, cfg);
    const teamRootPath = cfg.tfs.teamRootPath;

    // Build per-feature info + group by team (filtered by teamPath when provided)
    const byTeam = {};
    const featById = {};
    details.forEach(i => {
      const area = i.fields['System.AreaPath'] || '';
      const team = extractTeam(area, teamRootPath);
      if (!byTeam[team]) byTeam[team] = { team, totalFeatures: 0, checkFails: {}, failItems: {} };
      byTeam[team].totalFeatures++;
      featById[i.id] = {
        id: i.id, title: i.fields['System.Title'], state: i.fields['System.State'],
        team, area: i.fields['System.AreaPath'], iter: i.fields['System.IterationPath'],
        assignedTo: i.fields['System.AssignedTo']?.displayName || i.fields['System.AssignedTo'] || null,
      };
    });

    // Populate failures per team per check
    const failIdSet = new Set(allIds);  // only score against features we fetched
    checks.forEach(chk => {
      const failSet = new Set(chk.failIds);
      Object.values(byTeam).forEach(tEntry => {
        tEntry.checkFails[chk.id]  = 0;
        tEntry.failItems[chk.id]   = [];
      });
      chk.failIds.forEach(fid => {
        const feat = featById[fid];
        if (!feat) return;
        byTeam[feat.team].checkFails[chk.id]++;
        byTeam[feat.team].failItems[chk.id].push({ id: fid, title: feat.title, state: feat.state, assignedTo: feat.assignedTo });
      });
    });

    // Compute per-team score: weighted sum of pass rates
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const teams = Object.values(byTeam).map(t => {
      let weightedScore = 0;
      const criteria = checks.map(chk => {
        const fail = t.checkFails[chk.id] || 0;
        const pass = Math.max(0, t.totalFeatures - fail);
        const pct  = t.totalFeatures > 0 ? Math.round((pass / t.totalFeatures) * 100) : 100;
        weightedScore += (pct / 100) * chk.weight;
        return { id: chk.id, label: chk.label, pass, fail, pct, failItems: (t.failItems[chk.id] || []).slice(0, 30) };
      });
      const score = Math.round((weightedScore / totalWeight) * 100);
      return { team: t.team, score, totalFeatures: t.totalFeatures, criteria };
    }).sort((a, b) => a.score - b.score);

    // Programme-level aggregate
    const totalFeatures = teams.reduce((s, t) => s + t.totalFeatures, 0);
    const programmeScore = totalFeatures > 0
      ? Math.round(teams.reduce((s, t) => s + t.score * t.totalFeatures, 0) / totalFeatures)
      : 0;

    res.json({
      programmeScore,
      totalFeatures,
      teams,
      checkLabels: checks.map(c => ({ id: c.id, label: c.label, weight: c.weight })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[pi-readiness]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
