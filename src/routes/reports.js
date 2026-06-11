'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsPost, fetchWorkItemDetails } = require('../tfsClient');
const { parsePILabels, getDefaultPIs, buildIterationClauses, sprintSortKey, buildSprintIterPath, matchSprintSuffix } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// ── Constants ──────────────────────────────────────────────────────────────
const CLOSED_DEFECT_STATES = new Set(['Resolved', 'Closed', 'Removed']);
const ACTIVE_RISK_STATES   = new Set(['Open', 'Identified', 'Owned', 'Accepted']);

// ── Utility helpers ────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatGeneratedAt(value) {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatProgrammeLabel(piLabels) {
  if (!piLabels.length) return 'Selected PI';
  if (piLabels.length === 1) return piLabels[0];
  return `${piLabels[0]}\u2013${piLabels[piLabels.length - 1]}`;
}

function normalizePiLabels(query) {
  let piLabels = parsePILabels(query);
  if (!piLabels || !piLabels.length) piLabels = getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern);
  if (!Array.isArray(piLabels)) piLabels = [piLabels];
  return [...new Set(piLabels.filter(Boolean))];
}

function extractSprintLabel(iterPath, piLabel, sprintLabels) {
  // Try pattern-aware match first (handles both '{pi} {sprint}' and '{sprint}' conventions)
  if (sprintLabels?.length) {
    const matched = matchSprintSuffix(iterPath, piLabel, sprintLabels);
    if (matched) return matched;
  }
  // Fallback: return last path segment, stripping PI prefix if present
  const segs = (iterPath || '').replace(/\//g, '\\').split('\\').filter(Boolean);
  const last = segs[segs.length - 1] || 'Unknown';
  if (piLabel && last.startsWith(piLabel + ' ')) return last.slice(piLabel.length + 1);
  return last;
}

function extractTeam(areaPath) {
  return (areaPath || '').replace(/\//g, '\\').split('\\').filter(Boolean).pop() || 'Unknown';
}

function displayName(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.displayName || field.uniqueName || '';
}

function isSevP1(sev) {
  const s = String(sev || '').toLowerCase();
  return s.includes('1') || s.includes('critical');
}

function isSevP2(sev) {
  const s = String(sev || '').toLowerCase();
  return s.includes('2') || s.includes('high');
}

function isInProgressState(state) {
  const n = String(state || '').trim().toLowerCase();
  return n === 'activated' || n === 'approved' || n === 'active'
    || n === 'in progress' || n.includes('progress');
}

function ragColor(value, thresholds, higherIsBetter = true) {
  if (!thresholds) return '#6b7280';
  if (higherIsBetter) {
    if (value >= thresholds.green) return '#068443';
    if (value >= thresholds.amber) return '#d97706';
    return '#dc2626';
  } else {
    if (value <= thresholds.green) return '#068443';
    if (value <= thresholds.amber) return '#d97706';
    return '#dc2626';
  }
}

function ragBadgeHtml(label, color) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${color};color:#fff">${escapeHtml(label)}</span>`;
}

function priorityLabel(p) {
  const n = parseInt(p, 10);
  if (n === 1) return 'P1-Critical';
  if (n === 2) return 'P2-High';
  if (n === 3) return 'P3-Medium';
  if (n === 4) return 'P4-Low';
  return 'Unknown';
}

function riskStateColor(state) {
  const s = String(state || '').toLowerCase();
  if (s === 'open' || s === 'identified') return '#dc2626';
  if (s === 'owned' || s === 'accepted') return '#d97706';
  if (s === 'mitigated' || s === 'resolved') return '#068443';
  return '#6b7280';
}

// ── HTML Building Blocks ───────────────────────────────────────────────────
function buildLogoHtml(branding) {
  if (branding.logoType === 'url' && branding.logoUrl) {
    return `<img src="${escapeHtml(branding.logoUrl)}" style="width:48px;height:48px;object-fit:contain;" alt="logo">`;
  }
  if (branding.logoType === 'svg' && branding.logoSvg) {
    return `<span style="display:inline-block;width:48px;height:48px;">${branding.logoSvg}</span>`;
  }
  const letter = (branding.companyName || 'A')[0].toUpperCase();
  const color = branding.primaryColor || '#0072db';
  return `<div style="width:48px;height:48px;background:${escapeHtml(color)};color:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700">${escapeHtml(letter)}</div>`;
}

function buildStyles(primaryColor) {
  const c = primaryColor || '#0072db';
  return `<style>
:root { --primary: ${c}; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; background: #fff; color: #111827; }
.no-print {}
.report-wrap { max-width: 1100px; margin: 0 auto; padding: 32px 28px; }
.print-btn { position: fixed; top: 16px; right: 16px; background: var(--primary); color: #fff; border: none; border-radius: 6px; padding: 8px 18px; cursor: pointer; font-size: 13px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 99; }
.report-header { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 3px solid var(--primary); margin-bottom: 24px; }
.report-title-block { flex: 1; }
.report-company { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; }
.report-title { font-size: 22px; font-weight: 700; color: #111827; margin: 3px 0; }
.report-meta { font-size: 11px; color: #9ca3af; }
.kpi-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
.kpi-card { padding: 14px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; }
.kpi-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
.kpi-value { font-size: 28px; font-weight: 700; line-height: 1; }
.kpi-sub { font-size: 11px; color: #9ca3af; margin-top: 3px; }
.section { margin-bottom: 28px; page-break-inside: avoid; }
.section-title { font-size: 14px; font-weight: 700; color: var(--primary); border-bottom: 1.5px solid #bfdbfe; padding-bottom: 6px; margin-bottom: 14px; display: flex; align-items: center; gap: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; padding: 7px 10px; background: #f3f4f6; color: #374151; font-weight: 600; border-bottom: 2px solid #e5e7eb; white-space: nowrap; }
td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; color: #374151; }
tr:nth-child(even) td { background: #fafafa; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
.report-footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
.page-break { page-break-before: always; padding-top: 28px; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } .report-wrap { padding: 0; } }
</style>`;
}

function buildKpiBar(kpis) {
  const cards = kpis.map(k => {
    const valueStyle = k.color ? `color:${k.color}` : '';
    return `<div class="kpi-card">
  <div class="kpi-label">${escapeHtml(k.label)}</div>
  <div class="kpi-value" style="${valueStyle}">${escapeHtml(String(k.value ?? ''))}</div>
  ${k.sub ? `<div class="kpi-sub">${escapeHtml(k.sub)}</div>` : ''}
</div>`;
  }).join('\n');
  return `<div class="kpi-bar">${cards}</div>`;
}

function buildTable(headers, rows, opts = {}) {
  const compact = opts.compact ? 'style="font-size:11px;"' : '';
  const ths = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const trs = rows.map(row => {
    const tds = row.map(cell => {
      if (cell && typeof cell === 'object' && cell.html !== undefined) {
        return `<td>${cell.html}</td>`;
      }
      return `<td>${escapeHtml(String(cell ?? ''))}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('\n');
  return `<table ${compact}><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function buildSection(icon, title, content) {
  const iconPart = icon ? `<span>${icon}</span>` : '';
  return `<div class="section">
  <div class="section-title">${iconPart}${escapeHtml(title)}</div>
  ${content}
</div>`;
}

function buildHtmlDoc(title, branding, sections, generatedAt, printBtn = true) {
  const styles = buildStyles(branding.primaryColor || '#0072db');
  const logoHtml = buildLogoHtml(branding);
  const printBtnHtml = printBtn
    ? `<button class="print-btn no-print" onclick="window.print()">\uD83D\uDDA8 Print / Save PDF</button>`
    : '';
  const sectionsHtml = sections.join('\n');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${styles}</head>
<body>
${printBtnHtml}
<div class="report-wrap">
  <div class="report-header">
    ${logoHtml}
    <div class="report-title-block">
      <div class="report-company">${escapeHtml(branding.companyName || '')}</div>
      <div class="report-title">${escapeHtml(title)}</div>
      <div class="report-meta">Generated: ${escapeHtml(generatedAt)}${branding.appSubtitle ? ' \u00B7 ' + escapeHtml(branding.appSubtitle) : ''}</div>
    </div>
  </div>
  ${sectionsHtml}
  <div class="report-footer">
    <span>${escapeHtml(branding.companyName || '')} \u00B7 ${escapeHtml(branding.appName || 'AV Dashboard')}</span>
    <span>${escapeHtml(generatedAt)}</span>
  </div>
</div>
</body>
</html>`;
}

// ── Data Fetcher Helpers ───────────────────────────────────────────────────
async function runWiql(cfg, wiql) {
  const url = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const result = await tfsPost(url, { query: wiql }, cfg.tfs.pat);
  return (result.workItems || []).map(item => item.id);
}

async function fetchFeatureItems(cfg, fm, piLabels, teamPath) {
  const areaPath = teamPath || cfg.tfs.areaPath;
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.feature}'
      AND [System.AreaPath] UNDER '${areaPath}'${iterPart}
    ORDER BY [System.Id]`;
  const ids = await runWiql(cfg, wiql);
  if (!ids.length) return [];
  const fields = [
    'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
    'System.IterationPath', 'System.AssignedTo', 'System.CreatedDate',
    fm.fields.stateChangeDateField, 'System.Tags',
    fm.fields.effortField, fm.fields.releaseField,
  ].filter(Boolean);
  return fetchWorkItemDetails(ids, fields, cfg);
}

async function fetchDefectItems(cfg, fm, piLabels, teamPath) {
  const areaPath = teamPath || cfg.tfs.areaPath;
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.defect}'
      AND [System.AreaPath] UNDER '${areaPath}'${iterPart}
    ORDER BY [System.Id]`;
  const ids = await runWiql(cfg, wiql);
  if (!ids.length) return [];
  const fields = [
    'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
    'System.IterationPath', fm.fields.severityField,
    fm.fields.effortField, 'System.Tags',
  ].filter(Boolean);
  return fetchWorkItemDetails(ids, fields, cfg);
}

async function fetchObjectiveItems(cfg, fm, piLabels, teamPath) {
  const areaPath = teamPath || cfg.tfs.areaPath;
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.objective}'
      AND [System.AreaPath] UNDER '${areaPath}'${iterPart}
    ORDER BY [System.Id]`;
  const ids = await runWiql(cfg, wiql);
  if (!ids.length) return [];
  const fields = [
    'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
    fm.fields.businessValueField,
  ].filter(Boolean);
  return fetchWorkItemDetails(ids, fields, cfg);
}

async function fetchRiskItems(cfg, fm, piLabels, teamPath) {
  const areaPath = teamPath || cfg.tfs.areaPath;
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  const riskType = fm.workItemTypes.risk || 'Risk';
  const prodRiskType = fm.workItemTypes.productRisk || 'Product Risk';
  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] IN ('${riskType}', '${prodRiskType}')
      AND [System.AreaPath] UNDER '${areaPath}'${iterPart}
    ORDER BY [System.Id]`;
  const ids = await runWiql(cfg, wiql);
  if (!ids.length) return [];
  const fields = [
    'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
    fm.fields.priorityField, 'System.Tags',
  ].filter(Boolean);
  return fetchWorkItemDetails(ids, fields, cfg);
}

async function fetchStoryItems(cfg, fm, piLabels, teamPath) {
  const areaPath = teamPath || cfg.tfs.areaPath;
  const iterClause = buildIterationClauses(cfg.tfs.iterationPath, piLabels);
  const iterPart = iterClause ? ` AND ${iterClause}` : '';
  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.WorkItemType] = '${fm.workItemTypes.story}'
      AND [System.AreaPath] UNDER '${areaPath}'${iterPart}
    ORDER BY [System.Id]`;
  const ids = await runWiql(cfg, wiql);
  if (!ids.length) return [];
  const fields = [
    'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
    'System.IterationPath', fm.fields.storyPointsField, fm.fields.effortField,
  ].filter(Boolean);
  return fetchWorkItemDetails(ids, fields, cfg);
}

// ── Send HTML helper ───────────────────────────────────────────────────────
function sendHtml(res, html, filename, inline) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!inline) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.send(html);
}

// ── Sprint-close WIQL helper — uses configurable sprintSubpathPattern ────────
function buildSprintClause(iterationBase, piLabels, sprint, subpathPattern) {
  const clauses = piLabels.map(pi =>
    `[System.IterationPath] UNDER '${buildSprintIterPath(iterationBase, pi, sprint, subpathPattern)}'`
  );
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PI Feature Delivery
// ═══════════════════════════════════════════════════════════════════════════
router.get('/pi-feature-delivery', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};

    const features    = await fetchFeatureItems(cfg, fm, piLabels, teamPath);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const total      = features.length;
    const done       = features.filter(f => f.fields['System.State'] === fm.stateValues.featureDone).length;
    const inProgress = features.filter(f => isInProgressState(f.fields['System.State'])).length;
    const doneRate   = total > 0 ? Math.round(done / total * 100) : 0;

    const kpis = [
      { label: 'Total Features', value: total },
      { label: 'Done',           value: done,        color: '#068443' },
      { label: 'Done %',         value: `${doneRate}%`, color: ragColor(doneRate, cfg.ragThresholds?.doneRate) },
      { label: 'In Progress',    value: inProgress },
    ];

    // Feature Delivery by Sprint
    const sprintMap = {};
    for (const f of features) {
      const sprint = extractSprintLabel(f.fields['System.IterationPath'], piLabels[0]);
      if (!sprintMap[sprint]) sprintMap[sprint] = { total: 0, done: 0, inProgress: 0, deferred: 0 };
      sprintMap[sprint].total++;
      const state = f.fields['System.State'] || '';
      if (state === fm.stateValues.featureDone)                                    sprintMap[sprint].done++;
      else if (isInProgressState(state))                                            sprintMap[sprint].inProgress++;
      else if (state === fm.stateValues.featureRemoved || state.toLowerCase().includes('defer')) sprintMap[sprint].deferred++;
    }
    const sprintRows = Object.entries(sprintMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sprint, s]) => [
        sprint, s.total, s.done, s.inProgress, s.deferred,
        `${s.total > 0 ? Math.round(s.done / s.total * 100) : 0}%`,
      ]);

    // Team Breakdown
    const teamMap = {};
    for (const f of features) {
      const team = extractTeam(f.fields['System.AreaPath'] || '');
      if (!teamMap[team]) teamMap[team] = { total: 0, done: 0, inProgress: 0 };
      teamMap[team].total++;
      const state = f.fields['System.State'] || '';
      if (state === fm.stateValues.featureDone) teamMap[team].done++;
      else if (isInProgressState(state))         teamMap[team].inProgress++;
    }
    const teamRows = Object.entries(teamMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, t]) => [
        team, t.total, t.done, t.inProgress,
        `${t.total > 0 ? Math.round(t.done / t.total * 100) : 0}%`,
      ]);

    // Full Feature List
    const featureRows = features.map(f => {
      const id     = f.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [
        idLink,
        f.fields['System.Title'] || '',
        f.fields['System.State'] || '',
        extractTeam(f.fields['System.AreaPath'] || ''),
        extractSprintLabel(f.fields['System.IterationPath'], piLabels[0]),
        displayName(f.fields['System.AssignedTo']),
      ];
    });

    const sections = [
      buildKpiBar(kpis),
      buildSection('📅', 'Feature Delivery by Sprint',
        sprintRows.length
          ? buildTable(['Sprint', 'Total', 'Done', 'In Progress', 'Deferred/Removed', 'Done %'], sprintRows)
          : '<p style="color:#6b7280">No sprint data.</p>'
      ),
      buildSection('👥', 'Team Breakdown',
        teamRows.length
          ? buildTable(['Team', 'Total', 'Done', 'In Progress', 'Done %'], teamRows)
          : '<p style="color:#6b7280">No team data.</p>'
      ),
      buildSection('📋', 'Full Feature List',
        featureRows.length
          ? buildTable(['ID', 'Title', 'State', 'Team', 'Sprint', 'Assigned To'], featureRows)
          : '<p style="color:#6b7280">No features found.</p>'
      ),
    ];

    const html = buildHtmlDoc(`PI Feature Delivery Report \u2014 ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `pi-feature-delivery-${piLabel}.html`, inline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Sprint Progress
// ═══════════════════════════════════════════════════════════════════════════
router.get('/sprint-progress', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};

    const [features, stories] = await Promise.all([
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
      fetchStoryItems(cfg, fm, piLabels, teamPath),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const storyDoneSet = new Set(fm.stateValues.storyDone || ['Done', 'Closed', 'Resolved']);
    const totalStories = stories.length;
    const doneStories  = stories.filter(s => storyDoneSet.has(s.fields['System.State'])).length;
    const storyDoneRate = totalStories > 0 ? Math.round(doneStories / totalStories * 100) : 0;

    // Sprint map (features + stories combined)
    const sprintMap = {};
    for (const f of features) {
      const sprint = extractSprintLabel(f.fields['System.IterationPath'], piLabels[0]);
      if (!sprintMap[sprint]) sprintMap[sprint] = { featDone: 0, featTotal: 0, storyDone: 0, storyTotal: 0 };
      sprintMap[sprint].featTotal++;
      if (f.fields['System.State'] === fm.stateValues.featureDone) sprintMap[sprint].featDone++;
    }
    for (const s of stories) {
      const sprint = extractSprintLabel(s.fields['System.IterationPath'], piLabels[0]);
      if (!sprintMap[sprint]) sprintMap[sprint] = { featDone: 0, featTotal: 0, storyDone: 0, storyTotal: 0 };
      sprintMap[sprint].storyTotal++;
      if (storyDoneSet.has(s.fields['System.State'])) sprintMap[sprint].storyDone++;
    }
    const sprintList = Object.keys(sprintMap).sort((a, b) => sprintSortKey(a).localeCompare(sprintSortKey(b)));
    const avgStoriesPerSprint = sprintList.length > 0 ? Math.round(totalStories / sprintList.length) : 0;

    const sprintRows = sprintList.map(sprint => {
      const s = sprintMap[sprint];
      return [
        sprint, s.featDone, s.featTotal, s.storyDone, s.storyTotal,
        `${s.storyTotal > 0 ? Math.round(s.storyDone / s.storyTotal * 100) : 0}%`,
      ];
    });

    // Team story completion
    const teamStoryMap = {};
    for (const s of stories) {
      const team = extractTeam(s.fields['System.AreaPath'] || '');
      if (!teamStoryMap[team]) teamStoryMap[team] = { done: 0, total: 0 };
      teamStoryMap[team].total++;
      if (storyDoneSet.has(s.fields['System.State'])) teamStoryMap[team].done++;
    }
    const teamStoryRows = Object.entries(teamStoryMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, t]) => [
        team, t.done, t.total,
        `${t.total > 0 ? Math.round(t.done / t.total * 100) : 0}%`,
      ]);

    // Carryover (stories not done, grouped by sprint)
    const carryoverSprints = {};
    for (const s of stories) {
      const sprint = extractSprintLabel(s.fields['System.IterationPath'], piLabels[0]);
      if (!carryoverSprints[sprint]) carryoverSprints[sprint] = { planned: 0, done: 0 };
      carryoverSprints[sprint].planned++;
      if (storyDoneSet.has(s.fields['System.State'])) carryoverSprints[sprint].done++;
    }
    const carryoverRows = Object.entries(carryoverSprints)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sprint, c]) => {
        const carryover = c.planned - c.done;
        return [sprint, c.planned, c.done, carryover, `${c.planned > 0 ? Math.round(c.done / c.planned * 100) : 0}%`];
      });

    const kpis = [
      { label: 'Total Stories',       value: totalStories },
      { label: 'Done',                value: doneStories,         color: '#068443' },
      { label: 'Done %',              value: `${storyDoneRate}%`, color: ragColor(storyDoneRate, cfg.ragThresholds?.doneRate) },
      { label: 'Avg Stories/Sprint',  value: avgStoriesPerSprint },
    ];

    const sections = [
      buildKpiBar(kpis),
      buildSection('🏃', 'Sprint Progress',
        sprintRows.length
          ? buildTable(['Sprint', 'Features Done', 'Features Total', 'Stories Done', 'Stories Total', 'Done %'], sprintRows)
          : '<p style="color:#6b7280">No sprint data.</p>'
      ),
      buildSection('👥', 'Team Story Completion',
        teamStoryRows.length
          ? buildTable(['Team', 'Stories Done', 'Stories Total', 'Done %'], teamStoryRows)
          : '<p style="color:#6b7280">No team data.</p>'
      ),
      buildSection('🔄', 'Story Carryover',
        carryoverRows.length
          ? buildTable(['Sprint', 'Stories Planned', 'Stories Done', 'Carryover', 'Done %'], carryoverRows)
          : '<p style="color:#6b7280">No carryover data.</p>'
      ),
    ];

    const html = buildHtmlDoc(`Sprint-wise PI Progress Report \u2014 ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `sprint-progress-${piLabel}.html`, inline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Release Readiness
// ═══════════════════════════════════════════════════════════════════════════
router.get('/release-readiness', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};
    const sevField = fm.fields.severityField;
    const relField = fm.fields.releaseField;

    const [features, defects] = await Promise.all([
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
      fetchDefectItems(cfg, fm, piLabels, teamPath),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const totalFeatures = features.length;
    const doneFeatures  = features.filter(f => f.fields['System.State'] === fm.stateValues.featureDone).length;
    const openDefects   = defects.filter(d => !CLOSED_DEFECT_STATES.has(d.fields['System.State'])).length;
    const p1p2Defects   = defects.filter(d => {
      const sev = d.fields[sevField] || '';
      return (isSevP1(sev) || isSevP2(sev)) && !CLOSED_DEFECT_STATES.has(d.fields['System.State']);
    }).length;

    const kpis = [
      { label: 'Total Features', value: totalFeatures },
      { label: 'Done',           value: doneFeatures,   color: '#068443' },
      { label: 'Open Defects',   value: openDefects,    color: openDefects  > 0 ? '#dc2626' : '#068443' },
      { label: 'P1/P2 Defects',  value: p1p2Defects,   color: p1p2Defects  > 0 ? '#dc2626' : '#068443' },
    ];

    // Feature status
    const featureRows = features.map(f => {
      const id     = f.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [
        idLink,
        f.fields['System.Title'] || '',
        f.fields['System.State'] || '',
        relField ? (f.fields[relField] || '') : '',
        extractTeam(f.fields['System.AreaPath'] || ''),
        f.fields['System.Tags'] || '',
      ];
    });

    // Defect summary by team
    const teamDefectMap = {};
    for (const d of defects) {
      const team  = extractTeam(d.fields['System.AreaPath'] || '');
      const state = d.fields['System.State'] || '';
      const sev   = d.fields[sevField] || '';
      if (!teamDefectMap[team]) teamDefectMap[team] = { total: 0, open: 0, p1: 0, p2: 0, closed: 0 };
      teamDefectMap[team].total++;
      if (!CLOSED_DEFECT_STATES.has(state)) {
        teamDefectMap[team].open++;
        if (isSevP1(sev)) teamDefectMap[team].p1++;
        if (isSevP2(sev)) teamDefectMap[team].p2++;
      } else {
        teamDefectMap[team].closed++;
      }
    }
    const defectTeamRows = Object.entries(teamDefectMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, t]) => [
        team, t.total, t.open, t.p1, t.p2,
        `${t.total > 0 ? Math.round(t.closed / t.total * 100) : 0}%`,
      ]);

    // Blockers
    const blockers = features.filter(f =>
      (f.fields['System.Tags'] || '').toLowerCase().includes('block') ||
      (f.fields['System.State'] || '').toLowerCase().includes('block')
    );
    const blockerRows = blockers.map(f => {
      const id     = f.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [
        idLink,
        f.fields['System.Title'] || '',
        extractTeam(f.fields['System.AreaPath'] || ''),
        extractSprintLabel(f.fields['System.IterationPath'], piLabels[0]),
      ];
    });

    const sections = [
      buildKpiBar(kpis),
      buildSection('📋', 'Feature Status',
        featureRows.length
          ? buildTable(['ID', 'Title', 'State', 'Release', 'Team', 'Tags'], featureRows)
          : '<p style="color:#6b7280">No features found.</p>'
      ),
      buildSection('🐛', 'Defect Summary by Team',
        defectTeamRows.length
          ? buildTable(['Team', 'Total', 'Open', 'P1', 'P2', 'Closed %'], defectTeamRows)
          : '<p style="color:#6b7280">No defect data.</p>'
      ),
      buildSection('🚧', 'Blockers',
        blockerRows.length
          ? buildTable(['ID', 'Title', 'Team', 'Sprint'], blockerRows)
          : '<p style="color:#6b7280">No blockers identified.</p>'
      ),
    ];

    const html = buildHtmlDoc(`Release Readiness Report \u2014 ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `release-readiness-${piLabel}.html`, inline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Dependency & Risk
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dependency-risk', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};

    const [features, risks] = await Promise.all([
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
      fetchRiskItems(cfg, fm, piLabels, teamPath),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const blockedFeatures = features.filter(f =>
      (f.fields['System.Tags'] || '').toLowerCase().includes('blocked') ||
      (f.fields['System.State'] || '').toLowerCase().includes('block')
    );
    const openRisks = risks.filter(r => ACTIVE_RISK_STATES.has(r.fields['System.State'] || ''));

    const kpis = [
      { label: 'Total Features',    value: features.length },
      { label: 'Blocked Features',  value: blockedFeatures.length, color: blockedFeatures.length > 0 ? '#dc2626' : '#068443' },
      { label: 'Total Risks',       value: risks.length },
      { label: 'Open Risks',        value: openRisks.length,       color: openRisks.length > 0 ? '#d97706' : '#068443' },
    ];

    const blockedRows = blockedFeatures.map(f => {
      const id     = f.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [
        idLink,
        f.fields['System.Title'] || '',
        f.fields['System.State'] || '',
        extractTeam(f.fields['System.AreaPath'] || ''),
        extractSprintLabel(f.fields['System.IterationPath'], piLabels[0]),
        f.fields['System.Tags'] || '',
      ];
    });

    const riskRows = risks.map(r => {
      const id        = r.id;
      const state     = r.fields['System.State'] || '';
      const idLink    = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      const stateBadge = { html: ragBadgeHtml(state, riskStateColor(state)) };
      return [
        idLink,
        r.fields['System.Title'] || '',
        priorityLabel(r.fields[fm.fields.priorityField]),
        stateBadge,
        extractTeam(r.fields['System.AreaPath'] || ''),
        r.fields['System.Tags'] || '',
      ];
    });

    const sections = [
      buildKpiBar(kpis),
      buildSection('🚧', 'Blocked / At-Risk Features',
        blockedRows.length
          ? buildTable(['ID', 'Title', 'State', 'Team', 'Sprint', 'Tags'], blockedRows)
          : '<p style="color:#6b7280">No blocked features.</p>'
      ),
      buildSection('⚠️', 'Risk Register',
        riskRows.length
          ? buildTable(['ID', 'Title', 'Priority', 'State', 'Team', 'Tags'], riskRows)
          : '<p style="color:#6b7280">No risks found.</p>'
      ),
    ];

    const html = buildHtmlDoc(`Dependency & Risk Report \u2014 ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `dependency-risk-${piLabel}.html`, inline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Executive Summary
// ═══════════════════════════════════════════════════════════════════════════
router.get('/executive-summary', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};
    const bvField  = fm.fields.businessValueField;

    const [features, defects, objectives, risks] = await Promise.all([
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
      fetchDefectItems(cfg, fm, piLabels, teamPath),
      fetchObjectiveItems(cfg, fm, piLabels, teamPath),
      fetchRiskItems(cfg, fm, piLabels, teamPath),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const total      = features.length;
    const done       = features.filter(f => f.fields['System.State'] === fm.stateValues.featureDone).length;
    const doneRate   = total > 0 ? Math.round(done / total * 100) : 0;
    const openDefects = defects.filter(d => !CLOSED_DEFECT_STATES.has(d.fields['System.State'])).length;
    const openRisks   = risks.filter(r => ACTIVE_RISK_STATES.has(r.fields['System.State'] || '')).length;

    const kpis = [
      { label: 'Done %',         value: `${doneRate}%`, color: ragColor(doneRate, cfg.ragThresholds?.doneRate) },
      { label: 'Total Features', value: total },
      { label: 'Open Defects',   value: openDefects,    color: openDefects  > 0 ? '#dc2626' : '#068443' },
      { label: 'Open Risks',     value: openRisks,      color: openRisks    > 0 ? '#d97706' : '#068443' },
    ];

    // Delivery confidence
    const progressPct = total > 0 ? Math.round(done / total * 100) : 0;
    const progressBar = `
<div style="background:#e5e7eb;border-radius:8px;height:16px;margin-bottom:14px;overflow:hidden;">
  <div style="background:#068443;height:100%;width:${progressPct}%;"></div>
</div>
<p style="font-size:12px;color:#6b7280;margin-bottom:10px;">${done} of ${total} features complete (${progressPct}%)</p>`;

    const teamFeatureMap = {};
    for (const f of features) {
      const team = extractTeam(f.fields['System.AreaPath'] || '');
      if (!teamFeatureMap[team]) teamFeatureMap[team] = { done: 0, total: 0 };
      teamFeatureMap[team].total++;
      if (f.fields['System.State'] === fm.stateValues.featureDone) teamFeatureMap[team].done++;
    }
    const deliveryRows = Object.entries(teamFeatureMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, t]) => [
        team, t.done, t.total,
        `${t.total > 0 ? Math.round(t.done / t.total * 100) : 0}%`,
      ]);

    // BV attainment
    const bvDoneStates = new Set(['Done', 'Achieved', 'Closed']);
    const teamObjMap   = {};
    for (const o of objectives) {
      const team = extractTeam(o.fields['System.AreaPath'] || '');
      if (!teamObjMap[team]) teamObjMap[team] = { total: 0, done: 0, bvPlanned: 0, bvDelivered: 0 };
      const state = o.fields['System.State'] || '';
      const bv    = parseFloat(o.fields[bvField] || 0) || 0;
      teamObjMap[team].total++;
      teamObjMap[team].bvPlanned += bv;
      if (bvDoneStates.has(state)) {
        teamObjMap[team].done++;
        teamObjMap[team].bvDelivered += bv;
      }
    }
    const bvRows = Object.entries(teamObjMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, t]) => [team, t.total, t.done, t.bvPlanned, t.bvDelivered]);

    const bvTotalPlanned   = objectives.reduce((s, o) => s + (parseFloat(o.fields[bvField] || 0) || 0), 0);
    const bvTotalDelivered = objectives
      .filter(o => bvDoneStates.has(o.fields['System.State'] || ''))
      .reduce((s, o) => s + (parseFloat(o.fields[bvField] || 0) || 0), 0);

    // Risk ROAM
    const roam = { Open: 0, Owned: 0, Accepted: 0, Mitigated: 0 };
    for (const r of risks) {
      const sl = (r.fields['System.State'] || '').toLowerCase();
      if (sl === 'open' || sl === 'identified') roam.Open++;
      else if (sl === 'owned')                  roam.Owned++;
      else if (sl === 'accepted')               roam.Accepted++;
      else if (sl === 'mitigated' || sl === 'resolved') roam.Mitigated++;
    }
    const topRisks = risks
      .filter(r => {
        const p  = parseInt(r.fields[fm.fields.priorityField] || '9', 10);
        const sl = (r.fields['System.State'] || '').toLowerCase();
        return p === 1 || sl === 'open' || sl === 'identified';
      })
      .slice(0, 5);
    const topRiskRows = topRisks.map(r => {
      const id     = r.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [
        idLink,
        r.fields['System.Title'] || '',
        priorityLabel(r.fields[fm.fields.priorityField]),
        r.fields['System.State'] || '',
        extractTeam(r.fields['System.AreaPath'] || ''),
      ];
    });

    // Features needing attention
    const blockedFeatures = features.filter(f =>
      (f.fields['System.Tags'] || '').toLowerCase().includes('blocked') ||
      (f.fields['System.State'] || '').toLowerCase().includes('block')
    );
    const attentionRows = blockedFeatures.map(f => {
      const id     = f.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [
        idLink,
        f.fields['System.Title'] || '',
        f.fields['System.State'] || '',
        extractTeam(f.fields['System.AreaPath'] || ''),
      ];
    });

    const sections = [
      buildKpiBar(kpis),
      buildSection('📈', 'Delivery Confidence',
        progressBar +
        (deliveryRows.length
          ? buildTable(['Team', 'Done', 'Total', 'Done %'], deliveryRows)
          : '<p style="color:#6b7280">No delivery data.</p>')
      ),
      buildSection('🎯', 'Business Value Attainment',
        `<p style="margin-bottom:10px;font-size:12px;color:#6b7280;">BV Planned: <strong>${bvTotalPlanned}</strong> \u00B7 BV Delivered: <strong>${bvTotalDelivered}</strong></p>` +
        (bvRows.length
          ? buildTable(['Team', 'Objectives Total', 'Objectives Done', 'BV Planned', 'BV Delivered'], bvRows)
          : '<p style="color:#6b7280">No objectives data.</p>')
      ),
      buildSection('⚠️', 'Risk Summary',
        `<p style="margin-bottom:10px;font-size:12px;color:#6b7280;">ROAM \u2014 Open/Identified: <strong>${roam.Open}</strong> \u00B7 Owned: <strong>${roam.Owned}</strong> \u00B7 Accepted: <strong>${roam.Accepted}</strong> \u00B7 Mitigated/Resolved: <strong>${roam.Mitigated}</strong></p>` +
        (topRiskRows.length
          ? buildTable(['ID', 'Title', 'Priority', 'State', 'Team'], topRiskRows)
          : '<p style="color:#6b7280">No critical risks.</p>')
      ),
      ...(attentionRows.length
        ? [buildSection('🚨', 'Features Needing Attention',
            buildTable(['ID', 'Title', 'State', 'Team'], attentionRows)
          )]
        : []
      ),
    ];

    const html = buildHtmlDoc(`Executive PI Summary Report \u2014 ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `executive-summary-${piLabel}.html`, inline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Sprint Close (enhanced)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/sprint-close', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const sprintList   = fm.piStructure.sprintLabels;
    const validSprints = new Set(sprintList.map(s => s.toUpperCase()));
    const defaultSprint = (sprintList[sprintList.length - 2] || sprintList[0] || 'S3').toUpperCase();

    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });

    const requestedSprint = String(req.query.sprint || defaultSprint).trim().toUpperCase();
    const sprint   = validSprints.has(requestedSprint) ? requestedSprint : defaultSprint;
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};
    const sevField = fm.fields.severityField;

    const filterPath  = teamPath || cfg.tfs.areaPath;
    const sprintClause = buildSprintClause(cfg.tfs.iterationPath, piLabels, sprint, fm.piStructure.sprintSubpathPattern);
    const wiqlUrl     = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;

    const fetchForType = async (type, fields) => {
      const r = await tfsPost(wiqlUrl, {
        query: `SELECT [System.Id] FROM WorkItems
          WHERE [System.WorkItemType] = '${type}'
            AND [System.AreaPath] UNDER '${filterPath}'
            AND ${sprintClause}
          ORDER BY [System.Id]`
      }, cfg.tfs.pat);
      const ids = (r.workItems || []).map(i => i.id);
      return ids.length ? fetchWorkItemDetails(ids, fields, cfg) : [];
    };

    const [featureItems, defectItems] = await Promise.all([
      fetchForType(fm.workItemTypes.feature, [
        'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
        'System.IterationPath', 'System.AssignedTo', 'System.CreatedDate',
        fm.fields.stateChangeDateField,
      ]),
      fetchForType(fm.workItemTypes.defect, [
        'System.Id', 'System.Title', 'System.State', 'System.AreaPath',
        'System.IterationPath', sevField, 'System.Tags',
      ]),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const totalFeatures  = featureItems.length;
    const doneCount      = featureItems.filter(f => f.fields['System.State'] === fm.stateValues.featureDone).length;
    const inProgressCount = featureItems.filter(f => isInProgressState(f.fields['System.State'])).length;
    const blockedCount   = featureItems.filter(f => (f.fields['System.State'] || '').toLowerCase().includes('block')).length;
    const openDefects    = defectItems.filter(d => !CLOSED_DEFECT_STATES.has(d.fields['System.State'])).length;
    const p1p2Count      = defectItems.filter(d => {
      const sev = d.fields[sevField] || '';
      return (isSevP1(sev) || isSevP2(sev)) && !CLOSED_DEFECT_STATES.has(d.fields['System.State']);
    }).length;
    const doneRate = totalFeatures > 0 ? Math.round(doneCount / totalFeatures * 100) : 0;

    // Team breakdown
    const teamMap = {};
    for (const f of featureItems) {
      const team = extractTeam(f.fields['System.AreaPath'] || '');
      if (!teamMap[team]) teamMap[team] = { done: 0, inProgress: 0, total: 0 };
      teamMap[team].total++;
      if (f.fields['System.State'] === fm.stateValues.featureDone) teamMap[team].done++;
      else if (isInProgressState(f.fields['System.State']))          teamMap[team].inProgress++;
    }
    const teamRows = Object.entries(teamMap)
      .sort(([, a], [, b]) => b.done - a.done || b.inProgress - a.inProgress)
      .slice(0, 5)
      .map(([team, t]) => [team, t.done, t.inProgress, t.total]);

    const kpis = [
      { label: 'Total Features', value: totalFeatures },
      { label: 'Done',           value: doneCount,       color: '#068443' },
      { label: 'Done %',         value: `${doneRate}%`,  color: ragColor(doneRate, cfg.ragThresholds?.doneRate) },
      { label: 'In Progress',    value: inProgressCount },
      { label: 'Blocked',        value: blockedCount,    color: blockedCount > 0 ? '#dc2626' : '#068443' },
      { label: 'Open Defects',   value: openDefects,     color: openDefects  > 0 ? '#dc2626' : '#068443' },
      { label: 'P1/P2 Defects',  value: p1p2Count,       color: p1p2Count    > 0 ? '#dc2626' : '#068443' },
    ];

    const sections = [
      buildKpiBar(kpis),
      buildSection('👥', `Top Teams by Delivery \u2014 ${sprint}`,
        teamRows.length
          ? buildTable(['Team', 'Done', 'In Progress', 'Total'], teamRows)
          : '<p style="color:#6b7280">No team data available.</p>'
      ),
    ];

    const html = buildHtmlDoc(`${piLabel} ${sprint} Sprint Close Report`, branding, sections, generatedAt);
    sendHtml(res, html, `sprint-close-${piLabel}.html`, inline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Excel Export
// ═══════════════════════════════════════════════════════════════════════════
router.get('/excel', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm      = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const role     = req.query.role || 'all';
    const piLabel  = formatProgrammeLabel(piLabels);

    const [features, defects, risks, objectives] = await Promise.all([
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
      fetchDefectItems(cfg, fm, piLabels, teamPath),
      fetchRiskItems(cfg, fm, piLabels, teamPath),
      fetchObjectiveItems(cfg, fm, piLabels, teamPath),
    ]);

    const XLSX = require('xlsx');
    const wb   = XLSX.utils.book_new();

    // Features sheet (all roles)
    const featureData = [
      ['Id', 'Title', 'State', 'Team', 'Sprint', 'AssignedTo', 'Effort'],
      ...features.map(f => [
        f.id,
        f.fields['System.Title'] || '',
        f.fields['System.State'] || '',
        extractTeam(f.fields['System.AreaPath'] || ''),
        extractSprintLabel(f.fields['System.IterationPath'], piLabels[0]),
        displayName(f.fields['System.AssignedTo']),
        f.fields[fm.fields.effortField] || '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(featureData), 'Features');

    if (role !== 'exec') {
      const defectData = [
        ['Id', 'Title', 'State', 'Team', 'Severity', 'Sprint'],
        ...defects.map(d => [
          d.id,
          d.fields['System.Title'] || '',
          d.fields['System.State'] || '',
          extractTeam(d.fields['System.AreaPath'] || ''),
          d.fields[fm.fields.severityField] || '',
          extractSprintLabel(d.fields['System.IterationPath'], piLabels[0]),
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(defectData), 'Defects');
    }

    if (['pm', 'rte', 'all', 'admin'].includes(role)) {
      const riskData = [
        ['Id', 'Title', 'State', 'Priority', 'Team', 'Tags'],
        ...risks.map(r => [
          r.id,
          r.fields['System.Title'] || '',
          r.fields['System.State'] || '',
          priorityLabel(r.fields[fm.fields.priorityField]),
          extractTeam(r.fields['System.AreaPath'] || ''),
          r.fields['System.Tags'] || '',
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riskData), 'Risks');
    }

    if (['rte', 'all', 'admin'].includes(role)) {
      const objData = [
        ['Id', 'Title', 'State', 'Team', 'BusinessValue'],
        ...objectives.map(o => [
          o.id,
          o.fields['System.Title'] || '',
          o.fields['System.State'] || '',
          extractTeam(o.fields['System.AreaPath'] || ''),
          o.fields[fm.fields.businessValueField] || '',
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(objData), 'Objectives');
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pi-data-${piLabel}.xlsx"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Route: /defect-summary ────────────────────────────────────────────────
router.get('/defect-summary', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};

    const defects     = await fetchDefectItems(cfg, fm, piLabels, teamPath);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const closedSet = new Set(['Resolved', 'Closed', 'Removed']);
    const total  = defects.length;
    const open   = defects.filter(d => !closedSet.has(d.fields['System.State'])).length;
    const closed = total - open;
    const p1p2   = defects.filter(d => isSevP1(d.fields[fm.fields.severityField] || '') || isSevP2(d.fields[fm.fields.severityField] || '')).length;

    const kpis = [
      { label: 'Total Defects',  value: total },
      { label: 'Open',           value: open,   color: open > 0 ? '#dc2626' : '#068443' },
      { label: 'Closed',         value: closed, color: '#068443' },
      { label: 'P1/P2 Critical', value: p1p2,   color: p1p2 > 0 ? '#dc2626' : '#068443' },
    ];

    // By Severity
    const sevMap = {};
    for (const d of defects) {
      const sev = d.fields[fm.fields.severityField] || 'Unknown';
      if (!sevMap[sev]) sevMap[sev] = { total: 0, open: 0 };
      sevMap[sev].total++;
      if (!closedSet.has(d.fields['System.State'])) sevMap[sev].open++;
    }
    const sevRows = Object.entries(sevMap).sort().map(([sev, s]) => [sev, s.total, s.open, s.total - s.open]);

    // By Sprint
    const sprintMap = {};
    for (const d of defects) {
      const sprint = extractSprintLabel(d.fields['System.IterationPath'], piLabels[0]);
      if (!sprintMap[sprint]) sprintMap[sprint] = { total: 0, open: 0, p1p2: 0 };
      sprintMap[sprint].total++;
      if (!closedSet.has(d.fields['System.State'])) sprintMap[sprint].open++;
      if (isSevP1(d.fields[fm.fields.severityField] || '') || isSevP2(d.fields[fm.fields.severityField] || '')) sprintMap[sprint].p1p2++;
    }
    const sprintRows = Object.entries(sprintMap).sort(([a], [b]) => sprintSortKey(a).localeCompare(sprintSortKey(b))).map(([sp, s]) => [sp, s.total, s.open, s.total - s.open, s.p1p2]);

    // By Team
    const teamMap = {};
    for (const d of defects) {
      const team = extractTeam(d.fields['System.AreaPath'] || '');
      if (!teamMap[team]) teamMap[team] = { total: 0, open: 0, p1p2: 0 };
      teamMap[team].total++;
      if (!closedSet.has(d.fields['System.State'])) teamMap[team].open++;
      if (isSevP1(d.fields[fm.fields.severityField] || '') || isSevP2(d.fields[fm.fields.severityField] || '')) teamMap[team].p1p2++;
    }
    const teamRows = Object.entries(teamMap).sort(([a], [b]) => a.localeCompare(b)).map(([team, t]) => [team, t.total, t.open, t.total - t.open, t.p1p2]);

    // Full defect list
    const defectRows = defects.map(d => {
      const id = d.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [idLink, d.fields['System.Title'] || '', d.fields['System.State'] || '', d.fields[fm.fields.severityField] || '', extractSprintLabel(d.fields['System.IterationPath'], piLabels[0]), extractTeam(d.fields['System.AreaPath'] || '')];
    });

    const sections = [
      buildKpiBar(kpis),
      buildSection('🔴', 'Defects by Severity', sevRows.length ? buildTable(['Severity', 'Total', 'Open', 'Closed'], sevRows) : '<p style="color:#6b7280">No defects found.</p>'),
      buildSection('📅', 'Defects by Sprint', sprintRows.length ? buildTable(['Sprint', 'Total', 'Open', 'Closed', 'P1/P2'], sprintRows) : '<p style="color:#6b7280">No sprint data.</p>'),
      buildSection('👥', 'Defects by Team', teamRows.length ? buildTable(['Team', 'Total', 'Open', 'Closed', 'P1/P2'], teamRows) : '<p style="color:#6b7280">No team data.</p>'),
      buildSection('📋', 'Full Defect List', defectRows.length ? buildTable(['ID', 'Title', 'State', 'Severity', 'Sprint', 'Team'], defectRows, { compact: true }) : '<p style="color:#6b7280">No defects found.</p>'),
    ];

    const html = buildHtmlDoc(`Defect Summary Report — ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `defect-summary-${piLabel}.html`, inline);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Route: /story-by-feature ──────────────────────────────────────────────
router.get('/story-by-feature', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};
    const storyDoneSet = new Set(fm.stateValues.storyDone || ['Done', 'Closed', 'Resolved', 'Completed']);

    // Fetch features and stories in parallel
    const [features, stories] = await Promise.all([
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
      fetchStoryItems(cfg, fm, piLabels, teamPath),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    // Try tree WIQL to get feature→story parent-child links
    const areaPath = teamPath || cfg.tfs.areaPath;
    const iterClauses = piLabels.map(pi => `Source.[System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${pi}'`);
    const iterPart = iterClauses.length === 1 ? iterClauses[0] : '(' + iterClauses.join(' OR ') + ')';
    const treeWiql = `SELECT [System.Id] FROM WorkItemLinks WHERE Source.[System.WorkItemType] = '${fm.workItemTypes.feature}' AND Source.[System.AreaPath] UNDER '${areaPath}' AND ${iterPart} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' AND Target.[System.WorkItemType] = '${fm.workItemTypes.story}' MODE (MustContain)`;

    let featureStoryMap = {}; // featureId → { feature, stories[] }
    const featById = Object.fromEntries(features.map(f => [f.id, f]));
    const storyById = Object.fromEntries(stories.map(s => [s.id, s]));

    try {
      const url = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
      const treeResult = await tfsPost(url, { query: treeWiql }, cfg.tfs.pat);
      const relations = treeResult.workItemRelations || [];
      for (const rel of relations) {
        if (!rel.rel || !rel.source || !rel.target) continue;
        const featId = rel.source.id;
        const storyId = rel.target.id;
        if (!featureStoryMap[featId]) featureStoryMap[featId] = { feature: featById[featId], stories: [] };
        if (storyById[storyId]) featureStoryMap[featId].stories.push(storyById[storyId]);
      }
    } catch (treeErr) {
      // Fallback: group stories by area+iteration proximity to features (no parent-child)
      console.warn('[story-by-feature] Tree WIQL failed, using flat grouping:', treeErr.message.slice(0, 60));
    }

    // Also add features with no matched children from tree query
    for (const f of features) {
      if (!featureStoryMap[f.id]) featureStoryMap[f.id] = { feature: f, stories: [] };
    }

    // Build report rows
    const featureRows = Object.values(featureStoryMap).map(({ feature, stories: fStories }) => {
      if (!feature) return null;
      const total  = fStories.length;
      const done   = fStories.filter(s => storyDoneSet.has(s.fields['System.State'])).length;
      const pct    = total > 0 ? Math.round(done / total * 100) : 0;
      const id     = feature.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      const statusColor = feature.fields['System.State'] === fm.stateValues.featureDone ? '#068443' : '#d97706';
      const stateHtml = { html: ragBadgeHtml(feature.fields['System.State'] || 'Unknown', statusColor) };
      return [idLink, feature.fields['System.Title'] || '', stateHtml, total, done, `${pct}%`, extractTeam(feature.fields['System.AreaPath'] || '')];
    }).filter(Boolean);

    // Summary KPIs
    const allFeat  = featureRows.length;
    const fullDone = Object.values(featureStoryMap).filter(({ feature, stories: fStories }) => feature && fStories.length > 0 && fStories.every(s => storyDoneSet.has(s.fields['System.State']))).length;
    const partDone = Object.values(featureStoryMap).filter(({ feature, stories: fStories }) => feature && fStories.length > 0 && fStories.some(s => storyDoneSet.has(s.fields['System.State'])) && !fStories.every(s => storyDoneSet.has(s.fields['System.State']))).length;
    const noStories = Object.values(featureStoryMap).filter(({ feature, stories: fStories }) => feature && fStories.length === 0).length;

    const kpis = [
      { label: 'Total Features',           value: allFeat },
      { label: 'All Stories Done',          value: fullDone,   color: '#068443' },
      { label: 'Partially Done',            value: partDone,   color: '#d97706' },
      { label: 'No Stories / Not Linked',   value: noStories,  color: '#6b7280' },
      { label: 'Total Stories',             value: stories.length },
    ];

    const sections = [
      buildKpiBar(kpis),
      buildSection('📋', 'Story Completion by Feature',
        featureRows.length
          ? buildTable(['Feature ID', 'Title', 'State', 'Stories Total', 'Stories Done', 'Done %', 'Team'], featureRows)
          : '<p style="color:#6b7280">No features found.</p>'
      ),
    ];

    const html = buildHtmlDoc(`Story Completion by Feature — ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `story-by-feature-${piLabel}.html`, inline);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Route: /business-value ────────────────────────────────────────────────
router.get('/business-value', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};

    const [objectives, features] = await Promise.all([
      fetchObjectiveItems(cfg, fm, piLabels, teamPath),
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const doneStates = new Set(['Done', 'Closed', 'Resolved', 'Accepted', 'Completed']);
    const plannedBV   = objectives.reduce((sum, o) => sum + (parseFloat(o.fields[fm.fields.businessValueField]) || 0), 0);
    const deliveredBV = objectives.filter(o => doneStates.has(o.fields['System.State'])).reduce((sum, o) => sum + (parseFloat(o.fields[fm.fields.businessValueField]) || 0), 0);
    const bvPct       = plannedBV > 0 ? Math.round(deliveredBV / plannedBV * 100) : 0;

    const kpis = [
      { label: 'Total Objectives', value: objectives.length },
      { label: 'Planned BV',        value: plannedBV.toFixed(0) },
      { label: 'Delivered BV',      value: deliveredBV.toFixed(0), color: '#068443' },
      { label: 'BV Achievement',    value: `${bvPct}%`, color: ragColor(bvPct, cfg.ragThresholds?.doneRate) },
    ];

    // Objectives table
    const objRows = objectives.map(o => {
      const id = o.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      const bv = parseFloat(o.fields[fm.fields.businessValueField]) || 0;
      const stateColor = doneStates.has(o.fields['System.State']) ? '#068443' : '#d97706';
      const stateHtml = { html: ragBadgeHtml(o.fields['System.State'] || 'Unknown', stateColor) };
      return [idLink, o.fields['System.Title'] || '', stateHtml, bv || '', extractTeam(o.fields['System.AreaPath'] || '')];
    }).sort((a, b) => (b[3] || 0) - (a[3] || 0));

    // BV by team
    const teamBVMap = {};
    for (const o of objectives) {
      const team = extractTeam(o.fields['System.AreaPath'] || '');
      if (!teamBVMap[team]) teamBVMap[team] = { planned: 0, delivered: 0 };
      const bv = parseFloat(o.fields[fm.fields.businessValueField]) || 0;
      teamBVMap[team].planned += bv;
      if (doneStates.has(o.fields['System.State'])) teamBVMap[team].delivered += bv;
    }
    const teamBVRows = Object.entries(teamBVMap).sort(([a], [b]) => a.localeCompare(b)).map(([team, t]) => [
      team, t.planned.toFixed(0), t.delivered.toFixed(0),
      `${t.planned > 0 ? Math.round(t.delivered / t.planned * 100) : 0}%`,
    ]);

    // Feature summary
    const featTotal = features.length;
    const featDone  = features.filter(f => f.fields['System.State'] === fm.stateValues.featureDone).length;

    const sections = [
      buildKpiBar(kpis),
      buildSection('📊', 'Business Value by Team', teamBVRows.length ? buildTable(['Team', 'Planned BV', 'Delivered BV', 'Achievement %'], teamBVRows) : '<p style="color:#6b7280">No team data.</p>'),
      buildSection('🎯', 'Objectives Detail', objRows.length ? buildTable(['ID', 'Objective', 'State', 'Business Value', 'Team'], objRows) : '<p style="color:#6b7280">No objectives found.</p>'),
      buildSection('📋', 'Feature Context', `<p style="color:#374151;font-size:12px;">Features total: <strong>${featTotal}</strong> · Done: <strong>${featDone}</strong> · Done %: <strong>${featTotal > 0 ? Math.round(featDone / featTotal * 100) : 0}%</strong></p>`),
    ];

    const html = buildHtmlDoc(`Business Value Delivery Report — ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `business-value-${piLabel}.html`, inline);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Route: /backlog-readiness ─────────────────────────────────────────────
router.get('/backlog-readiness', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};
    const storyDoneSet = new Set(fm.stateValues.storyDone || ['Done', 'Closed', 'Resolved', 'Completed']);

    const stories = await fetchStoryItems(cfg, fm, piLabels, teamPath);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const activeStories = stories.filter(s => !storyDoneSet.has(s.fields['System.State']) && s.fields['System.State'] !== (fm.stateValues.storyRemoved || 'Removed'));

    const missingEffort   = activeStories.filter(s => !s.fields[fm.fields.storyPointsField] && !s.fields[fm.fields.effortField]);
    const missingAssignee = activeStories.filter(s => !s.fields['System.AssignedTo'] || displayName(s.fields['System.AssignedTo']) === '');
    const readyStories    = activeStories.filter(s => (s.fields[fm.fields.storyPointsField] || s.fields[fm.fields.effortField]) && s.fields['System.AssignedTo'] && displayName(s.fields['System.AssignedTo']) !== '');

    const kpis = [
      { label: 'Total Active Stories',    value: activeStories.length },
      { label: 'Ready',                   value: readyStories.length,    color: '#068443' },
      { label: 'Missing Effort/Points',   value: missingEffort.length,   color: missingEffort.length > 0 ? '#dc2626' : '#068443' },
      { label: 'Missing Assignee',         value: missingAssignee.length, color: missingAssignee.length > 0 ? '#d97706' : '#068443' },
    ];

    function storyRow(s) {
      const id = s.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      return [idLink, s.fields['System.Title'] || '', s.fields['System.State'] || '', extractSprintLabel(s.fields['System.IterationPath'], piLabels[0]), extractTeam(s.fields['System.AreaPath'] || ''), displayName(s.fields['System.AssignedTo'])];
    }

    const sections = [
      buildKpiBar(kpis),
      buildSection('⚠️', 'Stories Missing Effort / Story Points', missingEffort.length ? buildTable(['ID', 'Title', 'State', 'Sprint', 'Team', 'Assignee'], missingEffort.map(storyRow), { compact: true }) : '<p style="color:#068443">✅ All active stories have effort estimates.</p>'),
      buildSection('👤', 'Stories Missing Assignee', missingAssignee.length ? buildTable(['ID', 'Title', 'State', 'Sprint', 'Team', 'Assignee'], missingAssignee.map(storyRow), { compact: true }) : '<p style="color:#068443">✅ All active stories are assigned.</p>'),
    ];

    const html = buildHtmlDoc(`Backlog Readiness Report — ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `backlog-readiness-${piLabel}.html`, inline);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Route: /team-health ───────────────────────────────────────────────────
router.get('/team-health', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};
    const storyDoneSet = new Set(fm.stateValues.storyDone || ['Done', 'Closed', 'Resolved', 'Completed']);
    const closedDefects = new Set(['Resolved', 'Closed', 'Removed']);

    const [features, defects, stories] = await Promise.all([
      fetchFeatureItems(cfg, fm, piLabels, teamPath),
      fetchDefectItems(cfg, fm, piLabels, teamPath),
      fetchStoryItems(cfg, fm, piLabels, teamPath),
    ]);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    // Build per-team health metrics
    const teamHealth = {};
    function ensureTeam(t) {
      if (!teamHealth[t]) teamHealth[t] = { featTotal: 0, featDone: 0, storyTotal: 0, storyDone: 0, defectTotal: 0, defectOpen: 0, defectP1P2: 0 };
      return teamHealth[t];
    }
    for (const f of features) {
      const t = ensureTeam(extractTeam(f.fields['System.AreaPath'] || ''));
      t.featTotal++;
      if (f.fields['System.State'] === fm.stateValues.featureDone) t.featDone++;
    }
    for (const s of stories) {
      const t = ensureTeam(extractTeam(s.fields['System.AreaPath'] || ''));
      t.storyTotal++;
      if (storyDoneSet.has(s.fields['System.State'])) t.storyDone++;
    }
    for (const d of defects) {
      const t = ensureTeam(extractTeam(d.fields['System.AreaPath'] || ''));
      t.defectTotal++;
      if (!closedDefects.has(d.fields['System.State'])) t.defectOpen++;
      if (isSevP1(d.fields[fm.fields.severityField] || '') || isSevP2(d.fields[fm.fields.severityField] || '')) t.defectP1P2++;
    }

    const teamList = Object.entries(teamHealth).sort(([a], [b]) => a.localeCompare(b));
    const avgFeatDone = teamList.length > 0 ? Math.round(teamList.reduce((s, [, t]) => s + (t.featTotal > 0 ? t.featDone / t.featTotal : 0), 0) / teamList.length * 100) : 0;

    const kpis = [
      { label: 'Teams',              value: teamList.length },
      { label: 'Avg Feature Done %', value: `${avgFeatDone}%`, color: ragColor(avgFeatDone, cfg.ragThresholds?.doneRate) },
      { label: 'Total Features',     value: features.length },
      { label: 'Total Open Defects', value: defects.filter(d => !closedDefects.has(d.fields['System.State'])).length, color: '#d97706' },
    ];

    const teamRows = teamList.map(([team, t]) => {
      const featPct   = t.featTotal  > 0 ? Math.round(t.featDone  / t.featTotal  * 100) : 0;
      const storyPct  = t.storyTotal > 0 ? Math.round(t.storyDone / t.storyTotal * 100) : 0;
      const defDensity = t.storyTotal > 0 ? (t.defectTotal / t.storyTotal).toFixed(2) : '—';
      const healthPct = Math.round((featPct + storyPct) / 2);
      const healthColor = ragColor(healthPct, cfg.ragThresholds?.doneRate);
      const healthBadge = { html: ragBadgeHtml(`${healthPct}%`, healthColor) };
      return [team, t.featDone, t.featTotal, `${featPct}%`, t.storyDone, t.storyTotal, `${storyPct}%`, t.defectTotal, t.defectOpen, t.defectP1P2, defDensity, healthBadge];
    });

    const sections = [
      buildKpiBar(kpis),
      buildSection('🏥', 'Team Delivery Health',
        teamRows.length
          ? buildTable(['Team', 'Feat Done', 'Feat Total', 'Feat %', 'Story Done', 'Story Total', 'Story %', 'Defects', 'Open Def', 'P1/P2', 'Def Density', 'Health'], teamRows)
          : '<p style="color:#6b7280">No team data.</p>'
      ),
    ];

    const html = buildHtmlDoc(`Team Delivery Health Report — ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `team-health-${piLabel}.html`, inline);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Route: /pi-predictability ─────────────────────────────────────────────
router.get('/pi-predictability', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });
    const fm = getFieldMappings(cfg);
    const piLabels = normalizePiLabels(req.query);
    if (!piLabels.length) return res.status(400).json({ error: 'No PI selection available' });
    const teamPath = req.query.teamPath || '';
    const inline   = req.query.inline === '1' || req.query.inline === 'true';
    const piLabel  = formatProgrammeLabel(piLabels);
    const branding = cfg.branding || {};

    const features    = await fetchFeatureItems(cfg, fm, piLabels, teamPath);
    const generatedAt = formatGeneratedAt(new Date().toISOString());

    const total     = features.length;
    const committed = features.filter(f => f.fields['System.State'] !== 'New' && f.fields['System.State'] !== (fm.stateValues.featureRemoved || 'Removed')).length;
    const delivered = features.filter(f => f.fields['System.State'] === fm.stateValues.featureDone).length;
    const deferred  = features.filter(f => f.fields['System.State'] === (fm.stateValues.featureRemoved || 'Removed') || (f.fields['System.State'] || '').toLowerCase().includes('defer')).length;
    const predictability = committed > 0 ? Math.round(delivered / committed * 100) : 0;

    const kpis = [
      { label: 'Total Features',    value: total },
      { label: 'Committed',         value: committed },
      { label: 'Delivered (Done)',  value: delivered,       color: '#068443' },
      { label: 'Deferred/Removed',  value: deferred,        color: deferred > 0 ? '#dc2626' : '#068443' },
      { label: 'Predictability',    value: `${predictability}%`, color: ragColor(predictability, cfg.ragThresholds?.doneRate) },
    ];

    // Per-sprint predictability
    const sprintMap = {};
    for (const f of features) {
      const sprint = extractSprintLabel(f.fields['System.IterationPath'], piLabels[0]);
      if (!sprintMap[sprint]) sprintMap[sprint] = { committed: 0, delivered: 0, deferred: 0 };
      const state = f.fields['System.State'] || '';
      if (state !== 'New' && state !== (fm.stateValues.featureRemoved || 'Removed')) sprintMap[sprint].committed++;
      if (state === fm.stateValues.featureDone) sprintMap[sprint].delivered++;
      if (state === (fm.stateValues.featureRemoved || 'Removed') || state.toLowerCase().includes('defer')) sprintMap[sprint].deferred++;
    }
    const sprintRows = Object.entries(sprintMap).sort(([a], [b]) => sprintSortKey(a).localeCompare(sprintSortKey(b))).map(([sprint, s]) => {
      const pct = s.committed > 0 ? Math.round(s.delivered / s.committed * 100) : 0;
      const pctBadge = { html: ragBadgeHtml(`${pct}%`, ragColor(pct, cfg.ragThresholds?.doneRate)) };
      return [sprint, s.committed, s.delivered, s.deferred, pctBadge];
    });

    // Per-team predictability
    const teamMap2 = {};
    for (const f of features) {
      const team = extractTeam(f.fields['System.AreaPath'] || '');
      if (!teamMap2[team]) teamMap2[team] = { committed: 0, delivered: 0, deferred: 0 };
      const state = f.fields['System.State'] || '';
      if (state !== 'New' && state !== (fm.stateValues.featureRemoved || 'Removed')) teamMap2[team].committed++;
      if (state === fm.stateValues.featureDone) teamMap2[team].delivered++;
      if (state === (fm.stateValues.featureRemoved || 'Removed') || state.toLowerCase().includes('defer')) teamMap2[team].deferred++;
    }
    const teamPredRows = Object.entries(teamMap2).sort(([a], [b]) => a.localeCompare(b)).map(([team, t]) => {
      const pct = t.committed > 0 ? Math.round(t.delivered / t.committed * 100) : 0;
      const pctBadge = { html: ragBadgeHtml(`${pct}%`, ragColor(pct, cfg.ragThresholds?.doneRate)) };
      return [team, t.committed, t.delivered, t.deferred, pctBadge];
    });

    // Feature list with RAG status
    const featureRows = features.map(f => {
      const id = f.id;
      const idLink = { html: `<a href="${escapeHtml(`${cfg.tfs.baseUrl}/_workitems/edit/${id}`)}" target="_blank">${id}</a>` };
      const state = f.fields['System.State'] || '';
      const stateColor = state === fm.stateValues.featureDone ? '#068443' : isInProgressState(state) ? '#d97706' : '#6b7280';
      const stateHtml = { html: ragBadgeHtml(state, stateColor) };
      return [idLink, f.fields['System.Title'] || '', stateHtml, extractTeam(f.fields['System.AreaPath'] || ''), extractSprintLabel(f.fields['System.IterationPath'], piLabels[0])];
    });

    const sections = [
      buildKpiBar(kpis),
      buildSection('📅', 'Predictability by Sprint', sprintRows.length ? buildTable(['Sprint', 'Committed', 'Delivered', 'Deferred', 'Predictability'], sprintRows) : '<p style="color:#6b7280">No sprint data.</p>'),
      buildSection('👥', 'Predictability by Team', teamPredRows.length ? buildTable(['Team', 'Committed', 'Delivered', 'Deferred', 'Predictability'], teamPredRows) : '<p style="color:#6b7280">No team data.</p>'),
      buildSection('📋', 'Feature Detail', featureRows.length ? buildTable(['ID', 'Title', 'State', 'Team', 'Sprint'], featureRows, { compact: true }) : '<p style="color:#6b7280">No features found.</p>'),
    ];

    const html = buildHtmlDoc(`PI Predictability Report — ${piLabel}`, branding, sections, generatedAt);
    sendHtml(res, html, `pi-predictability-${piLabel}.html`, inline);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;


