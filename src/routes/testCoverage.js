'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet, tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { getDefaultPIs } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');
const { putCacheEntry, buildCacheKey } = require('../helpers/responseCache');

const router = express.Router();

// Track in-progress background recomputes per cache key
const _recomputing = new Set();

const TC_CACHE_TTL   = 3600;     // 1 hour fresh
const TC_STALE_EXTRA = 3600;     // serve stale for another 1 hour while recomputing

// ─── Core computation (extracted so scheduler can call it too) ────────────────
async function computeTestCoverage(cfg, { piLabels, filterPath, teamPath }) {
  const fm       = getFieldMappings(cfg);
  const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;

  const wiqlUrl  = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const iterPart = piLabels.length
    ? ` AND (${piLabels.map(p => `[System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${p}'`).join(' OR ')})`
    : '';

  const tcType  = fm.workItemTypes.testCase || 'Test Case';
  const autoFld = fm.fields.automationStatusField;

  // Phase 1: 5 parallel WIQL queries on indexed fields only
  const [allTcRes, tcSampleRes, linkRes, featRes, runsRes] = await Promise.allSettled([

    // 1. Total TC count — area path only, NO iterPart (TCs live in sprint paths, not PI paths)
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.WorkItemType] = '${tcType}'
                AND [System.AreaPath] UNDER '${filterPath}'`
    }, cfg.tfs.pat),

    // 2. Top-200 sample for automation breakdown (reduced from 400 for speed)
    tfsPost(`${wiqlUrl}&$top=200`, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.WorkItemType] = '${tcType}'
                AND [System.AreaPath] UNDER '${filterPath}'
              ORDER BY [System.Id]`
    }, cfg.tfs.pat),

    // 3. Feature→TestCase coverage links
    tfsPost(`${wiqlUrl}&$top=500`, {
      query: `SELECT [System.Id] FROM WorkItemLinks
              WHERE ([Source].[System.WorkItemType] = 'Feature'
                AND [Source].[System.AreaPath] UNDER '${filterPath}')
                AND [System.Links.LinkType] = 'Microsoft.VSTS.Common.TestedBy-Forward'
                AND ([Target].[System.WorkItemType] = '${tcType}')
              ORDER BY [System.Id] MODE (MustContain)`
    }, cfg.tfs.pat),

    // 4. Feature IDs in selected PIs
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.WorkItemType] = 'Feature'
                AND [System.AreaPath] UNDER '${filterPath}'
                AND [System.State] <> 'Removed'
                ${iterPart}
              ORDER BY [System.Id]`
    }, cfg.tfs.pat),

    // 5. Recent test runs (last 100)
    tfsGet(
      `${cfg.tfs.baseUrl}/_apis/test/runs?includeRunDetails=true&$top=100&api-version=${cfg.tfs.apiVersion}`,
      cfg.tfs.pat
    ),
  ]);

  const totalTC   = allTcRes.status === 'fulfilled' ? (allTcRes.value.workItems || []).length : 0;
  const sampleIds = tcSampleRes.status === 'fulfilled'
    ? (tcSampleRes.value.workItems || []).map(w => w.id)
    : [];

  const coveredIds = new Set(
    linkRes.status === 'fulfilled'
      ? (linkRes.value.workItemRelations || []).filter(r => r.source && r.target).map(r => r.source.id)
      : []
  );
  const allFeatIds   = featRes.status === 'fulfilled' ? (featRes.value.workItems || []).map(w => w.id) : [];
  const uncoveredIds = allFeatIds.filter(id => !coveredIds.has(id)).slice(0, 50);

  // Phase 2: fetch item details
  const [tcItems, uncoveredItems] = await Promise.all([
    fetchWorkItemDetails(sampleIds, ['System.Id', 'System.AreaPath', autoFld], cfg),
    fetchWorkItemDetails(uncoveredIds, ['System.Id', 'System.Title', 'System.State', 'System.AreaPath'], cfg),
  ]);

  // Automation breakdown from sample
  const byTeam = {};
  let sampleAuto = 0, samplePlanned = 0, sampleNotAuto = 0;

  tcItems.forEach(item => {
    const raw  = item.fields[autoFld] || 'Not Automated';
    const key  = raw === 'Automated' ? 'Automated' : raw === 'Planned' ? 'Planned' : 'Not Automated';
    if (key === 'Automated')    sampleAuto++;
    else if (key === 'Planned') samplePlanned++;
    else                        sampleNotAuto++;

    const team = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
    if (!byTeam[team]) byTeam[team] = { Automated: 0, 'Not Automated': 0, Planned: 0 };
    byTeam[team][key]++;
  });

  const sampleSize = tcItems.length;
  const scale      = sampleSize > 0 && totalTC > sampleSize ? totalTC / sampleSize : 1;
  const isEstimated = totalTC > sampleSize;

  const automationBreakdown = {
    Automated:       Math.round(sampleAuto    * scale),
    Planned:         Math.round(samplePlanned * scale),
    'Not Automated': Math.round(sampleNotAuto * scale),
  };
  const automatedPct = totalTC > 0
    ? Math.round((sampleSize > 0 ? sampleAuto / sampleSize : 0) * 100)
    : 0;

  const coveredCount    = allFeatIds.filter(id => coveredIds.has(id)).length;
  const featureCoverage = {
    total:            allFeatIds.length,
    coveredCount,
    uncoveredCount:   allFeatIds.length - coveredCount,
    coveredPct:       allFeatIds.length > 0 ? Math.round(coveredCount / allFeatIds.length * 100) : 0,
    uncoveredFeatures: uncoveredItems.map(i => ({
      id:    i.id,
      title: i.fields['System.Title'],
      state: i.fields['System.State'],
      team:  extractTeam(i.fields['System.AreaPath'] || '', teamRoot),
    })),
  };

  if (linkRes.status !== 'fulfilled')
    console.warn('[test-coverage] link query failed:', linkRes.reason?.message);

  let testRunsSummary = { runCount: 0, passed: 0, failed: 0, notExecuted: 0, blocked: 0, inProgress: 0, passRate: 0 };
  if (runsRes.status === 'fulfilled') {
    const runs = runsRes.value.value || [];
    let passed = 0, failed = 0, notExecuted = 0, blocked = 0, inProgress = 0;
    runs.forEach(r => {
      passed      += r.passedTests     || 0;
      failed      += r.failedTests     || 0;
      notExecuted += r.incompleteTests || 0;
      blocked     += r.blockedTests    || 0;
      inProgress  += r.inProgressTests || 0;
    });
    const denominator = passed + failed + blocked;
    testRunsSummary = {
      runCount: runs.length,
      passed, failed, notExecuted, blocked, inProgress,
      passRate: denominator > 0 ? Math.round(passed / denominator * 100) : 0,
    };
  }

  return {
    meta: {
      fetchedAt: new Date().toISOString(),
      pis: piLabels,
      totalTestCases: totalTC,
      sampleSize,
      isEstimated,
    },
    automationBreakdown, automatedPct, byTeam,
    featureCoverage, testRunsSummary,
  };
}

// ─── GET /api/test-coverage ───────────────────────────────────────────────────
router.get('/test-coverage', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm  = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) piLabels = getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern);
    else if (typeof piLabels === 'string') piLabels = piLabels.split(',').map(s => s.trim());
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const teamPath   = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const filterPath = teamPath || cfg.tfs.areaPath;
    const params     = { piLabels, filterPath, teamPath };

    // Stale-while-revalidate: if middleware served stale data, recompute in background
    if (res.headersSent || res.locals._cacheStale) {
      if (!res.headersSent) {
        // Should not happen — middleware already returned stale data
        return;
      }
      // Trigger background recompute (deduplicated)
      const cacheKey = res.locals._cacheKey || buildCacheKey(req.deptId || 'default', '/test-coverage',
        Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || '').entries()));
      if (!_recomputing.has(cacheKey)) {
        _recomputing.add(cacheKey);
        setImmediate(async () => {
          try {
            console.log('[test-coverage] background recompute:', cacheKey);
            const data = await computeTestCoverage(cfg, params);
            putCacheEntry(cacheKey, data, TC_CACHE_TTL);
            console.log('[test-coverage] background recompute done:', cacheKey);
          } catch (e) {
            console.warn('[test-coverage] background recompute failed:', e.message);
          } finally {
            _recomputing.delete(cacheKey);
          }
        });
      }
      return;
    }

    const data = await computeTestCoverage(cfg, params);
    if (res.headersSent) return;
    res.json(data);
  } catch (e) {
    console.error('[test-coverage]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.computeTestCoverage = computeTestCoverage; // exported for scheduler


// ─── GET /api/test-coverage ───────────────────────────────────────────────────
// Performance design:
//   Phase 1: 5 parallel WIQL queries on INDEXED fields only (WorkItemType +
//     AreaPath — never AutomationStatus which TFS doesn't index and takes 50s+).
//     - allTcRes: count-only (no $top limit) → exact totalTC
//     - tcSampleRes: top-400 IDs for breakdown sample
//     - linkRes: feature coverage links (capped $top=500)
//     - featRes: feature IDs in selected PIs
//     - runsRes: last 100 test runs
//   Phase 2: fetchWorkItemDetails for ≤400 TCs + ≤50 uncovered features.
//   Automation breakdown is computed from the sample and extrapolated to totalTC.
router.get('/test-coverage', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm  = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) piLabels = getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern);
    else if (typeof piLabels === 'string') piLabels = piLabels.split(',').map(s => s.trim());
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const teamPath   = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const filterPath = teamPath || cfg.tfs.areaPath;
    const teamRoot   = cfg.tfs.teamRootPath || cfg.tfs.areaPath;

    const wiqlUrl  = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const iterPart = piLabels.length
      ? ` AND (${piLabels.map(p => `[System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${p}'`).join(' OR ')})`
      : '';

    const tcType  = fm.workItemTypes.testCase || 'Test Case';
    const autoFld = fm.fields.automationStatusField;

    // ── Phase 1: 5 parallel WIQL queries on indexed fields only ──────────────
    const [allTcRes, tcSampleRes, linkRes, featRes, runsRes] = await Promise.allSettled([

      // 1. Total TC count — unfiltered, just WorkItemType + AreaPath (indexed, fast)
      tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems
                WHERE [System.WorkItemType] = '${tcType}'
                  AND [System.AreaPath] UNDER '${filterPath}'`
      }, cfg.tfs.pat),

      // 2. Top-400 sample for automation breakdown + byTeam (bounded, fast)
      tfsPost(`${wiqlUrl}&$top=400`, {
        query: `SELECT [System.Id] FROM WorkItems
                WHERE [System.WorkItemType] = '${tcType}'
                  AND [System.AreaPath] UNDER '${filterPath}'
                ORDER BY [System.Id]`
      }, cfg.tfs.pat),

      // 3. Feature→TestCase coverage links (capped to avoid slow scan)
      tfsPost(`${wiqlUrl}&$top=500`, {
        query: `SELECT [System.Id] FROM WorkItemLinks
                WHERE ([Source].[System.WorkItemType] = 'Feature'
                  AND [Source].[System.AreaPath] UNDER '${filterPath}')
                  AND [System.Links.LinkType] = 'Microsoft.VSTS.Common.TestedBy-Forward'
                  AND ([Target].[System.WorkItemType] = '${tcType}')
                ORDER BY [System.Id] MODE (MustContain)`
      }, cfg.tfs.pat),

      // 4. Feature IDs in selected PIs
      tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems
                WHERE [System.WorkItemType] = 'Feature'
                  AND [System.AreaPath] UNDER '${filterPath}'
                  AND [System.State] <> 'Removed'
                  ${iterPart}
                ORDER BY [System.Id]`
      }, cfg.tfs.pat),

      // 5. Recent test runs (last 100)
      tfsGet(
        `${cfg.tfs.baseUrl}/_apis/test/runs?includeRunDetails=true&$top=100&api-version=${cfg.tfs.apiVersion}`,
        cfg.tfs.pat
      ),
    ]);

    // Guard: timeout middleware may have already sent 503
    if (res.headersSent) return;

    // ── Phase 1 result extraction ──────────────────────────────────────────────
    const totalTC  = allTcRes.status === 'fulfilled' ? (allTcRes.value.workItems || []).length : 0;
    const sampleIds = tcSampleRes.status === 'fulfilled'
      ? (tcSampleRes.value.workItems || []).map(w => w.id)
      : [];

    const coveredIds = new Set(
      linkRes.status === 'fulfilled'
        ? (linkRes.value.workItemRelations || []).filter(r => r.source && r.target).map(r => r.source.id)
        : []
    );
    const allFeatIds   = featRes.status === 'fulfilled' ? (featRes.value.workItems || []).map(w => w.id) : [];
    const uncoveredIds = allFeatIds.filter(id => !coveredIds.has(id)).slice(0, 50);

    // ── Phase 2: fetch item details — bounded to ≤400 TCs + ≤50 features ──────
    const [tcItems, uncoveredItems] = await Promise.all([
      fetchWorkItemDetails(sampleIds, ['System.Id', 'System.AreaPath', autoFld], cfg),
      fetchWorkItemDetails(uncoveredIds, ['System.Id', 'System.Title', 'System.State', 'System.AreaPath'], cfg),
    ]);

    if (res.headersSent) return;

    // ── Automation breakdown from sample ──────────────────────────────────────
    // AutomationStatus is NOT indexed in TFS — never filter WIQL by it.
    // Instead derive counts from the 400-item sample and scale to totalTC.
    const byTeam = {};
    let sampleAuto = 0, samplePlanned = 0, sampleNotAuto = 0;

    tcItems.forEach(item => {
      const raw  = item.fields[autoFld] || 'Not Automated';
      const key  = raw === 'Automated' ? 'Automated' : raw === 'Planned' ? 'Planned' : 'Not Automated';
      if (key === 'Automated')    sampleAuto++;
      else if (key === 'Planned') samplePlanned++;
      else                        sampleNotAuto++;

      const team = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
      if (!byTeam[team]) byTeam[team] = { Automated: 0, 'Not Automated': 0, Planned: 0 };
      byTeam[team][key]++;
    });

    const sampleSize = tcItems.length;
    // If sample covers all TCs (≤400 total), counts are exact; otherwise extrapolate
    const scale = sampleSize > 0 && totalTC > sampleSize ? totalTC / sampleSize : 1;
    const isEstimated = totalTC > sampleSize;

    const automationBreakdown = {
      Automated:       Math.round(sampleAuto    * scale),
      Planned:         Math.round(samplePlanned * scale),
      'Not Automated': Math.round(sampleNotAuto * scale),
    };
    const automatedPct = totalTC > 0
      ? Math.round((sampleSize > 0 ? sampleAuto / sampleSize : 0) * 100)
      : 0;

    // ── Feature coverage ──────────────────────────────────────────────────────
    const coveredCount    = allFeatIds.filter(id => coveredIds.has(id)).length;
    const featureCoverage = {
      total:            allFeatIds.length,
      coveredCount,
      uncoveredCount:   allFeatIds.length - coveredCount,
      coveredPct:       allFeatIds.length > 0 ? Math.round(coveredCount / allFeatIds.length * 100) : 0,
      uncoveredFeatures: uncoveredItems.map(i => ({
        id:    i.id,
        title: i.fields['System.Title'],
        state: i.fields['System.State'],
        team:  extractTeam(i.fields['System.AreaPath'] || '', teamRoot),
      })),
    };

    if (linkRes.status !== 'fulfilled')
      console.warn('[test-coverage] link query failed:', linkRes.reason?.message);

    // ── Test runs summary ─────────────────────────────────────────────────────
    let testRunsSummary = { runCount: 0, passed: 0, failed: 0, notExecuted: 0, blocked: 0, inProgress: 0, passRate: 0 };
    if (runsRes.status === 'fulfilled') {
      const runs = runsRes.value.value || [];
      let passed = 0, failed = 0, notExecuted = 0, blocked = 0, inProgress = 0;
      runs.forEach(r => {
        passed      += r.passedTests     || 0;
        failed      += r.failedTests     || 0;
        notExecuted += r.incompleteTests || 0;
        blocked     += r.blockedTests    || 0;
        inProgress  += r.inProgressTests || 0;
      });
      const denominator = passed + failed + blocked;
      testRunsSummary = {
        runCount: runs.length,
        passed, failed, notExecuted, blocked, inProgress,
        passRate: denominator > 0 ? Math.round(passed / denominator * 100) : 0,
      };
    } else {
      console.warn('[test-coverage] test runs API failed:', runsRes.reason?.message);
    }

    if (res.headersSent) return;

    res.json({
      meta: {
        fetchedAt: new Date().toISOString(),
        pis: piLabels,
        totalTestCases: totalTC,
        sampleSize,
        isEstimated,           // true when byTeam/breakdown are extrapolated from top-400 sample
      },
      automationBreakdown, automatedPct, byTeam,
      featureCoverage, testRunsSummary,
    });
  } catch (e) {
    console.error('[test-coverage]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
