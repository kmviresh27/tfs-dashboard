'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet, tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { processFeatures, processDefects } = require('../helpers/dataProcessors');
const { getDefaultPIs, wiqlFeatures, wiqlDefects } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');
const { fetchLeafTeams } = require('../helpers/teamsHelper');

const router = express.Router();

function getDefectFieldConfig(fm) {
  return {
    howFoundField:    fm.fields.howFoundField,
    whereFoundField:  fm.fields.whereFoundField,
    severityField:    fm.fields.severityField,
    rankField:        fm.fields.rankField,
    foundInBuildField: fm.fields.foundInBuildField,
    resolveByField:   fm.fields.resolveByField || '',
  };
}

function uniqueFields(fields) {
  return [...new Set(fields.filter(Boolean))];
}

// ─── GET /api/teams ───────────────────────────────────────────────────────────
router.get('/teams', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const leafTeams = await fetchLeafTeams(cfg);
    res.json({ teams: [...leafTeams].sort() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/dashboard ───────────────────────────────────────────────────────
// Query params:
//   pis[]  — comma or repeated: ?pis[]=26-PI1&pis[]=26-PI2  (default: completed PIs of current year)
router.get('/dashboard', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured. Set it in Settings.' });

    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) {
      piLabels = getDefaultPIs(fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern);
    } else if (typeof piLabels === 'string') {
      piLabels = piLabels.split(',').map(s => s.trim());
    }
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const sizeField = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    const df = getDefectFieldConfig(fm);

    const [featWIQLRes, defWIQLRes] = await Promise.allSettled([
      tfsPost(wiqlUrl, wiqlFeatures(cfg, piLabels), cfg.tfs.pat),
      tfsPost(wiqlUrl, wiqlDefects(cfg, piLabels),  cfg.tfs.pat)
    ]);

    const featWIQL = featWIQLRes.status === 'fulfilled' ? featWIQLRes.value : { workItems: [] };
    const defWIQL  = defWIQLRes.status  === 'fulfilled' ? defWIQLRes.value  : { workItems: [] };
    if (featWIQLRes.status === 'rejected') console.warn('[dashboard] features WIQL failed:', featWIQLRes.reason?.message?.slice(0, 80));
    if (defWIQLRes.status  === 'rejected') console.warn('[dashboard] defects WIQL failed:',  defWIQLRes.reason?.message?.slice(0, 80));

    const featIds = (featWIQL.workItems || []).map(w => w.id);
    const defIds  = (defWIQL.workItems  || []).map(w => w.id);

    const defExtraFields = uniqueFields([
      df.howFoundField,
      df.whereFoundField,
      df.severityField,
      df.rankField,
      sizeField,
      storyPointsField,
      df.foundInBuildField,
      df.resolveByField
    ]);
    const featFields = uniqueFields([
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', 'System.CreatedDate', 'System.ChangedDate',
      fm.fields.stateChangeDateField,
      sizeField,
      storyPointsField
    ]);
    const defFields = uniqueFields([
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', df.rankField,
      'System.CreatedDate', 'System.ChangedDate', 'System.Tags',
      ...defExtraFields
    ]);

    const [featItemsRes, defItemsRes] = await Promise.allSettled([
      fetchWorkItemDetails(featIds, featFields, cfg),
      fetchWorkItemDetails(defIds,  defFields,  cfg)
    ]);

    const featItems = featItemsRes.status === 'fulfilled' ? featItemsRes.value : [];
    const defItems  = defItemsRes.status  === 'fulfilled' ? defItemsRes.value  : [];
    if (featItemsRes.status === 'rejected') console.warn('[dashboard] features detail failed:', featItemsRes.reason?.message?.slice(0, 80));
    if (defItemsRes.status  === 'rejected') console.warn('[dashboard] defects detail failed:',  defItemsRes.reason?.message?.slice(0, 80));

    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const features = processFeatures(featItems, teamRoot, fm);
    const defects  = processDefects(defItems, teamRoot, cfg.defectEscapeRatio, df, fm);

    res.json({
      meta: {
        fetchedAt: new Date().toISOString(),
        pis: piLabels,
        featureCount: featIds.length,
        defectCount:  defIds.length
      },
      features,
      defects
    });
  } catch (e) {
    console.error('[dashboard]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/features ────────────────────────────────────────────────────────
router.get('/features', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = req.query['pis[]'] || req.query.pis || getDefaultPIs(fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern);
    if (typeof piLabels === 'string') piLabels = piLabels.split(',');
    if (!Array.isArray(piLabels)) piLabels = [piLabels];

    const sizeField = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const result  = await tfsPost(wiqlUrl, wiqlFeatures(cfg, piLabels), cfg.tfs.pat);
    const ids     = (result.workItems || []).map(w => w.id);
    const items   = await fetchWorkItemDetails(ids, uniqueFields([
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', 'System.CreatedDate', 'System.ChangedDate',
      fm.fields.stateChangeDateField,
      sizeField,
      storyPointsField
    ]), cfg);
    res.json(processFeatures(items, cfg.tfs.teamRootPath || cfg.tfs.areaPath, fm));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/defects ─────────────────────────────────────────────────────────
router.get('/defects', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = req.query['pis[]'] || req.query.pis || getDefaultPIs(fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern);
    if (typeof piLabels === 'string') piLabels = piLabels.split(',');
    if (!Array.isArray(piLabels)) piLabels = [piLabels];

    const df = getDefectFieldConfig(fm);
    const sizeField = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    const extraFields = uniqueFields([
      df.howFoundField,
      df.whereFoundField,
      df.severityField,
      df.rankField,
      df.foundInBuildField,
      df.resolveByField,
      sizeField,
      storyPointsField
    ]);
    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const result  = await tfsPost(wiqlUrl, wiqlDefects(cfg, piLabels), cfg.tfs.pat);
    const ids     = (result.workItems || []).map(w => w.id);
    const items   = await fetchWorkItemDetails(ids, uniqueFields([
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', df.rankField,
      'System.CreatedDate', 'System.ChangedDate', 'System.Tags',
      ...extraFields
    ]), cfg);
    res.json(processDefects(items, cfg.tfs.teamRootPath || cfg.tfs.areaPath, cfg.defectEscapeRatio, df, fm));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
