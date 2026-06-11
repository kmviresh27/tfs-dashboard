'use strict';

const cron = require('node-cron');
const fetch = require('node-fetch');
const { loadConfig } = require('./config');
const { getCurrentPIInfo, getDefaultPIs, getPILabel } = require('./helpers/piHelpers');
const { getFieldMappings } = require('./helpers/fieldMappings');
const { tfsPost } = require('./tfsClient');
const notifHistory = require('./notificationHistory');
const { TOKEN: INTERNAL_TOKEN, HEADER: INTERNAL_HEADER } = require('./internalToken');

let scheduledTask = null;
let thresholdTask = null;
let lastDigestSentAt = null;

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function buildCronExpression(schedule = {}) {
  const day    = DAY_MAP[String(schedule.day || 'monday').toLowerCase()] ?? 1;
  const hour   = Math.max(0, Math.min(23, Number(schedule.hour)   || 9));
  const minute = Math.max(0, Math.min(59, Number(schedule.minute) || 0));
  return `${minute} ${hour} * * ${day}`;
}

function buildQs(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(item => search.append(`${key}[]`, item));
    } else {
      search.append(key, value);
    }
  });
  return search.toString();
}

function getDigestPiLabels() {
  const defaults = getDefaultPIs();
  const { yy, pi } = getCurrentPIInfo();
  const current = getPILabel(yy, pi);
  const labels = [...defaults, current].filter(Boolean);
  return [...new Set(labels)];
}

function getOpenDefectCount(stateCounts) {
  return Object.entries(stateCounts || {})
    .filter(([state]) => !['Resolved', 'Closed', 'Removed'].includes(state))
    .reduce((sum, [, count]) => sum + count, 0);
}

// ── TFS deep-link helpers ─────────────────────────────────────────────────────
function buildTfsQueryLink(tfsBaseUrl, wiql) {
  return `${tfsBaseUrl}/_workitems?_a=query-edit&queryText=${encodeURIComponent(wiql)}`;
}

function buildPiChecksLink(tfsBaseUrl, folder) {
  const path = (folder || 'Shared Queries/ICAP/Program Queries/TFSInconsistenciesQueryRepository')
    .split('/').map(encodeURIComponent).join('/');
  return `${tfsBaseUrl}/_queries/${path}`;
}

// ── Per-team done-rate computation ────────────────────────────────────────────
function computeTeamRates(teamBreakdown, fm) {
  const featureDone    = (fm && fm.stateValues && fm.stateValues.featureDone)    || 'Done';
  const featureRemoved = (fm && fm.stateValues && fm.stateValues.featureRemoved) || 'Removed';
  return Object.entries(teamBreakdown)
    .map(([team, states]) => {
      const done   = states[featureDone]    || 0;
      const removed= states[featureRemoved] || 0;
      const active = Object.values(states).reduce((a, b) => a + b, 0) - removed;
      const rate   = active > 0 ? Math.round((done / active) * 100) : 0;
      return { team, done, active, rate };
    })
    .filter(t => t.active > 0)
    .sort((a, b) => b.rate - a.rate);
}

// ── Top teams by open-defect count ────────────────────────────────────────────
function computeTopDefectTeams(teamBreakdown) {
  const CLOSED = ['Resolved', 'Closed', 'Removed'];
  return Object.entries(teamBreakdown)
    .map(([team, states]) => {
      const open = Object.entries(states)
        .filter(([s]) => !CLOSED.includes(s))
        .reduce((sum, [, v]) => sum + v, 0);
      return { team, open };
    })
    .filter(t => t.open > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, 3);
}

// ── Changes in last 7 days (direct TFS WIQL) ─────────────────────────────────
async function fetchChangesThisWeek(cfg, fm, piLabels) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const area  = cfg.tfs.areaPath;
  const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;
  const featureType  = (fm && fm.workItemTypes && fm.workItemTypes.feature) || 'Feature';
  const defectType   = (fm && fm.workItemTypes && fm.workItemTypes.defect)  || 'Defect';
  const featureDone  = (fm && fm.stateValues   && fm.stateValues.featureDone)  || 'Done';

  const [featDoneRes, defNewRes, defP12Res, defClosedRes] = await Promise.allSettled([
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${featureType}' AND [System.AreaPath] UNDER '${area}' AND [System.State]='${featureDone}' AND [Microsoft.VSTS.Common.StateChangeDate] >= '${since}' ORDER BY [Microsoft.VSTS.Common.StateChangeDate] DESC`
    }, cfg.tfs.pat),
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${defectType}' AND [System.AreaPath] UNDER '${area}' AND [System.CreatedDate] >= '${since}' AND [System.State] NOT IN ('Removed') ORDER BY [System.CreatedDate] DESC`
    }, cfg.tfs.pat),
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${defectType}' AND [System.AreaPath] UNDER '${area}' AND [System.CreatedDate] >= '${since}' AND [Microsoft.VSTS.Common.Priority] <= 2 AND [System.State] NOT IN ('Resolved','Closed','Removed') ORDER BY [System.CreatedDate] DESC`
    }, cfg.tfs.pat),
    tfsPost(wiqlUrl, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${defectType}' AND [System.AreaPath] UNDER '${area}' AND [Microsoft.VSTS.Common.ResolvedDate] >= '${since}' ORDER BY [Microsoft.VSTS.Common.ResolvedDate] DESC`
    }, cfg.tfs.pat),
  ]);

  const ids = r => r.status === 'fulfilled' ? (r.value.workItems || []).map(w => w.id) : [];
  const featDoneIds  = ids(featDoneRes);
  const defNewIds    = ids(defNewRes);
  const defP12Ids    = ids(defP12Res);
  const defClosedIds = ids(defClosedRes);

  return {
    since,
    featDone:    featDoneIds.length,
    featDoneIds: featDoneIds.slice(0, 10),
    defNew:      defNewIds.length,
    defNewIds:   defNewIds.slice(0, 10),
    defP12New:   defP12Ids.length,
    defP12Ids:   defP12Ids.slice(0, 10),
    defClosed:   defClosedIds.length,
    netBurn:     defClosedIds.length - defNewIds.length,
  };
}

function buildHistogram(results) {
  const counts = {};
  results.forEach(value => { counts[value] = (counts[value] || 0) + 1; });
  return counts;
}

function runMonteCarlo(throughputHistory, remainingItems, simulations = 3000) {
  if (!throughputHistory.length || remainingItems <= 0 || !throughputHistory.some(value => value > 0)) return null;
  const results = [];
  for (let i = 0; i < simulations; i++) {
    let remaining = remainingItems;
    let periods = 0;
    while (remaining > 0 && periods < 20) {
      remaining -= throughputHistory[Math.floor(Math.random() * throughputHistory.length)];
      periods++;
    }
    results.push(periods);
  }
  results.sort((a, b) => a - b);
  buildHistogram(results);
  return {
    p50: results[Math.floor(simulations * 0.50)],
    p85: results[Math.floor(simulations * 0.85)],
    p95: results[Math.floor(simulations * 0.95)]
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', [INTERNAL_HEADER]: INTERNAL_TOKEN }
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${url}`);
    }
  }
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

async function postWebhook(url, payload) {
  const body = JSON.stringify(payload);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`[postWebhook] ${response.status} — payload size: ${body.length} bytes — response: ${text.slice(0, 300)}`);
    throw new Error(`Webhook POST failed: ${response.status} ${text.slice(0, 200)}`);
  }
}

function formatScope(piLabels) {
  if (!piLabels.length) return 'Selected PI';
  if (piLabels.length === 1) return piLabels[0];
  return `${piLabels[0]}–${piLabels[piLabels.length - 1]}`;
}

// O365 Connector webhooks (webhook.office.com) only support legacy MessageCard.
// Power Automate / newer webhooks (logic.azure.com, flow.microsoft.com) support Adaptive Cards.
function isO365Connector(url) {
  return String(url || '').includes('webhook.office.com');
}

// ── Legacy MessageCard builder (O365 Connectors) ───────────────────────────
function buildMessageCard({ title, scope, headline, deliveryFacts, qualityFacts, forecastFacts, velocityFacts, risksFacts, teamFacts, piReadinessFacts, changesFacts, sections, doneRate, footer, tfsLinks }) {
  const themeColor = doneRate >= 80 ? '00C176' : doneRate >= 50 ? 'FFA500' : 'E81123';
  const msgSections = [
    { activityTitle: `${ragBadge(doneRate)} ${scope}`, text: headline }
  ];
  if (sections.delivery && deliveryFacts) {
    msgSections.push({ activityTitle: '📦 Delivery', facts: deliveryFacts.map(f => ({ name: f.title, value: f.value })), text: `${doneRate}% done rate` });
  }
  if (sections.teamBreakdown && teamFacts) {
    msgSections.push({ activityTitle: '👥 Team Breakdown', facts: teamFacts.map(f => ({ name: f.title, value: f.value })) });
  }
  if (sections.quality && qualityFacts) {
    msgSections.push({ activityTitle: '🐛 Quality', facts: qualityFacts.map(f => ({ name: f.title, value: f.value })) });
  }
  if (sections.piReadiness && piReadinessFacts) {
    msgSections.push({ activityTitle: '🔍 PI Readiness', facts: piReadinessFacts.map(f => ({ name: f.title, value: f.value })) });
  }
  if (sections.velocity && velocityFacts) {
    msgSections.push({ activityTitle: '⚡ Velocity', facts: velocityFacts.map(f => ({ name: f.title, value: f.value })) });
  }
  if (sections.risks && risksFacts) {
    msgSections.push({ activityTitle: '⚠️ Risks', facts: risksFacts.map(f => ({ name: f.title, value: f.value })) });
  }
  if (sections.forecast && forecastFacts) {
    msgSections.push({ activityTitle: '🔮 Forecast', facts: forecastFacts.map(f => ({ name: f.title, value: f.value })) });
  }
  if (sections.changes && changesFacts) {
    msgSections.push({ activityTitle: '📅 Changes This Week', facts: changesFacts.map(f => ({ name: f.title, value: f.value })) });
  }
  msgSections.push({ text: footer });

  const actions = [];
  if (tfsLinks?.dashboard) actions.push({ '@type': 'OpenUri', name: '🔗 Open Dashboard', targets: [{ os: 'default', uri: tfsLinks.dashboard }] });
  // O365 Connector has a URL length limit — use TFS base URL, not WIQL deep-links
  const tfsBaseShort = tfsLinks?.openDefects ? tfsLinks.openDefects.split('/_workitems')[0] : null;
  if (tfsBaseShort) {
    actions.push({ '@type': 'OpenUri', name: '📋 Open TFS Queries', targets: [{ os: 'default', uri: tfsBaseShort + '/_workItems' }] });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: title,
    themeColor,
    title,
    sections: msgSections,
    potentialAction: actions.length ? actions : undefined
  };

  // O365 Connector has a ~24KB payload limit — trim facts if needed
  if (JSON.stringify(card).length > 22000) {
    card.sections = msgSections.slice(0, 5);
  }
  return card;
}

function buildAlertMessageCard({ title, message }) {
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: title,
    themeColor: 'E81123',
    title,
    text: message.replace(/\n/g, '<br/>')
  };
}
function ragColor(rate) {
  return rate >= 80 ? 'Good' : rate >= 50 ? 'Warning' : 'Attention';
}
function ragBadge(rate) {
  return rate >= 80 ? '🟢 Green' : rate >= 50 ? '🟡 Amber' : '🔴 Red';
}

function buildAdaptiveCard({ title, scope, headline, deliveryFacts, qualityFacts, forecastFacts, velocityFacts, risksFacts, teamFacts, piReadinessFacts, changesFacts, sections, doneRate, footer, dashboardUrl, tfsLinks }) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(doneRate) || 0)));
  const col  = ragColor(pct);

  const body = [
    {
      type: 'Container', style: 'accent', bleed: true,
      items: [{
        type: 'ColumnSet',
        columns: [
          { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', color: 'Light', wrap: true }] },
          { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: ragBadge(pct), weight: 'Bolder', color: 'Light', horizontalAlignment: 'Right' }] }
        ]
      }]
    },
    { type: 'TextBlock', text: `**${scope}**: ${headline}`, wrap: true, spacing: 'Medium' }
  ];

  if (sections.delivery && deliveryFacts) {
    body.push({ type: 'TextBlock', text: '📦 **Delivery**', weight: 'Bolder', spacing: 'Medium' });
    const filled = Math.max(1, pct);
    const empty  = Math.max(1, 100 - pct);
    const progressCols = [{ type: 'Column', width: filled, style: col === 'Good' ? 'good' : col === 'Warning' ? 'warning' : 'attention', items: [{ type: 'TextBlock', text: ' ' }] }];
    if (pct < 100) progressCols.push({ type: 'Column', width: empty, items: [{ type: 'TextBlock', text: ' ' }] });
    body.push({ type: 'ColumnSet', columns: progressCols, spacing: 'Small' });
    body.push({ type: 'FactSet', facts: deliveryFacts, spacing: 'Small' });
  }

  if (sections.teamBreakdown && teamFacts && teamFacts.length) {
    body.push({ type: 'TextBlock', text: '👥 **Team Breakdown**', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'FactSet', facts: teamFacts });
  }

  if (sections.quality && qualityFacts) {
    body.push({ type: 'TextBlock', text: '🐛 **Quality**', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'FactSet', facts: qualityFacts });
  }

  if (sections.piReadiness && piReadinessFacts && piReadinessFacts.length) {
    body.push({ type: 'TextBlock', text: '🔍 **PI Readiness**', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'FactSet', facts: piReadinessFacts });
  }

  if (sections.velocity && velocityFacts) {
    body.push({ type: 'TextBlock', text: '⚡ **Velocity**', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'FactSet', facts: velocityFacts });
  }

  if (sections.risks && risksFacts) {
    body.push({ type: 'TextBlock', text: '⚠️ **Risks**', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'FactSet', facts: risksFacts });
  }

  if (sections.forecast && forecastFacts) {
    body.push({ type: 'TextBlock', text: '🔮 **Forecast**', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'FactSet', facts: forecastFacts });
  }

  if (sections.changes && changesFacts && changesFacts.length) {
    body.push({ type: 'TextBlock', text: '📅 **Changes This Week**', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'FactSet', facts: changesFacts });
  }

  body.push({ type: 'TextBlock', text: footer, size: 'Small', color: 'Subtle', spacing: 'Large', wrap: true });

  const card = {
    '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body
  };

  // Build action buttons — dashboard first, then TFS deep-links
  const actions = [];
  if (dashboardUrl || tfsLinks?.dashboard) {
    actions.push({ type: 'Action.OpenUrl', title: '🔗 Open Dashboard', url: tfsLinks?.dashboard || dashboardUrl });
  }
  if (tfsLinks?.p1p2Defects) {
    actions.push({ type: 'Action.OpenUrl', title: '🚨 P1/P2 Defects', url: tfsLinks.p1p2Defects });
  }
  if (tfsLinks?.piReadiness) {
    actions.push({ type: 'Action.OpenUrl', title: '📋 PI Readiness', url: tfsLinks.piReadiness });
  }
  if (tfsLinks?.openDefects) {
    actions.push({ type: 'Action.OpenUrl', title: '🐛 Open Defects', url: tfsLinks.openDefects });
  }
  if (tfsLinks?.openFeatures) {
    actions.push({ type: 'Action.OpenUrl', title: '🚀 Open Features', url: tfsLinks.openFeatures });
  }
  if (actions.length) card.actions = actions;

  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }] };
}

function buildAlertAdaptiveCard({ title, message, color, webhookUrl = '' }) {
  // Auto-detect: O365 Connector webhooks need legacy MessageCard
  if (isO365Connector(webhookUrl)) {
    return buildAlertMessageCard({ title, message });
  }
  const styleMap = { red: 'attention', amber: 'warning', green: 'good', default: 'accent' };
  const style = styleMap[color] || styleMap.default;
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard', version: '1.4',
        msteams: { width: 'Full' },
        body: [
          { type: 'Container', style, bleed: true, items: [{ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', color: 'Light', wrap: true }] },
          { type: 'TextBlock', text: message.replace(/\n/g, '\n\n'), wrap: true, spacing: 'Medium' }
        ]
      }
    }]
  };
}

async function sendDigest() {
  const cfg = loadConfig();
  const fm  = getFieldMappings(cfg);
  const notifications = cfg.notifications || {};
  const webhookUrl  = String(notifications.webhookUrl || '').trim();
  const webhookType = String(notifications.webhookType || 'teams').trim().toLowerCase() === 'slack' ? 'slack' : 'teams';

  if (!webhookUrl) {
    const error = new Error('Webhook not configured');
    error.status = 400;
    throw error;
  }

  const sections = {
    delivery: true, quality: true, forecast: true,
    risks: false, velocity: false,
    teamBreakdown: true, piReadiness: true, changes: true,
    ...(notifications.digestSections || {})
  };
  const percentiles = Array.isArray(notifications.forecastPercentiles) && notifications.forecastPercentiles.length ? notifications.forecastPercentiles : ['p50'];
  const customTitle  = String(notifications.digestTitle  || '').trim();
  const customFooter = String(notifications.digestFooter || '').trim();

  const piLabels = getDigestPiLabels();
  const params   = buildQs({ pis: piLabels });
  const baseUrl  = `http://127.0.0.1:${cfg.app?.port || 3000}`;

  // ── Parallel data fetch ──────────────────────────────────────────────────
  const [summary, dashboard, velocity, risks, piReadinessData] = await Promise.all([
    fetchJson(`${baseUrl}/api/insights/summary?${params}`),
    fetchJson(`${baseUrl}/api/dashboard?${params}`),
    sections.velocity || sections.forecast ? fetchJson(`${baseUrl}/api/velocity?${params}`) : Promise.resolve({}),
    sections.risks ? fetchJson(`${baseUrl}/api/risks?${params}`) : Promise.resolve({}),
    sections.piReadiness ? fetchJson(`${baseUrl}/api/pi-readiness?${params}`).catch(() => null) : Promise.resolve(null),
  ]);

  // ── Features ─────────────────────────────────────────────────────────────
  const features       = dashboard.features || {};
  const defects        = dashboard.defects  || {};
  const done           = features.stateCounts?.Done    || 0;
  const removed        = features.stateCounts?.Removed || 0;
  const total          = features.total || 0;
  const remainingItems = Math.max(0, total - done - removed);
  const openDefects    = getOpenDefectCount(defects.stateCounts);
  const doneRate       = features.doneRate || 0;
  const slippedCount   = features.slippedFeatures?.count || 0;
  const wipCount       = features.wipCount || 0;

  // ── Defect quality ───────────────────────────────────────────────────────
  const escapeRatio       = defects.escapeRatio || 0;
  const resolveRate       = defects.resolveRate || 0;
  const severityBreakdown = defects.severityBreakdown || {};

  // ── Velocity / forecast ──────────────────────────────────────────────────
  const throughputHistory = (velocity.velocity || [])
    .flatMap(pi => (pi.sprints || []).map(s => s.totalDone || 0))
    .filter(v => Number.isFinite(v));
  const forecast = runMonteCarlo(throughputHistory, remainingItems);
  const avgVelocity = throughputHistory.length
    ? (throughputHistory.reduce((a, b) => a + b, 0) / throughputHistory.length).toFixed(1)
    : 'N/A';
  // Sprint-over-sprint trend (last 3 sprints)
  const last3 = throughputHistory.slice(-3);
  const velocityTrend = last3.length >= 2
    ? (last3[last3.length - 1] > last3[0] ? '↗ improving' : last3[last3.length - 1] < last3[0] ? '↘ declining' : '→ stable')
    : '';

  // ── Per-team done rates ──────────────────────────────────────────────────
  const teamRates   = computeTeamRates(features.teamBreakdown || {}, fm);
  const topTeams    = teamRates.slice(0, 3);
  const bottomTeams = teamRates.length > 3 ? teamRates.slice(-Math.min(3, teamRates.length - topTeams.length)) : [];
  const topDefectTeams = computeTopDefectTeams(defects.teamBreakdown || {});

  // ── PI Readiness ─────────────────────────────────────────────────────────
  let piScore = null, piTotalViolations = 0, piTopViolations = [];
  if (piReadinessData && sections.piReadiness) {
    piScore = piReadinessData.programmeScore;
    const checkTotals = {};
    (piReadinessData.teams || []).forEach(t => {
      (t.criteria || []).forEach(c => {
        if (!checkTotals[c.id]) checkTotals[c.id] = { label: c.label, total: 0 };
        checkTotals[c.id].total += c.fail || 0;
      });
    });
    piTopViolations  = Object.values(checkTotals).sort((a, b) => b.total - a.total).filter(v => v.total > 0);
    piTotalViolations = piTopViolations.reduce((s, v) => s + v.total, 0);
    piTopViolations   = piTopViolations.slice(0, 3);
  }

  // ── Changes this week (direct TFS WIQL) ──────────────────────────────────
  let changes = { featDone: 0, defNew: 0, defP12New: 0, defClosed: 0, netBurn: 0, since: '' };
  if (sections.changes) {
    changes = await fetchChangesThisWeek(cfg, fm, piLabels).catch(() => changes);
  }

  // ── TFS deep-links ───────────────────────────────────────────────────────
  const tfsBase = cfg.tfs.baseUrl;
  const area    = cfg.tfs.areaPath;
  const defectType  = (fm && fm.workItemTypes && fm.workItemTypes.defect)  || 'Defect';
  const featureType = (fm && fm.workItemTypes && fm.workItemTypes.feature) || 'Feature';
  const tfsLinks = tfsBase ? {
    dashboard:    `http://localhost:${cfg.app?.port || 3000}`,
    openDefects:  buildTfsQueryLink(tfsBase, `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${defectType}' AND [System.AreaPath] UNDER '${area}' AND [System.State] NOT IN ('Resolved','Closed','Removed') ORDER BY [System.CreatedDate] DESC`),
    p1p2Defects:  buildTfsQueryLink(tfsBase, `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${defectType}' AND [System.AreaPath] UNDER '${area}' AND [Microsoft.VSTS.Common.Priority] <= 2 AND [System.State] NOT IN ('Resolved','Closed','Removed') ORDER BY [Microsoft.VSTS.Common.Priority] ASC`),
    openFeatures: buildTfsQueryLink(tfsBase, `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='${featureType}' AND [System.AreaPath] UNDER '${area}' AND [System.State] NOT IN ('Done','Removed') ORDER BY [System.State] ASC`),
    piReadiness:  buildPiChecksLink(tfsBase, cfg.piChecksQueryFolder),
  } : { dashboard: `http://localhost:${cfg.app?.port || 3000}` };

  // ── Build fact sections ───────────────────────────────────────────────────
  const digestDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const scope   = formatScope(piLabels);
  const title   = customTitle  || `📊 Weekly PI Health Digest — ${digestDate}`;
  const footer  = customFooter || `AV Dashboard · ${scope} · ${digestDate}`;
  const headline = summary.narrative?.headline || `${doneRate}% delivery rate — ${doneRate >= 80 ? 'Green' : doneRate >= 50 ? 'Amber' : 'Red'} status`;

  const deliveryFacts = sections.delivery ? [
    { title: 'Done rate',         value: `${doneRate}%` },
    { title: 'Done / Total',      value: `${done} / ${total}` },
    { title: 'Remaining',         value: String(remainingItems) },
    { title: 'Slipped features',  value: slippedCount > 0 ? `${slippedCount} ⚠️` : '0 ✅' },
    { title: 'WIP (in-progress)', value: String(wipCount) },
  ] : null;

  // Team breakdown facts: top performers then worst performers
  let teamFacts = null;
  if (sections.teamBreakdown && teamRates.length) {
    teamFacts = [];
    topTeams.forEach(t => teamFacts.push({ title: `✅ ${t.team}`, value: `${t.rate}% (${t.done}/${t.active})` }));
    bottomTeams.forEach(t => {
      if (!topTeams.find(tt => tt.team === t.team))
        teamFacts.push({ title: `⚠️ ${t.team}`, value: `${t.rate}% (${t.done}/${t.active})` });
    });
    if (topDefectTeams.length) {
      topDefectTeams.forEach(t => teamFacts.push({ title: `🐛 ${t.team} (defects)`, value: `${t.open} open` }));
    }
  }

  const escapeRag = escapeRatio >= 20 ? '🔴' : escapeRatio >= 10 ? '🟡' : '🟢';
  const qualityFacts = sections.quality ? [
    { title: 'Escape ratio',   value: `${escapeRatio}% ${escapeRag}` },
    { title: 'Resolve rate',   value: `${resolveRate}%` },
    { title: 'Open defects',   value: String(openDefects) },
    { title: 'P1 / P2 open',   value: `${defects.p1p2Count || 0}${(defects.p1p2Count || 0) > 0 ? ' 🚨' : ''}` },
    ...Object.entries(severityBreakdown)
      .filter(([k]) => k !== 'Unknown' && k !== 'undefined')
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([sev, cnt]) => ({ title: sev, value: String(cnt) })),
  ] : null;

  const forecastFacts = sections.forecast ? [
    ...percentiles.filter(p => forecast?.[p]).map(p => ({ title: p.toUpperCase(), value: `${forecast[p]} sprint(s)` })),
    { title: 'Remaining items', value: String(remainingItems) }
  ] : null;

  const velocityFacts = sections.velocity ? [
    { title: 'Avg throughput',  value: `${avgVelocity} items/sprint` },
    { title: 'Trend (last 3)',  value: velocityTrend || `${last3.join(', ')} items` },
    { title: 'Data points',     value: String(throughputHistory.length) }
  ] : null;

  const openRisks   = (risks.items || []).filter(r => !['Resolved', 'Mitigated', 'Closed', 'Removed'].includes(r.state));
  const unroamedCnt = openRisks.filter(r => !r.roamStatus || r.roamStatus === 'Unroamed').length;
  const risksFacts  = sections.risks ? [
    { title: 'Open risks',  value: String(openRisks.length) },
    { title: "Unroam'd",    value: String(unroamedCnt) }
  ] : null;

  let piReadinessFacts = null;
  if (sections.piReadiness && piScore !== null) {
    piReadinessFacts = [
      { title: 'Programme score',    value: `${piScore}%${piScore >= 80 ? ' 🟢' : piScore >= 60 ? ' 🟡' : ' 🔴'}` },
      { title: 'Total violations',   value: `${piTotalViolations}${piTotalViolations === 0 ? ' ✅' : ' ⚠️'}` },
      ...piTopViolations.map((v, i) => ({ title: `#${i + 1} ${v.label}`, value: `${v.total} failing` })),
    ];
  }

  const changesFacts = sections.changes && changes.since ? [
    { title: `Features done (since ${changes.since})`,   value: `+${changes.featDone}` },
    { title: 'New defects this week',    value: `${changes.defNew}${changes.defNew > 5 ? ' ⚠️' : ''}` },
    { title: 'Defects closed this week', value: String(changes.defClosed) },
    { title: 'Net defect burn',          value: `${changes.netBurn >= 0 ? '+' : ''}${changes.netBurn}${changes.netBurn > 0 ? ' 🔴' : changes.netBurn < 0 ? ' 🟢' : ''}` },
    { title: 'New P1/P2 this week',      value: `${changes.defP12New}${changes.defP12New > 0 ? ' 🚨' : ' ✅'}` },
  ] : null;

  // ── Send ─────────────────────────────────────────────────────────────────
  const dashboardUrl = `http://localhost:${cfg.app?.port || 3000}`;

  let sent = false;
  if (webhookType === 'slack') {
    const lines = [title, `${scope}: ${headline}`];
    if (sections.delivery)      lines.push(`📦 Delivery: ${doneRate}% done (${done}/${total}) · Slipped: ${slippedCount} · WIP: ${wipCount}`);
    if (sections.quality)       lines.push(`🐛 Quality: ${openDefects} open · ${defects.p1p2Count || 0} P1/P2 · Escape: ${escapeRatio}% ${escapeRag} · Resolve: ${resolveRate}%`);
    if (sections.teamBreakdown && topTeams.length) lines.push(`👥 Teams: ${topTeams.map(t => `${t.team} ${t.rate}%`).join(' | ')}`);
    if (sections.piReadiness && piScore !== null) lines.push(`🔍 PI Readiness: ${piScore}% · ${piTotalViolations} violations`);
    if (sections.velocity)      lines.push(`⚡ Velocity: avg ${avgVelocity} items/sprint ${velocityTrend}`);
    if (sections.risks)         lines.push(`⚠️ Risks: ${openRisks.length} open (${unroamedCnt} unROAM'd)`);
    if (sections.forecast && forecast) lines.push(`🔮 Forecast: ${percentiles.filter(p => forecast[p]).map(p => `${p.toUpperCase()}=${forecast[p]}sp`).join(', ')} — ${remainingItems} remaining`);
    if (sections.changes && changes.since) lines.push(`📅 This week: +${changes.featDone} features done · ${changes.defNew} new defects · ${changes.defP12New} new P1/P2`);
    lines.push(footer);
    if (tfsLinks.p1p2Defects)  lines.push(`🚨 P1/P2: ${tfsLinks.p1p2Defects}`);
    if (tfsLinks.piReadiness)   lines.push(`📋 PI Readiness: ${tfsLinks.piReadiness}`);
    await postWebhook(webhookUrl, { text: lines.filter(Boolean).join('\n') });
    sent = true;
  } else if (isO365Connector(webhookUrl)) {
    await postWebhook(webhookUrl, buildMessageCard({ title, scope, headline, deliveryFacts, qualityFacts, forecastFacts, velocityFacts, risksFacts, teamFacts, piReadinessFacts, changesFacts, sections, doneRate, footer, tfsLinks }));
    sent = true;
  } else {
    const card = buildAdaptiveCard({ title, scope, headline, deliveryFacts, qualityFacts, forecastFacts, velocityFacts, risksFacts, teamFacts, piReadinessFacts, changesFacts, sections, doneRate, footer, dashboardUrl, tfsLinks });
    await postWebhook(webhookUrl, card);
    sent = true;
  }

  if (sent) {
    lastDigestSentAt = new Date().toISOString();
    notifHistory.record({ type: 'digest', status: 'ok', target: webhookType, scope, doneRate: `${doneRate}%`, summary: `Done ${done}/${total} · Escape ${escapeRatio}% · PIR ${piScore ?? 'n/a'}%` });
  }
  return { sent: true, lastSentAt: lastDigestSentAt };
}

// ── Threshold-based alerts ─────────────────────────────────────────────────
const METRIC_LABELS = { doneRate: 'Done Rate (%)', defectCount: 'Open Defects', velocity: 'Avg Velocity', p1p2Count: 'P1/P2 Defects', remainingItems: 'Remaining Items' };

async function checkThresholds() {
  const cfg = loadConfig();
  const notifications  = cfg.notifications || {};
  const thresholds     = Array.isArray(notifications.thresholdAlerts) ? notifications.thresholdAlerts.filter(t => t.enabled) : [];
  if (!thresholds.length) return { checked: 0, fired: 0 };

  const webhookUrl   = String(notifications.webhookUrl || '').trim();
  const alertUrl     = String(notifications.alertWebhookUrl || '').trim() || webhookUrl;
  const alertType    = String(notifications.alertWebhookType || notifications.webhookType || 'teams').toLowerCase() === 'slack' ? 'slack' : 'teams';
  if (!alertUrl || !notifications.enabled) return { checked: thresholds.length, fired: 0 };

  const baseUrl  = `http://127.0.0.1:${cfg.app?.port || 3000}`;
  const piLabels = getDigestPiLabels();
  const params   = buildQs({ pis: piLabels });

  const [dashboard, velocity] = await Promise.all([
    fetchJson(`${baseUrl}/api/dashboard?${params}`),
    fetchJson(`${baseUrl}/api/velocity?${params}`)
  ]).catch(() => [null, null]);

  if (!dashboard) return { checked: thresholds.length, fired: 0, error: 'Failed to fetch data' };

  const features     = dashboard.features || {};
  const defects      = dashboard.defects  || {};
  const done         = features.stateCounts?.Done || 0;
  const removed      = features.stateCounts?.Removed || 0;
  const total        = features.total || 0;
  const throughputHistory = (velocity?.velocity || []).flatMap(pi => (pi.sprints || []).map(s => s.totalDone || 0)).filter(v => Number.isFinite(v));
  const avgVelocity  = throughputHistory.length ? throughputHistory.reduce((a, b) => a + b, 0) / throughputHistory.length : 0;

  const metricValues = {
    doneRate:       features.doneRate   || 0,
    defectCount:    getOpenDefectCount(defects.stateCounts),
    velocity:       Math.round(avgVelocity * 10) / 10,
    p1p2Count:      defects.p1p2Count   || 0,
    remainingItems: Math.max(0, total - done - removed)
  };

  const ops = { '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '=': (a, b) => a === b };
  const fired = [];

  for (const rule of thresholds) {
    const current = metricValues[rule.metric];
    const op      = ops[rule.operator];
    if (current === undefined || !op) continue;
    if (op(current, Number(rule.value))) {
      fired.push({ rule, current, label: METRIC_LABELS[rule.metric] || rule.metric });
    }
  }

  if (fired.length) {
    const scope = formatScope(piLabels);
    const lines = fired.map(({ rule, current, label }) =>
      `${label}: ${current} ${rule.operator} ${rule.value}${rule.message ? ` — ${rule.message}` : ''}`
    );
    const message = `🚨 ${fired.length} threshold alert${fired.length > 1 ? 's' : ''} fired for ${scope}\n${lines.join('\n')}`;

    if (alertType === 'slack') {
      await postWebhook(alertUrl, { text: message });
    } else {
      await postWebhook(alertUrl, buildAlertAdaptiveCard({ title: '🚨 Threshold Alert — AV Dashboard', message, color: 'red', webhookUrl: alertUrl }));
    }
    notifHistory.record({ type: 'threshold-alert', status: 'ok', target: alertType, count: fired.length, summary: lines.join('; ') });
  }

  return { checked: thresholds.length, fired: fired.length, alerts: fired.map(f => f.label) };
}

function startScheduler(app) {
  const cfg = loadConfig();
  if (!cfg.notifications?.enabled || !cfg.notifications?.webhookUrl) return null;
  if (scheduledTask) return scheduledTask;

  const cronExpr = buildCronExpression(cfg.notifications?.digestSchedule);
  scheduledTask = cron.schedule(cronExpr, () => {
    sendDigest().catch(error => console.error('[scheduler] digest error:', error.message));
  });

  thresholdTask = cron.schedule('0 8 * * *', () => {
    checkThresholds().catch(error => console.error('[scheduler] threshold check error:', error.message));
  });

  if (app?.locals) { app.locals.weeklyDigestTask = scheduledTask; app.locals.thresholdTask = thresholdTask; }
  console.log(`[scheduler] Weekly PI digest: ${cronExpr} | Threshold check: daily 08:00`);
  return scheduledTask;
}

function restartScheduler(app) {
  if (scheduledTask) { scheduledTask.stop(); scheduledTask = null; }
  if (thresholdTask) { thresholdTask.stop(); thresholdTask = null; }
  return startScheduler(app);
}

function getLastDigestSentAt() {
  return lastDigestSentAt;
}

module.exports = { sendDigest, startScheduler, restartScheduler, checkThresholds, buildAlertAdaptiveCard, getLastDigestSentAt };
