'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { listSnapshotFiles } = require('../helpers/snapshots');
const { getFieldMappings } = require('../helpers/fieldMappings');
const { matchSprintSuffix, buildSprintIterPath } = require('../helpers/piHelpers');
const { fetchSprintDates, isSprintFuture } = require('../helpers/sprintDates');

const router = express.Router();

function classifyState(state, doneStates, exclStates, ipStates) {
  if (doneStates.has(state))  return 'done';
  if (exclStates.has(state))  return 'removed';
  if (ipStates.has(state))    return 'inProgress';
  return 'notStarted';
}

function getSprintLabel(iterPath, piLabel, sprintLabels) {
  const match = matchSprintSuffix(iterPath, piLabel, sprintLabels);
  return match || 'Unassigned';
}

function findPlanningSnapshot(pi, deptId) {
  try {
    const all = listSnapshotFiles(deptId);
    const snaps = all
      .filter(s => (s.pis || (s.pi ? [s.pi] : [])).includes(pi))
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    return snaps.length ? snaps[0] : null;
  } catch (_) {
    return null;
  }
}


function getSprintByDate(dateStr, sprintWindows, sprintLabels) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  for (const s of sprintLabels) {
    const w = sprintWindows[s];
    if (!w || !w.start || !w.end) continue;
    const end = new Date(w.end);
    end.setHours(23, 59, 59, 999);
    if (d >= w.start && d <= end) return s;
  }
  return null;
}

router.get('/pi-delivery', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const SPRINT_LABELS = fm.piStructure.sprintLabels;
    const DONE_STATES = new Set([fm.stateValues.featureDone].filter(Boolean));
    const EXCL_STATES = new Set([fm.stateValues.featureRemoved].filter(Boolean));
    const IP_STATES   = new Set(fm.stateValues.featureWip);

    const pi        = (req.query.pi || '').trim();
    const teamPath  = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const iterBase  = cfg.tfs.iterationPath;
    const areaBase  = cfg.tfs.areaPath;
    const teamRoot  = cfg.tfs.teamRootPath || areaBase;
    const sizeField = fm.fields.effortField;
    const storyPointsField = fm.fields.storyPointsField;
    if (!pi) return res.status(400).json({ error: 'pi param required' });

    const filterPath = teamPath || areaBase;
    const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const warnings = [];
    let shouldNoStore = false;

    const [snapshotSettled, sprintWindowsSettled, wiqlResultSettled] = await Promise.allSettled([
      Promise.resolve(findPlanningSnapshot(pi, req.deptId)),
      fetchSprintDates(cfg, pi, SPRINT_LABELS),
      tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}' AND [System.AreaPath] UNDER '${filterPath}' AND [System.IterationPath] UNDER '${iterBase}\\${pi}' AND [System.State] <> '${fm.stateValues.featureRemoved}' ORDER BY [System.IterationPath], [System.Id]`
      }, cfg.tfs.pat),
    ]);
    const snapshot = snapshotSettled.status === 'fulfilled' ? snapshotSettled.value : null;
    const sprintWindows = sprintWindowsSettled.status === 'fulfilled' ? sprintWindowsSettled.value : {};
    const wiqlResult = wiqlResultSettled.status === 'fulfilled' ? wiqlResultSettled.value : { workItems: [] };
    if (snapshotSettled.status !== 'fulfilled') {
      const message = `[pi-delivery] snapshot fetch failed: ${snapshotSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (sprintWindowsSettled.status !== 'fulfilled') {
      const message = `[pi-delivery] sprint dates fetch failed: ${sprintWindowsSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (wiqlResultSettled.status !== 'fulfilled') {
      const message = `[pi-delivery] features fetch failed: ${wiqlResultSettled.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
    }
    if (snapshotSettled.status !== 'fulfilled' && sprintWindowsSettled.status !== 'fulfilled' && wiqlResultSettled.status !== 'fulfilled') shouldNoStore = true;

    const ids      = (wiqlResult.workItems || []).map(w => w.id);
    const hasDates = Object.keys(sprintWindows).length > 0;

    const liveItems = ids.length ? await fetchWorkItemDetails(ids, [...new Set([
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath', 'System.IterationPath',
      'System.AssignedTo', 'System.Tags', fm.fields.stateChangeDateField,
      sizeField, storyPointsField,
      fm.fields.plannedForField,   // may be '' — filtered by Set + filter(Boolean) in fetchWorkItemDetails
    ].filter(Boolean))], cfg) : [];

    const plannedForField = fm.fields.plannedForField;
    const liveMap = new Map();
    for (const item of liveItems) {
      const raw = item.fields['System.AssignedTo'];
      const pts = item.fields[sizeField] || item.fields[storyPointsField] || 0;
      const iterPath = item.fields['System.IterationPath'] || '';
      // Derive sprint from iterationPath first; fall back to plannedForField if still Unassigned
      let sprintFromIter = getSprintLabel(iterPath, pi, SPRINT_LABELS);
      let plannedForValue = plannedForField ? (item.fields[plannedForField] || '') : '';
      liveMap.set(item.id, {
        title:    item.fields['System.Title'] || '',
        state:    item.fields['System.State'] || '',
        status:   classifyState(item.fields['System.State'] || '', DONE_STATES, EXCL_STATES, IP_STATES),
        iterPath,
        sprintFromIter,
        plannedForValue,
        pts,
        team:     extractTeam(item.fields['System.AreaPath'] || '', teamRoot),
        assignee: typeof raw === 'object' ? (raw?.displayName || '') : (raw || ''),
        tags:     item.fields['System.Tags'] || '',
        stateChangedDate: item.fields[fm.fields.stateChangeDateField] || null,
        tfsUrl:   `${cfg.tfs.baseUrl}/_workitems/edit/${item.id}`,
      });
    }

    const mkBucket = (label) => ({
      label,
      currentPlan: 0, currentPlanPts: 0,
      actualDone: 0,  actualDonePts: 0,
      piPlan: 0,      piPlanPts: 0,
    });
    const buckets = {};
    for (const s of [...SPRINT_LABELS, 'Unassigned']) buckets[s] = mkBucket(s);

    const allSnapItems = (snapshot && snapshot.data && snapshot.data.features && snapshot.data.features.items)
      ? snapshot.data.features.items
      : [];
    const snapItems = teamPath
      ? allSnapItems.filter(i => i.area && (i.area === teamPath || i.area.startsWith(teamPath + '\\')))
      : allSnapItems;
    const snapPlanMap = new Map();
    for (const item of snapItems) {
      if (item.state === fm.stateValues.featureRemoved) continue;
      const sprint = getSprintLabel(item.iter || '', pi, SPRINT_LABELS);
      const pts    = item.size || 0;
      snapPlanMap.set(item.id, { sprint, pts });
      buckets[sprint].piPlan++;
      buckets[sprint].piPlanPts += pts;
    }

    const featureList = [];
    for (const [id, live] of liveMap) {
      if (live.status === 'removed') continue;

      // currentSprint: from iterationPath, or plannedForField if iter is only at PI level
      let currentSprint = live.sprintFromIter;
      if (currentSprint === 'Unassigned' && live.plannedForValue) {
        // plannedForField contains a sprint label directly (e.g. 'S1', 'SP2') or an iter path
        const fromField = getSprintLabel(live.plannedForValue, pi, SPRINT_LABELS);
        if (fromField !== 'Unassigned') currentSprint = fromField;
        else {
          // Value might be a plain sprint label like 'S1' or 'SP1' — match directly
          const matched = SPRINT_LABELS.find(s => s.toLowerCase() === live.plannedForValue.toLowerCase().split('\\').pop());
          if (matched) currentSprint = matched;
        }
      }
      if (!buckets[currentSprint]) buckets[currentSprint] = mkBucket(currentSprint);
      buckets[currentSprint].currentPlan++;
      buckets[currentSprint].currentPlanPts += live.pts;

      let doneSprint = null;
      if (live.status === 'done') {
        doneSprint = hasDates ? getSprintByDate(live.stateChangedDate, sprintWindows, SPRINT_LABELS) : null;
        if (!doneSprint) doneSprint = currentSprint;
        if (!buckets[doneSprint]) buckets[doneSprint] = mkBucket(doneSprint);
        buckets[doneSprint].actualDone++;
        buckets[doneSprint].actualDonePts += live.pts;
      }

      const snapPlan      = snapPlanMap.get(id);
      const plannedSprint = snapPlan ? snapPlan.sprint : currentSprint;
      const isAdded       = !snapPlanMap.has(id);

      featureList.push({
        id, title: live.title, state: live.state, status: live.status,
        team: live.team, plannedSprint, currentSprint, doneSprint,
        assignee: live.assignee, pts: live.pts, tags: live.tags,
        stateChangedDate: live.stateChangedDate, tfsUrl: live.tfsUrl, isAdded,
      });
    }

    const orderedSprints = SPRINT_LABELS.map(s => Object.assign({}, buckets[s]));
    let cumPI = 0, cumPIPts = 0, cumSP = 0, cumSPPts = 0, cumAct = 0, cumActPts = 0;
    for (const s of orderedSprints) {
      cumPI  += s.piPlan;      cumPIPts  += s.piPlanPts;
      cumSP  += s.currentPlan; cumSPPts  += s.currentPlanPts;
      cumAct += s.actualDone;  cumActPts += s.actualDonePts;
      s.cumulativePIPlan         = cumPI;
      s.cumulativePIPlanPts      = Math.round(cumPIPts * 10) / 10;
      s.cumulativeSprintPlan     = cumSP;
      s.cumulativeSprintPlanPts  = Math.round(cumSPPts * 10) / 10;
      s.cumulativeActual         = cumAct;
      s.cumulativeActualPts      = Math.round(cumActPts * 10) / 10;
      s.isFuture                 = isSprintFuture(s.label, sprintWindows);
    }

    const ua               = buckets['Unassigned'];
    const totalPIPlan      = snapItems.filter(i => i.state !== fm.stateValues.featureRemoved).length;
    const totalCurrentPlan = orderedSprints.reduce((s, b) => s + b.currentPlan, 0) + ua.currentPlan;
    const totalActualDone  = orderedSprints.reduce((s, b) => s + b.actualDone, 0)  + ua.actualDone;
    const allLive          = [...liveMap.values()].filter(f => f.status !== 'removed');
    const ptsPIPlan        = Math.round(snapItems.filter(i => i.state !== fm.stateValues.featureRemoved).reduce((s, i) => s + (i.size || 0), 0) * 10) / 10;
    const ptsCurrentPlan   = Math.round(allLive.reduce((s, f) => s + f.pts, 0) * 10) / 10;
    const ptsActualDone    = Math.round(allLive.filter(f => f.status === 'done').reduce((s, f) => s + f.pts, 0) * 10) / 10;

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({
      pi,
      snapshot:    snapshot ? { id: snapshot.id, label: snapshot.label, capturedAt: snapshot.capturedAt } : null,
      sprintDates: sprintWindows,
      hasDates,
      sprints:     orderedSprints,
      unassigned:  ua,
      totals: {
        piPlan: totalPIPlan, currentPlan: totalCurrentPlan, actualDone: totalActualDone,
        inProgress: allLive.filter(f => f.status === 'inProgress').length,
        notStarted: allLive.filter(f => f.status === 'notStarted').length,
        pct:        totalPIPlan > 0 ? Math.round(totalActualDone / totalPIPlan * 100) : 0,
        ptsPIPlan, ptsCurrentPlan, ptsActualDone,
      },
      features:    featureList,
      fetchedAt:   new Date().toISOString(),
      ...(warnings.length ? { _warnings: warnings } : {}),
    });
  } catch (e) {
    console.error('[pi-delivery]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
