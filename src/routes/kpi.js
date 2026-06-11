'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet, tfsPost } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { getDefaultPIs, getPILabel } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch work items by ID with their relations (attachments + links) */
async function fetchWithRelations(ids, cfg) {
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const results = await Promise.allSettled(
    chunks.map(chunk => {
      const url = `${cfg.tfs.baseUrl}/_apis/wit/workitems?ids=${chunk.join(',')}&$expand=relations&api-version=${cfg.tfs.apiVersion}`;
      return tfsGet(url, cfg.tfs.pat).then(d => d.value || []);
    })
  );
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

/** Run a WIQL query and return array of work item IDs */
async function wiqlIds(query, wiqlUrl, pat) {
  try {
    const res = await tfsPost(wiqlUrl, { query }, pat);
    return (res.workItems || []).map(w => w.id);
  } catch { return []; }
}

/** Compute RAG status for a KPI value vs its target */
function ragStatus(value, target, dir) {
  if (value === null || value === undefined) return 'unknown';
  if (dir === 'lte') {
    // lower-is-better (defect ratios, analysis time)
    if (value <= target) return 'green';
    if (value <= target * 1.2) return 'amber';
    return 'red';
  }
  if (dir === 'count') {
    // raw count where 0 is ideal
    if (value === 0) return 'green';
    if (value <= 3) return 'amber';
    return 'red';
  }
  // gte — higher-is-better (coverage percentages)
  if (target === 0) return value > 0 ? 'green' : 'amber';
  const ratio = value / target;
  if (ratio >= 1) return 'green';
  if (ratio >= 0.9) return 'amber';
  return 'red';
}

function pct(n, d) { return d > 0 ? Math.round(n / d * 100) : null; }

function prevPIOf(piLabel, pisPerYear = 4) {
  const m = (piLabel || '').match(/^(\d{2})-PI(\d+)$/);
  if (!m) return null;
  let yy = parseInt(m[1]), n = parseInt(m[2]);
  if (--n < 1) { yy--; n = pisPerYear; }
  return getPILabel(yy, n);
}

/** Build a TFS work-item query URL (on-prem) from a WIQL string */
function buildTfsUrl(baseUrl, wiql) {
  return `${baseUrl}/_workitems?_a=query-edit&wiql=${encodeURIComponent(wiql)}`;
}

/** Build WIQL using the smaller of IN(targetIds) vs NOT IN(complementIds)+area-filter.
 *  Ensures the shortest possible URL regardless of which side is larger.
 *  e.g. 2% coverage → IN(2 met IDs); 98% coverage → NOT IN(2 not-met IDs) + area filter. */
function smartIdWiql(targetIds, complementIds, wiType, filterPath, iterQ, notRemoved) {
  if (!targetIds.length) return null;
  if (targetIds.length <= complementIds.length) {
    return `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${wiType}' AND [System.Id] IN (${targetIds.join(',')}) AND ${notRemoved}`;
  }
  const excl = complementIds.length ? ` AND [System.Id] NOT IN (${complementIds.join(',')})` : '';
  return `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${wiType}' AND [System.AreaPath] UNDER '${filterPath}' AND ${iterQ} AND ${notRemoved}${excl}`;
}

/** Check if a TFS relation has any of the given keywords in its name/URL */
function relHasKeyword(rel, keywords) {
  const nm = [
    rel.attributes?.name || '',
    rel.attributes?.comment || '',
    rel.url || '',
  ].join(' ').toLowerCase();
  return keywords.some(kw => nm.includes(kw.toLowerCase()));
}

// ── GET /api/kpi ──────────────────────────────────────────────────────────────
router.get('/kpi', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm       = getFieldMappings(cfg);
    const WIT_FEAT   = fm.workItemTypes.feature;
    const WIT_DEFECT = fm.workItemTypes.defect;
    const DONE_STATE = fm.stateValues.featureDone.toLowerCase();
    const DEFECT_CLOSED_SQL = fm.stateValues.defectClosed.map(s => `'${s}'`).join(',');
    const kpiCfg   = cfg.kpi || {};

    function kwArr(val, fallback) {
      if (!val) return fallback;
      return String(val).split(',').map(s => s.trim()).filter(Boolean);
    }

    const TAGS = {
      scenarioGap:    kpiCfg.tags?.scenarioGap    || 'Scenario-Gap',
      regression:     kpiCfg.tags?.regression     || 'Regression',
      missedStandard: kpiCfg.tags?.missedStandard || 'Missed-Standard',
      aiAssisted:     kpiCfg.tags?.aiAssisted     || 'AI-Assisted',
      lateChange:     kpiCfg.tags?.lateChange     || 'Late-Change',
    };

    const AKW = {
      mindmap:     kwArr(kpiCfg.attachmentKeywords?.mindmap,     ['mindmap', 'mind map', 'mind-map']),
      fmea:        kwArr(kpiCfg.attachmentKeywords?.fmea,        ['fmea']),
      impact:      kwArr(kpiCfg.attachmentKeywords?.impact,      ['impact', 'impact analysis', 'impact-analysis']),
      checklist:   kwArr(kpiCfg.attachmentKeywords?.checklist,   ['checklist', 'check list', 'dod']),
      crossReview: kwArr(kpiCfg.attachmentKeywords?.crossReview, ['review']),
    };

    const T = {
      'exploratory-coverage':        kpiCfg.targets?.['exploratory-coverage']        ?? 80,
      'fmea-coverage':               kpiCfg.targets?.['fmea-coverage']               ?? 70,
      'scenario-gap-defects':        kpiCfg.targets?.['scenario-gap-defects']        ?? 15,
      'regression-defects':          kpiCfg.targets?.['regression-defects']          ?? 15,
      'checklist-compliance':        kpiCfg.targets?.['checklist-compliance']        ?? 80,
      'cross-team-review':           kpiCfg.targets?.['cross-team-review']           ?? 80,
      'missed-standard-defects':     kpiCfg.targets?.['missed-standard-defects']     ?? 15,
      'say-do-ratio':                kpiCfg.targets?.['say-do-ratio']                ?? 90,
      'late-changes':                kpiCfg.targets?.['late-changes']                ?? 0,
      'impact-assessment':           kpiCfg.targets?.['impact-assessment']           ?? 80,
      'build-time-reduction':        kpiCfg.targets?.['build-time-reduction']        ?? 25,
      'build-stability':             kpiCfg.targets?.['build-stability']             ?? 80,
      'ai-assisted-usage':           kpiCfg.targets?.['ai-assisted-usage']           ?? 95,
      'post-integration-regression': kpiCfg.targets?.['post-integration-regression'] ?? 15,
      'defect-analysis-time':        kpiCfg.targets?.['defect-analysis-time']        ?? 1.5,
    };
    const BASELINE_ANALYSIS_DAYS = kpiCfg.defectAnalysisTimeBaseline ?? 2.5;
    const FEAT_LABEL = `${WIT_FEAT} items`;
    const DEFECT_LABEL = `${WIT_DEFECT} items`;
    const kwText = arr => arr.join(', ');

    const KPI_WIQL_FN = {
      'exploratory-coverage':        (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND ${nr}`,
      'fmea-coverage':               (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND ${nr}`,
      'scenario-gap-defects':        (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.Tags],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.Tags] CONTAINS '${TAGS.scenarioGap}' AND ${nr}`,
      'regression-defects':          (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.Tags],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.Tags] CONTAINS '${TAGS.regression}' AND ${nr}`,
      'checklist-compliance':        (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND ${nr}`,
      'cross-team-review':           (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND ${nr}`,
      'missed-standard-defects':     (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.Tags],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.Tags] CONTAINS '${TAGS.missedStandard}' AND ${nr}`,
      'say-do-ratio':                (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND ${nr}`,
      'late-changes':                (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.Tags],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.Tags] CONTAINS '${TAGS.lateChange}' AND ${nr}`,
      'impact-assessment':           (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND ${nr}`,
      'ai-assisted-usage':           (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.Tags],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.Tags] CONTAINS '${TAGS.aiAssisted}' AND ${nr}`,
      'post-integration-regression': (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.Tags],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.Tags] CONTAINS '${TAGS.regression}' AND ${nr}`,
      'defect-analysis-time':        (ap, iq)      => `SELECT [System.Id],[System.Title],[System.State],[Microsoft.VSTS.Common.ResolvedDate],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.State] IN (${DEFECT_CLOSED_SQL})`,
    };

    const KPI_MET_WIQL = {
      'say-do-ratio': (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.State] = '${fm.stateValues.featureDone}' AND ${nr}`,
    };

    const KPI_NOT_MET_WIQL = {
      'scenario-gap-defects':        (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND NOT [System.Tags] CONTAINS '${TAGS.scenarioGap}' AND ${nr}`,
      'regression-defects':          (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND NOT [System.Tags] CONTAINS '${TAGS.regression}' AND ${nr}`,
      'missed-standard-defects':     (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND NOT [System.Tags] CONTAINS '${TAGS.missedStandard}' AND ${nr}`,
      'post-integration-regression': (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND NOT [System.Tags] CONTAINS '${TAGS.regression}' AND ${nr}`,
      'ai-assisted-usage':           (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND NOT [System.Tags] CONTAINS '${TAGS.aiAssisted}' AND ${nr}`,
      'late-changes':                (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND NOT [System.Tags] CONTAINS '${TAGS.lateChange}' AND ${nr}`,
      'say-do-ratio':                (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.State] <> '${fm.stateValues.featureDone}' AND ${nr}`,
      'defect-analysis-time':        (ap, iq, nr) => `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND [System.AreaPath] UNDER '${ap}' AND ${iq} AND [System.State] NOT IN (${DEFECT_CLOSED_SQL}) AND ${nr}`,
    };

    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const pi         = req.query.pi || getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern)[0];
    const teamPath   = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const filterPath = teamPath || cfg.tfs.areaPath;

    const wiqlUrl   = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const iterRoot  = cfg.tfs.iterationPath;
    const areaQ     = `[System.AreaPath] UNDER '${filterPath}'`;
    const iterQ     = `[System.IterationPath] UNDER '${iterRoot}\\${pi}'`;
    const notRemoved = `[System.State] <> 'Removed'`;

    // ── Phase 1: Fire all WIQL ID queries in parallel ─────────────────────
    const [
      featRes, bugRes,
      aiTagRes, lateChgRes,
      scenGapRes, regRes, missedStdRes,
      resolvedBugRes,
    ] = await Promise.allSettled([
      // 1. All features in PI
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND ${areaQ} AND ${iterQ} AND ${notRemoved}` }, cfg.tfs.pat),
      // 2. All defects in PI
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND ${areaQ} AND ${iterQ} AND ${notRemoved}` }, cfg.tfs.pat),
      // 3. AI-assisted features
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND ${areaQ} AND ${iterQ} AND [System.Tags] CONTAINS '${TAGS.aiAssisted}' AND ${notRemoved}` }, cfg.tfs.pat),
      // 4. Late-change features
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND ${areaQ} AND ${iterQ} AND [System.Tags] CONTAINS '${TAGS.lateChange}' AND ${notRemoved}` }, cfg.tfs.pat),
      // 5. Scenario-gap defects
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND ${areaQ} AND ${iterQ} AND [System.Tags] CONTAINS '${TAGS.scenarioGap}' AND ${notRemoved}` }, cfg.tfs.pat),
      // 6. Regression defects
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND ${areaQ} AND ${iterQ} AND [System.Tags] CONTAINS '${TAGS.regression}' AND ${notRemoved}` }, cfg.tfs.pat),
      // 7. Missed-standard defects
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND ${areaQ} AND ${iterQ} AND [System.Tags] CONTAINS '${TAGS.missedStandard}' AND ${notRemoved}` }, cfg.tfs.pat),
      // 8. Closed defects (for defect analysis time)
      tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${WIT_DEFECT}' AND ${areaQ} AND ${iterQ} AND [System.State] IN (${DEFECT_CLOSED_SQL})` }, cfg.tfs.pat),
    ]);

    const featIds      = featRes.status === 'fulfilled'      ? (featRes.value.workItems      || []).map(w => w.id) : [];
    const bugIds       = bugRes.status === 'fulfilled'       ? (bugRes.value.workItems       || []).map(w => w.id) : [];
    const aiTagIds     = aiTagRes.status === 'fulfilled'     ? new Set((aiTagRes.value.workItems     || []).map(w => w.id)) : new Set();
    const lateChgIds   = lateChgRes.status === 'fulfilled'   ? (lateChgRes.value.workItems   || []).map(w => w.id) : [];
    const scenGapSet   = scenGapRes.status === 'fulfilled'   ? new Set((scenGapRes.value.workItems   || []).map(w => w.id)) : new Set();
    const regSet       = regRes.status === 'fulfilled'       ? new Set((regRes.value.workItems       || []).map(w => w.id)) : new Set();
    const missedStdSet = missedStdRes.status === 'fulfilled' ? new Set((missedStdRes.value.workItems || []).map(w => w.id)) : new Set();
    const resolvedBugIds = resolvedBugRes.status === 'fulfilled' ? (resolvedBugRes.value.workItems || []).map(w => w.id) : [];

    // ── Phase 2: Fetch feature details with relations + resolved bug timestamps ──
    const [featDetails, resolvedBugDetails] = await Promise.all([
      fetchWithRelations(featIds, cfg),
      resolvedBugIds.length ? (() => {
        const fields = ['System.Id', 'System.AreaPath', 'System.CreatedDate', 'Microsoft.VSTS.Common.ResolvedDate'];
        const chunks = [];
        for (let i = 0; i < resolvedBugIds.length; i += 200) chunks.push(resolvedBugIds.slice(i, i + 200));
        return Promise.allSettled(
          chunks.map(c => tfsPost(
            `${cfg.tfs.baseUrl}/_apis/wit/workitemsbatch?api-version=${cfg.tfs.apiVersion}`,
            { ids: c, fields }, cfg.tfs.pat
          ).then(d => d.value || []))
        ).then(r => r.flatMap(x => x.status === 'fulfilled' ? x.value : []));
      })() : Promise.resolve([]),
    ]);

    // ── Phase 3: Compute attachment/link-based KPI sets ──────────────────────
    const mindmapSet     = new Set();
    const fmeaSet        = new Set();
    const impactSet      = new Set();
    const checklistSet   = new Set();
    const crossReviewSet = new Set();
    const doneFeats      = new Set();

    for (const feat of featDetails) {
      const id   = feat.id;
      const rels = feat.relations || [];
      const state = (feat.fields?.['System.State'] || '').toLowerCase();

      if (state === DONE_STATE) doneFeats.add(id);

      for (const rel of rels) {
        if (relHasKeyword(rel, AKW.mindmap))       mindmapSet.add(id);
        if (relHasKeyword(rel, AKW.fmea))          fmeaSet.add(id);
        if (relHasKeyword(rel, AKW.impact))        impactSet.add(id);
        if (relHasKeyword(rel, AKW.checklist))     checklistSet.add(id);
        // Cross-team review: linked task/story with configured review keywords
        if (/Related|Child|Dependency/i.test(rel.rel || '')) {
          if (relHasKeyword(rel, AKW.crossReview)) crossReviewSet.add(id);
        }
      }
      // Checklist evidence in work item description
      const desc = (feat.fields?.['System.Description'] || '').toLowerCase();
      if (AKW.checklist.some(kw => desc.includes(String(kw).toLowerCase())) || /\[x\]|☑|✅/.test(desc)) checklistSet.add(id);
    }

    // ── Sprint-level feature grouping (using already-fetched featDetails) ────────
    const sprintFeatMap = {};
    for (const feat of featDetails) {
      const iterPath = feat.fields?.['System.IterationPath'] || '';
      const seg = iterPath.replace(/\//g, '\\').split('\\').pop() || '';
      const sprint = seg.replace(/^\d{2}-PI\d+\s*/i, '').trim().toUpperCase() || null;
      if (!sprint) continue;
      if (!sprintFeatMap[sprint]) sprintFeatMap[sprint] = new Set();
      sprintFeatMap[sprint].add(feat.id);
    }
    const sprintOrder = Object.keys(sprintFeatMap).sort((a, b) => {
      const key = s => s === 'IP' ? '\xFF' : `S${(s.slice(1) || '0').padStart(4, '0')}`;
      return key(a).localeCompare(key(b));
    }); 
    const analysisTimeDays = [];
    for (const bug of resolvedBugDetails) {
      const created  = bug.fields?.['System.CreatedDate'];
      const resolved = bug.fields?.['Microsoft.VSTS.Common.ResolvedDate'];
      if (created && resolved) {
        const days = (new Date(resolved) - new Date(created)) / 86400000;
        if (days >= 0 && days < 365) analysisTimeDays.push(days);
      }
    }
    const avgAnalysisTime = analysisTimeDays.length
      ? parseFloat((analysisTimeDays.reduce((s, d) => s + d, 0) / analysisTimeDays.length).toFixed(2))
      : null;

    // ── Phase 5: Pipeline KPIs from config (manual input) ─────────────────────
    const pipeCfg          = (cfg.kpi?.pipeline?.[pi]) || {};
    const buildTimeBaseline = pipeCfg.buildTimeBaseline || null;
    const buildTimeCurrent  = pipeCfg.buildTimeCurrent  || null;
    const buildStabilityPct = pipeCfg.buildStability    || null;
    const buildTimeReduction = (buildTimeBaseline && buildTimeCurrent)
      ? parseFloat(((buildTimeBaseline - buildTimeCurrent) / buildTimeBaseline * 100).toFixed(1))
      : null;

    // ── Phase 6: Say/Do — PI-level completion rate (proxy) ────────────────────
    const totalFeats = featIds.length;
    const totalBugs  = bugIds.length;
    const sayDoValue = totalFeats > 0 ? pct(doneFeats.size, totalFeats) : null;

    // ── Phase 6b: Met ID sets for attachment-based KPIs (dual TFS links) ────────
    // Tag/state-based KPIs use KPI_MET_WIQL / KPI_NOT_MET_WIQL instead (no ID lists)
    const kpiSets = {
      'exploratory-coverage': { metIds: [...mindmapSet],    allIds: featIds, wiType: WIT_FEAT },
      'fmea-coverage':        { metIds: [...fmeaSet],       allIds: featIds, wiType: WIT_FEAT },
      'checklist-compliance': { metIds: [...checklistSet],  allIds: featIds, wiType: WIT_FEAT },
      'cross-team-review':    { metIds: [...crossReviewSet], allIds: featIds, wiType: WIT_FEAT },
      'impact-assessment':    { metIds: [...impactSet],     allIds: featIds, wiType: WIT_FEAT },
    };

    // ── Phase 7: Build KPI array ───────────────────────────────────────────────
    const kpis = [
      // ── Quality ──────────────────────────────────────────────────────────────
      {
        id: 'exploratory-coverage', name: 'Exploratory Testing Coverage',
        group: 'quality', type: 'leading', seq: 1,
        value: pct(mindmapSet.size, totalFeats), unit: '%', target: T['exploratory-coverage'], targetDir: 'gte',
        met: mindmapSet.size, total: totalFeats,
        formula: `${FEAT_LABEL} with exploratory evidence / Total ${FEAT_LABEL}`,
        note: `Configured attachment/link matches exploratory keywords: ${kwText(AKW.mindmap)}`,
        isManual: false,
      },
      {
        id: 'fmea-coverage', name: 'FMEA Coverage',
        group: 'quality', type: 'leading', seq: 2,
        value: pct(fmeaSet.size, totalFeats), unit: '%', target: T['fmea-coverage'], targetDir: 'gte',
        met: fmeaSet.size, total: totalFeats,
        formula: `${FEAT_LABEL} with FMEA evidence / Total ${FEAT_LABEL}`,
        note: `Configured attachment/link matches FMEA keywords: ${kwText(AKW.fmea)}`,
        isManual: false,
      },
      {
        id: 'scenario-gap-defects', name: 'Scenario Gap Defects',
        group: 'quality', type: 'lagging', seq: 3,
        value: pct(scenGapSet.size, totalBugs), unit: '%', target: T['scenario-gap-defects'], targetDir: 'lte',
        met: scenGapSet.size, total: totalBugs,
        formula: `${DEFECT_LABEL} tagged ${TAGS.scenarioGap} / Total ${DEFECT_LABEL}`,
        note: `Configured tag ${TAGS.scenarioGap} on ${WIT_DEFECT} work items + RCA text`,
        isManual: false,
      },
      {
        id: 'regression-defects', name: 'Regression Defects',
        group: 'quality', type: 'lagging', seq: 4,
        value: pct(regSet.size, totalBugs), unit: '%', target: T['regression-defects'], targetDir: 'lte',
        met: regSet.size, total: totalBugs,
        formula: `${DEFECT_LABEL} tagged ${TAGS.regression} / Total ${DEFECT_LABEL}`,
        note: `Configured tag ${TAGS.regression} on ${WIT_DEFECT} work items`,
        isManual: false,
      },
      // ── Process ──────────────────────────────────────────────────────────────
      {
        id: 'checklist-compliance', name: 'Checklist Compliance (PR Gate)',
        group: 'process', type: 'leading', seq: 5,
        value: pct(checklistSet.size, totalFeats), unit: '%', target: T['checklist-compliance'], targetDir: 'gte',
        met: checklistSet.size, total: totalFeats,
        formula: `${FEAT_LABEL} with checklist evidence / Total ${FEAT_LABEL}`,
        note: `Configured checklist keywords (${kwText(AKW.checklist)}) in attachments, links, or description evidence`,
        isManual: false,
      },
      {
        id: 'cross-team-review', name: 'Cross-Team Review Coverage',
        group: 'process', type: 'leading', seq: 6,
        value: pct(crossReviewSet.size, totalFeats), unit: '%', target: T['cross-team-review'], targetDir: 'gte',
        met: crossReviewSet.size, total: totalFeats,
        formula: `${FEAT_LABEL} with cross-team review evidence / Total ${FEAT_LABEL}`,
        note: `Configured related-link review keywords: ${kwText(AKW.crossReview)}`,
        isManual: false,
      },
      {
        id: 'missed-standard-defects', name: 'Missed Standard Defects',
        group: 'process', type: 'lagging', seq: 7,
        value: pct(missedStdSet.size, totalBugs), unit: '%', target: T['missed-standard-defects'], targetDir: 'lte',
        met: missedStdSet.size, total: totalBugs,
        formula: `${DEFECT_LABEL} tagged ${TAGS.missedStandard} / Total ${DEFECT_LABEL}`,
        note: `Configured tag ${TAGS.missedStandard} on ${WIT_DEFECT} work items + RCA text`,
        isManual: false,
      },
      {
        id: 'say-do-ratio', name: 'Say/Do Ratio (PI Completion)',
        group: 'process', type: 'lagging', seq: 8,
        value: sayDoValue, unit: '%', target: T['say-do-ratio'], targetDir: 'gte',
        met: doneFeats.size, total: totalFeats,
        formula: `${fm.stateValues.featureDone} ${FEAT_LABEL} / Total planned ${FEAT_LABEL} (PI level)`,
        note: `PI-level completion rate for ${WIT_FEAT} work items. Sprint-level Say/Do: see Velocity section.`,
        isManual: false,
      },
      // ── Change Management ─────────────────────────────────────────────────────
      {
        id: 'late-changes', name: 'Late Changes After sVer',
        group: 'change', type: 'leading', seq: 9,
        value: lateChgIds.length, unit: 'count', target: T['late-changes'], targetDir: 'count',
        met: lateChgIds.length === 0 ? 1 : 0, total: null,
        formula: `Count of ${WIT_FEAT} items tagged ${TAGS.lateChange}`,
        note: `Configured tag ${TAGS.lateChange} on ${WIT_FEAT} work items. Ideally 0 after sVer milestone.`,
        isManual: false,
      },
      {
        id: 'impact-assessment', name: 'Impact Assessment Coverage',
        group: 'change', type: 'leading', seq: 10,
        value: pct(impactSet.size, totalFeats), unit: '%', target: T['impact-assessment'], targetDir: 'gte',
        met: impactSet.size, total: totalFeats,
        formula: `${FEAT_LABEL} with impact assessment evidence / Total ${FEAT_LABEL}`,
        note: `Configured attachment/link matches impact keywords: ${kwText(AKW.impact)}`,
        isManual: false,
      },
      {
        id: 'build-time-reduction', name: 'E2E Build Time Reduction',
        group: 'change', type: 'leading', seq: 11,
        value: buildTimeReduction, unit: '%', target: T['build-time-reduction'], targetDir: 'gte',
        met: null, total: null,
        formula: '(Baseline − Current) / Baseline × 100',
        note: 'Pipeline metric — set baseline/current in Settings → KPI Config',
        isManual: true,
        pipelineConfig: { baseline: buildTimeBaseline, current: buildTimeCurrent },
      },
      {
        id: 'build-stability', name: 'Build Stability After sVer',
        group: 'change', type: 'lagging', seq: 12,
        value: buildStabilityPct !== null ? parseFloat(buildStabilityPct) : null,
        unit: '%', target: T['build-stability'], targetDir: 'gte',
        met: null, total: null,
        formula: 'Successful builds / Total builds',
        note: 'Pipeline metric — enter value in Settings → KPI Config',
        isManual: true,
        pipelineConfig: { stability: buildStabilityPct },
      },
      // ── AI / Automation ───────────────────────────────────────────────────────
      {
        id: 'ai-assisted-usage', name: 'AI-Assisted Feature Usage',
        group: 'ai', type: 'leading', seq: 13,
        value: pct(aiTagIds.size, totalFeats), unit: '%', target: T['ai-assisted-usage'], targetDir: 'gte',
        met: aiTagIds.size, total: totalFeats,
        formula: `${FEAT_LABEL} tagged ${TAGS.aiAssisted} / Total ${FEAT_LABEL}`,
        note: `Configured tag ${TAGS.aiAssisted} on ${WIT_FEAT} work items (Windsurf, Kiro, Copilot, Claude)`,
        isManual: false,
      },
      {
        id: 'post-integration-regression', name: 'Post-Integration Regression Rate',
        group: 'ai', type: 'lagging', seq: 14,
        value: pct(regSet.size, totalBugs), unit: '%', target: T['post-integration-regression'], targetDir: 'lte',
        met: regSet.size, total: totalBugs,
        formula: `${DEFECT_LABEL} tagged ${TAGS.regression} / Total ${DEFECT_LABEL} (post-integration scope)`,
        note: `Configured tag ${TAGS.regression} on ${WIT_DEFECT} work items. Overlap with Quality regression — different scope intent.`,
        isManual: false,
      },
      {
        id: 'defect-analysis-time', name: 'Defect Analysis Time Reduction',
        group: 'ai', type: 'lagging', seq: 15,
        value: avgAnalysisTime, unit: 'days', target: T['defect-analysis-time'], targetDir: 'lte',
        met: analysisTimeDays.length, total: resolvedBugIds.length,
        formula: `Avg(Resolved − Created) for resolved ${WIT_DEFECT} items · baseline: ${BASELINE_ANALYSIS_DAYS} days`,
        note: `Auto-computed from TFS timestamps; baseline ${BASELINE_ANALYSIS_DAYS} days → target ${T['defect-analysis-time']} days`,
        isManual: false,
        baseline: BASELINE_ANALYSIS_DAYS,
      },
    ];

    // Attach RAG + TFS URLs (overall + met/notMet dual links) to each KPI
    for (const kpi of kpis) {
      kpi.rag = ragStatus(kpi.value, kpi.target, kpi.targetDir);

      // Overall "all items" TFS link
      const wiqlFn = KPI_WIQL_FN[kpi.id];
      if (wiqlFn) {
        kpi.tfsUrl = buildTfsUrl(cfg.tfs.baseUrl, wiqlFn(filterPath, iterQ, notRemoved));
      }

      // Attachment-based KPIs: use smart ID approach (always picks smaller set)
      const sets = kpiSets[kpi.id];
      if (sets) {
        const notMetIds = sets.allIds.filter(id => !new Set(sets.metIds).has(id));
        const metWiql    = smartIdWiql(sets.metIds, notMetIds,    sets.wiType, filterPath, iterQ, notRemoved);
        const notMetWiql = smartIdWiql(notMetIds,   sets.metIds,  sets.wiType, filterPath, iterQ, notRemoved);
        if (metWiql)    kpi.tfsUrlMet    = buildTfsUrl(cfg.tfs.baseUrl, metWiql);
        if (notMetWiql) kpi.tfsUrlNotMet = buildTfsUrl(cfg.tfs.baseUrl, notMetWiql);
        kpi.metCount    = sets.metIds.length;
        kpi.notMetCount = notMetIds.length;
      }

      // Tag/state-based KPIs: use WIQL with NOT CONTAINS / state operators (no ID list)
      if (!sets) {
        const metFn    = KPI_MET_WIQL[kpi.id];
        const notMetFn = KPI_NOT_MET_WIQL[kpi.id];
        if (metFn)    kpi.tfsUrlMet    = buildTfsUrl(cfg.tfs.baseUrl, metFn(filterPath, iterQ, notRemoved));
        if (notMetFn) kpi.tfsUrlNotMet = buildTfsUrl(cfg.tfs.baseUrl, notMetFn(filterPath, iterQ, notRemoved));
        if (metFn || notMetFn) {
          kpi.metCount    = kpi.met    ?? null;
          kpi.notMetCount = kpi.total != null && kpi.met != null ? kpi.total - kpi.met : null;
        }
      }
    }

    // ── Sprint values for feature-based KPIs ─────────────────────────────────
    for (const kpi of kpis) {
      if (kpi.isManual || !sprintOrder.length) { kpi.sprintValues = null; continue; }
      const computeSprintVal = ids => {
        const n = ids.size;
        switch (kpi.id) {
          case 'exploratory-coverage': return pct([...mindmapSet].filter(x => ids.has(x)).length, n);
          case 'fmea-coverage':        return pct([...fmeaSet].filter(x => ids.has(x)).length, n);
          case 'checklist-compliance': return pct([...checklistSet].filter(x => ids.has(x)).length, n);
          case 'cross-team-review':    return pct([...crossReviewSet].filter(x => ids.has(x)).length, n);
          case 'impact-assessment':    return pct([...impactSet].filter(x => ids.has(x)).length, n);
          case 'ai-assisted-usage':    return pct([...aiTagIds].filter(x => ids.has(x)).length, n);
          case 'late-changes':         return lateChgIds.filter(x => ids.has(x)).length;
          case 'say-do-ratio':         return pct([...doneFeats].filter(x => ids.has(x)).length, n);
          default: return null;
        }
      };
      const sv = sprintOrder.map(sprint => ({ sprint, value: computeSprintVal(sprintFeatMap[sprint]) }));
      kpi.sprintValues = sv.some(s => s.value != null) ? sv : null;
    }

    // ── Previous PI values from optional config ────────────────────────────────
    const prevPiLabel = prevPIOf(pi);
    const prevVals = cfg.kpi?.previousValues?.[prevPiLabel] || {};
    for (const kpi of kpis) {
      kpi.previousValue = prevVals[kpi.id] != null ? Number(prevVals[kpi.id]) : null;
    }

    // ── Phase 8: Team breakdown from featDetails ──────────────────────────────
    const teamFeatMap  = {};
    const teamAreaPath = {};  // team name → representative TFS area path
    for (const feat of featDetails) {
      const ap   = feat.fields?.['System.AreaPath'] || '';
      const team = extractTeam(ap, cfg.tfs.areaPath);
      if (!team || team === 'Unknown') continue;
      if (!teamFeatMap[team]) teamFeatMap[team] = [];
      teamFeatMap[team].push(feat.id);
      // Store the deepest area path segment matching the team (first occurrence is fine)
      if (!teamAreaPath[team]) {
        const norm  = ap.replace(/\//g, '\\');
        const parts = norm.split('\\').filter(Boolean);
        const idx   = parts.findIndex(p => p === team);
        teamAreaPath[team] = idx >= 0 ? parts.slice(0, idx + 1).join('\\') : norm;
      }
    }

    const teamBreakdown = {};
    for (const [team, ids] of Object.entries(teamFeatMap)) {
      const s  = new Set(ids);
      const n  = ids.length;
      const ap = teamAreaPath[team] || team;
      teamBreakdown[team] = {
        features:    n,
        exploratory: pct([...mindmapSet].filter(x => s.has(x)).length, n),
        fmea:        pct([...fmeaSet].filter(x => s.has(x)).length, n),
        checklist:   pct([...checklistSet].filter(x => s.has(x)).length, n),
        crossReview: pct([...crossReviewSet].filter(x => s.has(x)).length, n),
        impactAssess:pct([...impactSet].filter(x => s.has(x)).length, n),
        aiAssisted:  pct([...aiTagIds].filter(x => s.has(x)).length, n),
        lateChanges: lateChgIds.filter(x => s.has(x)).length,
        done:        [...doneFeats].filter(x => s.has(x)).length,
        // Per-team TFS links: generic (all features) + per bucket
        tfsUrl: buildTfsUrl(cfg.tfs.baseUrl,
          `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${WIT_FEAT}' AND [System.AreaPath] UNDER '${ap}' AND ${iterQ} AND ${notRemoved}`),
        tfsUrls: Object.fromEntries(
          Object.entries(KPI_WIQL_FN)
            .map(([kid, fn]) => [kid, buildTfsUrl(cfg.tfs.baseUrl, fn(ap, iterQ, notRemoved))])
        ),
      };
    }

    // Summary counts
    const summary = { green: 0, amber: 0, red: 0, unknown: 0 };
    for (const kpi of kpis) summary[kpi.rag] = (summary[kpi.rag] || 0) + 1;

    res.json({
      pi,
      computedAt: new Date().toISOString(),
      totalFeatures: totalFeats,
      totalBugs: totalBugs,
      summary,
      kpis,
      teamBreakdown,
      previousPI: prevPiLabel || null,
      previousSummary: cfg.kpi?.previousSummaries?.[prevPiLabel] || null,
    });

  } catch (err) {
    console.error('[/api/kpi]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/kpi/pipeline — Save manual pipeline values for a PI ─────────────
router.post('/kpi/pipeline', async (req, res) => {
  try {
    const { saveConfig } = require('../config');
    const { pi, buildTimeBaseline, buildTimeCurrent, buildStability } = req.body;
    if (!pi) return res.status(400).json({ error: 'pi is required' });

    const cfg = loadConfig(req.deptId);
    if (!cfg.kpi) cfg.kpi = {};
    if (!cfg.kpi.pipeline) cfg.kpi.pipeline = {};
    cfg.kpi.pipeline[pi] = {
      buildTimeBaseline: buildTimeBaseline ?? cfg.kpi.pipeline[pi]?.buildTimeBaseline ?? null,
      buildTimeCurrent:  buildTimeCurrent  ?? cfg.kpi.pipeline[pi]?.buildTimeCurrent  ?? null,
      buildStability:    buildStability    ?? cfg.kpi.pipeline[pi]?.buildStability    ?? null,
    };
    saveConfig(cfg, req.deptId);
    res.json({ ok: true, pipeline: cfg.kpi.pipeline[pi] });
  } catch (err) {
    console.error('[/api/kpi/pipeline]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


