'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { processFeatures, processDefects } = require('../helpers/dataProcessors');
const { getFieldMappings } = require('../helpers/fieldMappings');
const { fetchSprintDates, isSprintFuture } = require('../helpers/sprintDates');
const { buildSprintIterPath } = require('../helpers/piHelpers');

const router = express.Router();

// ─── GET /api/sprint-trend ────────────────────────────────────────────────
// Query params: pi (single PI label, e.g. '26-PI1')
router.get('/sprint-trend', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const pi       = req.query.pi;
    const teamPath = req.query.teamPath || null;
    if (!pi) return res.status(400).json({ error: 'pi query param required' });

    const fm         = getFieldMappings(cfg);
    const suffixes   = fm.piStructure.sprintLabels;
    const filterPath = teamPath || cfg.tfs.areaPath;
    const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const teamRoot   = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const iterBase   = cfg.tfs.iterationPath;
    const minFields  = ['System.Id', 'System.State', 'System.AreaPath'];
    const warnings = [];
    let shouldNoStore = false;

    const [sprintWindowsSettled, resultsSettled] = await Promise.allSettled([
      fetchSprintDates(cfg, pi, suffixes),
      Promise.all(suffixes.map(async suffix => {
        const sprintPath  = buildSprintIterPath(iterBase, pi, suffix, fm.piStructure.sprintSubpathPattern);
        const iterClause  = `[System.IterationPath] UNDER '${sprintPath}'`;

        const featQuery = {
          query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
              AND [System.AreaPath] UNDER '${filterPath}'
              AND ${iterClause}
            ORDER BY [System.Id]`
        };
        const defQuery = {
          query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.WorkItemType] = '${fm.workItemTypes.defect}'
              AND [System.AreaPath] UNDER '${filterPath}'
              AND ${iterClause}
            ORDER BY [System.Id]`
        };

        const [featWIQLSettled, defWIQLSettled] = await Promise.allSettled([
          tfsPost(wiqlUrl, featQuery, cfg.tfs.pat),
          tfsPost(wiqlUrl, defQuery,  cfg.tfs.pat)
        ]);
        const featWIQL = featWIQLSettled.status === 'fulfilled' ? featWIQLSettled.value : { workItems: [] };
        const defWIQL = defWIQLSettled.status === 'fulfilled' ? defWIQLSettled.value : { workItems: [] };
        if (featWIQLSettled.status !== 'fulfilled') {
          const message = `[sprint-trend] ${suffix} features fetch failed: ${featWIQLSettled.reason?.message || 'Unknown error'}`;
          warnings.push(message);
          console.warn(message);
        }
        if (defWIQLSettled.status !== 'fulfilled') {
          const message = `[sprint-trend] ${suffix} defects fetch failed: ${defWIQLSettled.reason?.message || 'Unknown error'}`;
          warnings.push(message);
          console.warn(message);
        }
        if (featWIQLSettled.status !== 'fulfilled' && defWIQLSettled.status !== 'fulfilled') shouldNoStore = true;

        const featIds = (featWIQL.workItems || []).map(w => w.id);
        const defIds  = (defWIQL.workItems  || []).map(w => w.id);

        const [featItemsSettled, defItemsSettled] = await Promise.allSettled([
          featIds.length ? fetchWorkItemDetails(featIds, minFields, cfg) : Promise.resolve([]),
          defIds.length ? fetchWorkItemDetails(defIds,  minFields, cfg) : Promise.resolve([])
        ]);
        const featItems = featItemsSettled.status === 'fulfilled' ? featItemsSettled.value : [];
        const defItems = defItemsSettled.status === 'fulfilled' ? defItemsSettled.value : [];
        if (featItemsSettled.status !== 'fulfilled') {
          const message = `[sprint-trend] ${suffix} feature details fetch failed: ${featItemsSettled.reason?.message || 'Unknown error'}`;
          warnings.push(message);
          console.warn(message);
        }
        if (defItemsSettled.status !== 'fulfilled') {
          const message = `[sprint-trend] ${suffix} defect details fetch failed: ${defItemsSettled.reason?.message || 'Unknown error'}`;
          warnings.push(message);
          console.warn(message);
        }
        if (featItemsSettled.status !== 'fulfilled' && defItemsSettled.status !== 'fulfilled') shouldNoStore = true;

        const features = processFeatures(featItems, teamRoot);
        const defects  = processDefects(defItems,  teamRoot, cfg.defectEscapeRatio);

        return {
          sprint:        suffix,
          label:         suffix,
          featureTotal:  features.total,
          featureDone:   features.stateCounts['Done'] || 0,
          doneRate:      features.doneRate,
          defectTotal:   defects.total,
          defectResolved:defects.stateCounts['Resolved'] || 0,
          resolveRate:   defects.resolveRate,
          escapeRatio:   defects.escapeRatio
        };
      })),
    ]);
    const sprintWindows = sprintWindowsSettled.status === 'fulfilled' ? sprintWindowsSettled.value : {};
    const results = resultsSettled.status === 'fulfilled' ? resultsSettled.value : [];
    if (sprintWindowsSettled.status !== 'fulfilled') {
      const message = `[sprint-trend] sprint dates fetch failed: ${sprintWindowsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (resultsSettled.status !== 'fulfilled') {
      const message = `[sprint-trend] sprint results fetch failed: ${resultsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (sprintWindowsSettled.status !== 'fulfilled' && resultsSettled.status !== 'fulfilled') shouldNoStore = true;

    // Tag each sprint with isFuture so the frontend can stop lines at today
    const today = new Date();
    results.forEach(r => {
      const w = sprintWindows[r.label];
      r.isFuture = w && w.start ? w.start > today : false;
    });

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({ pi, sprints: results, sprintDates: sprintWindows, ...(warnings.length ? { _warnings: warnings } : {}) });
  } catch (e) {
    console.error('[sprint-trend]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Returns per-sprint burndown data (feature count + effort) for a given PI.
router.get('/sprint-burndown', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const pi       = req.query.pi;
    const teamPath = req.query.teamPath || null;
    if (!pi) return res.status(400).json({ error: 'pi query param required' });

    const fm         = getFieldMappings(cfg);
    const suffixes   = fm.piStructure.sprintLabels;
    const sizeField  = fm.fields.effortField;
    const filterPath = teamPath || cfg.tfs.areaPath;
    const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const iterBase   = cfg.tfs.iterationPath;
    const doneState  = fm.stateValues.featureDone;

    const results = await Promise.all(suffixes.map(async suffix => {
      const sprintPath  = buildSprintIterPath(iterBase, pi, suffix, fm.piStructure.sprintSubpathPattern);
      const wiql = {
        query: `SELECT [System.Id] FROM WorkItems
          WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
            AND [System.AreaPath] UNDER '${filterPath}'
            AND [System.IterationPath] UNDER '${sprintPath}'
          ORDER BY [System.Id]`
      };
      try {
        const result = await tfsPost(wiqlUrl, wiql, cfg.tfs.pat);
        const ids = (result.workItems || []).map(w => w.id);
        if (!ids.length) return { sprint: suffix, total: 0, done: 0, remaining: 0, totalEffort: 0, doneEffort: 0, remainingEffort: 0, pctComplete: 0 };
        const items = await fetchWorkItemDetails(ids, ['System.Id', 'System.State', sizeField], cfg);
        const total        = items.length;
        const done         = items.filter(i => i.fields['System.State'] === doneState).length;
        const remaining    = total - done;
        const totalEffort  = Math.round(items.reduce((s, i) => s + (i.fields[sizeField] || 0), 0));
        const doneEffort   = Math.round(items.filter(i => i.fields['System.State'] === doneState).reduce((s, i) => s + (i.fields[sizeField] || 0), 0));
        const pctComplete  = total > 0 ? Math.round(done / total * 100) : 0;
        return { sprint: suffix, total, done, remaining, totalEffort, doneEffort, remainingEffort: totalEffort - doneEffort, pctComplete };
      } catch (_) {
        return { sprint: suffix, total: 0, done: 0, remaining: 0, totalEffort: 0, doneEffort: 0, remainingEffort: 0, pctComplete: 0 };
      }
    }));

    res.json({ pi, sprints: results });
  } catch (e) {
    console.error('[sprint-burndown]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
