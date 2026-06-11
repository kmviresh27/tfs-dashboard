'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { processFeatures, processDefects } = require('../helpers/dataProcessors');
const { wiqlFeatures, wiqlDefects } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');
const { getSnapshotsDir, ensureSnapshotsDir, listSnapshotFiles, readSnapshot, fetchTCSummary,
  fetchObjectivesSnapshot, fetchRisksSnapshot, fetchReleaseHealthSnapshot, fetchStoryMetricsSnapshot,
  fetchVelocitySnapshot, fetchPIChecksSnapshot, fetchDependenciesSnapshot
} = require('../helpers/snapshots');

const router = express.Router();

// ─── POST /api/snapshot ───────────────────────────────────────────────────────
// Capture full dashboard data (features + defects + meta) for selected PIs.
router.post('/snapshot', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const { pis, label = 'Plan Final - Approved', isRevision = false, parentId = null } = req.body;
    if (!pis || !pis.length) return res.status(400).json({ error: 'pis[] is required' });
    const piLabels = Array.isArray(pis) ? pis : [pis];

    // Reuse the same query logic as /api/dashboard
    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const fm = getFieldMappings(cfg);
    const df = cfg.defectFields || {};
    const sizeField = fm.fields.effortField || cfg.sizeField || 'Microsoft.VSTS.Scheduling.Effort';
    const teamRoot  = cfg.tfs.teamRootPath || cfg.tfs.areaPath;

    const defExtraFields = [
      df.howFoundField, df.whereFoundField,
      df.severityField || 'Microsoft.VSTS.Common.Severity',
      df.rankField,
      sizeField, 'Microsoft.VSTS.Build.FoundIn'
    ].filter(Boolean);
    const featFields = [
      'System.Id','System.Title','System.State','System.AreaPath',
      'System.IterationPath','System.AssignedTo','System.CreatedDate','System.ChangedDate',
      'System.Tags', fm.fields.stateChangeDateField, sizeField
    ];
    const defFields = [
      'System.Id','System.Title','System.State','System.AreaPath',
      'System.IterationPath','System.AssignedTo', fm.fields.rankField,
      'System.CreatedDate','System.ChangedDate','System.Tags',
      ...defExtraFields
    ].filter(Boolean);

    // Fire all supplementary captures in parallel — no extra latency on critical path
    const tcSummaryPromise = fetchTCSummary(cfg, piLabels, cfg.tfs.areaPath).catch(e => {
      console.warn('[snapshot] TC capture failed:', e.message);
      return null;
    });
    const objectivesPromise = fetchObjectivesSnapshot(cfg, piLabels).catch(e => {
      console.warn('[snapshot] Objectives capture failed:', e.message);
      return null;
    });
    const risksPromise = fetchRisksSnapshot(cfg, piLabels).catch(e => {
      console.warn('[snapshot] Risks capture failed:', e.message);
      return null;
    });
    const releaseHealthPromise = fetchReleaseHealthSnapshot(cfg, piLabels).catch(e => {
      console.warn('[snapshot] Release health capture failed:', e.message);
      return null;
    });
    const storyMetricsPromise = fetchStoryMetricsSnapshot(cfg, piLabels).catch(e => {
      console.warn('[snapshot] Story metrics capture failed:', e.message);
      return null;
    });
    const velocityPromise = fetchVelocitySnapshot(cfg, piLabels).catch(e => {
      console.warn('[snapshot] Velocity capture failed:', e.message);
      return null;
    });
    const piChecksPromise = fetchPIChecksSnapshot(cfg, piLabels).catch(e => {
      console.warn('[snapshot] PI checks capture failed:', e.message);
      return null;
    });
    const dependenciesPromise = fetchDependenciesSnapshot(cfg, piLabels).catch(e => {
      console.warn('[snapshot] Dependencies capture failed:', e.message);
      return null;
    });

    const warnings = [];
    let shouldNoStore = false;

    const [featWIQLSettled, defWIQLSettled] = await Promise.allSettled([
      tfsPost(wiqlUrl, wiqlFeatures(cfg, piLabels), cfg.tfs.pat),
      tfsPost(wiqlUrl, wiqlDefects(cfg, piLabels),  cfg.tfs.pat)
    ]);
    const featWIQL = featWIQLSettled.status === 'fulfilled' ? featWIQLSettled.value : { workItems: [] };
    const defWIQL = defWIQLSettled.status === 'fulfilled' ? defWIQLSettled.value : { workItems: [] };
    if (featWIQLSettled.status !== 'fulfilled') {
      const message = `[snapshot] features fetch failed: ${featWIQLSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (defWIQLSettled.status !== 'fulfilled') {
      const message = `[snapshot] defects fetch failed: ${defWIQLSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (featWIQLSettled.status !== 'fulfilled' && defWIQLSettled.status !== 'fulfilled') shouldNoStore = true;
    const featIds = (featWIQL.workItems || []).map(w => w.id);
    const defIds  = (defWIQL.workItems  || []).map(w => w.id);

    const [featItemsSettled, defItemsSettled] = await Promise.allSettled([
      featIds.length ? fetchWorkItemDetails(featIds, featFields, cfg) : Promise.resolve([]),
      defIds.length ? fetchWorkItemDetails(defIds,  defFields,  cfg) : Promise.resolve([])
    ]);
    const featItems = featItemsSettled.status === 'fulfilled' ? featItemsSettled.value : [];
    const defItems = defItemsSettled.status === 'fulfilled' ? defItemsSettled.value : [];
    if (featItemsSettled.status !== 'fulfilled') {
      const message = `[snapshot] feature details fetch failed: ${featItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (defItemsSettled.status !== 'fulfilled') {
      const message = `[snapshot] defect details fetch failed: ${defItemsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (featItemsSettled.status !== 'fulfilled' && defItemsSettled.status !== 'fulfilled') shouldNoStore = true;

    const features = processFeatures(featItems, teamRoot);
    const defects  = processDefects(defItems, teamRoot, cfg.defectEscapeRatio, df);

    // Classify Planned vs Stretch via System.Tags ("Stretch" tag = Stretch, else Planned)
    // Removed-state features are stored but excluded from predictability denominator
    features.items = features.items.map((item, idx) => {
      const tags = (featItems[idx]?.fields['System.Tags'] || '').toLowerCase();
      const type = tags.split(';').map(t => t.trim()).includes('stretch') ? 'Stretch' : 'Planned';
      return { ...item, type };
    });

    const capturedAt = new Date().toISOString();
    const id = `${piLabels.join('_')}-${capturedAt.replace(/[:.]/g, '-')}`;

    // Await all supplementary captures together
    const [tcSnapshot, objectivesSnapshot, risksSnapshot, releaseHealthSnapshot, storyMetricsSnapshot,
           velocitySnapshot, piChecksSnapshot, dependenciesSnapshot] =
      await Promise.all([tcSummaryPromise, objectivesPromise, risksPromise, releaseHealthPromise, storyMetricsPromise,
                         velocityPromise, piChecksPromise, dependenciesPromise]);

    const snapshot = {
      id, pis: piLabels, label, capturedAt,
      isRevision: !!isRevision, parentId: parentId || null,
      data: {
        meta: { fetchedAt: capturedAt, pis: piLabels, featureCount: featIds.length, defectCount: defIds.length },
        features,
        defects,
        testCoverage:      tcSnapshot,
        githubTestMatrix:  req.body.githubTestMatrix || null,
        objectives:        objectivesSnapshot,
        risks:             risksSnapshot,
        releaseHealth:     releaseHealthSnapshot,
        storyMetrics:      storyMetricsSnapshot,
        velocity:          velocitySnapshot,
        piChecks:          piChecksSnapshot,
        dependencies:      dependenciesSnapshot,
      }
    };

    ensureSnapshotsDir(req.deptId);
    fs.writeFileSync(path.join(getSnapshotsDir(req.deptId), `${id}.json`), JSON.stringify(snapshot, null, 2));
    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      snapshot: {
        id, pis: piLabels, label, capturedAt,
        isRevision: snapshot.isRevision, parentId: snapshot.parentId,
        featureCount:      featIds.length,
        defectCount:       defIds.length,
        objectiveCount:    objectivesSnapshot?.total ?? 0,
        riskCount:         risksSnapshot?.total ?? 0,
        releaseCount:      releaseHealthSnapshot?.releases?.length ?? 0,
        storyCount:        storyMetricsSnapshot?.total ?? 0,
        piCheckIssues:     piChecksSnapshot?.totalIssues ?? null,
        depBlockedCount:   dependenciesSnapshot?.blockedCount ?? 0,
      },
      ...(warnings.length ? { _warnings: warnings } : {}),
    });
  } catch (e) {
    console.error('[snapshot]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/snapshots ───────────────────────────────────────────────────────
router.get('/snapshots', (req, res) => {
  try {
    const { pi } = req.query;
    let snaps = listSnapshotFiles(req.deptId).map(s => ({
      id: s.id,
      pis: s.pis || (s.pi ? [s.pi] : []),
      label: s.label, capturedAt: s.capturedAt,
      isRevision: s.isRevision, parentId: s.parentId,
      featureCount:   s.data?.features?.items?.length   ?? s.features?.length ?? 0,
      defectCount:    s.data?.defects?.items?.length    ?? 0,
      objectiveCount: s.data?.objectives?.total         ?? 0,
      riskCount:      s.data?.risks?.total              ?? 0,
      storyCount:     s.data?.storyMetrics?.total       ?? 0,
      piCheckIssues:  s.data?.piChecks?.totalIssues     ?? null,
      depBlockedCount:s.data?.dependencies?.blockedCount ?? 0,
    }));
    if (pi) snaps = snaps.filter(s => (s.pis || []).includes(pi));
    snaps.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    res.json({ snapshots: snaps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/snapshots/:id/github-matrix ────────────────────────────────────
// Returns snapshot's GitHub test matrix so client can compare with live data.
router.get('/snapshots/:id/github-matrix', (req, res) => {
  try {
    const snap = readSnapshot(req.params.id, req.deptId);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    res.json({
      id:         snap.id,
      label:      snap.label,
      capturedAt: snap.capturedAt,
      pis:        snap.pis,
      data:       snap.data?.githubTestMatrix || null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/snapshots/:id ────────────────────────────────────────────────
router.delete('/snapshots/:id', (req, res) => {
  try {
    const file = path.join(getSnapshotsDir(req.deptId), `${req.params.id}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Snapshot not found' });
    fs.unlinkSync(file);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/snapshot-tc-delta ──────────────────────────────────────────────
// Compare snapshot's test-coverage data against live data.
// Uses cached TC data when available (same cache as /api/test-coverage) to avoid
// a full fresh TFS fetch on every call.
router.get('/snapshot-tc-delta', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const { snapshotId } = req.query;
    if (!snapshotId) return res.status(400).json({ error: 'snapshotId required' });

    const snap = readSnapshot(snapshotId, req.deptId);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

    const snapTC     = snap.data?.testCoverage || null;
    const piLabels   = snap.pis || [];
    const filterPath = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : cfg.tfs.areaPath;

    // Try to reuse cached TC data from /api/test-coverage to avoid a duplicate live fetch
    const { getCacheEntry, buildCacheKey, putCacheEntry } = require('../helpers/responseCache');
    const { computeTestCoverage } = require('./testCoverage');
    const TC_CACHE_TTL = 3600;

    const piQuery = piLabels.sort().map(p => `pis[]=${p}`).join('&');
    const cacheKey = buildCacheKey(req.deptId || 'default', '/test-coverage',
      Object.fromEntries(new URLSearchParams(piQuery).entries()));
    const cached = getCacheEntry(cacheKey);
    let liveData;
    if (cached) {
      liveData = cached.data;
    } else {
      // Cache miss — compute fresh and populate cache for subsequent requests
      liveData = await computeTestCoverage(cfg, { piLabels, filterPath, teamPath: null });
      putCacheEntry(cacheKey, liveData, TC_CACHE_TTL);
    }

    const live = {
      totalTests:    liveData.meta?.totalTestCases ?? 0,
      automatedPct:  liveData.automatedPct,
      passRate:      liveData.testRunsSummary?.passRate ?? 0,
      coveredPct:    liveData.featureCoverage?.coveredPct ?? 0,
      coveredCount:  liveData.featureCoverage?.coveredCount ?? 0,
      totalFeatures: liveData.featureCoverage?.total ?? 0,
      automationBreakdown: liveData.automationBreakdown,
      byTeam:        liveData.byTeam
    };

    if (!snapTC) {
      return res.json({ hasSnapshot: false, snapshotLabel: snap.label, snapshotDate: snap.capturedAt, live });
    }

    const snapshot = {
      totalTests:    snapTC.totalTestCases,
      automatedPct:  snapTC.automatedPct,
      passRate:      snapTC.testRunsSummary?.passRate      ?? 0,
      coveredPct:    snapTC.featureCoverage?.coveredPct    ?? 0,
      coveredCount:  snapTC.featureCoverage?.coveredCount  ?? 0,
      totalFeatures: snapTC.featureCoverage?.total         ?? 0,
      automationBreakdown: snapTC.automationBreakdown,
      byTeam:        snapTC.byTeam
    };

    const delta = {
      totalTests:   live.totalTests   - snapshot.totalTests,
      automatedPct: live.automatedPct - snapshot.automatedPct,
      passRate:     live.passRate     - snapshot.passRate,
      coveredPct:   live.coveredPct   - snapshot.coveredPct
    };

    res.json({ hasSnapshot: true, snapshotLabel: snap.label, snapshotDate: snap.capturedAt, snapshot, live, delta });
  } catch (e) {
    console.error('[snapshot-tc-delta]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
