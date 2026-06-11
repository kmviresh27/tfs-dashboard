'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet, tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// GET /api/progress?pi=26-PI1&teamPath=...&granularity=day|week|month
router.get('/progress', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const pi          = (req.query.pi || '').trim();
    const teamPath    = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const granularity = ['day', 'week', 'month'].includes(req.query.granularity) ? req.query.granularity : 'week';
    const iterBase    = cfg.tfs.iterationPath;
    const areaBase    = cfg.tfs.areaPath;
    const sizeField   = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    const featureDoneStates = new Set([fm.stateValues.featureDone].filter(Boolean));
    const storyDoneStates = new Set(fm.stateValues.storyDone);

    if (!pi) return res.status(400).json({ error: 'pi param required' });

    const teamPathNorm = teamPath ? teamPath.replace(/\//g, '\\').toLowerCase() : null;
    const matchesTeam  = areaPath => {
      if (!teamPathNorm) return true;
      const norm = (areaPath || '').replace(/\//g, '\\').toLowerCase();
      return norm === teamPathNorm || norm.startsWith(teamPathNorm + '\\');
    };

    const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const areaClause = `[System.AreaPath] UNDER '${areaBase}'`;
    const iterClause = `[System.IterationPath] UNDER '${iterBase}\\${pi}'`;
    const warnings = [];
    let shouldNoStore = false;

    const [featResultSettled, storyResultSettled] = await Promise.allSettled([
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${fm.workItemTypes.feature}' AND ${areaClause} AND ${iterClause} ORDER BY [System.CreatedDate]` }, cfg.tfs.pat),
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${fm.workItemTypes.story}' AND ${areaClause} AND ${iterClause} ORDER BY [System.CreatedDate]` }, cfg.tfs.pat),
    ]);
    const featResult = featResultSettled.status === 'fulfilled' ? featResultSettled.value : { workItems: [] };
    const storyResult = storyResultSettled.status === 'fulfilled' ? storyResultSettled.value : { workItems: [] };
    if (featResultSettled.status !== 'fulfilled') {
      const message = `[progress] features fetch failed: ${featResultSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (storyResultSettled.status !== 'fulfilled') {
      const message = `[progress] stories fetch failed: ${storyResultSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (featResultSettled.status !== 'fulfilled' && storyResultSettled.status !== 'fulfilled') shouldNoStore = true;

    // Fetch PI iteration node for actual start/end dates
    let piStartDate = null, piEndDate = null;
    try {
      const iterParts = iterBase.split('\\');
      const subParts  = iterParts.length > 1 ? iterParts.slice(1) : iterParts;
      const pathSegs  = [...subParts, pi].map(encodeURIComponent).join('/');
      const piNodeUrl = `${cfg.tfs.baseUrl}/_apis/wit/classificationNodes/Iterations/${pathSegs}?$depth=0&api-version=${cfg.tfs.apiVersion}`;
      const piNode    = await tfsGet(piNodeUrl, cfg.tfs.pat);
      if (piNode.attributes) {
        if (piNode.attributes.startDate)  piStartDate = new Date(piNode.attributes.startDate);
        if (piNode.attributes.finishDate) piEndDate   = new Date(piNode.attributes.finishDate);
      }
    } catch (_) { /* use fallback range */ }

    const fields = [...new Set([
      'System.Id', 'System.State', 'System.AreaPath', 'System.CreatedDate',
      fm.fields.stateChangeDateField, sizeField, storyPointsField
    ])];
    const featIds  = (featResult.workItems  || []).map(w => w.id);
    const storyIds = (storyResult.workItems || []).map(w => w.id);

    const [featItemsSettled, storyItemsSettled] = await Promise.allSettled([
      featIds.length  ? fetchWorkItemDetails(featIds,  fields, cfg) : Promise.resolve([]),
      storyIds.length ? fetchWorkItemDetails(storyIds, fields, cfg) : Promise.resolve([]),
    ]);
    const featItems = featItemsSettled.status === 'fulfilled' ? featItemsSettled.value : [];
    const storyItems = storyItemsSettled.status === 'fulfilled' ? storyItemsSettled.value : [];
    if (featItemsSettled.status !== 'fulfilled') {
      const message = `[progress] feature details fetch failed: ${featItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (storyItemsSettled.status !== 'fulfilled') {
      const message = `[progress] story details fetch failed: ${storyItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (featItemsSettled.status !== 'fulfilled' && storyItemsSettled.status !== 'fulfilled') shouldNoStore = true;

    const features = featItems.filter(i  => matchesTeam(i.fields['System.AreaPath'] || ''));
    const stories  = storyItems.filter(i => matchesTeam(i.fields['System.AreaPath'] || ''));

    function toBucketKey(date) {
      const d = new Date(date);
      if (granularity === 'day') {
        return d.toISOString().slice(0, 10);
      } else if (granularity === 'week') {
        const day  = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon  = new Date(d); mon.setDate(d.getDate() + diff); mon.setHours(0, 0, 0, 0);
        return mon.toISOString().slice(0, 10);
      }
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    function bucketEnd(key) {
      if (granularity === 'day') {
        const d = new Date(key); d.setHours(23, 59, 59, 999); return d;
      } else if (granularity === 'week') {
        const d = new Date(key); d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d;
      }
      const [y, m] = key.split('-').map(Number);
      return new Date(y, m, 0, 23, 59, 59, 999);
    }

    function nextBucket(key) {
      if (granularity === 'day') {
        const d = new Date(key); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10);
      } else if (granularity === 'week') {
        const d = new Date(key); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10);
      }
      const [y, m] = key.split('-').map(Number);
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }

    function buildBurnup(items, doneStates) {
      if (!items.length) return { dates: [], scope: [], done: [], scopePts: [], donePts: [] };

      // Use PI iteration dates when available — prevents chart starting from Jan for items
      // created long before the PI's sprint window
      const allCreateDates = items.map(i => new Date(i.fields['System.CreatedDate']));
      const rawStart = piStartDate || new Date(Math.min(...allCreateDates));
      const now      = new Date();
      const rawEnd   = piEndDate ? new Date(Math.min(piEndDate.getTime(), now.getTime())) : now;
      const startKey = toBucketKey(rawStart);
      const endKey   = toBucketKey(rawEnd);

      const buckets = [];
      let cur = startKey;
      while (cur <= endKey) { buckets.push(cur); cur = nextBucket(cur); }

      const scope    = [];
      const done     = [];
      const scopePts = [];
      const donePts  = [];

      for (const bucket of buckets) {
        const end = bucketEnd(bucket);
        let sc = 0, dn = 0, scPt = 0, dnPt = 0;
        for (const item of items) {
          const created = new Date(item.fields['System.CreatedDate']);
          const effort  = item.fields[sizeField] || item.fields[storyPointsField] || 0;
          const state   = item.fields['System.State'] || '';
          const changed = item.fields[fm.fields.stateChangeDateField]
            ? new Date(item.fields[fm.fields.stateChangeDateField])
            : null;
          if (created <= end) { sc++; scPt += effort; }
          if (doneStates.has(state) && changed && changed <= end) { dn++; dnPt += effort; }
        }
        scope.push(sc); done.push(dn);
        scopePts.push(Math.round(scPt * 10) / 10);
        donePts.push(Math.round(dnPt * 10) / 10);
      }

      return { dates: buckets, scope, done, scopePts, donePts };
    }

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({
      pi,
      granularity,
      piStartDate: piStartDate ? piStartDate.toISOString() : null,
      piEndDate:   piEndDate   ? piEndDate.toISOString()   : null,
      features: buildBurnup(features, featureDoneStates),
      stories:  buildBurnup(stories, storyDoneStates),
      meta: {
        featureCount: features.length,
        storyCount:   stories.length,
        team:         teamPath || 'all',
      },
      fetchedAt: new Date().toISOString(),
      ...(warnings.length ? { _warnings: warnings } : {}),
    });
  } catch (e) {
    console.error('[progress]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
