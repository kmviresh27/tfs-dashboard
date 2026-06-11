'use strict';
const path = require('path');
const fs   = require('fs');

const { fetchWorkItemDetails, tfsGet, tfsPost } = require('../tfsClient');
const { extractTeam } = require('./dataProcessors');
const { buildIterationClauses, buildSprintIterPath } = require('./piHelpers');
const { getFieldMappings } = require('./fieldMappings');
const { getSnapshotsDir: _getSnapshotsDir } = require('./deptPaths');

// Legacy constant kept for backward compat; new code should use getSnapshotsDir(deptId)
const SNAPSHOTS_DIR = path.join(__dirname, '..', '..', 'snapshots');

function getSnapshotsDir(deptId) {
  return deptId ? _getSnapshotsDir(deptId) : SNAPSHOTS_DIR;
}

function ensureSnapshotsDir(deptId) {
  const dir = getSnapshotsDir(deptId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function listSnapshotFiles(deptId) {
  ensureSnapshotsDir(deptId);
  const dir = getSnapshotsDir(deptId);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.endsWith('_scope.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch (_) { return null; }
    })
    .filter(Boolean);
}

/**
 * Like listSnapshotFiles but returns only top-level metadata (no data blob).
 * Much faster — avoids loading large feature/defect arrays into memory.
 */
function listSnapshotMeta(deptId) {
  ensureSnapshotsDir(deptId);
  const dir = getSnapshotsDir(deptId);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.endsWith('_scope.json'))
    .map(f => {
      try {
        const raw  = fs.readFileSync(path.join(dir, f), 'utf8');
        const full = JSON.parse(raw);
        return {
          id:          full.id,
          pis:         full.pis,
          label:       full.label,
          capturedAt:  full.capturedAt,
          isRevision:  full.isRevision,
          parentId:    full.parentId,
          _file:       f,
        };
      } catch (e) {
        console.warn(`[snapshots] failed to parse metadata from ${f}:`, e.message);
        return null;
      }
    })
    .filter(Boolean);
}

function readSnapshot(id, deptId) {
  const dir  = getSnapshotsDir(deptId);
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ─── TC Summary helper (used by /api/test-coverage + snapshot capture) ────────
async function fetchTCSummary(cfg, piLabels, filterPath) {
  const wiqlUrl  = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
  const iterPart = piLabels && piLabels.length
    ? ` AND (${piLabels.map(p => `[System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${p}'`).join(' OR ')})`
    : '';

  const [tcRes, linkRes, featRes, runsRes] = await Promise.allSettled([
    tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Test Case' AND [System.AreaPath] UNDER '${filterPath}' ORDER BY [System.Id]` }, cfg.tfs.pat),
    tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItemLinks WHERE ([Source].[System.WorkItemType] = 'Feature' AND [Source].[System.AreaPath] UNDER '${filterPath}') AND [System.Links.LinkType] = 'Microsoft.VSTS.Common.TestedBy-Forward' AND ([Target].[System.WorkItemType] = 'Test Case') ORDER BY [System.Id] MODE (MustContain)` }, cfg.tfs.pat),
    tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Feature' AND [System.AreaPath] UNDER '${filterPath}' AND [System.State] <> 'Removed'${iterPart} ORDER BY [System.Id]` }, cfg.tfs.pat),
    tfsGet(`${cfg.tfs.baseUrl}/_apis/test/runs?includeRunDetails=true&$top=100&api-version=${cfg.tfs.apiVersion}`, cfg.tfs.pat)
  ]);

  const tcIds      = tcRes.status   === 'fulfilled' ? (tcRes.value.workItems   || []).map(w => w.id) : [];
  const coveredIds = new Set(linkRes.status === 'fulfilled'
    ? (linkRes.value.workItemRelations || []).filter(r => r.source && r.target).map(r => r.source.id) : []);
  const allFeatIds = featRes.status === 'fulfilled' ? (featRes.value.workItems || []).map(w => w.id) : [];

  const tcItems = await fetchWorkItemDetails(
    tcIds, ['System.Id', 'System.AreaPath', 'Microsoft.VSTS.TCM.AutomationStatus'], cfg
  );

  const automationBreakdown = { Automated: 0, 'Not Automated': 0, Planned: 0 };
  const byTeam = {};
  tcItems.forEach(item => {
    const raw  = item.fields['Microsoft.VSTS.TCM.AutomationStatus'] || 'Not Automated';
    const key  = ['Automated', 'Planned'].includes(raw) ? raw : 'Not Automated';
    const team = extractTeam(item.fields['System.AreaPath'] || '', teamRoot);
    automationBreakdown[key]++;
    if (!byTeam[team]) byTeam[team] = { Automated: 0, 'Not Automated': 0, Planned: 0 };
    byTeam[team][key]++;
  });
  const totalTC      = tcItems.length;
  const automatedPct = totalTC > 0 ? Math.round(automationBreakdown.Automated / totalTC * 100) : 0;

  let testRunsSummary = { runCount: 0, passed: 0, failed: 0, notExecuted: 0, blocked: 0, inProgress: 0, passRate: 0 };
  if (runsRes.status === 'fulfilled') {
    const runs = runsRes.value.value || [];
    let passed = 0, failed = 0, notExecuted = 0, blocked = 0, inProgress = 0;
    runs.forEach(r => {
      passed += r.passedTests || 0; failed += r.failedTests || 0;
      notExecuted += r.incompleteTests || 0; blocked += r.blockedTests || 0; inProgress += r.inProgressTests || 0;
    });
    const denom = passed + failed + blocked;
    testRunsSummary = { runCount: runs.length, passed, failed, notExecuted, blocked, inProgress,
      passRate: denom > 0 ? Math.round(passed / denom * 100) : 0 };
  }

  const coveredCount = allFeatIds.filter(id => coveredIds.has(id)).length;
  return {
    totalTestCases: totalTC, automatedPct, automationBreakdown, byTeam,
    featureCoverage: {
      total: allFeatIds.length, coveredCount,
      uncoveredCount: allFeatIds.length - coveredCount,
      coveredPct: allFeatIds.length > 0 ? Math.round(coveredCount / allFeatIds.length * 100) : 0
    },
    testRunsSummary
  };
}

// ─── Objectives snapshot ──────────────────────────────────────────────────────
function _isStretch(title = '') {
  const t = title.toLowerCase();
  return t.includes('(stretch)') || t.includes('[stretch]') ||
         t.startsWith('stretch:') || /\(s\)\s*$/.test(t);
}

function _parseTeamTags(tagsStr = '') {
  const reqTeams = [], comTeams = [];
  tagsStr.split(/[;,]/).map(t => t.trim()).filter(Boolean).forEach(tag => {
    const u = tag.toUpperCase();
    if (u.startsWith('REQ_'))      reqTeams.push(tag.slice(4).trim());
    else if (u.startsWith('COM_')) comTeams.push(tag.slice(4).trim());
  });
  return { reqTeams, comTeams };
}

async function fetchObjectivesSnapshot(cfg, piLabels) {
  const fm = getFieldMappings(cfg);
  const teamRoot   = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
  const bvField    = fm.fields.businessValueField;
  const effortField = fm.fields.effortField || 'Microsoft.VSTS.Scheduling.Effort';
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart   = iterClause ? ` AND ${iterClause}` : '';
  const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;

  const result = await tfsPost(wiqlUrl, {
    query: `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.objective}'
      AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'${iterPart}
    ORDER BY [System.Id]`
  }, cfg.tfs.pat);

  const ids = (result.workItems || []).map(w => w.id);
  if (!ids.length) return { items: [], total: 0, committed: 0, stretch: 0, done: 0, approved: 0, removed: 0, active: 0, attainmentPct: 0, bvPlanned: 0, bvDelivered: 0, bvAttainmentPct: 0, featuresWithDeviations: 0, totalLinkedFeatures: 0, byTeam: {} };

  // Fetch objective items and linked feature IDs in parallel
  const [rawItems, linkResult] = await Promise.all([
    fetchWorkItemDetails(ids, [
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.IterationPath', 'System.AssignedTo', bvField,
      'Microsoft.VSTS.Common.StateChangeDate', 'System.CreatedDate'
    ], cfg),
    tfsPost(wiqlUrl, {
      query: `SELECT [Source].[System.Id], [Target].[System.Id] FROM WorkItemLinks
        WHERE [Source].[System.WorkItemType] = '${fm.workItemTypes.objective}'
          AND [Source].[System.Id] IN (${ids.join(',')})
          AND [Target].[System.WorkItemType] = '${fm.workItemTypes.feature}'
        ORDER BY [Source].[System.Id]`
    }, cfg.tfs.pat)
  ]);

  // Build objective → feature ID map
  const objFeatureMap = {};
  for (const rel of (linkResult.workItemRelations || [])) {
    if (!rel.source || !rel.target) continue;
    if (!objFeatureMap[rel.source.id]) objFeatureMap[rel.source.id] = [];
    objFeatureMap[rel.source.id].push(rel.target.id);
  }

  // Fetch all linked feature details
  const allFeatureIds = [...new Set(Object.values(objFeatureMap).flat())];
  const featItems = allFeatureIds.length
    ? await fetchWorkItemDetails(allFeatureIds, [
        'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
        'System.AssignedTo', 'System.Tags', effortField,
      ], cfg)
    : [];

  // Build feature lookup with REQ_/COM_ tag parsing
  const featById = {};
  for (const f of featItems) {
    const tags = f.fields['System.Tags'] || '';
    const { reqTeams, comTeams } = _parseTeamTags(tags);
    const allTeams = [...new Set([...reqTeams, ...comTeams])];
    const deviations = allTeams.filter(t => !reqTeams.includes(t) || !comTeams.includes(t));
    featById[f.id] = {
      id:          f.id,
      title:       f.fields['System.Title'],
      state:       f.fields['System.State'],
      team:        extractTeam(f.fields['System.AreaPath'] || '', teamRoot),
      assignedTo:  typeof f.fields['System.AssignedTo'] === 'object'
        ? (f.fields['System.AssignedTo']?.displayName || '')
        : (f.fields['System.AssignedTo'] || ''),
      tags,
      reqTeams,
      comTeams,
      deviations,
      hasDeviation: deviations.length > 0,
      effort:      f.fields[effortField] ?? null,
    };
  }

  const objectives = rawItems.map(item => {
    const title       = item.fields['System.Title'] || '';
    const featureIds  = objFeatureMap[item.id] || [];
    const features    = featureIds.map(fid => featById[fid]).filter(Boolean);
    const linkedTeams = [...new Set(features.map(f => f.team).filter(Boolean))];
    return {
      id:            item.id,
      title,
      state:         item.fields['System.State'],
      team:          extractTeam(item.fields['System.AreaPath'] || '', teamRoot),
      iter:          item.fields['System.IterationPath'],
      assignedTo:    typeof item.fields['System.AssignedTo'] === 'object'
        ? (item.fields['System.AssignedTo']?.displayName || '')
        : (item.fields['System.AssignedTo'] || ''),
      businessValue: item.fields[bvField] ?? null,
      type:          _isStretch(title) ? 'stretch' : 'committed',
      features,
      linkedTeams,
    };
  });

  const total     = objectives.length;
  const committed = objectives.filter(o => o.type === 'committed').length;
  const stretch   = objectives.filter(o => o.type === 'stretch').length;
  const done      = objectives.filter(o => o.state === 'Done').length;
  const approved  = objectives.filter(o => o.state === 'Approved').length;
  const removed   = objectives.filter(o => o.state === 'Removed').length;
  const active    = total - removed;
  const attainmentPct   = active > 0 ? Math.round((done / active) * 100) : 0;
  const bvPlanned       = objectives.filter(o => o.state !== 'Removed').reduce((s, o) => s + (o.businessValue || 0), 0);
  const bvDelivered     = objectives.filter(o => o.state === 'Done').reduce((s, o) => s + (o.businessValue || 0), 0);
  const bvAttainmentPct = bvPlanned > 0 ? Math.round((bvDelivered / bvPlanned) * 100) : 0;
  const totalLinkedFeatures  = Object.values(objFeatureMap).reduce((s, arr) => s + arr.length, 0);
  const featuresWithDeviations = Object.values(featById).filter(f => f.hasDeviation).length;

  const byTeam = {};
  for (const obj of objectives) {
    const t = obj.team || 'Unassigned';
    if (!byTeam[t]) byTeam[t] = { total: 0, committed: 0, stretch: 0, done: 0, bvPlanned: 0, bvDelivered: 0, attainmentPct: 0 };
    byTeam[t].total++;
    if (obj.type === 'committed') byTeam[t].committed++;
    if (obj.type === 'stretch')   byTeam[t].stretch++;
    if (obj.state === 'Done')    { byTeam[t].done++;    byTeam[t].bvDelivered += (obj.businessValue || 0); }
    if (obj.state !== 'Removed')   byTeam[t].bvPlanned  += (obj.businessValue || 0);
  }
  for (const t of Object.values(byTeam)) {
    t.attainmentPct = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
  }

  return { items: objectives, total, committed, stretch, done, approved, removed, active, attainmentPct, bvPlanned, bvDelivered, bvAttainmentPct, totalLinkedFeatures, featuresWithDeviations, byTeam };
}

// ─── Risks snapshot ───────────────────────────────────────────────────────────
const RISK_SNAP_FIELDS = [
  'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
  'System.IterationPath', 'System.AssignedTo', 'System.CreatedDate',
  'System.ChangedDate', 'System.Tags', 'System.WorkItemType',
  'Microsoft.VSTS.Common.Priority'
];
const RISK_UNROAMED = new Set(['Open', 'Identified']);
const RISK_ACTIVE   = new Set(['Open', 'Identified', 'Owned', 'Accepted']);

async function fetchRisksSnapshot(cfg, piLabels) {
  const fm = getFieldMappings(cfg);
  const teamRoot   = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
  const iterClause = piLabels && piLabels.length ? buildIterationClauses(cfg.tfs.iterationPath, piLabels) : '';
  const iterPart   = iterClause ? ` AND ${iterClause}` : '';
  const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;

  const result = await tfsPost(wiqlUrl, {
    query: `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] IN ('${fm.workItemTypes.risk}', '${fm.workItemTypes.productRisk}')
      AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'${iterPart}
    ORDER BY [System.Id]`
  }, cfg.tfs.pat);

  const ids = (result.workItems || []).map(w => w.id);
  if (!ids.length) return { items: [], total: 0, unroamedCount: 0, activeCount: 0, byState: {}, byROAM: { R: 0, O: 0, A: 0, M: 0, unroamed: 0 }, byTeam: {} };

  const rawItems = await fetchWorkItemDetails(ids, RISK_SNAP_FIELDS, cfg);

  const byState = {}, byTeam = {}, items = [];
  for (const item of rawItems) {
    const f    = item.fields;
    const st   = f['System.State'] || 'Unknown';
    const type = f['System.WorkItemType'] || fm.workItemTypes.risk;
    const team = extractTeam(f['System.AreaPath'] || '', teamRoot);
    byState[st] = (byState[st] || 0) + 1;
    if (!byTeam[team]) byTeam[team] = { open: 0, owned: 0, accepted: 0, mitigated: 0, resolved: 0, total: 0 };
    byTeam[team].total++;
    if      (RISK_UNROAMED.has(st)) byTeam[team].open++;
    else if (st === 'Owned')        byTeam[team].owned++;
    else if (st === 'Accepted')     byTeam[team].accepted++;
    else if (st === 'Mitigated')    byTeam[team].mitigated++;
    else if (st === 'Resolved')     byTeam[team].resolved++;
    items.push({
      id: item.id, title: f['System.Title'], state: st, type, team,
      priority: f['Microsoft.VSTS.Common.Priority'] || null, tags: f['System.Tags'] || '',
      iter: (f['System.IterationPath'] || '').split('\\').pop(),
    });
  }

  const total        = items.length;
  const unroamedCount= items.filter(r => RISK_UNROAMED.has(r.state)).length;
  const activeCount  = items.filter(r => RISK_ACTIVE.has(r.state)).length;
  const byROAM = {
    R: byState['Resolved']  || 0,
    O: byState['Owned']     || 0,
    A: byState['Accepted']  || 0,
    M: byState['Mitigated'] || 0,
    unroamed: (byState['Open'] || 0) + (byState['Identified'] || 0),
  };

  return { items, total, unroamedCount, activeCount, byState, byROAM, byTeam };
}

// ─── Release Health snapshot ──────────────────────────────────────────────────
async function fetchReleaseHealthSnapshot(cfg, piLabels) {
  const fm         = getFieldMappings(cfg);
  const REL_FIELD  = fm.fields.releaseField;
  const sizeField  = fm.fields.effortField;
  const spField    = fm.fields.storyPointsField;
  const iterBase   = cfg.tfs.iterationPath;
  const filterPath = cfg.tfs.areaPath;
  const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const iterPart   = piLabels.length
    ? ` AND (${piLabels.map(p => `[System.IterationPath] UNDER '${iterBase}\\${p}'`).join(' OR ')})`
    : '';

  const [featWIQL, storyWIQL] = await Promise.all([
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}' AND [System.State] <> '${fm.stateValues.featureRemoved}' AND [System.AreaPath] UNDER '${filterPath}'${iterPart} AND [${REL_FIELD}] <> '' ORDER BY [${REL_FIELD}], [System.Id]`
    }, cfg.tfs.pat),
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${fm.workItemTypes.story}' AND [System.State] <> '${fm.stateValues.storyRemoved}' AND [System.AreaPath] UNDER '${filterPath}'${iterPart} AND [${REL_FIELD}] <> '' ORDER BY [${REL_FIELD}], [System.Id]`
    }, cfg.tfs.pat),
  ]);

  const featIds  = (featWIQL.workItems  || []).map(w => w.id);
  const storyIds = (storyWIQL.workItems || []).map(w => w.id);
  const common   = ['System.Id', 'System.Title', 'System.State', 'System.AreaPath', REL_FIELD];

  const [featItems, storyItems] = await Promise.all([
    featIds.length  ? fetchWorkItemDetails(featIds,  common, cfg) : Promise.resolve([]),
    storyIds.length ? fetchWorkItemDetails(storyIds, [...new Set([...common, sizeField, spField])], cfg) : Promise.resolve([]),
  ]);

  function groupByState(arr, sf, spf) {
    const byState = {}, ptsByState = {};
    let total = 0, totalPts = 0;
    for (const item of arr) {
      const state = item.fields['System.State'] || 'Unknown';
      const pts   = item.fields[sf] || item.fields[spf] || 0;
      byState[state]    = (byState[state]    || 0) + 1;
      ptsByState[state] = (ptsByState[state] || 0) + pts;
      total++; totalPts += pts;
    }
    return { total, totalPts: Math.round(totalPts * 10) / 10, byState, ptsByState };
  }

  const releaseMap = new Map();
  for (const item of [...featItems, ...storyItems]) {
    const rel = (item.fields[REL_FIELD] || '').trim();
    if (!rel) continue;
    if (!releaseMap.has(rel)) releaseMap.set(rel, { features: [], stories: [] });
    const bucket = featItems.includes(item) ? 'features' : 'stories';
    releaseMap.get(rel)[bucket].push(item);
  }

  const releases = [...releaseMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([name, { features, stories }]) => ({
      name,
      features: groupByState(features, sizeField, spField),
      stories:  groupByState(stories,  sizeField, spField),
    }));

  return { releases, totalFeatures: featIds.length, totalStories: storyIds.length };
}

// ─── Story Metrics snapshot ───────────────────────────────────────────────────
async function fetchStoryMetricsSnapshot(cfg, piLabels) {
  const fm              = getFieldMappings(cfg);
  const teamRoot        = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
  const spField         = fm.fields.storyPointsField;
  const sizeField       = fm.fields.effortField;
  const storyDoneStates = new Set(fm.stateValues.storyDone);
  const lastSprint      = (fm.piStructure.sprintLabels[fm.piStructure.sprintLabels.length - 1] || 'IP').toLowerCase();
  const iterClause      = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart        = iterClause ? ` AND ${iterClause}` : '';
  const wiqlUrl         = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;

  const result = await tfsPost(wiqlUrl, {
    query: `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.story}'
      AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'${iterPart}
    ORDER BY [System.Id]`
  }, cfg.tfs.pat);

  const ids = (result.workItems || []).map(w => w.id);
  if (!ids.length) return { total: 0, done: 0, acceptanceRate: 0, bySprintAcceptance: {}, ipSprint: { total: 0, done: 0, doneRate: 0 } };

  const rawItems = await fetchWorkItemDetails(ids, [...new Set([
    'System.Id', 'System.State', 'System.AreaPath', 'System.IterationPath',
    'System.CreatedDate', 'Microsoft.VSTS.Common.ClosedDate', spField, sizeField
  ])], cfg);

  function sprintOf(iterPath) {
    const segs = (iterPath || '').replace(/\//g, '\\').split('\\').filter(Boolean);
    return segs.pop() || 'Unknown';
  }

  const bySprintAcceptance = {};
  let totalDone = 0;
  for (const item of rawItems) {
    const sprint = sprintOf(item.fields['System.IterationPath']);
    const state  = item.fields['System.State'] || '';
    if (!bySprintAcceptance[sprint]) bySprintAcceptance[sprint] = { total: 0, done: 0, rate: 0 };
    bySprintAcceptance[sprint].total++;
    if (storyDoneStates.has(state)) { bySprintAcceptance[sprint].done++; totalDone++; }
  }
  for (const s of Object.values(bySprintAcceptance)) {
    s.rate = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
  }

  const total          = rawItems.length;
  const acceptanceRate = total > 0 ? Math.round((totalDone / total) * 100) : 0;

  const ipItems  = rawItems.filter(i => sprintOf(i.fields['System.IterationPath']).toLowerCase().endsWith(lastSprint));
  const ipTotal  = ipItems.length;
  const ipDone   = ipItems.filter(i => storyDoneStates.has(i.fields['System.State'] || '')).length;
  const ipDoneRate = ipTotal > 0 ? Math.round((ipDone / ipTotal) * 100) : 0;

  return { total, done: totalDone, acceptanceRate, bySprintAcceptance, ipSprint: { total: ipTotal, done: ipDone, doneRate: ipDoneRate } };
}

// ─── Velocity snapshot ────────────────────────────────────────────────────────
async function fetchVelocitySnapshot(cfg, piLabels) {
  const fm           = getFieldMappings(cfg);
  const sprintLabels = fm.piStructure.sprintLabels;
  const wiqlUrl      = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const iterBase     = cfg.tfs.iterationPath;
  const filterPath   = cfg.tfs.areaPath;
  const sizeField    = fm.fields.effortField;
  const spField      = fm.fields.storyPointsField;
  const featureType  = fm.workItemTypes.feature;
  const doneState    = fm.stateValues.featureDone;
  const velFields    = [...new Set(['System.Id', 'System.State', 'System.AreaPath', sizeField, spField])];

  function getSize(item) { return item.fields[sizeField] || item.fields[spField] || 0; }

  const byPI = await Promise.all(piLabels.map(async piLabel => {
    const sprints = await Promise.all(sprintLabels.map(async sprintLabel => {
      const sprintIter = buildSprintIterPath(iterBase, piLabel, sprintLabel, fm.piStructure.sprintSubpathPattern);
      try {
        const res  = await tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${featureType}' AND [System.AreaPath] UNDER '${filterPath}' AND [System.IterationPath] UNDER '${sprintIter}' ORDER BY [System.Id]` }, cfg.tfs.pat);
        const ids  = (res.workItems || []).map(w => w.id);
        if (!ids.length) return { sprint: sprintLabel, total: 0, done: 0, deliveryRate: 0, totalPts: 0, donePts: 0 };
        const items = await fetchWorkItemDetails(ids, velFields, cfg);
        let done = 0, totalPts = 0, donePts = 0;
        for (const item of items) {
          const pts = getSize(item); totalPts += pts;
          if (item.fields['System.State'] === doneState) { done++; donePts += pts; }
        }
        const total = items.length;
        return { sprint: sprintLabel, total, done, deliveryRate: total > 0 ? Math.round(done / total * 100) : 0, totalPts: Math.round(totalPts * 10) / 10, donePts: Math.round(donePts * 10) / 10 };
      } catch (_) {
        return { sprint: sprintLabel, total: 0, done: 0, deliveryRate: 0, totalPts: 0, donePts: 0 };
      }
    }));

    try {
      const piRes  = await tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${featureType}' AND [System.AreaPath] UNDER '${filterPath}' AND [System.IterationPath] UNDER '${iterBase}\\${piLabel}' ORDER BY [System.Id]` }, cfg.tfs.pat);
      const piIds  = (piRes.workItems || []).map(w => w.id);
      const piItems = piIds.length ? await fetchWorkItemDetails(piIds, velFields, cfg) : [];
      let piDone = 0, piTotalPts = 0, piDonePts = 0;
      for (const item of piItems) {
        const pts = getSize(item); piTotalPts += pts;
        if (item.fields['System.State'] === doneState) { piDone++; piDonePts += pts; }
      }
      const piTotal = piItems.length;
      return { pi: piLabel, sprints, piEnd: { total: piTotal, done: piDone, deliveryRate: piTotal > 0 ? Math.round(piDone / piTotal * 100) : 0, totalPts: Math.round(piTotalPts * 10) / 10, donePts: Math.round(piDonePts * 10) / 10 } };
    } catch (_) {
      return { pi: piLabel, sprints, piEnd: { total: 0, done: 0, deliveryRate: 0, totalPts: 0, donePts: 0 } };
    }
  }));

  return { byPI };
}

// ─── PI Checks snapshot ───────────────────────────────────────────────────────
const PI_CHECK_NAMES_SNAP = [
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
  '[PI] Stories without Release Field',
];

async function fetchPIChecksSnapshot(cfg, piLabels) {
  const folderPath  = cfg.piChecksQueryFolder || 'Shared Queries/ICAP/Program Queries/TFSInconsistenciesQueryRepository';
  const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
  const folderUrl   = `${cfg.tfs.baseUrl}/_apis/wit/queries/${encodedPath}?$depth=2&$expand=all&api-version=${cfg.tfs.apiVersion}`;
  const wiqlUrl     = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const iterBase    = cfg.tfs.iterationPath;

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
    console.warn('[snapshot/pi-checks] folder fetch failed:', e.message.slice(0, 80));
    return { checks: PI_CHECK_NAMES_SNAP.map(name => ({ name, count: null, error: 'Query folder unavailable' })), totalIssues: null };
  }

  function matchesPI(iterPath) {
    if (!piLabels.length || !iterBase) return true;
    const norm = (iterPath || '').replace(/\//g, '\\').toLowerCase();
    return piLabels.some(pi => {
      const prefix = `${iterBase}\\${pi}`.toLowerCase();
      return norm === prefix || norm.startsWith(prefix + '\\');
    });
  }

  const checks = await Promise.all(PI_CHECK_NAMES_SNAP.map(async name => {
    const found = queryMap[name] || queryMap[name.replace(/^\[PI\]\s*/, '')];
    if (!found) return { name, count: null, error: 'Query not found' };
    try {
      const result  = await tfsPost(wiqlUrl, { query: found.wiql }, cfg.tfs.pat);
      const allIds  = result.workItems
        ? result.workItems.map(w => w.id)
        : [...new Set((result.workItemRelations || []).filter(r => r.target?.id).map(r => r.target.id))];
      if (!allIds.length) return { name, count: 0 };
      if (!piLabels.length) return { name, count: allIds.length };
      const items = await fetchWorkItemDetails(allIds.slice(0, 500), ['System.Id', 'System.IterationPath'], cfg);
      const count = items.filter(i => matchesPI(i.fields['System.IterationPath'] || '')).length;
      return { name, count };
    } catch (e) {
      return { name, count: null, error: e.message.slice(0, 80) };
    }
  }));

  const totalIssues = checks.reduce((s, c) => s + (c.count || 0), 0);
  return { checks, totalIssues };
}

// ─── Dependencies snapshot ────────────────────────────────────────────────────
async function fetchDependenciesSnapshot(cfg, piLabels) {
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart   = iterClause ? ` AND ${iterClause}` : '';
  const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const teamRoot   = cfg.tfs.teamRootPath || cfg.tfs.areaPath;

  const DEP_LINK_TYPES = new Set([
    'System.LinkTypes.Dependency-Forward',
    'System.LinkTypes.Dependency-Reverse',
    'System.LinkTypes.Related',
  ]);
  const extractIdFromUrl = url => { const m = (url || '').match(/\/(\d+)$/); return m ? parseInt(m[1], 10) : null; };

  const result  = await tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Feature' AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'${iterPart} ORDER BY [System.Id]` }, cfg.tfs.pat);
  const featIds = (result.workItems || []).map(w => w.id);
  if (!featIds.length) return { total: 0, blockedCount: 0, crossTeamCount: 0, byTeam: {} };

  const featuresWithRels = [];
  for (let i = 0; i < featIds.length; i += 50) {
    const chunk = featIds.slice(i, i + 50);
    const data  = await tfsGet(`${cfg.tfs.baseUrl}/_apis/wit/workitems?ids=${chunk.join(',')}&$expand=relations&api-version=${cfg.tfs.apiVersion}`, cfg.tfs.pat);
    featuresWithRels.push(...(data.value || []));
  }

  const linkedIdSet = new Set();
  for (const feat of featuresWithRels)
    for (const rel of (feat.relations || []))
      if (DEP_LINK_TYPES.has(rel.rel)) { const id = extractIdFromUrl(rel.url); if (id && id !== feat.id) linkedIdSet.add(id); }

  const linkedItems = await fetchWorkItemDetails([...linkedIdSet], ['System.Id', 'System.State', 'System.AreaPath'], cfg);
  const linkedMap   = new Map(linkedItems.map(item => [item.id, item]));

  let total = 0, blockedCount = 0, crossTeamCount = 0;
  const byTeam = {};

  for (const feat of featuresWithRels) {
    const rels = (feat.relations || []).filter(rel => DEP_LINK_TYPES.has(rel.rel));
    if (!rels.length) continue;
    const featTeam = extractTeam(feat.fields['System.AreaPath'] || '', teamRoot);
    let isBlocked = false, hasCrossTeam = false;
    for (const rel of rels) {
      const linkedId = extractIdFromUrl(rel.url);
      if (!linkedId || linkedId === feat.id) continue;
      const linked = linkedMap.get(linkedId);
      if (!linked) continue;
      const linkedTeam = extractTeam(linked.fields['System.AreaPath'] || '', teamRoot);
      if (linkedTeam !== featTeam) { crossTeamCount++; hasCrossTeam = true; }
      if (rel.rel === 'System.LinkTypes.Dependency-Forward' && linked.fields['System.State'] !== 'Done') isBlocked = true;
    }
    total++;
    if (isBlocked) blockedCount++;
    if (!byTeam[featTeam]) byTeam[featTeam] = { total: 0, blocked: 0, crossTeam: 0 };
    byTeam[featTeam].total++;
    if (isBlocked) byTeam[featTeam].blocked++;
    if (hasCrossTeam) byTeam[featTeam].crossTeam++;
  }

  return { total, blockedCount, crossTeamCount, byTeam };
}

module.exports = {
  SNAPSHOTS_DIR, getSnapshotsDir, ensureSnapshotsDir,
  listSnapshotFiles, listSnapshotMeta, readSnapshot,
  fetchTCSummary, fetchObjectivesSnapshot, fetchRisksSnapshot,
  fetchReleaseHealthSnapshot, fetchStoryMetricsSnapshot,
  fetchVelocitySnapshot, fetchPIChecksSnapshot, fetchDependenciesSnapshot,
};
