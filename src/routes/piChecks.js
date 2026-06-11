'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet, tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { processFeatures, processDefects } = require('../helpers/dataProcessors');
const { getCurrentPIInfo, getDefaultPIs, getPILabel } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ─── GET /api/pi-checks ───────────────────────────────────────────────────────
// Fetches the named [PI] saved queries from TFS, runs each one, and returns
// count + top items + direct TFS link per check.
const PI_CHECK_NAMES = [
  '[PI] Features Done with Child Features NOT Done',
  '[PI] Features NOT Done with Epics Done',
  '[PI] Features Done with Child Stories NOT Done',
  '[PI] Features Done without Effort',
  '[PI] Features with bl tag and Approved',
  '[PI] Features without bl tag and NOT Approved',
  '[PI] NOT Approved Objectives',
  '[PI] Objectives after 26-PI1 are still Feature WorkItems',
  '[PI] Planned Features NOT Linked to Objectives',
  '[PI] Planned Features Unassigned',
  '[PI] Planned Features with unplanned or Deferred Iteration stories',
  '[PI] Planned Features with unplanned or Deferred Iteration stories_test',
  '[PI] Planned Features without Effort',
  '[PI] Planned Features without Release Field',
  '[PI] Planned Features without Sprint',
  '[PI] Stories without Effort',
  '[PI] Stories without Release Field'
];

// Known TFS folder path for the PI readiness queries
const PI_CHECKS_FOLDER =
  'Shared Queries/ICAP/Program Queries/TFSInconsistenciesQueryRepository';

router.get('/pi-checks', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const teamPath = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;

    // Resolve selected PIs (same pattern as /api/dashboard)
    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) piLabels = [];
    else if (typeof piLabels === 'string') piLabels = piLabels.split(',').map(s => s.trim());
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const iterBase = cfg.tfs.iterationPath; // e.g. "Healthcare IT\\ISP"

    // Use the configured override path or the known default
    const folderPath = cfg.piChecksQueryFolder || PI_CHECKS_FOLDER;
    const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
    const folderUrl = `${cfg.tfs.baseUrl}/_apis/wit/queries/${encodedPath}?$depth=2&$expand=all&api-version=${cfg.tfs.apiVersion}`;

    const queryMap = {};
    function flattenQueries(node) {
      if (!node) return;
      if (node.queryType && node.wiql && node.id) {
        queryMap[node.name] = { id: node.id, wiql: node.wiql };
        const stripped = node.name.replace(/^\[PI\]\s*/, '');
        if (stripped !== node.name) queryMap[stripped] = { id: node.id, wiql: node.wiql };
      }
      (node.children || []).forEach(flattenQueries);
    }

    try {
      flattenQueries(await tfsGet(folderUrl, cfg.tfs.pat));
    } catch (e) {
      const msg = e.message || '';
      console.warn('[pi-checks] folder fetch failed:', msg.slice(0, 100));
      // Circuit open means TFS is temporarily unavailable — return 503 so result is NOT cached
      if (msg.includes('Circuit open') || msg.includes('temporarily unavailable')) {
        return res.status(503).json({ error: 'TFS temporarily unavailable — circuit breaker open. Try again in 60s or reset via Admin → Observability → Full Reset.' });
      }
    }

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const detailFields = [
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', 'System.WorkItemType'
    ];

    // Normalise team path for prefix matching
    const teamPathNorm = teamPath ? teamPath.replace(/\//g, '\\').toLowerCase() : null;

    function matchesTeam(areaPath) {
      if (!teamPathNorm) return true;
      const norm = (areaPath || '').replace(/\//g, '\\').toLowerCase();
      return norm === teamPathNorm || norm.startsWith(teamPathNorm + '\\');
    }

    // PI filter: item's IterationPath must be UNDER one of the selected PI roots
    function matchesPI(iterPath) {
      if (!piLabels.length || !iterBase) return true;
      const norm = (iterPath || '').replace(/\//g, '\\').toLowerCase();
      return piLabels.some(pi => {
        const prefix = `${iterBase}\\${pi}`.toLowerCase();
        return norm === prefix || norm.startsWith(prefix + '\\');
      });
    }

    const checks = await Promise.all(PI_CHECK_NAMES.map(async name => {
      const found = queryMap[name] || queryMap[name.replace(/^\[PI\]\s*/, '')];
      if (!found) {
        return { name, count: null, queryId: null, queryUrl: null, items: [], error: 'Query not found in TFS folder' };
      }

      const queryUrl = `${cfg.tfs.baseUrl}/_queries/query/${found.id}`;
      try {
        const result = await tfsPost(wiqlUrl, { query: found.wiql }, cfg.tfs.pat);
        const allIds = result.workItems
          ? result.workItems.map(w => w.id)
          : [...new Set(
              (result.workItemRelations || [])
                .filter(r => r.target?.id)
                .map(r => r.target.id)
            )];

        if (!allIds.length) {
          return { name, count: 0, queryId: found.id, queryUrl, wiql: found.wiql, items: [], error: null };
        }

        // Fetch all items when any filter is active for accurate counts; else cap at 200
        const needsFilter = !!(teamPathNorm || piLabels.length);
        const fetchIds = needsFilter ? allIds : allIds.slice(0, 200);
        const details  = await fetchWorkItemDetails(fetchIds, detailFields, cfg);

        const filtered = details.filter(i =>
          matchesTeam(i.fields['System.AreaPath']    || '') &&
          matchesPI(i.fields['System.IterationPath'] || '')
        );

        // Count: if filters applied use filtered length, otherwise use raw TFS count
        const count = needsFilter ? filtered.length : allIds.length;
        const items = filtered.slice(0, 50).map(i => ({
          id:         i.id,
          title:      i.fields['System.Title'],
          state:      i.fields['System.State'],
          area:       i.fields['System.AreaPath'],
          iter:       i.fields['System.IterationPath'],
          assignedTo: i.fields['System.AssignedTo']
            ? (i.fields['System.AssignedTo'].displayName || i.fields['System.AssignedTo'])
            : null,
          type:       i.fields['System.WorkItemType']
        }));

        return { name, count, queryId: found.id, queryUrl, wiql: found.wiql, items, error: null };
      } catch (e) {
        return { name, count: null, queryId: found.id, queryUrl, wiql: null, items: [], error: e.message.slice(0, 120) };
      }
    }));

    res.json({ checks, teamPath: teamPath || null, pis: piLabels, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('[pi-checks]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/pi-comparison ───────────────────────────────────────────────────
// Returns per-PI summary metrics for comparison charts.
// Query: pis[]= (defaults to all completed PIs of current year)
router.get('/pi-comparison', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const teamPath = req.query.teamPath || null;
    const filterPath = teamPath || cfg.tfs.areaPath;

    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) {
      const fm = getFieldMappings(cfg);
      piLabels = getDefaultPIs(fm.piStructure.pisPerYear);
      const { yy, pi } = getCurrentPIInfo();
      const cur = getPILabel(yy, pi);
      if (!piLabels.includes(cur)) piLabels.push(cur);
    } else if (typeof piLabels === 'string') {
      piLabels = piLabels.split(',').map(s => s.trim());
    }
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const warnings = [];
    let shouldNoStore = false;

    const results = await Promise.all(piLabels.map(async pi => {
      const fm = getFieldMappings(cfg);
      // Build WIQL with filterPath instead of hardcoded areaPath
      const featWIQL = await tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems
          WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
            AND [System.AreaPath] UNDER '${filterPath}'
            AND [System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${pi}'
          ORDER BY [System.Id]`
      }, cfg.tfs.pat);
      const defWIQL = await tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems
          WHERE [System.WorkItemType] = '${fm.workItemTypes.defect}'
            AND [System.AreaPath] UNDER '${filterPath}'
            AND [System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${pi}'
          ORDER BY [System.Id]`
      }, cfg.tfs.pat);

      const featIds = (featWIQL.workItems || []).map(w => w.id);
      const defIds  = (defWIQL.workItems  || []).map(w => w.id);

      const minFields = ['System.Id', 'System.State', 'System.AreaPath'];
      const [featItemsSettled, defItemsSettled] = await Promise.allSettled([
        featIds.length ? fetchWorkItemDetails(featIds, minFields, cfg) : Promise.resolve([]),
        defIds.length ? fetchWorkItemDetails(defIds,  minFields, cfg) : Promise.resolve([])
      ]);
      const featItems = featItemsSettled.status === 'fulfilled' ? featItemsSettled.value : [];
      const defItems = defItemsSettled.status === 'fulfilled' ? defItemsSettled.value : [];
      if (featItemsSettled.status !== 'fulfilled') {
        const message = `[pi-comparison] ${pi} feature details fetch failed: ${featItemsSettled.reason?.message || 'Unknown error'}`;
        warnings.push(message);
        console.warn(message);
      }
      if (defItemsSettled.status !== 'fulfilled') {
        const message = `[pi-comparison] ${pi} defect details fetch failed: ${defItemsSettled.reason?.message || 'Unknown error'}`;
        warnings.push(message);
        console.warn(message);
      }
      if (featItemsSettled.status !== 'fulfilled' && defItemsSettled.status !== 'fulfilled') shouldNoStore = true;

      const features = processFeatures(featItems, teamRoot);
      const defects  = processDefects(defItems,  teamRoot, cfg.defectEscapeRatio);

      const density = features.total > 0
        ? Math.round((defects.total / features.total) * 10) / 10
        : 0;

      const healthScore = Math.round(
        0.4 * features.doneRate +
        0.3 * defects.resolveRate +
        0.3 * Math.max(0, 100 - defects.escapeRatio)
      );

      return {
        pi,
        featureTotal:   features.total,
        featureDone:    features.stateCounts['Done'] || 0,
        doneRate:       features.doneRate,
        defectTotal:    defects.total,
        defectResolved: defects.stateCounts['Resolved'] || 0,
        resolveRate:    defects.resolveRate,
        escapeRatio:    defects.escapeRatio,
        defectDensity:  density,
        healthScore
      };
    }));

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({ comparison: results, ...(warnings.length ? { _warnings: warnings } : {}) });
  } catch (e) {
    console.error('[pi-comparison]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/pi-list ─────────────────────────────────────────────────────────
router.get('/pi-list', (req, res) => {
  const cfg = loadConfig(req.deptId);
  const fm  = getFieldMappings(cfg);
  const pisPerYear = fm.piStructure.pisPerYear || 4;
  const piPattern  = fm.piStructure.piNamingPattern; // e.g. '{yy}-PI{n}' or 'PI{yy}.{n}'
  const { yy, pi: currentPI } = getCurrentPIInfo();

  // All years from programme start through current year
  const startFull = cfg.app?.programmeStartYear ?? 2024;
  const startYY   = startFull % 100; // two-digit
  const years = [];
  for (let y = startYY; y <= yy; y++) years.push(y);

  const list = [];
  for (const y of years) {
    for (let p = 1; p <= pisPerYear; p++) {
      const label = getPILabel(y, p, piPattern);
      const isCurrent = y === yy && p === currentPI;
      const isPast    = y < yy || (y === yy && p < currentPI);
      list.push({ label, yy: y, pi: p, isCurrent, isPast });
    }
  }
  res.json({
    list,
    years,
    defaultPIs:  getDefaultPIs(pisPerYear, piPattern),
    currentPI:   getPILabel(yy, currentPI, piPattern),
    piPattern,
    sprintLabels: fm.piStructure.sprintLabels,
    programmeStartYear: startFull,
  });
});

module.exports = router;
