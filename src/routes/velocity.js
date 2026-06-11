'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { getCurrentPIInfo, getDefaultPIs, getPILabel, buildSprintIterPath } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ─── GET /api/velocity ────────────────────────────────────────────────────────
// Returns per-PI, per-sprint, per-team velocity using StateChangeDate-based sprint windows.
// Sprint-level: features that moved to Done within the sprint's date window.
// PI-end: all features in Done state assigned to the PI (IterationPath).
router.get('/velocity', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) {
      piLabels = getDefaultPIs(fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern);
      const { yy, pi } = getCurrentPIInfo();
      const cur = getPILabel(yy, pi, fm.piStructure.piNamingPattern);
      if (!piLabels.includes(cur)) piLabels.push(cur);
    } else if (typeof piLabels === 'string') {
      piLabels = piLabels.split(',').map(s => s.trim());
    }
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const wiqlUrl  = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const iterBase = cfg.tfs.iterationPath;
    const sizeField = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    const sprintLabels = fm.piStructure.sprintLabels;
    const teamPath  = req.query.teamPath || null;
    const filterPath = teamPath || cfg.tfs.areaPath;

    const velocityFields = [...new Set([
      'System.Id', 'System.State', 'System.AreaPath', 'System.IterationPath',
      sizeField, storyPointsField, 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.StoryPoints'
    ])];

    function getSize(item) {
      return item.fields[sizeField]
          || item.fields[storyPointsField]
          || item.fields['Microsoft.VSTS.Scheduling.Effort']
          || item.fields['Microsoft.VSTS.Scheduling.StoryPoints']
          || 0;
    }

    function calcVelocity(items) {
      const byTeam = {};
      for (const item of items) {
        const state = item.fields['System.State'];
        const team  = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
        const pts   = getSize(item);
        if (!byTeam[team]) byTeam[team] = { done: 0, total: 0, points: 0, totalPoints: 0 };
        byTeam[team].total++;
        byTeam[team].totalPoints += pts;
        if (state === fm.stateValues.featureDone) {
          byTeam[team].done++;
          byTeam[team].points += pts;
        }
      }
      return byTeam;
    }

    const warnings = [];
    let shouldNoStore = false;

    const piResultsSettled = await Promise.allSettled(piLabels.map(async piLabel => {
      const sprintData = await Promise.all(sprintLabels.map(async sprintLabel => {
        const sprintIter = buildSprintIterPath(iterBase, piLabel, sprintLabel, fm.piStructure.sprintSubpathPattern);
        const wiql = {
          query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
              AND [System.AreaPath] UNDER '${filterPath}'
              AND [System.IterationPath] UNDER '${sprintIter}'
            ORDER BY [System.Id]`
        };
        try {
          const result = await tfsPost(wiqlUrl, wiql, cfg.tfs.pat);
          const ids = (result.workItems || []).map(w => w.id);
          if (!ids.length) return { sprint: sprintLabel, byTeam: {}, total: 0, totalDone: 0, totalPoints: 0, totalDonePoints: 0 };
          const items = await fetchWorkItemDetails(ids, velocityFields, cfg);
          const byTeam = calcVelocity(items);
          const totalDone       = Object.values(byTeam).reduce((s, v) => s + v.done, 0);
          const totalDonePoints = Object.values(byTeam).reduce((s, v) => s + v.points, 0);
          return { sprint: sprintLabel, byTeam, total: ids.length, totalDone, totalPoints: totalDonePoints, totalDonePoints };
        } catch (_) {
          return { sprint: sprintLabel, byTeam: {}, total: 0, totalDone: 0, totalPoints: 0, totalDonePoints: 0 };
        }
      }));

      const piWiql = {
        query: `SELECT [System.Id] FROM WorkItems
          WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
            AND [System.AreaPath] UNDER '${filterPath}'
            AND [System.IterationPath] UNDER '${iterBase}\\${piLabel}'
          ORDER BY [System.Id]`
      };
      const piResult = await tfsPost(wiqlUrl, piWiql, cfg.tfs.pat);
      const piIds = (piResult.workItems || []).map(w => w.id);
      const piItems = piIds.length ? await fetchWorkItemDetails(piIds, velocityFields, cfg) : [];
      const piByTeam = calcVelocity(piItems);
      const piTotal       = piItems.length;
      const piTotalDone   = Object.values(piByTeam).reduce((s, v) => s + v.done, 0);
      const piTotalPoints = Object.values(piByTeam).reduce((s, v) => s + v.totalPoints, 0);
      const piDonePoints  = Object.values(piByTeam).reduce((s, v) => s + v.points, 0);

      return {
        pi: piLabel,
        sprints: sprintData,
        piEnd: {
          byTeam: piByTeam,
          total: piTotal,
          totalDone: piTotalDone,
          totalPoints: piTotalPoints,
          totalDonePoints: piDonePoints,
          deliveryRate: piTotal > 0 ? Math.round(piTotalDone / piTotal * 100) : 0
        }
      };
    }));
    if (piResultsSettled.length && piResultsSettled.every(piResultSettled => piResultSettled.status !== 'fulfilled')) shouldNoStore = true;
    const piResults = piResultsSettled.map((piResultSettled, index) => {
      if (piResultSettled.status === 'fulfilled') return piResultSettled.value;
      const message = `[velocity] ${piLabels[index]} fetch failed: ${piResultSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
      return {
        pi: piLabels[index],
        sprints: [],
        piEnd: {
          byTeam: {},
          total: 0,
          totalDone: 0,
          totalPoints: 0,
          totalDonePoints: 0,
          deliveryRate: 0
        }
      };
    });

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({ velocity: piResults, ...(warnings.length ? { _warnings: warnings } : {}) });
  } catch (e) {
    console.error('[velocity]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/pi-story-velocity ───────────────────────────────────────────────
// Story-point-based PI velocity: planned SP vs completed SP per team.
// "Planned"   = Story items in the PI (state != Removed), regardless of whether estimated.
// "Completed" = Story items in done states within the PI.
router.get('/pi-story-velocity', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) {
      piLabels = getDefaultPIs(fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern);
      const { yy, pi } = getCurrentPIInfo();
      const cur = getPILabel(yy, pi, fm.piStructure.piNamingPattern);
      if (!piLabels.includes(cur)) piLabels.push(cur);
    } else if (typeof piLabels === 'string') {
      piLabels = piLabels.split(',').map(s => s.trim());
    }
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const iterBase   = cfg.tfs.iterationPath;
    const teamPath   = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const filterPath = teamPath || cfg.tfs.areaPath;
    const teamRoot   = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const sizeField  = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    const storyType  = fm.workItemTypes.story;

    const iterClause = piLabels.length && iterBase
      ? `AND (${piLabels.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`).join(' OR ')})`
      : '';

    const result = await tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] = '${storyType}'
          AND [System.AreaPath] UNDER '${filterPath}'
          AND [System.State] <> '${fm.stateValues.storyRemoved}'
          ${iterClause}
        ORDER BY [System.Id]`
    }, cfg.tfs.pat);

    const ids = (result.workItems || []).map(w => w.id);
    if (!ids.length) {
      return res.json({ byTeam: {}, totals: { planned: 0, completed: 0, plannedSP: 0, completedSP: 0 }, storyType, fetchedAt: new Date().toISOString() });
    }

    const fields = [...new Set([
      'System.Id', 'System.State', 'System.AreaPath', 'System.IterationPath',
      sizeField, storyPointsField, 'Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort'
    ])];
    const items = await fetchWorkItemDetails(ids, fields, cfg);

    const doneStates = new Set(fm.stateValues.storyDone);
    function getSP(item) {
      return item.fields[sizeField]
          || item.fields[storyPointsField]
          || item.fields['Microsoft.VSTS.Scheduling.StoryPoints']
          || item.fields['Microsoft.VSTS.Scheduling.Effort']
          || 0;
    }

    const byTeam = {};
    const totals = { planned: 0, completed: 0, plannedSP: 0, completedSP: 0 };

    for (const item of items) {
      const team = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
      const sp   = getSP(item);
      const done = doneStates.has(item.fields['System.State'] || '');

      if (!byTeam[team]) byTeam[team] = { planned: 0, completed: 0, plannedSP: 0, completedSP: 0 };
      byTeam[team].planned++;
      byTeam[team].plannedSP  += sp;
      totals.planned++;
      totals.plannedSP += sp;
      if (done) {
        byTeam[team].completed++;
        byTeam[team].completedSP += sp;
        totals.completed++;
        totals.completedSP += sp;
      }
    }

    res.json({ byTeam, totals, storyType, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('[pi-story-velocity]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
