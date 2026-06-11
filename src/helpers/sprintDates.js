'use strict';
const { tfsGet } = require('../tfsClient');

/**
 * Fetch start/end dates for each sprint label within a PI.
 * Returns { "Sprint 1": { start: Date, end: Date }, ... }
 */
async function fetchSprintDates(cfg, pi, sprintLabels) {
  try {
    const iterBase = cfg.tfs.iterationPath;
    const project  = cfg.tfs.project || '';
    const apiVer   = cfg.tfs.apiVersion;

    // Build the iteration sub-path relative to the project root:
    // - On-prem TFS: iterBase='Healthcare IT\ISP' → strip project name → subParts=['ISP']
    // - ADO: iterBase='DCP' (= project root itself) → subParts=[]
    const parts    = iterBase.replace(/\\/g, '/').split('/').filter(Boolean);
    const subParts = parts.length > 1 ? parts.slice(1)
                   : (parts[0]?.toLowerCase() === project.toLowerCase() ? [] : parts);
    const pathSegs = [...subParts, pi].map(encodeURIComponent).join('/');
    const url      = `${cfg.tfs.baseUrl}/_apis/wit/classificationNodes/Iterations/${pathSegs}?$depth=1&api-version=${apiVer}`;
    const data     = await tfsGet(url, cfg.tfs.pat);
    const result   = {};
    for (const child of (data.children || [])) {
      const name = (child.name || '').toLowerCase();
      for (const s of sprintLabels) {
        const sl = s.toLowerCase();
        // Match: exact (ADO: 'sp1'), dash-prefixed (ADO: 'pi26.2-sp1'), space-prefixed (on-prem: '26-pi1 s1')
        if (name === sl || name.endsWith(`-${sl}`) || name.endsWith(` ${sl}`)) {
          result[s] = {
            start: child.attributes && child.attributes.startDate  ? new Date(child.attributes.startDate)  : null,
            end:   child.attributes && child.attributes.finishDate ? new Date(child.attributes.finishDate) : null,
          };
          break;
        }
      }
    }
    return result;
  } catch (e) {
    console.warn('[sprintDates] Sprint dates unavailable:', e.message.slice(0, 200));
    return {};
  }
}

/**
 * Returns true if the sprint start date is strictly after today.
 */
function isSprintFuture(label, sprintWindows) {
  const w = sprintWindows && sprintWindows[label];
  if (!w || !w.start) return false;
  return w.start > new Date();
}

module.exports = { fetchSprintDates, isSprintFuture };
