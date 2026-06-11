'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { loadConfig }           = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { getFieldMappings }     = require('../helpers/fieldMappings');
const { getSnapshotsDir, readSnapshot } = require('../helpers/snapshots');

const router = express.Router();

// Sidecar scope items stored next to snapshot: snapshots/{id}_scope.json
function scopeFile(snapshotId, deptId) {
  return path.join(getSnapshotsDir(deptId), `${snapshotId}_scope.json`);
}

function readScopeItems(snapshotId, deptId) {
  const f = scopeFile(snapshotId, deptId);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; }
}

function writeScopeItems(snapshotId, items, deptId) {
  fs.writeFileSync(scopeFile(snapshotId, deptId), JSON.stringify(items, null, 2));
}

async function fetchPIScope(cfg, fm, piLabels, filterPath = null, requestState = null) {
  const wiqlUrl  = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const iterBase = cfg.tfs.iterationPath;
  const areaBase = filterPath || cfg.tfs.areaPath;  // team-scoped when provided

  const featureType  = fm.workItemTypes.feature  || 'Feature';
  const storyType    = fm.workItemTypes.story     || 'User Story';
  const storyRemoved = fm.stateValues.storyRemoved || 'Removed';
  const featRemoved  = fm.stateValues.featureRemoved || 'Removed';

  const iterClauses = piLabels.map(p => `[System.IterationPath] UNDER '${iterBase}\\${p}'`).join(' OR ');
  const iterFilter  = `(${iterClauses})`;
  const reportWarning = (message) => {
    console.warn(message);
    if (requestState?.warnings) requestState.warnings.push(message);
  };

  const [featResSettled, storyResSettled] = await Promise.allSettled([
    tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${featureType}' AND [System.AreaPath] UNDER '${areaBase}' AND (${iterFilter}) AND [System.State] <> '${featRemoved}' ORDER BY [System.Id]` }, cfg.tfs.pat),
    tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${storyType}' AND [System.AreaPath] UNDER '${areaBase}' AND (${iterFilter}) AND [System.State] <> '${storyRemoved}' ORDER BY [System.Id]` }, cfg.tfs.pat),
  ]);
  const featRes = featResSettled.status === 'fulfilled' ? featResSettled.value : { workItems: [] };
  const storyRes = storyResSettled.status === 'fulfilled' ? storyResSettled.value : { workItems: [] };
  if (featResSettled.status !== 'fulfilled') {
    reportWarning(`[scope-change] features fetch failed: ${featResSettled.reason?.message || 'Unknown error'}`);
  }
  if (storyResSettled.status !== 'fulfilled') {
    reportWarning(`[scope-change] stories fetch failed: ${storyResSettled.reason?.message || 'Unknown error'}`);
  }
  if (featResSettled.status !== 'fulfilled' && storyResSettled.status !== 'fulfilled' && requestState) requestState.shouldNoStore = true;

  const allIds = [
    ...(featRes.workItems || []).map(w => w.id),
    ...(storyRes.workItems || []).map(w => w.id),
  ];
  if (allIds.length === 0) return [];

  const effortField = fm.fields.effortField    || 'Microsoft.VSTS.Scheduling.Effort';
  const spField     = fm.fields.storyPointsField || 'Microsoft.VSTS.Scheduling.StoryPoints';
  const bvField     = fm.fields.businessValueField || 'Microsoft.VSTS.Common.BusinessValue';

  const items = await fetchWorkItemDetails(allIds, [
    'System.Id', 'System.WorkItemType', 'System.Title', 'System.State',
    'System.AreaPath', 'System.IterationPath', 'System.CreatedDate', 'System.ChangedDate',
    'System.ChangedBy', 'System.AssignedTo', 'System.Tags', 'System.Parent',
    effortField, spField, bvField,
  ], cfg);

  return items.map(item => {
    const f = item.fields;
    return {
      id:            f['System.Id'],
      type:          f['System.WorkItemType'],
      title:         f['System.Title'],
      state:         f['System.State'],
      areaPath:      f['System.AreaPath']      || '',
      iterationPath: f['System.IterationPath'] || '',
      createdDate:   f['System.CreatedDate'],
      changedDate:   f['System.ChangedDate'],
      changedBy:     typeof f['System.ChangedBy'] === 'object'
                       ? (f['System.ChangedBy']?.displayName || '')
                       : (f['System.ChangedBy'] || ''),
      assignedTo:    typeof f['System.AssignedTo'] === 'object'
                       ? (f['System.AssignedTo']?.displayName || '')
                       : (f['System.AssignedTo'] || ''),
      tags:          f['System.Tags'] || '',
      parentId:      f['System.Parent'] || null,
      effort:        parseFloat(f[effortField]) || 0,
      storyPoints:   parseFloat(f[spField])     || 0,
      businessValue: parseFloat(f[bvField])     || 0,
    };
  });
}

function getPoints(items) {
  return items.reduce((s, i) => s + (i.effort || i.storyPoints || 0), 0);
}

function sprintLabel(iterPath) {
  return (iterPath || '').replace(/\//g, '\\').split('\\').pop() || iterPath;
}

// ── GET /api/scope-change/compare ─────────────────────────────────────────────
// Uses an existing snapshot as the baseline reference.
// Lazily captures and caches raw scope items alongside the snapshot on first run.
router.get('/scope-change/compare', async (req, res) => {
  try {
    const { snapshotId } = req.query;
    if (!snapshotId) return res.status(400).json({ error: 'snapshotId is required' });

    const snapshot = readSnapshot(snapshotId, req.deptId);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const fm       = getFieldMappings(cfg);
    const piLabels = Array.isArray(snapshot.pis) && snapshot.pis.length ? snapshot.pis : [snapshot.pi].filter(Boolean);
    if (!piLabels.length) return res.status(400).json({ error: 'Snapshot has no PI labels' });
    const requestState = { warnings: [], shouldNoStore: false };

    // Optional team filter — baseline stored as all-teams; current queried at TFS level
    const teamPath = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;

    // Load or lazily capture baseline items for this snapshot (always stored unfiltered)
    let baselineItems = readScopeItems(snapshotId, req.deptId);
    if (!baselineItems) {
      baselineItems = await fetchPIScope(cfg, fm, piLabels, null, requestState);
      writeScopeItems(snapshotId, baselineItems, req.deptId);
    }

    // Apply team filter to baseline in-memory (stored file always has all teams)
    const filteredBaseline = teamPath
      ? baselineItems.filter(i => i.areaPath === teamPath || i.areaPath.startsWith(teamPath + '\\'))
      : baselineItems;

    // Fetch current scope from TFS — scoped to team if filter is active
    const currentItems = await fetchPIScope(cfg, fm, piLabels, teamPath, requestState);

    const baselineMap  = new Map(filteredBaseline.map(i => [i.id, i]));
    const currentMap   = new Map(currentItems.map(i  => [i.id, i]));
    const baselineDate = new Date(snapshot.capturedAt);

    const changes = { added: [], removed: [], estimateChanged: [], sprintMoved: [], teamChanged: [] };

    for (const [, curr] of currentMap) {
      if (!baselineMap.has(curr.id)) {
        const isMovedIn = new Date(curr.createdDate) < baselineDate;
        changes.added.push({ ...curr, changeType: isMovedIn ? 'MOVED_IN' : 'ADDED' });
      }
    }
    for (const [, base] of baselineMap) {
      if (!currentMap.has(base.id)) changes.removed.push({ ...base, changeType: 'REMOVED', changedDate: null });
    }

    // Fetch current changedDate for removed items so "When" reflects actual removal date
    const removedIds = changes.removed.map(i => i.id);
    if (removedIds.length > 0) {
      try {
        const removedDetails = await fetchWorkItemDetails(removedIds, ['System.Id', 'System.ChangedDate', 'System.ChangedBy'], cfg);
        const removedDateMap = new Map(removedDetails.map(i => [i.fields['System.Id'], {
          changedDate: i.fields['System.ChangedDate'],
          changedBy:   typeof i.fields['System.ChangedBy'] === 'object'
                         ? (i.fields['System.ChangedBy']?.displayName || '')
                         : (i.fields['System.ChangedBy'] || ''),
        }]));
        for (const item of changes.removed) {
          const d = removedDateMap.get(item.id);
          if (d) { item.changedDate = d.changedDate || item.changedDate; item.changedBy = d.changedBy || item.changedBy; }
        }
      } catch (_) { /* non-fatal — changedDate stays as baseline */ }
    }
    for (const [, curr] of currentMap) {
      if (!baselineMap.has(curr.id)) continue;
      const base       = baselineMap.get(curr.id);
      const basePoints = base.effort || base.storyPoints || 0;
      const currPoints = curr.effort || curr.storyPoints || 0;
      if (basePoints !== currPoints) {
        changes.estimateChanged.push({
          ...curr,
          changeType:     currPoints > basePoints ? 'ESTIMATE_INCREASED' : 'ESTIMATE_DECREASED',
          baselinePoints: basePoints, currentPoints: currPoints, delta: currPoints - basePoints,
        });
      }
      if (base.iterationPath !== curr.iterationPath) {
        changes.sprintMoved.push({
          ...curr, changeType: 'SPRINT_CHANGED',
          baselineSprint: sprintLabel(base.iterationPath),
          currentSprint:  sprintLabel(curr.iterationPath),
        });
      }
      if (base.areaPath !== curr.areaPath) {
        changes.teamChanged.push({
          ...curr, changeType: 'TEAM_CHANGED',
          baselineTeam: base.areaPath, currentTeam: curr.areaPath,
        });
      }
    }

    const baselinePoints = getPoints(filteredBaseline);
    const currentPoints  = getPoints(currentItems);
    const addedPoints    = getPoints(changes.added);
    const removedPoints  = getPoints(changes.removed);
    const absEstimateChg = changes.estimateChanged.reduce((s, i) => s + Math.abs(i.delta), 0);

    const netGrowthPct = baselinePoints > 0 ? (currentPoints - baselinePoints) / baselinePoints * 100 : 0;
    const churnPct     = baselinePoints > 0 ? (addedPoints + removedPoints + absEstimateChg) / baselinePoints * 100 : 0;

    let riskStatus = 'Green';
    if (netGrowthPct > 15 || churnPct > 25) riskStatus = 'Red';
    else if (netGrowthPct > 5)              riskStatus = 'Amber';

    const byType = arr => arr.reduce((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {});

    if (requestState.shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({
      summary: {
        snapshotLabel:        snapshot.label,
        baselineDate:         snapshot.capturedAt,
        piLabels,
        teamFilter:           teamPath || null,
        baselineItemCount:    filteredBaseline.length,
        currentItemCount:     currentItems.length,
        baselinePoints:       Math.round(baselinePoints * 10) / 10,
        currentPoints:        Math.round(currentPoints  * 10) / 10,
        addedPoints:          Math.round(addedPoints    * 10) / 10,
        removedPoints:        Math.round(removedPoints  * 10) / 10,
        netGrowthPct:         Math.round(netGrowthPct   * 10) / 10,
        churnPct:             Math.round(churnPct       * 10) / 10,
        riskStatus,
        addedCount:           changes.added.length,
        removedCount:         changes.removed.length,
        estimateChangedCount: changes.estimateChanged.length,
        sprintMovedCount:     changes.sprintMoved.length,
        teamChangedCount:     changes.teamChanged.length,
        addedByType:          byType(changes.added),
        removedByType:        byType(changes.removed),
      },
      changes,
      ...(requestState.warnings.length ? { _warnings: requestState.warnings } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/scope-change/report ─────────────────────────────────────────────
// Generates a printable HTML report of the scope change comparison.
router.get('/scope-change/report', async (req, res) => {
  try {
    const { snapshotId } = req.query;
    if (!snapshotId) return res.status(400).send('<h2>Missing snapshotId</h2>');

    const snapshot = readSnapshot(snapshotId, req.deptId);
    if (!snapshot) return res.status(404).send('<h2>Snapshot not found</h2>');

    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).send('<h2>PAT not configured</h2>');

    const fm       = getFieldMappings(cfg);
    const piLabels = Array.isArray(snapshot.pis) && snapshot.pis.length ? snapshot.pis : [snapshot.pi].filter(Boolean);

    let baselineItems = readScopeItems(snapshotId, req.deptId);
    if (!baselineItems) {
      baselineItems = await fetchPIScope(cfg, fm, piLabels);
      writeScopeItems(snapshotId, baselineItems, req.deptId);
    }
    const currentItems = await fetchPIScope(cfg, fm, piLabels);

    const baselineMap  = new Map(baselineItems.map(i => [i.id, i]));
    const currentMap   = new Map(currentItems.map(i  => [i.id, i]));
    const baselineDate = new Date(snapshot.capturedAt);

    const changes = { added: [], removed: [], estimateChanged: [], sprintMoved: [], teamChanged: [] };
    for (const [, curr] of currentMap) {
      if (!baselineMap.has(curr.id)) {
        const isMovedIn = new Date(curr.createdDate) < baselineDate;
        changes.added.push({ ...curr, changeType: isMovedIn ? 'MOVED_IN' : 'ADDED' });
      }
    }
    for (const [, base] of baselineMap) {
      if (!currentMap.has(base.id)) changes.removed.push({ ...base, changeType: 'REMOVED', changedDate: null });
    }
    const removedIds = changes.removed.map(i => i.id);
    if (removedIds.length > 0) {
      try {
        const rd = await fetchWorkItemDetails(removedIds, ['System.Id', 'System.ChangedDate', 'System.ChangedBy'], cfg);
        const rdMap = new Map(rd.map(i => [i.fields['System.Id'], {
          changedDate: i.fields['System.ChangedDate'],
          changedBy: typeof i.fields['System.ChangedBy'] === 'object' ? (i.fields['System.ChangedBy']?.displayName || '') : (i.fields['System.ChangedBy'] || ''),
        }]));
        for (const item of changes.removed) {
          const d = rdMap.get(item.id);
          if (d) { item.changedDate = d.changedDate || item.changedDate; item.changedBy = d.changedBy || item.changedBy; }
        }
      } catch (_) {}
    }
    for (const [, curr] of currentMap) {
      if (!baselineMap.has(curr.id)) continue;
      const base = baselineMap.get(curr.id);
      const bp = base.effort || base.storyPoints || 0;
      const cp = curr.effort || curr.storyPoints || 0;
      if (bp !== cp) changes.estimateChanged.push({ ...curr, changeType: cp > bp ? 'ESTIMATE_INCREASED' : 'ESTIMATE_DECREASED', baselinePoints: bp, currentPoints: cp, delta: cp - bp });
      if (base.iterationPath !== curr.iterationPath) changes.sprintMoved.push({ ...curr, changeType: 'SPRINT_CHANGED', baselineSprint: sprintLabel(base.iterationPath), currentSprint: sprintLabel(curr.iterationPath) });
      if (base.areaPath !== curr.areaPath) changes.teamChanged.push({ ...curr, changeType: 'TEAM_CHANGED', baselineTeam: base.areaPath, currentTeam: curr.areaPath });
    }

    const baselinePoints = getPoints(baselineItems);
    const currentPoints  = getPoints(currentItems);
    const addedPoints    = getPoints(changes.added);
    const removedPoints  = getPoints(changes.removed);
    const absEst = changes.estimateChanged.reduce((s, i) => s + Math.abs(i.delta), 0);
    const netGrowthPct = baselinePoints > 0 ? Math.round((currentPoints - baselinePoints) / baselinePoints * 1000) / 10 : 0;
    const churnPct     = baselinePoints > 0 ? Math.round((addedPoints + removedPoints + absEst) / baselinePoints * 1000) / 10 : 0;
    let riskStatus = 'Green';
    if (netGrowthPct > 15 || churnPct > 25) riskStatus = 'Red';
    else if (netGrowthPct > 5)              riskStatus = 'Amber';

    const branding  = cfg.branding || {};
    const piLabel   = piLabels.join(', ');
    const genAt     = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const tfsBase   = cfg.tfs.baseUrl || '';
    const primColor = branding.primaryColor || '#0072db';

    function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function link(id) { return tfsBase ? `<a href="${esc(tfsBase)}/_workitems/edit/${id}" target="_blank">${id}</a>` : String(id); }
    function fmtDate(d) { if (!d) return '-'; try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (_) { return '-'; } }
    function sign(n) { return n > 0 ? '+' + n : String(n); }
    function teamLeaf(p) { return (p || '').split('\\').pop() || p; }

    const ragColor  = { Green: '#068443', Amber: '#d97706', Red: '#dc2626' }[riskStatus] || '#6b7280';
    const growColor = netGrowthPct > 15 ? '#dc2626' : netGrowthPct > 5 ? '#d97706' : '#068443';
    const churColor = churnPct > 25 ? '#dc2626' : '#d97706';

    const maxPts = Math.max(baselinePoints, currentPoints, 1);
    function pct(v) { return Math.round(v / maxPts * 100); }

    function barRow(label, val, color) {
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:110px;font-size:12px;color:#374151;font-weight:600">${esc(label)}</div>
        <div style="flex:1;background:#f3f4f6;border-radius:4px;height:22px;overflow:hidden">
          <div style="width:${pct(val)}%;background:${color};height:100%;border-radius:4px;min-width:${val>0?4:0}px"></div>
        </div>
        <div style="width:52px;text-align:right;font-size:13px;font-weight:700;color:${color}">${val}</div>
      </div>`;
    }

    function chgBadge(type) {
      const map = {
        ADDED:              ['Added',         '#068443'],
        MOVED_IN:           ['Moved In',      '#0072db'],
        REMOVED:            ['Removed',       '#dc2626'],
        ESTIMATE_INCREASED: ['Est. UP',       '#d97706'],
        ESTIMATE_DECREASED: ['Est. DOWN',     '#7c3aed'],
        SPRINT_CHANGED:     ['Sprint Moved',  '#7c3aed'],
        TEAM_CHANGED:       ['Team Changed',  '#0d9488'],
      };
      const [label, color] = map[type] || [type, '#6b7280'];
      return `<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700;background:${color}22;color:${color};border:1px solid ${color}66">${esc(label)}</span>`;
    }

    function buildChangeTable(rows, includeDetail = false) {
      if (!rows.length) return '<p style="color:#9ca3af;font-size:12px;margin:0">No items.</p>';
      const detailCol = includeDetail ? '<th>Detail</th>' : '';
      const trs = rows.map(item => {
        const pts = item.effort || item.storyPoints || 0;
        let detail = '';
        if (item.changeType === 'ESTIMATE_INCREASED' || item.changeType === 'ESTIMATE_DECREASED')
          detail = `${item.baselinePoints} → ${item.currentPoints} (${sign(item.delta)} pts)`;
        else if (item.changeType === 'SPRINT_CHANGED')
          detail = `${esc(item.baselineSprint||'?')} → ${esc(item.currentSprint||'?')}`;
        else if (item.changeType === 'TEAM_CHANGED')
          detail = `${esc(teamLeaf(item.baselineTeam))} → ${esc(teamLeaf(item.currentTeam))}`;
        const detailTd = includeDetail ? `<td style="font-size:11px;color:#6b7280">${detail||'-'}</td>` : '';
        return `<tr>
          <td>${link(item.id)}</td>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.title)}">${esc(item.title)}</td>
          <td>${chgBadge(item.changeType)}</td>
          <td style="font-size:11px;color:#6b7280">${esc(teamLeaf(item.areaPath))}</td>
          <td style="font-size:11px;color:#6b7280">${esc(sprintLabel(item.iterationPath))}</td>
          ${detailTd}
          <td style="text-align:center;font-size:11px;color:#6b7280">${fmtDate(item.changedDate)}</td>
          <td style="font-size:11px;color:#6b7280;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.changedBy||'-')}</td>
          <td style="text-align:right;font-weight:600">${pts||'-'}</td>
          <td style="font-size:11px;color:#6b7280;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.assignedTo||'-')}</td>
        </tr>`;
      }).join('');
      const detailTh = includeDetail ? '<th>Detail</th>' : '';
      return `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f3f4f6">
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap">ID</th>
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">Title</th>
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">Change</th>
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">Team</th>
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">Sprint</th>
          ${detailTh}
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">When</th>
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">Changed By</th>
          <th style="padding:7px 8px;text-align:right;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">Pts</th>
          <th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#6b7280;border-bottom:2px solid #e5e7eb">Owner</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
    }

    const allChanges = [...changes.added, ...changes.removed, ...changes.estimateChanged, ...changes.sprintMoved, ...changes.teamChanged];

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scope Change Report — ${esc(piLabel)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; background: #fff; color: #111827; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 32px 28px; }
.print-btn { position: fixed; top: 16px; right: 16px; background: ${primColor}; color: #fff; border: none;
  border-radius: 6px; padding: 9px 20px; cursor: pointer; font-size: 13px; font-weight: 600;
  box-shadow: 0 2px 8px rgba(0,0,0,.2); z-index: 99; }
.header { display: flex; align-items: flex-start; gap: 16px; padding-bottom: 18px;
  border-bottom: 3px solid ${primColor}; margin-bottom: 24px; }
.header-text h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; color: #111827; }
.header-text .meta { font-size: 11px; color: #9ca3af; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 24px; }
.kpi { border: 1px solid #e5e7eb; border-radius: 8px; padding: 13px 15px; background: #f9fafb; }
.kpi .lbl { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
.kpi .val { font-size: 26px; font-weight: 700; line-height: 1.1; }
.kpi .sub { font-size: 11px; color: #9ca3af; margin-top: 3px; }
.sec { margin-bottom: 28px; page-break-inside: avoid; }
.sec-title { font-size: 13px; font-weight: 700; color: ${primColor}; border-bottom: 1.5px solid #bfdbfe;
  padding-bottom: 6px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; }
.sec-title .cnt { font-size: 11px; font-weight: 600; background: ${primColor}22; color: ${primColor};
  padding: 1px 8px; border-radius: 10px; }
td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
tr:hover td { background: #fafafa; }
a { color: ${primColor}; text-decoration: none; }
.footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e5e7eb;
  display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
.chart-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; background: #f9fafb; }
.chart-card h3 { font-size: 12px; font-weight: 700; color: #374151; margin: 0 0 14px;
  text-transform: uppercase; letter-spacing: .04em; }
.breakdown-row { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.bd-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.bd-label { font-size: 12px; color: #374151; flex: 1; }
.bd-val { font-size: 15px; font-weight: 700; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-btn { display: none !important; }
  .wrap { padding: 0; }
  .page-break { page-break-before: always; padding-top: 20px; }
}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
<div class="wrap">

  <div class="header">
    <div class="header-text">
      <h1>Scope Change Report — ${esc(piLabel)}</h1>
      <div class="meta">
        Baseline: <strong>${esc(snapshot.label || snapshotId)}</strong>
        &nbsp;·&nbsp; Captured: <strong>${fmtDate(snapshot.capturedAt)}</strong>
        &nbsp;·&nbsp; Generated: ${esc(genAt)}
        ${branding.appSubtitle ? ' &nbsp;·&nbsp; ' + esc(branding.appSubtitle) : ''}
      </div>
    </div>
  </div>

  <!-- KPIs -->
  <div class="kpis">
    <div class="kpi"><div class="lbl">Baseline Points</div><div class="val" style="color:#6b7280">${baselinePoints}</div><div class="sub">${baselineItems.length} items</div></div>
    <div class="kpi"><div class="lbl">Current Points</div><div class="val" style="color:${primColor}">${currentPoints}</div><div class="sub">${currentItems.length} items</div></div>
    <div class="kpi"><div class="lbl">Net Growth</div><div class="val" style="color:${growColor}">${sign(netGrowthPct)}%</div><div class="sub">${sign(currentPoints - baselinePoints)} pts</div></div>
    <div class="kpi"><div class="lbl">Scope Churn</div><div class="val" style="color:${churColor}">${churnPct}%</div></div>
    <div class="kpi"><div class="lbl">Added Points</div><div class="val" style="color:#068443">+${addedPoints}</div><div class="sub">${changes.added.length} items</div></div>
    <div class="kpi"><div class="lbl">Removed Points</div><div class="val" style="color:#dc2626">-${removedPoints}</div><div class="sub">${changes.removed.length} items</div></div>
    <div class="kpi"><div class="lbl">Risk Status</div><div class="val" style="color:${ragColor}">${esc(riskStatus)}</div></div>
    <div class="kpi"><div class="lbl">Total Changes</div><div class="val" style="color:#374151">${allChanges.length}</div></div>
  </div>

  <!-- Charts -->
  <div class="chart-grid">
    <div class="chart-card">
      <h3>Scope Points Comparison</h3>
      ${barRow('Baseline', baselinePoints, '#6b7280')}
      ${barRow('Current',  currentPoints,  primColor)}
      ${barRow('Added',    addedPoints,    '#068443')}
      ${barRow('Removed',  removedPoints,  '#dc2626')}
    </div>
    <div class="chart-card">
      <h3>Change Breakdown</h3>
      ${[
        { label: 'Added / Moved-In',  val: changes.added.length,           color: '#068443' },
        { label: 'Removed',            val: changes.removed.length,         color: '#dc2626' },
        { label: 'Estimate Changed',   val: changes.estimateChanged.length, color: '#d97706' },
        { label: 'Sprint Moved',       val: changes.sprintMoved.length,     color: '#7c3aed' },
        { label: 'Team Changed',       val: changes.teamChanged.length,     color: '#0d9488' },
      ].map(r => `<div class="breakdown-row">
        <div class="bd-dot" style="background:${r.color}"></div>
        <div class="bd-label">${esc(r.label)}</div>
        <div class="bd-val" style="color:${r.color}">${r.val}</div>
      </div>`).join('')}
    </div>
  </div>

  <!-- All Changes -->
  <div class="sec">
    <div class="sec-title">📋 All Changes <span class="cnt">${allChanges.length}</span></div>
    ${buildChangeTable(allChanges, true)}
  </div>

  ${changes.added.length ? `<div class="sec page-break">
    <div class="sec-title">✅ Added &amp; Moved-In <span class="cnt">${changes.added.length}</span></div>
    ${buildChangeTable(changes.added)}
  </div>` : ''}

  ${changes.removed.length ? `<div class="sec page-break">
    <div class="sec-title">❌ Removed <span class="cnt">${changes.removed.length}</span></div>
    ${buildChangeTable(changes.removed)}
  </div>` : ''}

  ${changes.estimateChanged.length ? `<div class="sec page-break">
    <div class="sec-title">📐 Estimate Changes <span class="cnt">${changes.estimateChanged.length}</span></div>
    ${buildChangeTable(changes.estimateChanged, true)}
  </div>` : ''}

  ${changes.sprintMoved.length ? `<div class="sec page-break">
    <div class="sec-title">📅 Sprint Moves <span class="cnt">${changes.sprintMoved.length}</span></div>
    ${buildChangeTable(changes.sprintMoved, true)}
  </div>` : ''}

  ${changes.teamChanged.length ? `<div class="sec page-break">
    <div class="sec-title">👥 Team Changes <span class="cnt">${changes.teamChanged.length}</span></div>
    ${buildChangeTable(changes.teamChanged, true)}
  </div>` : ''}

  <div class="footer">
    <span>${esc(branding.companyName || '')} · ${esc(branding.appName || 'AV Dashboard')} · Scope Change Report</span>
    <span>${esc(genAt)}</span>
  </div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[scope-change/report]', e.message);
    res.status(500).send(`<h2>Error: ${e.message}</h2>`);
  }
});

module.exports = router;

