'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { processFeatures, processDefects } = require('../helpers/dataProcessors');
const { listSnapshotFiles } = require('../helpers/snapshots');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ─── GET /api/defect-field-stats ───────────────────────────────────────────────
// Defects raised per quarter (all, excl Removed + Enhancement)
// Field defects (HowFound='Found In Field') by Project/release field
router.get('/defect-field-stats', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const teamPath = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    let piLabels = req.query['pis[]'] || req.query.pis;
    if (!piLabels) piLabels = [];
    else if (typeof piLabels === 'string') piLabels = piLabels.split(',').map(s => s.trim());
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);

    const iterBase     = cfg.tfs.iterationPath;
    const teamPathNorm = teamPath ? teamPath.replace(/\//g, '\\').toLowerCase() : null;

    function matchesTeam(areaPath) {
      if (!teamPathNorm) return true;
      const norm = (areaPath || '').replace(/\//g, '\\').toLowerCase();
      return norm === teamPathNorm || norm.startsWith(teamPathNorm + '\\');
    }
    function matchesPI(iterPath) {
      if (!piLabels.length || !iterBase) return true;
      const norm = (iterPath || '').replace(/\//g, '\\').toLowerCase();
      return piLabels.some(pi => {
        const prefix = `${iterBase}\\${pi}`.toLowerCase();
        return norm === prefix || norm.startsWith(prefix + '\\');
      });
    }

    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const result  = await tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${fm.workItemTypes.defect}' AND [System.State]<>'${fm.stateValues.defectRemoved}' AND [${fm.fields.defectClassificationField}]<>'${fm.stateValues.defectEnhancementValue}' ORDER BY [System.CreatedDate]`
    }, cfg.tfs.pat);

    const allIds = (result.workItems || []).map(w => w.id);
    if (!allIds.length) return res.json({ byQuarter: {}, byProject: {}, totalDefects: 0, totalFieldDefects: 0, fetchedAt: new Date().toISOString() });

    const fields = [...new Set([
      'System.Id', 'System.CreatedDate', 'System.AreaPath', 'System.IterationPath',
      'System.State', fm.fields.howFoundField, fm.fields.defectProjectField,
      fm.fields.closedDateField, fm.fields.resolvedDateField
    ])];
    const details = await fetchWorkItemDetails(allIds, fields, cfg);

    const teamFiltered = details.filter(i => matchesTeam(i.fields['System.AreaPath'] || ''));

    const currentYear = new Date().getFullYear();
    const byQuarterRaised = {};
    const byQuarterClosed = {};

    teamFiltered.forEach(i => {
      const created = new Date(i.fields['System.CreatedDate']);
      if (!isNaN(created) && created.getFullYear() === currentYear) {
        const key = `${currentYear}-Q${Math.ceil((created.getMonth() + 1) / 3)}`;
        byQuarterRaised[key] = (byQuarterRaised[key] || 0) + 1;
      }

      const state    = i.fields['System.State'] || '';
      const closedRaw = i.fields[fm.fields.closedDateField]
                     || (state === 'Resolved' ? i.fields[fm.fields.resolvedDateField] : null);
      if (closedRaw) {
        const closed = new Date(closedRaw);
        if (!isNaN(closed) && closed.getFullYear() === currentYear) {
          const key = `${currentYear}-Q${Math.ceil((closed.getMonth() + 1) / 3)}`;
          byQuarterClosed[key] = (byQuarterClosed[key] || 0) + 1;
        }
      }
    });

    const byQuarter = { raised: byQuarterRaised, closed: byQuarterClosed };

    const piFiltered   = teamFiltered.filter(i => matchesPI(i.fields['System.IterationPath'] || ''));
    const fieldDefects = piFiltered.filter(i => i.fields[fm.fields.howFoundField] === fm.stateValues.defectFieldFoundValue);
    const byProject    = {};
    fieldDefects.forEach(i => {
      const proj = (i.fields[fm.fields.defectProjectField] || 'Unknown').trim();
      byProject[proj] = (byProject[proj] || 0) + 1;
    });

    res.json({
      byQuarter,
      byProject,
      totalDefects:      teamFiltered.length,
      totalFieldDefects: fieldDefects.length,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[defect-field-stats]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/defect-density-trend ───────────────────────────────────────────
// Returns per-PI defect density: baseline (earliest snapshot) vs live (current TFS).
router.get('/defect-density-trend', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    let piLabels = req.query['pis[]'] || req.query.pis || [];
    if (typeof piLabels === 'string') piLabels = [piLabels];
    if (!Array.isArray(piLabels)) piLabels = [piLabels];
    piLabels = piLabels.filter(Boolean);
    if (!piLabels.length) return res.status(400).json({ error: 'pis[] required' });

    const teamPath   = req.query.teamPath || null;
    const filterPath = teamPath || cfg.tfs.areaPath;
    const wiqlUrl    = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const teamRoot   = cfg.tfs.teamRootPath || cfg.tfs.areaPath;
    const minFields  = ['System.Id', 'System.State', 'System.AreaPath'];

    const allSnaps   = listSnapshotFiles();
    const baselineMap = {};
    allSnaps.forEach(s => {
      (s.pis || (s.pi ? [s.pi] : [])).forEach(pi => {
        if (!piLabels.includes(pi)) return;
        const prev = baselineMap[pi];
        if (!prev || s.capturedAt < prev.capturedAt) {
          const fc = s.data?.features?.items?.length ?? s.features?.length ?? 0;
          const dc = s.data?.defects?.items?.length  ?? 0;
          baselineMap[pi] = {
            capturedAt:      s.capturedAt, label: s.label,
            baselineDensity: fc > 0 ? Math.round((dc / fc) * 100) / 100 : 0
          };
        }
      });
    });

    const warnings = [];
    let shouldNoStore = false;

    const liveDensitySettled = await Promise.allSettled(piLabels.map(async pi => {
      const [fwSettled, dwSettled] = await Promise.allSettled([
        tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${fm.workItemTypes.feature}' AND [System.AreaPath] UNDER '${filterPath}' AND [System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${pi}' ORDER BY [System.Id]` }, cfg.tfs.pat),
        tfsPost(wiqlUrl, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${fm.workItemTypes.defect}' AND [System.AreaPath] UNDER '${filterPath}' AND [System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${pi}' ORDER BY [System.Id]` }, cfg.tfs.pat)
      ]);
      const fw = fwSettled.status === 'fulfilled' ? fwSettled.value : { workItems: [] };
      const dw = dwSettled.status === 'fulfilled' ? dwSettled.value : { workItems: [] };
      if (fwSettled.status !== 'fulfilled') {
        const message = `[defect-density-trend] ${pi} features fetch failed: ${fwSettled.reason?.message || 'Unknown error'}`;
        warnings.push(message);
        console.warn(message);
      }
      if (dwSettled.status !== 'fulfilled') {
        const message = `[defect-density-trend] ${pi} defects fetch failed: ${dwSettled.reason?.message || 'Unknown error'}`;
        warnings.push(message);
        console.warn(message);
      }
      if (fwSettled.status !== 'fulfilled' && dwSettled.status !== 'fulfilled') shouldNoStore = true;

      const featIds = (fw.workItems || []).map(w => w.id);
      const defectIds = (dw.workItems || []).map(w => w.id);
      const [fItemsSettled, dItemsSettled] = await Promise.allSettled([
        featIds.length ? fetchWorkItemDetails(featIds, minFields, cfg) : Promise.resolve([]),
        defectIds.length ? fetchWorkItemDetails(defectIds, minFields, cfg) : Promise.resolve([])
      ]);
      const fItems = fItemsSettled.status === 'fulfilled' ? fItemsSettled.value : [];
      const dItems = dItemsSettled.status === 'fulfilled' ? dItemsSettled.value : [];
      if (fItemsSettled.status !== 'fulfilled') {
        const message = `[defect-density-trend] ${pi} feature details fetch failed: ${fItemsSettled.reason?.message || 'Unknown error'}`;
        warnings.push(message);
        console.warn(message);
      }
      if (dItemsSettled.status !== 'fulfilled') {
        const message = `[defect-density-trend] ${pi} defect details fetch failed: ${dItemsSettled.reason?.message || 'Unknown error'}`;
        warnings.push(message);
        console.warn(message);
      }
      if (fItemsSettled.status !== 'fulfilled' && dItemsSettled.status !== 'fulfilled') shouldNoStore = true;

      const fc = processFeatures(fItems, teamRoot, fm).total;
      const dc = processDefects(dItems, teamRoot, cfg.defectEscapeRatio, undefined, fm).total;
      return { pi, liveFeatures: fc, liveDefects: dc, liveDensity: fc > 0 ? Math.round((dc / fc) * 100) / 100 : 0 };
    }));
    if (liveDensitySettled.length && liveDensitySettled.every(entry => entry.status !== 'fulfilled')) shouldNoStore = true;
    const liveDensities = liveDensitySettled.map((entry, index) => {
      if (entry.status === 'fulfilled') return entry.value;
      const message = `[defect-density-trend] ${piLabels[index]} fetch failed: ${entry.reason?.message || 'Unknown error'}`;
      warnings.push(message);
      console.warn(message);
      return { pi: piLabels[index], liveFeatures: 0, liveDefects: 0, liveDensity: 0 };
    });

    const trend = piLabels.map(pi => {
      const b = baselineMap[pi] || null;
      const l = liveDensities.find(x => x.pi === pi) || {};
      return {
        pi,
        baselineDensity: b?.baselineDensity ?? null,
        baselineLabel: b?.label ?? null,
        baselineAt: b?.capturedAt ?? null,
        liveDensity: l.liveDensity ?? 0,
        liveFeatures: l.liveFeatures ?? 0,
        liveDefects: l.liveDefects ?? 0
      };
    });

    if (shouldNoStore) res.set('Cache-Control', 'no-store');
    res.json({ trend, ...(warnings.length ? { _warnings: warnings } : {}) });
  } catch (e) {
    console.error('[defect-density-trend]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/defect-version-stats ───────────────────────────────────────────
// Version-based defect aging analysis: KPI cards, age trends, component breakdown,
// carry forward, top oldest, release readiness RAG.
router.get('/defect-version-stats', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm  = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const teamPath     = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const areaBase     = teamPath || cfg.tfs.areaPath;
    const wiqlUrl      = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
    const fixVer       = fm.fields.fixedVersionField;
    const severityFld  = fm.fields.severityField  || 'Microsoft.VSTS.Common.Severity';
    const rankFld      = fm.fields.rankField       || '';
    const classFld     = fm.fields.defectClassificationField;
    const enhVal       = fm.stateValues.defectEnhancementValue;
    const removedState = fm.stateValues.defectRemoved;

    const currentYear  = new Date().getFullYear();
    const yearStart    = `${currentYear}-01-01T00:00:00.000Z`;

    const wiqlResult = await tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] = '${fm.workItemTypes.defect}'
          AND [System.AreaPath] UNDER '${areaBase}'
          AND [System.State] <> '${removedState}'
          AND [${classFld}] <> '${enhVal}'
          AND [System.CreatedDate] >= '${yearStart}'
        ORDER BY [System.CreatedDate]`
    }, cfg.tfs.pat);

    const allIds = (wiqlResult.workItems || []).map(w => w.id);
    if (!allIds.length) {
      return res.json({
        versions: [], versionStats: [],
        kpi: { totalActive: 0, medianAge: null, maxAge: null, carryForward: 0, withoutOwner: 0, withoutFixVersion: 0, criticalCount: 0, highCount: 0 },
        topOldest: [], carryForwardItems: [], relReadiness: 'Green', fetchedAt: new Date().toISOString()
      });
    }

    const fields = [
      'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
      'System.CreatedDate', 'System.AssignedTo', 'System.ChangedDate',
      fm.fields.closedDateField, fm.fields.resolvedDateField,
      fixVer, fm.fields.defectProjectField, severityFld, rankFld,
    ];
    const details = await fetchWorkItemDetails(allIds, fields, cfg);

    const today = new Date();

    const closedStates = new Set(fm.stateValues.defectClosed);
    function isActive(item) { return !closedStates.has(item.fields['System.State'] || ''); }

    function ageDays(item) {
      const created = new Date(item.fields['System.CreatedDate']);
      if (isNaN(created)) return 0;
      if (!isActive(item)) {
        const raw = item.fields[fm.fields.closedDateField]
                 || item.fields[fm.fields.resolvedDateField]
                 || item.fields['System.ChangedDate'];
        const closed = new Date(raw);
        if (!isNaN(closed)) return Math.max(0, Math.floor((closed - created) / 86400000));
      }
      return Math.max(0, Math.floor((today - created) / 86400000));
    }

    function median(arr) {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    }

    function getOwner(item) {
      const o = item.fields['System.AssignedTo'];
      return typeof o === 'object' ? (o?.displayName || '') : (o || '');
    }

    function compLabel(areaPath) {
      return (areaPath || '').replace(/\//g, '\\').split('\\').pop() || 'Unknown';
    }

    function isCritical(item) {
      const s = String(item.fields[severityFld] || item.fields[rankFld] || '').toLowerCase();
      return s.includes('1') || s.includes('critical');
    }
    function isHigh(item) {
      const s = String(item.fields[severityFld] || item.fields[rankFld] || '').toLowerCase();
      return s.includes('2') || s.includes('high');
    }

    // Group by FixedPlannedVersion
    const byVersion = {};
    for (const item of details) {
      const ver   = (item.fields[fixVer] || '').trim() || '(Unassigned)';
      const age   = ageDays(item);
      const comp  = compLabel(item.fields['System.AreaPath']);
      const activ = isActive(item);
      if (!byVersion[ver]) byVersion[ver] = { ages: [], activeAges: [], components: {}, items: [] };
      byVersion[ver].ages.push(age);
      if (activ) byVersion[ver].activeAges.push(age);
      byVersion[ver].components[comp] = (byVersion[ver].components[comp] || 0) + 1;
      byVersion[ver].items.push(item);
    }

    // Sort versions: (Unassigned) last, rest alphabetically
    const versions = Object.keys(byVersion).sort((a, b) => {
      if (a === '(Unassigned)') return 1;
      if (b === '(Unassigned)') return -1;
      return a.localeCompare(b);
    });

    const assignedVersions = versions.filter(v => v !== '(Unassigned)');
    const latestVersion    = assignedVersions[assignedVersions.length - 1] || null;

    // Carry forward = open defects NOT in the latest version (and not unassigned)
    const carryForwardItems = [];
    for (const item of details) {
      if (!isActive(item)) continue;
      const ver = (item.fields[fixVer] || '').trim() || '(Unassigned)';
      if (latestVersion && ver !== latestVersion && ver !== '(Unassigned)') {
        carryForwardItems.push({
          id:           item.fields['System.Id'],
          title:        item.fields['System.Title'],
          state:        item.fields['System.State'],
          age:          ageDays(item),
          fixedVersion: ver,
          sev:          item.fields[severityFld] || item.fields[rankFld] || '',
          owner:        getOwner(item),
          comp:         compLabel(item.fields['System.AreaPath']),
        });
      }
    }
    carryForwardItems.sort((a, b) => b.age - a.age);

    // Top 20 oldest ACTIVE defects
    const topOldest = details
      .filter(i => isActive(i))
      .map(item => ({
        id:           item.fields['System.Id'],
        title:        item.fields['System.Title'],
        state:        item.fields['System.State'],
        fixedVersion: (item.fields[fixVer] || '').trim() || '(Unassigned)',
        comp:         compLabel(item.fields['System.AreaPath']),
        sev:          item.fields[severityFld] || item.fields[rankFld] || '',
        age:          ageDays(item),
        owner:        getOwner(item),
        createdDate:  item.fields['System.CreatedDate'],
      }))
      .sort((a, b) => b.age - a.age)
      .slice(0, 20);

    // Overall KPIs
    const activeItems = details.filter(i => isActive(i));
    const allActiveAges = activeItems.map(i => ageDays(i));
    const withoutOwner      = activeItems.filter(i => !getOwner(i).trim()).length;
    const withoutFixVersion = activeItems.filter(i => !(item => (item.fields[fixVer] || '').trim())(i)).length;
    const criticalCount     = activeItems.filter(i => isCritical(i)).length;
    const highCount         = activeItems.filter(i => isHigh(i)).length;

    let relReadiness = 'Green';
    if (criticalCount > 0) relReadiness = 'Red';
    else if (highCount > 5 || carryForwardItems.length > 10) relReadiness = 'Amber';

    // Version stats for charts
    const versionStats = versions.map(ver => {
      const v    = byVersion[ver];
      const ages = v.ages;
      return {
        version:     ver,
        count:       ages.length,
        activeCount: v.activeAges.length,
        medianAge:   median(ages),
        minAge:      ages.length ? Math.min(...ages) : null,
        maxAge:      ages.length ? Math.max(...ages) : null,
        components:  v.components,
      };
    });

    res.json({
      versions,
      versionStats,
      kpi: {
        totalActive:    activeItems.length,
        medianAge:      median(allActiveAges),
        maxAge:         allActiveAges.length ? Math.max(...allActiveAges) : null,
        carryForward:   carryForwardItems.length,
        withoutOwner,
        withoutFixVersion,
        criticalCount,
        highCount,
      },
      topOldest,
      carryForwardItems,
      relReadiness,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[defect-version-stats]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/defect-escape-by-quarter ────────────────────────────────────────
// Defects split by in-house vs in-field per quarter for a given year.
// Query params: year (default current year), teamPath (optional)
router.get('/defect-escape-by-quarter', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    const fm  = getFieldMappings(cfg);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const year      = parseInt(req.query.year) || new Date().getFullYear();
    const teamPath  = req.query.teamPath ? decodeURIComponent(req.query.teamPath) : null;
    const areaBase  = teamPath || cfg.tfs.areaPath;

    const howFoundField = fm.fields.howFoundField  || 'Microsoft.VSTS.CMMI.HowFound';
    const inFieldVal    = fm.stateValues.defectFieldFoundValue || 'Found In Field';
    const removedState  = fm.stateValues.defectRemoved;
    const wiqlUrl       = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;

    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year + 1}-01-01`;

    const result = await tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] = '${fm.workItemTypes.defect}'
          AND [System.AreaPath] UNDER '${areaBase}'
          AND [System.State] <> '${removedState}'
          AND [System.CreatedDate] >= '${yearStart}'
          AND [System.CreatedDate] < '${yearEnd}'
        ORDER BY [System.CreatedDate]`,
    }, cfg.tfs.pat);

    const ids = (result.workItems || []).map(w => w.id);
    if (!ids.length) {
      const quarters = [1, 2, 3, 4].map(q => ({
        label: `${year}-Q${q}`, quarter: q, inHouse: 0, inField: 0, total: 0, ratio: 0,
      }));
      return res.json({ year, quarters, inFieldLabel: inFieldVal, fetchedAt: new Date().toISOString() });
    }

    const details = await fetchWorkItemDetails(ids, [
      'System.Id', 'System.CreatedDate', 'System.AreaPath', howFoundField,
    ], cfg);

    // Group by quarter
    const byQ = { 1: { inHouse: 0, inField: 0 }, 2: { inHouse: 0, inField: 0 }, 3: { inHouse: 0, inField: 0 }, 4: { inHouse: 0, inField: 0 } };
    for (const item of details) {
      const created = new Date(item.fields['System.CreatedDate']);
      if (isNaN(created)) continue;
      const q        = Math.ceil((created.getMonth() + 1) / 3);
      const howFound = item.fields[howFoundField] || '';
      if (howFound === inFieldVal) byQ[q].inField++;
      else                         byQ[q].inHouse++;
    }

    const quarters = [1, 2, 3, 4].map(q => {
      const { inHouse, inField } = byQ[q];
      const total = inHouse + inField;
      // ratio = escaped(inField) / caught(inHouse) * 100  — same formula as rest of app
      const ratio = inHouse > 0 ? Math.round((inField / inHouse) * 100) : (inField > 0 ? 100 : 0);
      return { label: `${year}-Q${q}`, quarter: q, inHouse, inField, total, ratio };
    });

    res.json({ year, quarters, inFieldLabel: inFieldVal, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('[defect-escape-by-quarter]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
