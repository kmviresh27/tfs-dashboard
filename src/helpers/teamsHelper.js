'use strict';
const { tfsGet } = require('../tfsClient');

/**
 * Fetch true leaf team names from TFS area classification tree.
 * A leaf node = a node that has NO children (actual scrum team).
 * Searches under each entry in cfg.tfs.teamRootPath.
 * Strips the "\Area\" segment TFS injects after the project name.
 *
 * Returns a Set<string> of leaf team names (e.g. {"DevOps_Installation", "TopQ", ...})
 *
 * Result is cached for 30 minutes (area structure changes rarely).
 */

const _teamsCache = new Map(); // cacheKey → { teams: Set, expiresAt }
const TEAMS_TTL   = 30 * 60 * 1000; // 30 minutes

async function fetchLeafTeams(cfg) {
  const teamRoots = Array.isArray(cfg.tfs.teamRootPath)
    ? cfg.tfs.teamRootPath
    : cfg.tfs.teamRootPath ? [cfg.tfs.teamRootPath]
    : cfg.tfs.areaPath    ? [cfg.tfs.areaPath]   // fallback: use areaPath root
    : [];
  if (!teamRoots.length) return new Set();

  const cacheKey = `${cfg.tfs.baseUrl}:${teamRoots.join('|')}`;
  const cached   = _teamsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.teams;

  // Fetch deep enough to capture all sub-teams (depth=10)
  const url  = `${cfg.tfs.baseUrl}/_apis/wit/classificationnodes/areas?$depth=10&api-version=${cfg.tfs.apiVersion}`;
  const data = await tfsGet(url, cfg.tfs.pat);

  // TFS node paths include "\Area\" after the project name — normalise it away
  function normPath(p) {
    return (p || '').replace(/\//g, '\\').replace(/\\Area\\/i, '\\').replace(/^\\/, '').toLowerCase();
  }

  function findNode(node, rootPath) {
    if (!node) return null;
    if (normPath(node.path) === rootPath.replace(/\//g, '\\').toLowerCase()) return node;
    for (const c of node.children || []) {
      const found = findNode(c, rootPath);
      if (found) return found;
    }
    return null;
  }

  // Recursively collect nodes that have NO children — true leaf/scrum teams
  function collectLeaves(node, result) {
    if (!node) return;
    const children = node.children || [];
    if (children.length === 0) {
      if (node.name) result.add(node.name);
    } else {
      for (const child of children) collectLeaves(child, result);
    }
  }

  const leafTeams = new Set();
  for (const rootPath of teamRoots) {
    const node = findNode(data, rootPath);
    if (node) collectLeaves(node, leafTeams);
  }

  _teamsCache.set(cacheKey, { teams: leafTeams, expiresAt: Date.now() + TEAMS_TTL });
  return leafTeams;
}

/** Bust cached teams for a given TFS base URL (e.g. after config change). */
function bustTeamsCache(baseUrl) {
  for (const key of _teamsCache.keys()) {
    if (key.startsWith(baseUrl + ':')) _teamsCache.delete(key);
  }
}

module.exports = { fetchLeafTeams, bustTeamsCache };
