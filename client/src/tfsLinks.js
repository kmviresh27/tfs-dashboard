import { extractTeamFromPath } from './utils.js';

export function getTeamAreaPath(state) {
  const filter = state.selectedTeam;
  if (!filter) return null;
  if (filter.startsWith('ROOT:')) return filter.slice(5);
  const allItems = [
    ...(state.data?.features?.items || []),
    ...(state.data?.defects?.items  || [])
  ];
  const item = allItems.find(i => extractTeamFromPath(i.area) === filter);
  if (!item) return null;
  const area = (item.area || '').replace(/\//g, '\\');
  const roots = Array.isArray(state.teamRootPath)
    ? state.teamRootPath
    : state.teamRootPath ? [state.teamRootPath] : [];
  for (const root of roots) {
    const base = root.replace(/\\$/, '');
    if (area.startsWith(base)) {
      const rel     = area.slice(base.length + 1);
      const teamSeg = rel.split('\\')[0];
      return `${base}\\${teamSeg}`;
    }
  }
  return null;
}

export function getTeamAreaPathByName(teamName, store) {
  if (!teamName || !store) return null;
  const roots = Array.isArray(store.teamRootPath)
    ? store.teamRootPath
    : store.teamRootPath ? [store.teamRootPath] : [];
  for (const root of roots) {
    return `${root.replace(/\\$/, '')}\\${teamName}`;
  }
  // Fallback: strip last segment of areaPath and append teamName
  const base = (store.areaPath || '').replace(/\//g, '\\');
  const parts = base.split('\\').filter(Boolean);
  if (parts.length > 1) return [...parts.slice(0, -1), teamName].join('\\');
  return null;
}

export function buildTFSQueryUrl(tfsBaseUrl, wiql) {
  if (!tfsBaseUrl) return null;
  return `${tfsBaseUrl}/_workitems?_a=query&wiql=${encodeURIComponent(wiql)}`;
}

export function getPIs(state) {
  return state.selectedPIs.length
    ? state.selectedPIs
    : (state.availablePIs || []).filter(p => p.isPast || p.isCurrent).map(p => p.label);
}

export function buildSectionTFSUrl(state, workItemType, piLabels) {
  const area = getTeamAreaPath(state) || state.areaPath || '';
  const iterBase = state.iterationPath;
  if (!area) return null;
  let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.IterationPath],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${workItemType}' AND [System.AreaPath] UNDER '${area}'`;
  if (piLabels?.length && iterBase) {
    const piParts = piLabels.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`);
    wiql += ` AND (${piParts.join(' OR ')})`;
  }
  wiql += ' ORDER BY [System.Id]';
  return buildTFSQueryUrl(state.tfsBaseUrl, wiql);
}

/**
 * Build a WIQL query URL and open it in a new tab.
 * @param {object} store - Zustand store state
 * @param {string[]} pis - PI labels array
 * @param {string} workItemType - 'Feature', 'Defect', etc.
 * @param {string[]} extraClauses - extra AND clauses (e.g. ["[System.State]='Done'"])
 * @param {string} [overrideArea] - override the area path (e.g. for team-filtered charts)
 */
export function openChartTFS(store, pis, workItemType, extraClauses = [], overrideArea = null) {
  const area     = overrideArea || getTeamAreaPath(store) || store.areaPath || '';
  const iterBase = store.iterationPath;
  if (!store.tfsBaseUrl || !area) return;
  let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],[System.IterationPath] FROM WorkItems WHERE [System.WorkItemType]='${workItemType}' AND [System.AreaPath] UNDER '${area}'`;
  if (pis?.length && iterBase) {
    const piParts = pis.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`);
    wiql += ` AND (${piParts.join(' OR ')})`;
  }
  for (const clause of extraClauses) {
    wiql += ` AND ${clause}`;
  }
  wiql += ' ORDER BY [System.Id]';
  const url = buildTFSQueryUrl(store.tfsBaseUrl, wiql);
  if (url) window.open(url, '_blank', 'noopener');
}
