'use strict';

const { getFieldMappings } = require('./fieldMappings');

/**
 * Returns a sort key for sprint labels/iteration paths so that
 * S1, S2, S3 … sort numerically and IP always sorts last.
 */
function sprintSortKey(iterPathOrLabel = '') {
  const seg = (iterPathOrLabel || '').replace(/\//g, '\\').split('\\').pop() || iterPathOrLabel;
  // Strip PI prefix: handles '26-PI1 S1', 'PI26.2-SP1', 'PI26.2 SP1'
  const label = seg.replace(/^.*?[-\s](S\d+|IP)$/i, '$1').trim().toUpperCase()
                || seg.replace(/^\d{2}-PI\d+[\s-]/i, '').trim().toUpperCase();
  if (label === 'IP') return '\xFF';
  const m = label.match(/^S(\d+)$/);
  if (m) return `S${m[1].padStart(4, '0')}`;
  return label;
}

function getCurrentPIInfo() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const month = now.getMonth() + 1;
  const pi = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return { yy: parseInt(yy), pi, year: now.getFullYear() };
}

/**
 * Format a PI label using the configured naming pattern.
 * Pattern tokens: {yy} = two-digit year, {n} = PI number.
 * Default pattern: '{yy}-PI{n}'  → '26-PI1'
 * Example custom:  'PI{yy}.{n}' → 'PI26.1'
 */
function getPILabel(yy, pi, pattern) {
  const pat = pattern || '{yy}-PI{n}';
  return pat
    .replace('{yy}', String(yy).padStart(2, '0'))
    .replace('{n}',  String(pi));
}

/**
 * Parse a PI label back to {yy, pi} using the configured naming pattern.
 * Returns null if the label doesn't match the pattern.
 */
function parsePILabel(label, pattern) {
  const pat = pattern || '{yy}-PI{n}';
  const groups = [];
  let regexStr = '';
  let i = 0;
  while (i < pat.length) {
    if (pat.startsWith('{yy}', i)) {
      groups.push('yy'); regexStr += '(\\d{2})'; i += 4;
    } else if (pat.startsWith('{n}', i)) {
      groups.push('n');  regexStr += '(\\d+)';   i += 3;
    } else {
      regexStr += pat[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++;
    }
  }
  const match = new RegExp('^' + regexStr + '$').exec(String(label || ''));
  if (!match) return null;
  const result = {};
  groups.forEach((g, idx) => { result[g] = parseInt(match[idx + 1], 10); });
  return (result.yy != null && result.n != null) ? { yy: result.yy, pi: result.n } : null;
}

/**
 * Returns all completed PIs for the current year (everything before current PI).
 * e.g. if currently in 26-PI2, returns ['26-PI1']
 * If PI=1 (start of year), returns last PI of previous year as fallback.
 */
function getDefaultPIs(pisPerYear = 4, pattern) {
  const { yy, pi } = getCurrentPIInfo();
  const n = Math.max(1, pisPerYear || 4);
  const pis = [];
  if (pi === 1) {
    pis.push(getPILabel(yy - 1, n, pattern));
  } else {
    for (let i = 1; i < pi; i++) {
      pis.push(getPILabel(yy, i, pattern));
    }
  }
  return pis;
}

/**
 * Build iteration path UNDER query for given PI labels.
 * e.g. ['26-PI1'] → UNDER 'Healthcare IT\ISP\26-PI1'
 */
function buildIterationClauses(iterBase, piLabels) {
  if (!piLabels || piLabels.length === 0) return '';
  const clauses = piLabels.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`);
  return clauses.length === 1 ? clauses[0] : '(' + clauses.join(' OR ') + ')';
}

/**
 * Get all available PIs for a given year (yy two-digit).
 * Returns array of {label, pi, yy}.
 */
function getAllPIsForYear(yy, pisPerYear = 4, pattern) {
  const n = Math.max(1, pisPerYear || 4);
  return Array.from({ length: n }, (_, i) => i + 1).map(pi => ({ label: getPILabel(yy, pi, pattern), pi, yy }));
}

function wiqlFeatures(cfg, piLabels) {
  const fm = getFieldMappings(cfg);
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  return {
    query: `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],
      [System.IterationPath],[System.AssignedTo],[Microsoft.VSTS.Scheduling.TargetDate],
      [System.CreatedDate],[System.ChangedDate],
      [Microsoft.VSTS.Common.ActivatedDate],[Microsoft.VSTS.Common.StateChangeDate]
    FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
      AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
      ${iterPart}
    ORDER BY [System.Id]`
  };
}

function wiqlStories(cfg, piLabels) {
  const fm = getFieldMappings(cfg);
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  return {
    query: `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],
      [System.IterationPath],[System.AssignedTo],[${fm.fields.storyPointsField}],
      [Microsoft.VSTS.Common.ActivatedDate],[Microsoft.VSTS.Common.StateChangeDate],
      [System.CreatedDate],[System.ChangedDate]
    FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.story}'
      AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
      ${iterPart}
    ORDER BY [System.Id]`
  };
}

function wiqlObjectives(cfg, piLabels) {
  const fm = getFieldMappings(cfg);
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  return {
    query: `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],
      [System.IterationPath],[System.AssignedTo],[${fm.fields.businessValueField}],
      [Microsoft.VSTS.Common.StateChangeDate],[System.CreatedDate]
    FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.objective}'
      AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
      ${iterPart}
    ORDER BY [System.Id]`
  };
}

function wiqlDefects(cfg, piLabels) {
  const fm = getFieldMappings(cfg);
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  return {
    query: `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],
      [System.IterationPath],[System.AssignedTo],[Microsoft.VSTS.Common.Priority],
      [System.CreatedDate],[System.ChangedDate],[System.Tags]
    FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.defect}'
      AND [System.AreaPath] UNDER '${cfg.tfs.areaPath}'
      ${iterPart}
    ORDER BY [System.Id]`
  };
}

function parsePILabels(query) {
  let piLabels = query['pis[]'] || query.pis;
  if (!piLabels) return null;
  if (typeof piLabels === 'string') piLabels = piLabels.split(',').map(s => s.trim());
  if (!Array.isArray(piLabels)) piLabels = [piLabels];
  return piLabels.filter(Boolean);
}

/**
 * Returns the last N PIs before (and including) the current PI.
 * e.g. if currently 26-PI2, last4 = ['26-PI2','26-PI1','25-PI4','25-PI3']
 */
function getLastNPIs(n = 4, pisPerYear = 4, pattern) {
  const { yy, pi } = getCurrentPIInfo();
  const result = [];
  let curYY = yy, curPI = pi;
  for (let i = 0; i < n; i++) {
    result.push(getPILabel(curYY, curPI, pattern));
    curPI--;
    if (curPI < 1) { curPI = pisPerYear; curYY--; }
  }
  return result;
}

module.exports = {
  getCurrentPIInfo, getPILabel, parsePILabel, getDefaultPIs, getLastNPIs,
  buildIterationClauses, getAllPIsForYear,
  wiqlFeatures, wiqlDefects, wiqlStories, wiqlObjectives, parsePILabels,
  sprintSortKey, buildSprintIterPath, matchSprintSuffix,
};

/**
 * Build the full iteration path for a sprint within a PI.
 *
 * sprintSubpathPattern tokens: {pi} = PI label, {sprint} = sprint suffix
 *   '{pi} {sprint}' (default) → iterBase\piLabel\piLabel sprintSuffix  e.g. Healthcare IT\ISP\26-PI1\26-PI1 S1
 *   '{sprint}'                → iterBase\piLabel\sprintSuffix          e.g. DCP\PI26.2\SP1
 */
function buildSprintIterPath(iterBase, piLabel, sprintSuffix, subpathPattern) {
  const pat = subpathPattern || '{pi} {sprint}';
  const sprintSubpath = pat
    .replace('{pi}',     piLabel)
    .replace('{sprint}', sprintSuffix);
  return `${iterBase}\\${piLabel}\\${sprintSubpath}`;
}

/**
 * Extract a sprint suffix from an iteration path, trying multiple naming conventions.
 * Returns the matching sprint suffix string, or null if none matched.
 *
 * Tries (in order):
 *  1. Last path segment equals sprint label exactly            → 'SP1'
 *  2. Last path segment equals '{pi} {sprint}'                → 'PI26.2 SP1'
 *  3. Any segment anywhere in the path contains the match     → fallback
 */
function matchSprintSuffix(iterPath, piLabel, sprintLabels) {
  if (!iterPath || !sprintLabels?.length) return null;
  const norm  = (iterPath || '').replace(/\//g, '\\');
  const segs  = norm.split('\\').filter(Boolean);
  const last  = (segs[segs.length - 1] || '').toLowerCase();
  const piL   = (piLabel || '').toLowerCase();

  for (const s of sprintLabels) {
    const sL = s.toLowerCase();
    // Exact last segment match: 'sp1' === 'sp1'
    if (last === sL) return s;
    // ADO dash format: 'pi26.2-sp1'
    if (last === `${piL}-${sL}`) return s;
    // On-prem TFS space format: '26-pi1 s1'
    if (last === `${piL} ${sL}`) return s;
    // Anywhere in full path (legacy fallback — space or dash)
    const lNorm = norm.toLowerCase();
    if (lNorm.includes(`${piL}-${sL}`) || lNorm.includes(`${piL} ${sL}`)) return s;
  }
  return null;
}
