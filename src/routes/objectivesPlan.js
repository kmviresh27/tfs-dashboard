'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { parsePILabels, getDefaultPIs, buildIterationClauses } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');
const { listSnapshotMeta, readSnapshot } = require('../helpers/snapshots');

const router = express.Router();

router.get('/objectives-plan', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm  = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = parsePILabels(req.query);
    if (!piLabels || !piLabels.length) piLabels = getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern);

    const requestedTeamPath = req.query.teamPath || null;
    const areaPath  = cfg.tfs.areaPath;
    const teamRoot  = cfg.tfs.teamRootPath || areaPath;
    const wiqlUrl   = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const businessValueField = fm.fields.businessValueField;

    const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
    // Include objectives at the PI iteration level OR at the area root (no sprint assigned)
    const iterPart = iterClause
      ? ` AND (${iterClause} OR [System.IterationPath] = '${cfg.tfs.iterationPath}')`
      : '';

    // Extract just the team leaf-name from a full area path (e.g. "…\Avyay" → "Avyay")
    const requestedTeamName = requestedTeamPath
      ? requestedTeamPath.split(/[/\\]/).filter(Boolean).pop()
      : null;

    // ── 1. Fetch all objectives for the PI (no team filter — objectives may sit
    //       at team-level or programme-level; we post-filter by team name) ──────
    const objResult = await tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] = '${fm.workItemTypes.objective}'
          AND [System.AreaPath] UNDER '${areaPath}'
          ${iterPart}
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.AreaPath] ASC, [System.Id] ASC`
    }, cfg.tfs.pat);

    let objIds = (objResult.workItems || []).map(w => w.id);
    if (!objIds.length) {
      return res.json({ meta: { fetchedAt: new Date().toISOString(), pis: piLabels }, objectives: [], byTeam: {} });
    }

    // ── 2. Fetch objective details ────────────────────────────────────────────
    const objItems = await fetchWorkItemDetails(objIds, [
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', businessValueField,
      'Microsoft.VSTS.Common.StackRank', 'Microsoft.VSTS.Common.Priority',
    ], cfg);

    // ── 3. Fetch work item links — objectives → features ─────────────────────
    //    (no MODE clause — just get all links, filter client-side)
    const linkResult = await tfsPost(wiqlUrl, {
      query: `SELECT [Source].[System.Id], [Target].[System.Id] FROM WorkItemLinks
        WHERE [Source].[System.WorkItemType] = '${fm.workItemTypes.objective}'
          AND [Source].[System.Id] IN (${objIds.join(',')})
          AND [Target].[System.WorkItemType] = '${fm.workItemTypes.feature}'
        ORDER BY [Source].[System.Id]`
    }, cfg.tfs.pat);

    const objFeatureMap = {};
    for (const rel of (linkResult.workItemRelations || [])) {
      if (!rel.source || !rel.target) continue;
      if (!objFeatureMap[rel.source.id]) objFeatureMap[rel.source.id] = [];
      objFeatureMap[rel.source.id].push(rel.target.id);
    }

    // ── 4. Fetch feature details ──────────────────────────────────────────────
    const allFeatureIds = [...new Set(Object.values(objFeatureMap).flat())];
    const effortField   = fm.fields.effortField || 'Microsoft.VSTS.Scheduling.StoryPoints';
    const featItems     = allFeatureIds.length
      ? await fetchWorkItemDetails(allFeatureIds, [
          'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
          'System.AssignedTo', 'System.Tags', effortField,
        ], cfg)
      : [];

    // Parse REQ_xxx / COM_xxx tags from a semicolon-separated tag string
    function parseTeamTags(tagsStr = '') {
      const reqTeams = [];
      const comTeams = [];
      tagsStr.split(/[;,]/).map(t => t.trim()).filter(Boolean).forEach(tag => {
        const u = tag.toUpperCase();
        if (u.startsWith('REQ_')) reqTeams.push(tag.slice(4).trim());
        else if (u.startsWith('COM_')) comTeams.push(tag.slice(4).trim());
      });
      return { reqTeams, comTeams };
    }

    const featById = {};
    for (const f of featItems) {
      const tags = f.fields['System.Tags'] || '';
      const { reqTeams, comTeams } = parseTeamTags(tags);
      // Deviation: REQ team with no matching COM, or COM team with no matching REQ
      const allTeams = [...new Set([...reqTeams, ...comTeams])];
      const deviations = allTeams.filter(t =>
        !reqTeams.includes(t) || !comTeams.includes(t)
      );
      featById[f.id] = {
        id:         f.id,
        title:      f.fields['System.Title'],
        state:      f.fields['System.State'],
        team:       extractTeam(f.fields['System.AreaPath'] || '', teamRoot),
        assignedTo: f.fields['System.AssignedTo']
          ? (f.fields['System.AssignedTo'].displayName || f.fields['System.AssignedTo'])
          : null,
        tags,
        reqTeams,
        comTeams,
        deviations,
        hasDeviation: deviations.length > 0,
        effort: f.fields[effortField] ?? null,
      };
    }

    // ── 5. Determine stretch objective from title ─────────────────────────────
    function isStretch(title = '') {
      const t = title.toLowerCase();
      return t.includes('(stretch)') || t.includes('[stretch]') ||
             t.startsWith('stretch:') || /\(s\)\s*$/.test(t);
    }

    // ── 5b. Classify feature state ────────────────────────────────────────────
    const featureDoneState    = fm.stateValues.featureDone    || 'Done';
    const featureRemovedState = fm.stateValues.featureRemoved || 'Removed';
    const featureWipStates    = new Set(
      Array.isArray(fm.stateValues.featureWip)
        ? fm.stateValues.featureWip
        : String(fm.stateValues.featureWip || '').split(',').map(s => s.trim()).filter(Boolean)
    );

    function classifyFeature(state = '') {
      if (state === featureDoneState)    return 'done';
      if (state === featureRemovedState) return 'removed';
      if (featureWipStates.has(state))   return 'inProgress';
      return 'notStarted';
    }

    // ── 5c. RAG status from progress + state ──────────────────────────────────
    function calcRag(state, pct, featuresDone, featuresTotal) {
      if (state === featureDoneState || pct >= 100)       return 'Done';
      if (state === featureRemovedState)                   return 'Dropped';
      if (pct >= 80)                                       return 'Green';
      if (pct >= 40)                                       return 'Amber';
      return 'Red';
    }

    // ── 6. Build objectives array, post-filter by team if requested ───────────
    const objectives = objItems
      .map(item => {
        const title      = item.fields['System.Title'] || '';
        const objTeam    = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
        const featureIds = objFeatureMap[item.id] || [];
        const allFeatures = featureIds.map(fid => featById[fid]).filter(Boolean);
        // When team filter is active, only show features belonging to that team
        const features = requestedTeamName
          ? allFeatures.filter(f => f.team === requestedTeamName)
          : allFeatures;
        const linkedTeams = [...new Set(allFeatures.map(f => f.team).filter(Boolean))];

        // ── Progress metrics ──────────────────────────────────────────────────
        const activeFeatures  = features.filter(f => classifyFeature(f.state) !== 'removed');
        const featuresDone    = activeFeatures.filter(f => classifyFeature(f.state) === 'done').length;
        const featuresInProg  = activeFeatures.filter(f => classifyFeature(f.state) === 'inProgress').length;
        const featuresNotStrt = activeFeatures.filter(f => classifyFeature(f.state) === 'notStarted').length;
        const featuresTotal   = activeFeatures.length;

        // Effort-weighted progress (more accurate than count when effort data exists)
        const totalEffort = activeFeatures.reduce((s, f) => s + (f.effort || 0), 0);
        const doneEffort  = activeFeatures
          .filter(f => classifyFeature(f.state) === 'done')
          .reduce((s, f) => s + (f.effort || 0), 0);
        const inProgEffort = activeFeatures
          .filter(f => classifyFeature(f.state) === 'inProgress')
          .reduce((s, f) => s + (f.effort || 0), 0);

        // If effort data exists use effort-based progress, else fall back to count-based
        const progressPct = totalEffort > 0
          ? Math.round((doneEffort / totalEffort) * 100)
          : featuresTotal > 0
            ? Math.round((featuresDone / featuresTotal) * 100)
            : 0;

        const bv           = item.fields[businessValueField] ?? null;
        const bvDelivered  = bv != null && progressPct >= 100 ? bv : null;
        const bvWeighted   = bv != null ? Math.round((bv * progressPct) / 100 * 10) / 10 : null;
        const state        = item.fields['System.State'] || '';
        const ragStatus    = calcRag(state, progressPct, featuresDone, featuresTotal);

        return {
          id:            item.id,
          title,
          state,
          team:          objTeam,
          iter:          item.fields['System.IterationPath'],
          businessValue: bv,
          bvDelivered,
          bvWeighted,
          type:          isStretch(title) ? 'stretch' : 'committed',
          features,
          linkedTeams,
          stackRank:     item.fields['Microsoft.VSTS.Common.StackRank'] ?? null,
          priority:      item.fields['Microsoft.VSTS.Common.Priority'] ?? null,
          // progress
          progressPct,
          featuresDone,
          featuresInProgress: featuresInProg,
          featuresNotStarted: featuresNotStrt,
          featuresTotal,
          totalEffort,
          doneEffort,
          inProgressEffort: inProgEffort,
          ragStatus,
          progressMode: totalEffort > 0 ? 'effort' : 'count',
        };
      })
      .filter(obj => {
        if (!requestedTeamName) return true;
        // Objective is directly under the requested team
        if (obj.team === requestedTeamName) return true;
        // Objective is at parent level but has features belonging to the team
        if (obj.features.some(f => f.team === requestedTeamName)) return true;
        return false;
      });

    // ── 7. Group by team ──────────────────────────────────────────────────────
    const byTeam = {};
    for (const obj of objectives) {
      const t = obj.team || 'Unassigned';
      if (!byTeam[t]) byTeam[t] = [];
      byTeam[t].push(obj);
    }

    // ── 8. Programme-level progress summary ───────────────────────────────────
    const activeObjs = objectives.filter(o => o.ragStatus !== 'Dropped');
    const totalBvPlanned   = activeObjs.reduce((s, o) => s + (o.businessValue || 0), 0);
    const totalBvDelivered = objectives
      .filter(o => o.ragStatus === 'Done')
      .reduce((s, o) => s + (o.businessValue || 0), 0);
    const totalBvWeighted  = activeObjs.reduce((s, o) => s + (o.bvWeighted || 0), 0);
    const totalEffortAll   = objectives.reduce((s, o) => s + (o.totalEffort || 0), 0);
    const doneEffortAll    = objectives.reduce((s, o) => s + (o.doneEffort  || 0), 0);
    const overallProgress  = totalEffortAll > 0
      ? Math.round((doneEffortAll / totalEffortAll) * 100)
      : activeObjs.length > 0
        ? Math.round(activeObjs.reduce((s, o) => s + o.progressPct, 0) / activeObjs.length)
        : 0;

    const ragCounts = { Green: 0, Amber: 0, Red: 0, Done: 0, Dropped: 0 };
    for (const o of objectives) ragCounts[o.ragStatus] = (ragCounts[o.ragStatus] || 0) + 1;

    // ── 9. Postponed / Removed impact — use selected snapshot from Config panel ──
    let baselineObjs = [];
    let snapshotLabel = null;
    const requestedSnapshotId = req.query.snapshotId || null;
    try {
      let snap = null;
      if (requestedSnapshotId) {
        // User explicitly selected a snapshot in the Config panel — use it directly
        snap = readSnapshot(requestedSnapshotId, req.deptId);
        if (snap) snapshotLabel = snap.label || requestedSnapshotId;
      } else {
        // Fallback: find the latest non-revision snapshot matching these PIs
        const allMeta = listSnapshotMeta(req.deptId);
        const matching = allMeta
          .filter(s => Array.isArray(s.pis) && s.pis.some(p => piLabels.includes(p)) && !s.isRevision)
          .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
        if (matching.length) {
          snap = readSnapshot(matching[0].id, req.deptId);
          snapshotLabel = matching[0].label || null;
        }
      }
      baselineObjs = snap?.data?.objectives?.items || [];

      // Apply the same team filter to the baseline that was applied to current objectives
      if (requestedTeamName && baselineObjs.length) {
        baselineObjs = baselineObjs.filter(bo =>
          bo.team === requestedTeamName ||
          (bo.features || []).some(f => f.team === requestedTeamName)
        );
      }

      console.log(`[objectives-plan] snapshot=${requestedSnapshotId || 'auto'} label="${snapshotLabel}" baselineObjs=${baselineObjs.length} team=${requestedTeamName || 'all'} deptId=${req.deptId}`);
    } catch (e) {
      console.error('[objectives-plan] snapshot comparison failed:', e.message);
    }

    const currentObjMap = new Map(objectives.map(o => [o.id, o]));

    // Category A: in snapshot baseline but completely gone from current TFS fetch
    const droppedObjs = baselineObjs.filter(bo => !currentObjMap.has(bo.id));

    // Category B: in both, but features present at snapshot are now missing
    const objsWithCuts = [];
    for (const bo of baselineObjs) {
      const curr = currentObjMap.get(bo.id);
      if (!curr) continue; // already counted above

      // When team filter active, only compare features belonging to that team
      const snapFeatures = requestedTeamName
        ? (bo.features || []).filter(f => f.team === requestedTeamName)
        : (bo.features || []);

      const currentFeatIds = new Set((curr.features || []).map(f => f.id));
      const cutFeatures = snapFeatures.filter(f => !currentFeatIds.has(f.id));
      if (cutFeatures.length > 0) {
        objsWithCuts.push({ obj: curr, cutFeatures, baselineFeatures: snapFeatures });
      }
    }

    function mapDropped(bo) {
      return {
        id: bo.id, title: bo.title, state: bo.state, team: bo.team,
        businessValue: bo.businessValue, iter: bo.iter,
        reason: 'dropped',
        removedFeaturesCount: (bo.features || []).length,
        linkedFeatures: (bo.features || []).map(f => ({ id: f.id, title: f.title, state: f.state, team: f.team, isRemoved: true })),
      };
    }
    function mapCut(entry) {
      const { obj, cutFeatures, baselineFeatures } = entry;
      return {
        id: obj.id, title: obj.title, state: obj.state, team: obj.team,
        businessValue: obj.businessValue, iter: obj.iter,
        reason: 'features-removed',
        removedFeaturesCount: cutFeatures.length,
        linkedFeatures: baselineFeatures.map(f => ({
          id: f.id, title: f.title, state: f.state, team: f.team,
          isRemoved: !currentObjMap.get(obj.id)?.features?.some(cf => cf.id === f.id),
        })),
      };
    }

    const allImpacted = [
      ...droppedObjs.map(mapDropped),
      ...objsWithCuts.map(mapCut),
    ];

    const postponedBvTotal = droppedObjs.reduce((s, o) => s + (o.businessValue || 0), 0);
    const postponedByTeam  = {};
    for (const o of allImpacted) {
      const t = o.team || 'Unassigned';
      if (!postponedByTeam[t]) postponedByTeam[t] = { count: 0, bvAtRisk: 0 };
      postponedByTeam[t].count++;
      if (o.reason === 'dropped') postponedByTeam[t].bvAtRisk += (o.businessValue || 0);
    }

    res.json({
      meta: { fetchedAt: new Date().toISOString(), pis: piLabels },
      objectives,
      byTeam,
      summary: {
        total: objectives.length,
        overallProgress,
        totalBvPlanned,
        totalBvDelivered,
        totalBvWeighted,
        totalEffortAll,
        doneEffortAll,
        ragCounts,
      },
      postponedImpact: {
        total:         allImpacted.length,
        droppedCount:  droppedObjs.length,
        impactedCount: objsWithCuts.length,
        bvAtRisk:      postponedBvTotal,
        byTeam:        postponedByTeam,
        objectives:    allImpacted,
        snapshotLabel,
        hasSnapshot:   baselineObjs.length > 0,
      },
    });
  } catch (e) {
    console.error('[objectives-plan]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


