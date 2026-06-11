'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { getCurrentPIInfo, getAllPIsForYear, buildIterationClauses, getPILabel } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ─── GET /api/roadmap ─────────────────────────────────────────────────────────
// Query params:
//   year     — 2-digit year, e.g. "26" (default: current year)
//   teamPath — optional AreaPath filter
router.get('/roadmap', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const fm = getFieldMappings(cfg);
    const pisPerYear = fm.piStructure.pisPerYear || 4;
    const featureDone = fm.stateValues.featureDone;
    const effortField = fm.fields.effortField;
    const storyPtsField = fm.fields.storyPointsField;

    const { yy: currentYy, pi: currentPi } = getCurrentPIInfo();
    const yearRaw = req.query.year != null ? String(req.query.year) : String(currentYy);
    const year    = yearRaw.padStart(2, '0');
    const teamPath = req.query.teamPath || null;

    const currentPILabel = getPILabel(currentYy, currentPi, fm.piStructure.piNamingPattern);

    // All PIs for the requested year (driven by pisPerYear config)
    const allPIsMeta = getAllPIsForYear(parseInt(year, 10), pisPerYear, fm.piStructure.piNamingPattern);
    const piLabels   = allPIsMeta.map(p => p.label);

    const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
    const iterPart   = iterClause ? ` AND ${iterClause}` : '';
    const teamPart   = teamPath   ? ` AND [System.AreaPath] UNDER '${teamPath}'` : '';

    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
        AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
        ${iterPart}${teamPart}
      ORDER BY [System.Id]`
    };

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const result  = await tfsPost(wiqlUrl, wiql, cfg.tfs.pat);
    const ids     = (result.workItems || []).map(w => w.id);

    const items = await fetchWorkItemDetails(ids, [
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', effortField, storyPtsField, 'System.AssignedTo'
    ], cfg);

    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;

    // Group items by PI label → sprint label
    // Use the computed piLabels list to match segments — works for any naming pattern
    const piMap = {}; // { piLabel: { sprintLabel: [items] } }
    for (const item of items) {
      const iterPath = item.fields['System.IterationPath'] || '';
      const segs     = iterPath.replace(/\//g, '\\').split('\\').filter(Boolean);
      const piPart   = segs.find(s => piLabels.includes(s)) || 'Unknown';
      // Sprint is the last segment; if it equals the PI (feature assigned at PI level, no sprint), use it as-is
      const sprint   = segs[segs.length - 1] || 'Unknown';
      if (!piMap[piPart]) piMap[piPart] = {};
      if (!piMap[piPart][sprint]) piMap[piPart][sprint] = [];
      piMap[piPart][sprint].push(item);
    }

    const pis = piLabels.sort().map(piLabel => {
      const sprintMap  = piMap[piLabel] || {};
      const sprintKeys = Object.keys(sprintMap).sort();
      let   piTotal    = 0;
      let   piDone     = 0;
      const byTeam     = {};
      const sprints    = [];

      for (const sprintKey of sprintKeys) {
        const sprintItems = sprintMap[sprintKey];
        const sprintTotal = sprintItems.length;
        const sprintDone  = sprintItems.filter(i => i.fields['System.State'] === featureDone).length;

        piTotal += sprintTotal;
        piDone  += sprintDone;

        for (const item of sprintItems) {
          const team = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
          if (!byTeam[team]) byTeam[team] = { total: 0, done: 0, doneRate: 0 };
          byTeam[team].total++;
          if (item.fields['System.State'] === featureDone) byTeam[team].done++;
        }

        const sprintFeatures = sprintItems.slice(0, 50).map(i => ({
          id:    i.id,
          title: i.fields['System.Title'],
          state: i.fields['System.State'],
          team:  extractTeam(i.fields['System.AreaPath'] || '', teamRoot),
          size:  i.fields[effortField] ?? i.fields[storyPtsField] ?? null
        }));

        sprints.push({
          sprint:   sprintKey,
          total:    sprintTotal,
          done:     sprintDone,
          doneRate: sprintTotal > 0 ? Math.round((sprintDone / sprintTotal) * 100) : 0,
          features: sprintFeatures
        });
      }

      for (const team of Object.keys(byTeam)) {
        const t = byTeam[team];
        t.doneRate = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
      }

      return {
        pi:        piLabel,
        isCurrent: piLabel === currentPILabel,
        isPast:    piLabel < currentPILabel,
        total:     piTotal,
        done:      piDone,
        doneRate:  piTotal > 0 ? Math.round((piDone / piTotal) * 100) : 0,
        byTeam,
        sprints
      };
    });

    res.json({
      meta: { fetchedAt: new Date().toISOString(), year, totalFeatures: ids.length },
      year,
      pis
    });
  } catch (e) {
    console.error('[roadmap]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
