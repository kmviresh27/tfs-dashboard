'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, tfsPostWiql, fetchWorkItemDetails } = require('../tfsClient');
const { getLastNPIs, buildIterationClauses } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');
const { fetchLeafTeams } = require('../helpers/teamsHelper');

const router = express.Router();

const BUCKET_EDGES  = [0, 15, 30, 45, 60, 90, 120, Infinity];
const BUCKET_LABELS = ['0–15d', '16–30d', '31–45d', '46–60d', '61–90d', '91–120d', '120+d'];

function calcStats(values) {
  if (!values.length) return { total: 0, avg: null, median: null, p25: null, p75: null, stdDev: null, buckets: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const sum      = sorted.reduce((s, v) => s + v, 0);
  const avg      = Math.round(sum / sorted.length);
  const median   = sorted[Math.floor(sorted.length / 2)];
  const p25      = sorted[Math.floor(sorted.length * 0.25)];
  const p75      = sorted[Math.floor(sorted.length * 0.75)];
  const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / sorted.length;
  const stdDev   = Math.round(Math.sqrt(variance));
  const buckets  = BUCKET_LABELS.map((label, i) => ({
    label,
    count: sorted.filter(v =>
      i === 0 ? v <= 15 : v > BUCKET_EDGES[i] && v <= BUCKET_EDGES[i + 1]
    ).length,
    from: BUCKET_EDGES[i],
    to:   BUCKET_EDGES[i + 1],
  }));
  return { total: sorted.length, avg, median, p25, p75, stdDev, buckets };
}

/**
 * GET /api/cycle-time-distribution
 * Query params:
 *   teamPath  — filter to a specific team area path (optional)
 *   piCount   — number of last PIs to include (default 4)
 *   byTeam    — when "true" AND no teamPath, returns per-team breakdown
 */
router.get('/cycle-time-distribution', async (req, res) => {
  try {
    const cfg      = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm       = getFieldMappings(cfg);
    const n        = parseInt(req.query.piCount) || 4;
    const piLabels = getLastNPIs(n, fm.piStructure.pisPerYear, fm.piStructure.piNamingPattern);
    const teamPath = req.query.teamPath ? decodeURIComponent(req.query.teamPath).replace(/^ROOT:/i, '') : null;
    const byTeam   = req.query.byTeam === 'true' && !teamPath;
    const areaPath = teamPath || cfg.tfs.areaPath;
    const wiqlUrl  = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const effortField        = fm.fields.effortField || 'Microsoft.VSTS.Scheduling.Effort';
    const stateChangeDateField = fm.fields.stateChangeDateField;
    const featureDoneState   = fm.stateValues.featureDone || 'Done';
    const iterClause  = buildIterationClauses(cfg.tfs.iterationPath, piLabels);

    console.log('[cycle-time] dept=%s pis=%j iterBase=%s areaPath=%s state=%s',
      req.deptId, piLabels, cfg.tfs.iterationPath, areaPath, featureDoneState);

    const result = await tfsPostWiql(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
          AND [System.AreaPath] UNDER '${areaPath}'
          AND [System.State] = '${featureDoneState}'
          AND ${iterClause}
        ORDER BY [System.Id]`
    }, cfg.tfs.pat);

    console.log('[cycle-time] query returned %d ids', (result.workItems || []).length);


    const ids = (result.workItems || []).map(w => w.id);
    if (!ids.length) {
      const empty = { pis: piLabels, total: 0, avg: null, median: null, p25: null, p75: null, stdDev: null, buckets: [], values: [] };
      return res.json(byTeam ? { ...empty, byTeam: {} } : empty);
    }

    const items = await fetchWorkItemDetails(ids, [
      'System.Id', 'System.Title', 'System.AreaPath',
      'System.CreatedDate', 'System.ChangedDate',
      stateChangeDateField, effortField,
      'Microsoft.VSTS.Common.ClosedDate',
    ].filter(Boolean), cfg);

    // Build array of { id, title, days, areaPath }
    const rows = [];
    for (const item of items) {
      const created   = item.fields['System.CreatedDate'];
      // Prefer stateChangeDateField, fall back to ClosedDate, then ChangedDate
      const stateDate = (stateChangeDateField && item.fields[stateChangeDateField])
        || item.fields['Microsoft.VSTS.Common.ClosedDate']
        || item.fields['System.ChangedDate'];
      if (!created || !stateDate) continue;
      const days = Math.max(0, Math.floor((new Date(stateDate) - new Date(created)) / 86400000));
      rows.push({
        id: item.id,
        title: item.fields['System.Title'] || '',
        days,
        areaPath: item.fields['System.AreaPath'] || '',
      });
    }

    const allValues = rows.map(r => r.days);
    const overall   = calcStats(allValues);

    if (!byTeam) {
      return res.json({ pis: piLabels, values: allValues, ...overall });
    }

    // Fetch true leaf teams (nodes with no children) from TFS area tree
    const leafTeams = await fetchLeafTeams(cfg);
    // If leafTeams is empty (API failure / unconfigured), fall back to using
    // the second-to-last path segment as team (depth-2 children of root)
    const useLeafFallback = leafTeams.size === 0;

    const teamRoots = Array.isArray(cfg.tfs.teamRootPath) ? cfg.tfs.teamRootPath
      : cfg.tfs.teamRootPath ? [cfg.tfs.teamRootPath]
      : cfg.tfs.areaPath    ? [cfg.tfs.areaPath]
      : [];
    const normRoots = teamRoots.map(r => r.replace(/\//g, '\\').toLowerCase());

    const teamMap = new Map();
    const misassigned = [];
    for (const row of rows) {
      const normArea = row.areaPath.replace(/\//g, '\\').toLowerCase();
      const underRoot = normRoots.length === 0
        || normRoots.some(r => normArea === r || normArea.startsWith(r + '\\'));

      const parts = row.areaPath.replace(/\//g, '\\').split('\\').filter(Boolean);
      const team = parts[parts.length - 1];
      // Accept if: under root AND (known leaf team OR fallback mode with depth >= 2)
      const isTeamLevel = useLeafFallback ? (underRoot && parts.length >= 2 && team) : leafTeams.has(team);
      if (underRoot && team && isTeamLevel) {
        if (!teamMap.has(team)) teamMap.set(team, []);
        teamMap.get(team).push(row.days);
      } else {
        misassigned.push({ id: row.id, title: row.title, areaPath: row.areaPath });
      }
    }

    const byTeamStats = {};
    for (const [team, vals] of teamMap) {
      byTeamStats[team] = calcStats(vals);
    }

    res.json({ pis: piLabels, values: allValues, ...overall, byTeam: byTeamStats, misassigned });
  } catch (e) {
    console.error('[cycle-time-distribution]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
