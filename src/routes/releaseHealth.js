'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

const FEAT_STATE_ORDER  = ['Done', 'Approved', 'Activated', 'Forecasted', 'New'];
const STORY_STATE_ORDER = ['Done', 'Closed', 'Resolved', 'Active', 'In Progress', 'New'];

function groupByState(items, sizeField, storyPointsField) {
  const byState    = {};
  const ptsByState = {};
  let total = 0, totalPts = 0;
  for (const item of items) {
    const state = item.fields['System.State'] || 'Unknown';
    const pts   = item.fields[sizeField]
      || item.fields[storyPointsField]
      || item.fields['Microsoft.VSTS.Scheduling.Effort']
      || item.fields['Microsoft.VSTS.Scheduling.StoryPoints']
      || 0;
    byState[state]    = (byState[state]    || 0) + 1;
    ptsByState[state] = (ptsByState[state] || 0) + pts;
    total++;
    totalPts += pts;
  }
  return { total, totalPts: Math.round(totalPts * 10) / 10, byState, ptsByState };
}

router.get('/release-health', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const REL_FIELD  = fm.fields.releaseField;
    const teamPath   = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const pi         = (req.query.pi || '').trim();
    const areaBase   = cfg.tfs.areaPath;
    const iterBase   = cfg.tfs.iterationPath;
    const sizeField  = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    const filterPath = teamPath || areaBase;
    const iterClause = pi ? `AND [System.IterationPath] UNDER '${iterBase}\\${pi}'` : '';
    const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const warnings = [];
    let shouldNoStore = false;

    const [featWIQLSettled, storyWIQLSettled] = await Promise.allSettled([
      tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}' AND [System.State] <> '${fm.stateValues.featureRemoved}' AND [System.AreaPath] UNDER '${filterPath}' ${iterClause} AND [${REL_FIELD}] <> '' ORDER BY [${REL_FIELD}], [System.Id]`,
      }, cfg.tfs.pat),
      tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${fm.workItemTypes.story}' AND [System.State] <> '${fm.stateValues.storyRemoved}' AND [System.AreaPath] UNDER '${filterPath}' ${iterClause} AND [${REL_FIELD}] <> '' ORDER BY [${REL_FIELD}], [System.Id]`,
      }, cfg.tfs.pat),
    ]);
    const featWIQL = featWIQLSettled.status === 'fulfilled' ? featWIQLSettled.value : { workItems: [] };
    const storyWIQL = storyWIQLSettled.status === 'fulfilled' ? storyWIQLSettled.value : { workItems: [] };
    if (featWIQLSettled.status !== 'fulfilled') {
      const message = `[release-health] features fetch failed: ${featWIQLSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (storyWIQLSettled.status !== 'fulfilled') {
      const message = `[release-health] stories fetch failed: ${storyWIQLSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (featWIQLSettled.status !== 'fulfilled' && storyWIQLSettled.status !== 'fulfilled') shouldNoStore = true;

    const featIds  = (featWIQL.workItems  || []).map(w => w.id);
    const storyIds = (storyWIQL.workItems || []).map(w => w.id);

    const commonFields = ['System.Id', 'System.Title', 'System.State', 'System.AreaPath', REL_FIELD];

    const [featItemsSettled, storyItemsSettled] = await Promise.allSettled([
      featIds.length  ? fetchWorkItemDetails(featIds,  [...commonFields], cfg) : Promise.resolve([]),
      storyIds.length ? fetchWorkItemDetails(storyIds, [...new Set([...commonFields, sizeField, storyPointsField])], cfg) : Promise.resolve([]),
    ]);
    const featItems = featItemsSettled.status === 'fulfilled' ? featItemsSettled.value : [];
    const storyItems = storyItemsSettled.status === 'fulfilled' ? storyItemsSettled.value : [];
    if (featItemsSettled.status !== 'fulfilled') {
      const message = `[release-health] feature details fetch failed: ${featItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (storyItemsSettled.status !== 'fulfilled') {
      const message = `[release-health] story details fetch failed: ${storyItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (featItemsSettled.status !== 'fulfilled' && storyItemsSettled.status !== 'fulfilled') shouldNoStore = true;

    const releaseMap = new Map();

    for (const item of featItems) {
      const rel = (item.fields[REL_FIELD] || '').trim();
      if (!rel) continue;
      if (!releaseMap.has(rel)) releaseMap.set(rel, { features: [], stories: [] });
      releaseMap.get(rel).features.push(item);
    }

    for (const item of storyItems) {
      const rel = (item.fields[REL_FIELD] || '').trim();
      if (!rel) continue;
      if (!releaseMap.has(rel)) releaseMap.set(rel, { features: [], stories: [] });
      releaseMap.get(rel).stories.push(item);
    }

    const releases = [...releaseMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map(([name, { features, stories }]) => ({
        name,
        features: groupByState(features, sizeField, storyPointsField),
        stories:  groupByState(stories,  sizeField, storyPointsField),
      }));

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({
      pi: pi || null,
      releases,
      featStateOrder:  FEAT_STATE_ORDER,
      storyStateOrder: STORY_STATE_ORDER,
      totalFeatures: featIds.length,
      totalStories:  storyIds.length,
      featureType:   fm.workItemTypes.feature,
      storyType:     fm.workItemTypes.story,
      fetchedAt:     new Date().toISOString(),
      ...(warnings.length ? { _warnings: warnings } : {}),
    });
  } catch (e) {
    console.error('[release-health]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
