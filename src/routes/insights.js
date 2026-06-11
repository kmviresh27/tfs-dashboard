'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { FEATURE_STATES, extractTeam, processFeatures, processDefects } = require('../helpers/dataProcessors');
const { getDefaultPIs, getPILabel, parsePILabel, getCurrentPIInfo, buildSprintIterPath, matchSprintSuffix } = require('../helpers/piHelpers');

const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();
const CLOSED_DEFECT_STATES = ['Resolved', 'Closed', 'Removed'];

function normalizePILabels(query, cfg) {
  const fm = cfg ? getFieldMappings(cfg) : null;
  const pisPerYear = fm?.piStructure?.pisPerYear || 4;
  const piPattern  = fm?.piStructure?.piNamingPattern;
  let piLabels = query['pis[]'] || query.pis;
  if (!piLabels) {
    piLabels = getDefaultPIs(pisPerYear, piPattern);
    if (!piLabels.length) {
      const { yy, pi } = getCurrentPIInfo();
      piLabels = [getPILabel(yy, pi, piPattern)];
    }
  } else if (typeof piLabels === 'string') {
    piLabels = piLabels.split(',').map(s => s.trim());
  }
  if (!Array.isArray(piLabels)) piLabels = [piLabels];
  return sortPIs(piLabels.filter(Boolean));
}

function parsePI(piLabel, pattern) {
  return parsePILabel(piLabel, pattern);
}

function sortPIs(piLabels) {
  return [...new Set(piLabels)].sort((a, b) => {
    const left  = parsePILabel(a);
    const right = parsePILabel(b);
    if (!left || !right) return String(a).localeCompare(String(b));
    if (left.yy !== right.yy) return left.yy - right.yy;
    return left.pi - right.pi;
  });
}

function previousPI(piLabel, pattern, pisPerYear = 4) {
  const parsed = parsePILabel(piLabel, pattern);
  if (!parsed) return null;
  return parsed.pi > 1
    ? getPILabel(parsed.yy, parsed.pi - 1, pattern)
    : getPILabel(parsed.yy - 1, pisPerYear, pattern);
}

function extractPIFromIteration(iterPath, pattern) {
  // Try to extract a PI segment from the iteration path by testing each segment
  const segments = String(iterPath || '').replace(/\//g, '\\').split('\\');
  const pat = pattern || '{yy}-PI{n}';
  for (const seg of segments) {
    if (parsePILabel(seg, pat)) return seg;
  }
  // Fallback: legacy hardcoded pattern
  const match = String(iterPath || '').replace(/\//g, '\\').match(/(\d{2}-PI\d)/);
  return match ? match[1] : '';
}

function buildFeatureFields(cfg) {
  const fm = getFieldMappings(cfg);
  const sizeField = fm.fields.effortField;
  return [
    'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
    'System.IterationPath', 'System.AssignedTo', 'System.CreatedDate', 'System.ChangedDate',
    fm.fields.stateChangeDateField,
    sizeField
  ];
}

function buildDefectFields(cfg) {
  const df = cfg.defectFields || {};
  const sizeField = cfg.sizeField || 'Microsoft.VSTS.Scheduling.Effort';
  return [
    'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
    'System.IterationPath', 'System.AssignedTo',
    'System.CreatedDate', 'System.ChangedDate', 'System.Tags',
    df.howFoundField, df.whereFoundField,
    df.severityField || 'Microsoft.VSTS.Common.Severity',
    df.rankField,
    'Microsoft.VSTS.Build.FoundIn',
    sizeField
  ].filter(Boolean);
}

function buildMultiPIClause(iterBase, piLabels) {
  if (!piLabels.length) return '';
  const clauses = piLabels.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`);
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

async function fetchFeatureItemsForPIs(cfg, piLabels, filterPath) {
  if (!piLabels.length) return [];
  const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const iterClause = buildMultiPIClause(cfg.tfs.iterationPath, piLabels);
  const result = await tfsPost(wiqlUrl, {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Feature'
        AND [System.AreaPath] UNDER '${filterPath}'
        AND ${iterClause}
      ORDER BY [System.Id]`
  }, cfg.tfs.pat);
  const ids = (result.workItems || []).map(w => w.id);
  return ids.length ? fetchWorkItemDetails(ids, buildFeatureFields(cfg), cfg) : [];
}

async function fetchDefectItemsForPIs(cfg, piLabels, filterPath) {
  if (!piLabels.length) return [];
  const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const iterClause = buildMultiPIClause(cfg.tfs.iterationPath, piLabels);
  const result = await tfsPost(wiqlUrl, {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Defect'
        AND [System.AreaPath] UNDER '${filterPath}'
        AND ${iterClause}
      ORDER BY [System.Id]`
  }, cfg.tfs.pat);
  const ids = (result.workItems || []).map(w => w.id);
  return ids.length ? fetchWorkItemDetails(ids, buildDefectFields(cfg), cfg) : [];
}

function openDefectCount(defectSummary) {
  return Object.entries(defectSummary?.stateCounts || {})
    .filter(([state]) => !CLOSED_DEFECT_STATES.includes(state))
    .reduce((sum, [, count]) => sum + count, 0);
}

function formatDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function getDeliveryStatus(doneRate) {
  if (doneRate >= 75) return 'Green';
  if (doneRate >= 50) return 'Amber';
  return 'Red';
}

function formatProgrammeLabel(piLabels) {
  if (!piLabels.length) return 'Selected';
  if (piLabels.length === 1) return piLabels[0];
  return `${piLabels[0]}–${piLabels[piLabels.length - 1]}`;
}

function compareMetric(currentValue, previousValue, higherIsBetter) {
  if (currentValue == null || previousValue == null) return null;
  if (currentValue === previousValue) return 'held steady';
  const better = higherIsBetter ? currentValue > previousValue : currentValue < previousValue;
  const verb = better ? 'improved' : 'declined';
  return `${verb} from ${previousValue} to ${currentValue}`;
}

function safeRound(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

async function fetchPerPIFeatureItems(cfg, piLabels, filterPath) {
  const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const fields = buildFeatureFields(cfg);
  const warnings = [];
  const entriesSettled = await Promise.allSettled(piLabels.map(async piLabel => {
    const result = await tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] = 'Feature'
          AND [System.AreaPath] UNDER '${filterPath}'
          AND [System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${piLabel}'
        ORDER BY [System.Id]`
    }, cfg.tfs.pat);
    const ids = (result.workItems || []).map(w => w.id);
    const items = ids.length ? await fetchWorkItemDetails(ids, fields, cfg) : [];
    return [piLabel, items];
  }));
  const allFailed = entriesSettled.length > 0 && entriesSettled.every(entry => entry.status !== 'fulfilled');
  const entries = entriesSettled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    const message = `[insights/flow] ${piLabels[index]} feature fetch failed: ${entry.reason?.message || 'Unknown error'}`;
    warnings.push(message);
    console.warn(message);
    return [piLabels[index], []];
  });
  return { itemsByPI: Object.fromEntries(entries), warnings, allFailed };
}

router.get('/flow', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const fm = getFieldMappings(cfg);
    const sprintLabels = fm.piStructure.sprintLabels;
    const piLabels = normalizePILabels(req.query, cfg);
    const filterPath = req.query.teamPath || cfg.tfs.areaPath;
    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const { itemsByPI, warnings, allFailed } = await fetchPerPIFeatureItems(cfg, piLabels, filterPath);

    const piFlow = [];
    const sprintThroughput = [];
    const cycleTimes = [];

    for (const piLabel of piLabels) {
      const items = itemsByPI[piLabel] || [];
      const featureSummary = processFeatures(items, teamRoot);
      piFlow.push({
        pi: piLabel,
        stateCounts: FEATURE_STATES.reduce((acc, state) => {
          acc[state] = featureSummary.stateCounts?.[state] || 0;
          return acc;
        }, {}),
        total: featureSummary.total || 0
      });

      for (const sprintLabel of sprintLabels) {
        const sprintIter = buildSprintIterPath(cfg.tfs.iterationPath, piLabel, sprintLabel, fm.piStructure.sprintSubpathPattern);
        const done = items.filter(item => {
          const state = item.fields['System.State'];
          const iter = String(item.fields['System.IterationPath'] || '').replace(/\//g, '\\');
          return state === 'Done' && (iter.startsWith(sprintIter) || matchSprintSuffix(iter, piLabel, [sprintLabel]));
        }).length;
        sprintThroughput.push({ label: sprintLabel, pi: piLabel, sprint: sprintLabel, done });
      }

      items.forEach(item => {
        const state = item.fields['System.State'];
        const createdDate = item.fields['System.CreatedDate'];
        const stateChangeDate = item.fields[fm.fields.stateChangeDateField];
        if (state !== 'Done' || !createdDate || !stateChangeDate) return;
        const days = Math.max(0, Math.floor((new Date(stateChangeDate) - new Date(createdDate)) / 86400000));
        cycleTimes.push({
          id: item.id,
          title: item.fields['System.Title'] || `Feature ${item.id}`,
          team: extractTeam(item.fields['System.AreaPath'] || '', teamRoot),
          days,
          completedDate: formatDateOnly(stateChangeDate),
          pi: piLabel
        });
      });
    }

    cycleTimes.sort((a, b) => new Date(a.completedDate || 0) - new Date(b.completedDate || 0));

    if (allFailed) res.set('Cache-Control', 'no-store');
    res.json({ piFlow, sprintThroughput, cycleTimes, ...(warnings.length ? { _warnings: warnings } : {}) });
  } catch (e) {
    console.error('[insights/flow]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const fm = getFieldMappings(cfg);
    const sprintLabels = fm.piStructure.sprintLabels;
    const filterPath = req.query.teamPath || cfg.tfs.areaPath;
    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const warnings = [];
    let shouldNoStore = false;

    const piLabels = normalizePILabels(req.query, cfg);

    const [featureItemsSettled, defectItemsSettled] = await Promise.allSettled([
      fetchFeatureItemsForPIs(cfg, piLabels, filterPath),
      fetchDefectItemsForPIs(cfg, piLabels, filterPath)
    ]);
    const featureItems = featureItemsSettled.status === 'fulfilled' ? featureItemsSettled.value : [];
    const defectItems = defectItemsSettled.status === 'fulfilled' ? defectItemsSettled.value : [];
    if (featureItemsSettled.status !== 'fulfilled') {
      const message = `[insights/summary] features fetch failed: ${featureItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (defectItemsSettled.status !== 'fulfilled') {
      const message = `[insights/summary] defects fetch failed: ${defectItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (featureItemsSettled.status !== 'fulfilled' && defectItemsSettled.status !== 'fulfilled') shouldNoStore = true;

    const features = processFeatures(featureItems, teamRoot);
    const defects = processDefects(defectItems, teamRoot, cfg.defectEscapeRatio, cfg.defectFields || {});
    const sortedPIs = sortPIs(piLabels);
    const latestPI = sortedPIs[sortedPIs.length - 1] || null;
    const previousSelectedPI = sortedPIs.length > 1 ? sortedPIs[sortedPIs.length - 2] : previousPI(latestPI);

    const latestFeatureItems = latestPI
      ? featureItems.filter(item => extractPIFromIteration(item.fields['System.IterationPath']) === latestPI)
      : featureItems;
    const latestDefectItems = latestPI
      ? defectItems.filter(item => extractPIFromIteration(item.fields['System.IterationPath']) === latestPI)
      : defectItems;

    const latestFeatures = processFeatures(latestFeatureItems, teamRoot);
    const latestDefects = processDefects(latestDefectItems, teamRoot, cfg.defectEscapeRatio, cfg.defectFields || {});

    let previousFeatures = null;
    let previousDefects = null;
    if (previousSelectedPI) {
      if (sortedPIs.includes(previousSelectedPI)) {
        previousFeatures = processFeatures(
          featureItems.filter(item => extractPIFromIteration(item.fields['System.IterationPath']) === previousSelectedPI),
          teamRoot
        );
        previousDefects = processDefects(
          defectItems.filter(item => extractPIFromIteration(item.fields['System.IterationPath']) === previousSelectedPI),
          teamRoot,
          cfg.defectEscapeRatio,
          cfg.defectFields || {}
        );
      } else {
        const [prevFeatureItemsSettled, prevDefectItemsSettled] = await Promise.allSettled([
          fetchFeatureItemsForPIs(cfg, [previousSelectedPI], filterPath),
          fetchDefectItemsForPIs(cfg, [previousSelectedPI], filterPath)
        ]);
        const prevFeatureItems = prevFeatureItemsSettled.status === 'fulfilled' ? prevFeatureItemsSettled.value : [];
        const prevDefectItems = prevDefectItemsSettled.status === 'fulfilled' ? prevDefectItemsSettled.value : [];
        if (prevFeatureItemsSettled.status !== 'fulfilled') {
          const message = `[insights/summary] ${previousSelectedPI} features fetch failed: ${prevFeatureItemsSettled.reason?.message || 'Unknown error'}`;
          warnings.push(message);
          console.warn(message);
        }
        if (prevDefectItemsSettled.status !== 'fulfilled') {
          const message = `[insights/summary] ${previousSelectedPI} defects fetch failed: ${prevDefectItemsSettled.reason?.message || 'Unknown error'}`;
          warnings.push(message);
          console.warn(message);
        }
        if (prevFeatureItemsSettled.status !== 'fulfilled' && prevDefectItemsSettled.status !== 'fulfilled') shouldNoStore = true;
        previousFeatures = processFeatures(prevFeatureItems, teamRoot);
        previousDefects = processDefects(prevDefectItems, teamRoot, cfg.defectEscapeRatio, cfg.defectFields || {});
      }
    }

    const topTeamEntry = Object.entries(features.teamBreakdown || {})
      .sort(([, left], [, right]) => ((right.Done || 0) - (left.Done || 0)) || ((right.Approved || 0) + (right.Activated || 0)) - ((left.Approved || 0) + (left.Activated || 0)))[0];
    const topTeam = topTeamEntry
      ? `Team ${topTeamEntry[0]} leads with ${topTeamEntry[1].Done || 0} features Done and ${(topTeamEntry[1].Approved || 0) + (topTeamEntry[1].Activated || 0)} in progress.`
      : 'No team delivery signal available for the selected PIs.';

    const latestOpenDefects = openDefectCount(latestDefects);
    const previousOpenDefects = previousDefects ? openDefectCount(previousDefects) : null;
    let defectTrend = `Open defects currently stand at ${latestOpenDefects}.`;
    if (previousSelectedPI && previousOpenDefects != null) {
      if (latestOpenDefects < previousOpenDefects) {
        defectTrend = `Open defects dropped from ${previousOpenDefects} in ${previousSelectedPI} to ${latestOpenDefects} in ${latestPI}.`;
      } else if (latestOpenDefects > previousOpenDefects) {
        defectTrend = `Open defects rose from ${previousOpenDefects} in ${previousSelectedPI} to ${latestOpenDefects} in ${latestPI}.`;
      } else {
        defectTrend = `Open defects held steady at ${latestOpenDefects} versus ${previousSelectedPI}.`;
      }
    }

    const latestVelocity = safeRound((latestFeatures.stateCounts?.Done || 0) / sprintLabels.length, 1);
    const previousVelocity = previousFeatures ? safeRound((previousFeatures.stateCounts?.Done || 0) / sprintLabels.length, 1) : null;
    let velocityInsight = `Average throughput is ${latestVelocity || 0} features per sprint.`;
    const velocityCompare = compareMetric(latestVelocity, previousVelocity, true);
    if (previousSelectedPI && velocityCompare) {
      velocityInsight = `Velocity ${velocityCompare} versus ${previousSelectedPI} (${latestVelocity || 0} features/sprint in ${latestPI}).`;
    }

    const agingBuckets = features.featureAge?.buckets || {};
    const highAgingCount = (agingBuckets['31-60d'] || 0) + (agingBuckets['60+d'] || 0);
    const slippedCount = features.slippedFeatures?.count || 0;
    const status = getDeliveryStatus(features.doneRate || 0);

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({
      narrative: {
        headline: `${formatProgrammeLabel(sortedPIs)} programme: ${features.doneRate || 0}% delivery rate — ${status} status`,
        bullets: [topTeam, defectTrend, velocityInsight],
        risks: [
          slippedCount > 0 ? `${slippedCount} features slipped from earlier PI scope.` : 'No slipped features detected in the selected PI set.',
          highAgingCount > 0 ? `${highAgingCount} active features have aged beyond 30 days.` : 'No active features are aged beyond 30 days.',
          defects.p1p2Count > 0 ? `${defects.p1p2Count} P1/P2 defects remain open.` : 'No open P1/P2 defects were found.'
        ],
        generated: new Date().toISOString()
      },
      ...(warnings.length ? { _warnings: warnings } : {}),
    });
  } catch (e) {
    console.error('[insights/summary]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
