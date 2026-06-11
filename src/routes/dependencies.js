'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet, tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { extractTeam } = require('../helpers/dataProcessors');
const { parsePILabels, getDefaultPIs, buildIterationClauses } = require('../helpers/piHelpers');

const router = express.Router();

const DEP_LINK_TYPES = new Set([
  'System.LinkTypes.Dependency-Forward',
  'System.LinkTypes.Dependency-Reverse',
  'System.LinkTypes.Related'
]);

function extractIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// Parse REQ_xxx / COM_xxx tags — same logic as objectivesPlan.js
function parseTeamTags(tagsStr = '') {
  const reqTeams = [];
  const comTeams = [];
  (tagsStr || '').split(/[;,]/).map(t => t.trim()).filter(Boolean).forEach(tag => {
    const u = tag.toUpperCase();
    if (u.startsWith('REQ_'))      reqTeams.push(tag.slice(4).trim());
    else if (u.startsWith('COM_')) comTeams.push(tag.slice(4).trim());
  });
  return { reqTeams, comTeams };
}

async function fetchDependenciesData(req) {
  const cfg = loadConfig(req.deptId);
  const query = req.query;
  if (!cfg.tfs.pat) {
    const error = new Error('PAT not configured');
    error.status = 400;
    throw error;
  }

  let piLabels = parsePILabels(query);
  if (!piLabels || !piLabels.length) piLabels = getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern);

  const teamPath = query.teamPath || null;
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  const teamPart = teamPath ? ` AND [System.AreaPath] UNDER '${teamPath}'` : '';

  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems
      WHERE [System.WorkItemType] = 'Feature'
        AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
        ${iterPart}${teamPart}
      ORDER BY [System.Id]`
  };

  const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const result = await tfsPost(wiqlUrl, wiql, cfg.tfs.pat);
  const featIds = (result.workItems || []).map(w => w.id);

  if (!featIds.length) {
    return {
      meta: { fetchedAt: new Date().toISOString(), pis: piLabels, total: 0 },
      features: [],
      total: 0,
      crossTeamCount: 0,
      blockedCount: 0,
      byTeam: {}
    };
  }

  const featuresWithRels = [];
  for (let i = 0; i < featIds.length; i += 50) {
    const chunk = featIds.slice(i, i + 50);
    const url = `${cfg.tfs.baseUrl}/_apis/wit/workitems?ids=${chunk.join(',')}&$expand=relations&api-version=${cfg.tfs.apiVersion}`;
    const data = await tfsGet(url, cfg.tfs.pat);
    featuresWithRels.push(...(data.value || []));
  }

  const linkedIdSet = new Set();
  for (const feat of featuresWithRels) {
    for (const rel of (feat.relations || [])) {
      if (!DEP_LINK_TYPES.has(rel.rel)) continue;
      const id = extractIdFromUrl(rel.url);
      if (id && id !== feat.id) linkedIdSet.add(id);
    }
  }

  const linkedItems = await fetchWorkItemDetails(
    [...linkedIdSet],
    ['System.Id', 'System.Title', 'System.State', 'System.AreaPath'],
    cfg
  );
  const linkedMap = new Map(linkedItems.map(item => [item.id, item]));

  const teamRoot = cfg.tfs.teamRootPath || cfg.tfs.areaPath;

  // ── Build tag maps from all features ────────────────────────────────────────
  // featTagMap: id → { reqTeams, comTeams, team }
  const featTagMap = new Map();
  for (const feat of featuresWithRels) {
    const { reqTeams, comTeams } = parseTeamTags(feat.fields['System.Tags'] || '');
    const team = extractTeam(feat.fields['System.AreaPath'] || '', teamRoot);
    featTagMap.set(feat.id, { reqTeams, comTeams, team });
  }

  // comMap[providerTeam][requesterTeam] = [featureId, ...]
  // e.g. comMap['Avyay']['Hercules'] = features from Avyay with COM_Hercules tag
  const comMap = {};
  featTagMap.forEach((info, id) => {
    info.comTeams.forEach(requesterTeam => {
      if (!comMap[info.team]) comMap[info.team] = {};
      if (!comMap[info.team][requesterTeam]) comMap[info.team][requesterTeam] = [];
      comMap[info.team][requesterTeam].push(id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  const features = [];
  let crossTeamCount = 0;
  let blockedCount = 0;
  const byTeam = {};

  for (const feat of featuresWithRels) {
    const rels = (feat.relations || []).filter(rel => DEP_LINK_TYPES.has(rel.rel));
    const tagInfo = featTagMap.get(feat.id) || { reqTeams: [], comTeams: [] };

    // Skip if neither link deps nor tag-based REQ deps exist
    if (!rels.length && !tagInfo.reqTeams.length) continue;

    const featState = feat.fields['System.State'] || '';
    const featTeam = extractTeam(feat.fields['System.AreaPath'] || '', teamRoot);
    const deps = [];
    let isBlocked = false;
    let isBlocker = false;

    // ── Link-type dependencies (TFS relations) ─────────────────────────────────
    for (const rel of rels) {
      const linkedId = extractIdFromUrl(rel.url);
      if (!linkedId || linkedId === feat.id) continue;
      const linked = linkedMap.get(linkedId);
      if (!linked) continue;

      const linkedTeam = extractTeam(linked.fields['System.AreaPath'] || '', teamRoot);
      const linkedState = linked.fields['System.State'] || '';
      const crossTeam = linkedTeam !== featTeam;

      deps.push({
        id: linked.id,
        title: linked.fields['System.Title'],
        state: linkedState,
        team: linkedTeam,
        linkType: rel.rel,
        crossTeam,
        depType: 'link',
      });

      if (crossTeam) crossTeamCount++;
      if (rel.rel === 'System.LinkTypes.Dependency-Forward' && linkedState !== 'Done') isBlocked = true;
      if (rel.rel === 'System.LinkTypes.Dependency-Reverse' && featState !== 'Done') isBlocker = true;
    }

    // ── Tag-based dependencies (REQ_xxx / COM_xxx) ────────────────────────────
    // For each REQ_TeamX tag: find features from TeamX that have COM_featTeam
    const linkDepIds = new Set(deps.map(d => d.id));
    for (const reqTeam of tagInfo.reqTeams) {
      const matchingIds = (comMap[reqTeam] && comMap[reqTeam][featTeam]) || [];
      if (matchingIds.length > 0) {
        for (const comFeatId of matchingIds) {
          if (linkDepIds.has(comFeatId) || comFeatId === feat.id) continue;
          linkDepIds.add(comFeatId);
          const comFeat = featuresWithRels.find(f => f.id === comFeatId);
          const comState = comFeat ? (comFeat.fields['System.State'] || 'Unknown') : 'Unknown';
          deps.push({
            id: comFeatId,
            title: comFeat ? comFeat.fields['System.Title'] : `#${comFeatId}`,
            state: comState,
            team: reqTeam,
            linkType: 'tag',
            crossTeam: true,
            depType: 'tag',
            reqTeam,
          });
          crossTeamCount++;
          if (comState !== 'Done') isBlocked = true;
        }
      } else {
        // No matching COM feature found — mark as unmatched REQ
        const virtualId = `vtag-${feat.id}-${reqTeam.replace(/\W/g, '')}`;
        if (!linkDepIds.has(virtualId)) {
          linkDepIds.add(virtualId);
          deps.push({
            id: virtualId,
            title: `${reqTeam} (no COM match)`,
            state: 'Unmatched',
            team: reqTeam,
            linkType: 'tag',
            crossTeam: true,
            depType: 'tag',
            isUnmatched: true,
            reqTeam,
          });
          crossTeamCount++;
          isBlocked = true; // unmatched REQ is a blocking concern
        }
      }
    }

    if (!deps.length) continue;

    if (isBlocked) blockedCount++;

    if (!byTeam[featTeam]) byTeam[featTeam] = { hasBlocker: 0, isBlocker: 0 };
    if (isBlocked) byTeam[featTeam].hasBlocker++;
    if (isBlocker) byTeam[featTeam].isBlocker++;

    // Deviation: REQ with no matching COM, or COM with no matching REQ
    const allTagTeams = [...new Set([...tagInfo.reqTeams, ...tagInfo.comTeams])];
    const hasDeviation = allTagTeams.some(t => !tagInfo.reqTeams.includes(t) || !tagInfo.comTeams.includes(t));

    features.push({
      id: feat.id,
      title: feat.fields['System.Title'],
      state: featState,
      team: featTeam,
      iter: feat.fields['System.IterationPath'],
      reqTeams: tagInfo.reqTeams,
      comTeams: tagInfo.comTeams,
      hasDeviation,
      deps
    });
  }

  return {
    meta: { fetchedAt: new Date().toISOString(), pis: piLabels, total: features.length },
    features,
    total: features.length,
    crossTeamCount,
    blockedCount,
    byTeam
  };
}

// ─── GET /api/dependencies ────────────────────────────────────────────────────
// Query params:
//   pis[]    — e.g. ?pis[]=26-PI1 (default: completed PIs of current year)
//   teamPath — optional AreaPath filter
router.get('/dependencies', async (req, res) => {
  try {
    const payload = await fetchDependenciesData(req);
    res.json(payload);
  } catch (e) {
    console.error('[dependencies]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/dependencies/matrix', async (req, res) => {
  try {
    const payload = await fetchDependenciesData(req);
    const matrix = {};
    const teams = new Set();
    let maxValue = 0;

    payload.features.forEach(feature => {
      feature.deps.forEach(dep => {
        if (!dep.crossTeam || !feature.team || !dep.team) return;
        if (!matrix[feature.team]) matrix[feature.team] = {};
        matrix[feature.team][dep.team] = (matrix[feature.team][dep.team] || 0) + 1;
        maxValue = Math.max(maxValue, matrix[feature.team][dep.team]);
        teams.add(feature.team);
        teams.add(dep.team);
      });
    });

    const hotspots = Object.entries(matrix)
      .flatMap(([from, targets]) => Object.entries(targets).map(([to, count]) => ({ from, to, count })))
      .filter(item => item.count >= 2)
      .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

    res.json({
      teams: [...teams].sort((a, b) => a.localeCompare(b)),
      matrix,
      maxValue,
      hotspots
    });
  } catch (e) {
    console.error('[dependencies/matrix]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;


