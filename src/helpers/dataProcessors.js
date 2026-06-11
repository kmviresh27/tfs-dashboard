'use strict';

const { DEFAULTS } = require('./fieldMappings');

function extractTeam(areaPath, teamRoots) {
  if (!areaPath) return 'Unknown';
  const normalized = areaPath.replace(/\//g, '\\');
  const parts = normalized.split('\\').filter(Boolean);

  // Only extract a team if the path is under one of the configured roots
  if (teamRoots) {
    const roots = Array.isArray(teamRoots) ? teamRoots : [teamRoots];
    const normArea = normalized.toLowerCase();
    const underRoot = roots.some(r => {
      const nr = r.replace(/\//g, '\\').toLowerCase();
      return normArea === nr || normArea.startsWith(nr + '\\');
    });
    if (!underRoot) return 'Unknown';
    // Exclude features assigned exactly at the root (no scrum team below it)
    const rootLastSegs = new Set(roots.map(r => r.replace(/\//g, '\\').split('\\').filter(Boolean).pop()?.toLowerCase()).filter(Boolean));
    const last = parts[parts.length - 1];
    if (rootLastSegs.has(last?.toLowerCase())) return 'Unknown';
  }

  // Team = deepest (last) segment of the area path
  return parts[parts.length - 1] || 'Unknown';
}

function processFeatures(items, areaBase, fm) {
  const sv = fm ? fm.stateValues : DEFAULTS.stateValues;
  const featureStates = Array.isArray(sv.featureAllStates) && sv.featureAllStates.length
    ? sv.featureAllStates
    : DEFAULTS.stateValues.featureAllStates;
  const featureDone = sv.featureDone || DEFAULTS.stateValues.featureDone;
  const featureRemoved = sv.featureRemoved || DEFAULTS.stateValues.featureRemoved;
  const featureWip = Array.isArray(sv.featureWip) && sv.featureWip.length
    ? sv.featureWip
    : DEFAULTS.stateValues.featureWip;

  const effortField = (fm && fm.fields && fm.fields.effortField) || DEFAULTS.fields.effortField;

  const stateCounts = {};
  const teamBreakdown = {};
  const teamBreakdownByEffort = {};
  featureStates.forEach(s => (stateCounts[s] = 0));
  const throughputByIteration = {};
  const totalByIteration = {};       // all non-removed features by iteration
  const cycleTimes = []; // { team, days } for Done features
  const now = new Date();

  // Build set of normalised root paths; items whose area equals any root are not leaf-team items
  const _normRoots = (Array.isArray(areaBase) ? areaBase : (areaBase ? [areaBase] : []))
    .map(r => r.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, ''))
    .filter(Boolean);
  const isRootArea = (area) => {
    const norm = area.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
    return _normRoots.length > 0 && _normRoots.some(r => norm === r);
  };

  for (const item of items) {
    const state = item.fields['System.State'] || 'Unknown';
    const area  = item.fields['System.AreaPath'] || '';
    const team  = extractTeam(area, areaBase);
    // Skip items assigned directly to a team-root area (no leaf team sub-path)
    const isRootLevel = isRootArea(area);

    if (featureStates.includes(state)) stateCounts[state]++;

    const iterPath = item.fields['System.IterationPath'] || 'Unknown';
    const effort   = Number(item.fields[effortField]) || 0;

    if (!isRootLevel) {
      if (!teamBreakdown[team]) {
        teamBreakdown[team] = {};
        teamBreakdownByEffort[team] = {};
        featureStates.forEach(s => { teamBreakdown[team][s] = 0; teamBreakdownByEffort[team][s] = 0; });
      }
      if (featureStates.includes(state)) {
        teamBreakdown[team][state]++;
        teamBreakdownByEffort[team][state] = (teamBreakdownByEffort[team][state] || 0) + effort;
      }
    }

    if (state !== featureRemoved) {
      if (!totalByIteration[iterPath]) totalByIteration[iterPath] = { total: 0, done: 0, totalEffort: 0, doneEffort: 0 };
      totalByIteration[iterPath].total++;
      totalByIteration[iterPath].totalEffort += effort;
    }

    if (state === featureDone) {
      throughputByIteration[iterPath] = (throughputByIteration[iterPath] || 0) + 1;
      if (totalByIteration[iterPath]) {
        totalByIteration[iterPath].done++;
        totalByIteration[iterPath].doneEffort += effort;
      }
      // Cycle time: Forecasted (CreatedDate proxy) → Done (StateChangeDate)
      const stateChangeDate = item.fields['Microsoft.VSTS.Common.StateChangeDate'];
      const createdDate     = item.fields['System.CreatedDate'];
      if (stateChangeDate && createdDate) {
        const days = Math.max(0, Math.floor((new Date(stateChangeDate) - new Date(createdDate)) / 86400000));
        cycleTimes.push({ team, days });
      }
    }
  }

  const total    = items.length;
  const done     = stateCounts[featureDone] || 0;
  const active   = total - (stateCounts[featureRemoved] || 0);
  const doneRate = active > 0 ? Math.round((done / active) * 100) : 0;

  const wipCount = items.filter(item => {
    const s = item.fields['System.State'] || '';
    return featureWip.some(w => s === w) || s.toLowerCase().includes('progress');
  }).length;

  // Slipped features: not Done/Removed, whose PI is earlier than the max PI in the data
  const piRegex = /\d{2}-PI\d/;
  const allPIParts = items
    .map(i => {
      const segs = (i.fields['System.IterationPath'] || '').replace(/\//g, '\\').split('\\');
      return segs.find(s => piRegex.test(s)) || '';
    })
    .filter(Boolean);
  const uniquePIs = [...new Set(allPIParts)].sort();
  const maxPI = uniquePIs.length ? uniquePIs[uniquePIs.length - 1] : '';

  const slippedRaw = maxPI ? items.filter(item => {
    const state = item.fields['System.State'] || '';
    if (state === featureDone || state === featureRemoved) return false;
    const segs = (item.fields['System.IterationPath'] || '').replace(/\//g, '\\').split('\\');
    const piPart = segs.find(s => piRegex.test(s)) || '';
    return piPart && piPart < maxPI;
  }) : [];

  const slippedFeatures = {
    count: slippedRaw.length,
    items: slippedRaw.slice(0, 30).map(i => ({
      id:    i.id,
      title: i.fields['System.Title'],
      state: i.fields['System.State'],
      team:  extractTeam(i.fields['System.AreaPath'] || '', areaBase),
      iter:  i.fields['System.IterationPath']
    }))
  };

  const ctByTeam = {};
  cycleTimes.forEach(({ team, days }) => {
    if (!ctByTeam[team]) ctByTeam[team] = [];
    ctByTeam[team].push(days);
  });
  const cycleTime = {
    count: cycleTimes.length,
    avg:   cycleTimes.length ? Math.round(cycleTimes.reduce((s, c) => s + c.days, 0) / cycleTimes.length) : null,
    min:   cycleTimes.length ? Math.min(...cycleTimes.map(c => c.days)) : null,
    max:   cycleTimes.length ? Math.max(...cycleTimes.map(c => c.days)) : null,
    byTeam: Object.fromEntries(Object.entries(ctByTeam).map(([t, vals]) => [t, {
      avg:   Math.round(vals.reduce((s, d) => s + d, 0) / vals.length),
      min:   Math.min(...vals),
      max:   Math.max(...vals),
      count: vals.length
    }]))
  };

  // Feature Age: days items have been in current state (for non-Done/Removed features)
  const AGE_BUCKETS = ['<7d', '7-14d', '15-30d', '31-60d', '60+d'];
  const featureAgeBuckets = Object.fromEntries(AGE_BUCKETS.map(b => [b, 0]));
  const featureAgeItems = [];
  for (const item of items) {
    const state = item.fields['System.State'] || '';
    if (state === featureDone || state === featureRemoved) continue;
    const sd = item.fields['Microsoft.VSTS.Common.StateChangeDate'] || item.fields['System.ChangedDate'];
    const days = sd ? Math.floor((now - new Date(sd)) / 86400000) : 0;
    if (days < 7)       featureAgeBuckets['<7d']++;
    else if (days < 14) featureAgeBuckets['7-14d']++;
    else if (days < 30) featureAgeBuckets['15-30d']++;
    else if (days < 60) featureAgeBuckets['31-60d']++;
    else                featureAgeBuckets['60+d']++;
    if (days > 30) featureAgeItems.push({
      id: item.id,
      title: item.fields['System.Title'],
      state,
      team: extractTeam(item.fields['System.AreaPath'] || '', areaBase),
      days,
      iter: item.fields['System.IterationPath']
    });
  }
  featureAgeItems.sort((a, b) => b.days - a.days);
  const featureAge = { buckets: featureAgeBuckets, staleItems: featureAgeItems.slice(0, 20) };

  return {
    total, stateCounts, teamBreakdown, teamBreakdownByEffort, doneRate,
    wipCount, throughputByIteration, totalByIteration, slippedFeatures,
    cycleTime, featureAge,
    items: items.map(i => itemSummary(i, null, fm))
  };
}

function processDefects(items, areaBase, escapeCfg, defectFieldsCfg, fm) {
  const sv = fm ? fm.stateValues : DEFAULTS.stateValues;
  const defectStates = ['New', 'Accepted', 'Investigated', 'Planned', 'Resolved', 'Closed', 'Removed'];
  const defectClosed = Array.isArray(sv.defectClosed) && sv.defectClosed.length
    ? sv.defectClosed
    : DEFAULTS.stateValues.defectClosed;
  const defectRemoved = sv.defectRemoved || DEFAULTS.stateValues.defectRemoved;

  const stateCounts = {};
  const teamBreakdown       = {};
  const howFoundBreakdown   = {};
  const whereFoundBreakdown = {};
  const severityBreakdown   = {};
  const foundInBreakdown    = {};
  const injectionByIteration = {};
  const AGING_BUCKET_KEYS = ['0–7 days', '8–14 days', '15–30 days', '31–60 days', '60+ days'];
  const agingBuckets = Object.fromEntries(AGING_BUCKET_KEYS.map(b => [b, 0]));
  const agingByPriority = {};
  const slaBreachesArr = [];
  const now = new Date();
  defectStates.forEach(s => (stateCounts[s] = 0));

  const df           = defectFieldsCfg || {};
  const howField     = df.howFoundField   || (fm && fm.fields.howFoundField)   || '';
  const whereField   = df.whereFoundField || (fm && fm.fields.whereFoundField) || '';
  const sevField     = df.severityField   || (fm && fm.fields.severityField)   || 'Microsoft.VSTS.Common.Severity';
  const rankField    = (fm && fm.fields.rankField) || df.rankField || '';
  const foundInField = df.foundInBuildField || (fm && fm.fields.foundInBuildField) || 'Microsoft.VSTS.Build.FoundIn';
  const resolveByField = df.resolveByField || (fm && fm.fields.resolveByField) || '';

  const resolveByBreakdown = {}; // open defects by Generic04 value

  // Build set of normalised root paths for defects; items whose area equals any root are not leaf-team items
  const _normDefRoots = (Array.isArray(areaBase) ? areaBase : (areaBase ? [areaBase] : []))
    .map(r => r.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, ''))
    .filter(Boolean);
  const isDefRootArea = (area) => {
    const norm = area.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
    return _normDefRoots.length > 0 && _normDefRoots.some(r => norm === r);
  };

  for (const item of items) {
    const state      = item.fields['System.State'] || 'Unknown';
    const area       = item.fields['System.AreaPath'] || '';
    const team       = extractTeam(area, areaBase);
    const isRootLevel = isDefRootArea(area);
    const howFound   = (howField   && item.fields[howField])   || 'Unknown';
    const whereFound = (whereField && item.fields[whereField]) || 'Unknown';
    const severity   = (sevField   && item.fields[sevField])   || 'Unknown';

    if (defectStates.includes(state)) stateCounts[state]++;

    if (!isRootLevel) {
      if (!teamBreakdown[team]) {
        teamBreakdown[team] = {};
        defectStates.forEach(s => (teamBreakdown[team][s] = 0));
      }
      if (defectStates.includes(state)) teamBreakdown[team][state]++;
    }

    if (state !== defectRemoved) {
      if (howField)   howFoundBreakdown[howFound]     = (howFoundBreakdown[howFound]     || 0) + 1;
      if (whereField) whereFoundBreakdown[whereFound] = (whereFoundBreakdown[whereFound] || 0) + 1;
      severityBreakdown[severity] = (severityBreakdown[severity] || 0) + 1;

      const foundInVal = item.fields[foundInField] ?? null;
      const foundInKey = foundInVal || 'Unknown';
      foundInBreakdown[foundInKey] = (foundInBreakdown[foundInKey] || 0) + 1;
    }

    const iterPath = item.fields['System.IterationPath'] || 'Unknown';
    if (!injectionByIteration[iterPath]) injectionByIteration[iterPath] = { total: 0, open: 0 };
    injectionByIteration[iterPath].total++;
    if (!defectClosed.includes(state) && state !== defectRemoved) {
      injectionByIteration[iterPath].open++;
    }

    if (!defectClosed.includes(state) && state !== defectRemoved) {
      const createdDate = item.fields['System.CreatedDate'];
      const ageDays = createdDate
        ? Math.floor((now - new Date(createdDate)) / 86400000)
        : 0;

      if      (ageDays <=  7) agingBuckets['0–7 days']++;
      else if (ageDays <= 14) agingBuckets['8–14 days']++;
      else if (ageDays <= 30) agingBuckets['15–30 days']++;
      else if (ageDays <= 60) agingBuckets['31–60 days']++;
      else                    agingBuckets['60+ days']++;

      const priority = item.fields[rankField] ?? null;
      const prioKey  = priority != null ? String(priority) : 'null';
      if (!agingByPriority[prioKey]) agingByPriority[prioKey] = { count: 0, totalDays: 0, avgDays: 0 };
      agingByPriority[prioKey].count++;
      agingByPriority[prioKey].totalDays += ageDays;
      agingByPriority[prioKey].avgDays = Math.round(
        agingByPriority[prioKey].totalDays / agingByPriority[prioKey].count
      );

      const slaThreshold = priority === 1 ? 7 : priority === 2 ? 14 : 30;
      if (ageDays > slaThreshold) {
        slaBreachesArr.push({
          id: item.id, title: item.fields['System.Title'],
          priority, state, team, ageDays, slaThreshold
        });
      }

      // Resolve-by (Generic04) breakdown — normalize to merge near-duplicates
      const rawVal = resolveByField && item.fields[resolveByField];
      const resolveByVal = rawVal
        ? String(rawVal).trim().replace(/\s+/g, ' ')
        : 'Not Set';
      resolveByBreakdown[resolveByVal] = (resolveByBreakdown[resolveByVal] || 0) + 1;
    }
  }

  slaBreachesArr.sort((a, b) => b.ageDays - a.ageDays);
  const slaBreaches = slaBreachesArr.slice(0, 50);

  const total    = items.length;
  const resolved = defectClosed.reduce((sum, st) => sum + (stateCounts[st] || 0), 0);
  const active   = total - (stateCounts[defectRemoved] || 0);
  const resolveRate = active > 0 ? Math.round((resolved / active) * 100) : 0;

  const inFieldVal = (escapeCfg || {}).inFieldValue || DEFAULTS.stateValues.defectFieldFoundValue;
  const escaped    = howFoundBreakdown[inFieldVal] || 0;
  const caught     = Object.entries(howFoundBreakdown)
    .filter(([k]) => k !== inFieldVal)
    .reduce((s, [, v]) => s + v, 0);
  const escapeRatio = caught > 0 ? Math.round(escaped / caught * 100) : 0;

  const p1p2Count = items.filter(item => {
    const p = item.fields[rankField];
    const s = item.fields['System.State'];
    return (p === 1 || p === 2) && !defectClosed.includes(s) && s !== defectRemoved;
  }).length;

  return {
    total, stateCounts, teamBreakdown, resolveRate, escapeRatio, escaped, caught, p1p2Count,
    howFoundBreakdown, whereFoundBreakdown, severityBreakdown,
    foundInBreakdown, agingBuckets, agingByPriority, slaBreaches, injectionByIteration,
    resolveByBreakdown,
    items: items.map(i => itemSummary(i, df, fm))
  };
}

function itemSummary(item, defectFieldsCfg, fm) {
  const df           = defectFieldsCfg || {};
  const fields       = fm ? fm.fields : {};
  const howField     = df.howFoundField   || fields.howFoundField   || '';
  const whereField   = df.whereFoundField || fields.whereFoundField || '';
  const sevField     = df.severityField   || fields.severityField   || 'Microsoft.VSTS.Common.Severity';
  const rankField    = df.rankField       || fields.rankField       || '';
  const sizeField    = fields.effortField || 'Microsoft.VSTS.Scheduling.Effort';
  const storyField   = fields.storyPointsField || 'Microsoft.VSTS.Scheduling.StoryPoints';
  const foundInField = df.foundInBuildField || fields.foundInBuildField || 'Microsoft.VSTS.Build.FoundIn';
  const resolveByField = df.resolveByField || fields.resolveByField || '';

  const size = item.fields[sizeField] ?? item.fields[storyField] ?? null;
  return {
    id:    item.id,
    title: item.fields['System.Title'],
    state: item.fields['System.State'],
    area:  item.fields['System.AreaPath'],
    iter:  item.fields['System.IterationPath'],
    assignedTo: item.fields['System.AssignedTo']
      ? (item.fields['System.AssignedTo'].displayName || item.fields['System.AssignedTo'])
      : null,
    created:       item.fields['System.CreatedDate'],
    changed:       item.fields['System.ChangedDate'],
    stateChangeDate: item.fields['Microsoft.VSTS.Common.StateChangeDate'] ?? null,
    priority:   item.fields[rankField] ?? null,
    size:       size,
    severity:   (sevField   && item.fields[sevField])   ?? null,
    rank:       (rankField  && item.fields[rankField])  ?? null,
    howFound:   (howField   && item.fields[howField])   ?? null,
    whereFound: (whereField && item.fields[whereField]) ?? null,
    foundIn:    item.fields[foundInField] ?? null,
    resolveBy:  item.fields[resolveByField] != null
      ? String(item.fields[resolveByField]).trim().replace(/\s+/g, ' ')
      : null,
  };
}

module.exports = {
  FEATURE_STATES: DEFAULTS.stateValues.featureAllStates.slice(),
  DEFECT_STATES: ['New', 'Accepted', 'Investigated', 'Planned', 'Resolved', 'Closed', 'Removed'],
  extractTeam,
  processFeatures,
  processDefects,
  itemSummary
};
