'use strict';
const express = require('express');
const { loadConfig, saveConfig } = require('../config');
const { requireDeptAdmin }       = require('../middleware/auth');
const { bustCache }              = require('../helpers/responseCache');
const { bustTeamsCache }         = require('../helpers/teamsHelper');

const router = express.Router();

// ─── GET /api/config ──────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    res.json({
      tfs: {
        organization:   cfg.tfs.organization,
        project:        cfg.tfs.project,
        baseUrl:        cfg.tfs.baseUrl,
        pat:            cfg.tfs.pat ? '***' : '',
        areaPath:       cfg.tfs.areaPath,
        teamRootPath:   cfg.tfs.teamRootPath || '',
        iterationPath:  cfg.tfs.iterationPath,
        apiVersion:     cfg.tfs.apiVersion
      },
      app: cfg.app,
      defectEscapeRatio: cfg.defectEscapeRatio,
      ragThresholds: cfg.ragThresholds,
      branding: cfg.branding || {
        companyName: 'Company',
        appName: 'AV Dashboard',
        appSubtitle: 'ISP Programme · Dashboard',
        logoType: 'text',
        logoSvg: '',
        logoUrl: '',
        primaryColor: '#1492ff'
      },
      notifications: {
        webhookUrl: cfg.notifications?.webhookUrl ? '***' : '',
        webhookType: cfg.notifications?.webhookType || 'teams',
        anomalyThreshold: Number.isFinite(Number(cfg.notifications?.anomalyThreshold)) ? Number(cfg.notifications.anomalyThreshold) : 1.5,
        enabled: Boolean(cfg.notifications?.enabled),
        digestSchedule: cfg.notifications?.digestSchedule || { day: 'monday', hour: 9, minute: 0 },
        digestSections: { delivery: true, quality: true, forecast: true, risks: false, velocity: false, ...(cfg.notifications?.digestSections || {}) },
        forecastPercentiles: cfg.notifications?.forecastPercentiles || ['p50'],
        anomalyAlerts: { enabled: true, metrics: ['doneRate', 'defectCount', 'velocity'], ...(cfg.notifications?.anomalyAlerts || {}) },
        digestTitle: cfg.notifications?.digestTitle || '',
        digestFooter: cfg.notifications?.digestFooter || '',
        alertWebhookUrl:  cfg.notifications?.alertWebhookUrl  ? '***' : '',
        alertWebhookType: cfg.notifications?.alertWebhookType || 'teams',
        thresholdAlerts:  cfg.notifications?.thresholdAlerts  || [],
      },
      github: {
        token:  cfg.github?.token  ? '***' : '',
        repos:  cfg.github?.repos  || []
      },
      roles: {
        custom:    cfg.roles?.custom    || [],
        overrides: cfg.roles?.overrides || {}
      },
      fieldMappings: cfg.fieldMappings || {},
      kpi: cfg.kpi || {},
      azureAd: {
        tenantId:    cfg.azureAd?.tenantId    || '',
        clientId:    cfg.azureAd?.clientId    || '',
        clientSecret: cfg.azureAd?.clientSecret ? '***' : '',
        redirectUrl: cfg.azureAd?.redirectUrl  || '',
      },
      roleMappings: cfg.roleMappings || [],
      adminRoles:   cfg.adminRoles   || ['admin'],
      policies:     cfg.policies     || {},
      tfsAuth: {
        enabled:    !!(cfg.tfsAuth?.enabled),
        userRoles:  cfg.tfsAuth?.userRoles  || {},
        adminUsers: cfg.tfsAuth?.adminUsers || [],
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/config ─────────────────────────────────────────────────────────
router.post('/config', requireDeptAdmin, (req, res) => {
  try {
    const current = loadConfig(req.deptId);
    const body = req.body;
    if (body.tfs) {
      if (body.tfs.teamRootPath !== undefined) {
        const raw = body.tfs.teamRootPath;
        body.tfs.teamRootPath = Array.isArray(raw)
          ? raw.filter(Boolean)
          : String(raw).split('\n').map(s => s.trim()).filter(Boolean);
      }
      // Normalise baseUrl: replace backslashes with forward slashes in URL part
      if (body.tfs.baseUrl) {
        body.tfs.baseUrl = body.tfs.baseUrl.trim().replace(/\\/g, '/');
      }
      Object.assign(current.tfs, body.tfs);
      if (!body.tfs.pat) delete body.tfs.pat;
    }
    if (body.app)               Object.assign(current.app, body.app);
    if (body.defectEscapeRatio) Object.assign(current.defectEscapeRatio, body.defectEscapeRatio);
    if (body.ragThresholds)     Object.assign(current.ragThresholds, body.ragThresholds);
    if (body.github) {
      if (!current.github) current.github = {};
      if (body.github.token)              current.github.token   = body.github.token;
      if (body.github.apiBase !== undefined) current.github.apiBase = body.github.apiBase;
      if (body.github.repos !== undefined) current.github.repos  = body.github.repos;
    }
    if (body.branding) {
      if (!current.branding) current.branding = {};
      Object.assign(current.branding, body.branding);
    }
    if (body.notifications) {
      if (!current.notifications) current.notifications = {};
      const notifications = { ...body.notifications };
      if (notifications.webhookUrl === '***' || !String(notifications.webhookUrl || '').trim()) {
        delete notifications.webhookUrl;
      } else {
        notifications.webhookUrl = String(notifications.webhookUrl).trim();
      }
      if (notifications.webhookType !== undefined) notifications.webhookType = String(notifications.webhookType || 'teams').trim().toLowerCase() || 'teams';
      if (notifications.anomalyThreshold !== undefined) notifications.anomalyThreshold = Number(notifications.anomalyThreshold);
      if (notifications.enabled !== undefined) notifications.enabled = Boolean(notifications.enabled);
      if (notifications.digestSchedule !== undefined) current.notifications.digestSchedule = notifications.digestSchedule;
      if (notifications.digestSections !== undefined) current.notifications.digestSections = notifications.digestSections;
      if (notifications.forecastPercentiles !== undefined) current.notifications.forecastPercentiles = notifications.forecastPercentiles;
      if (notifications.anomalyAlerts !== undefined) current.notifications.anomalyAlerts = notifications.anomalyAlerts;
      if (notifications.digestTitle  !== undefined) current.notifications.digestTitle  = notifications.digestTitle;
      if (notifications.digestFooter !== undefined) current.notifications.digestFooter = notifications.digestFooter;
      if (notifications.alertWebhookUrl === '***' || !String(notifications.alertWebhookUrl || '').trim()) {
        delete notifications.alertWebhookUrl;
      } else if (notifications.alertWebhookUrl !== undefined) {
        current.notifications.alertWebhookUrl = String(notifications.alertWebhookUrl).trim();
      }
      if (notifications.alertWebhookType !== undefined) current.notifications.alertWebhookType = String(notifications.alertWebhookType || 'teams').toLowerCase();
      if (notifications.thresholdAlerts  !== undefined) current.notifications.thresholdAlerts  = notifications.thresholdAlerts;
      delete notifications.digestSchedule; delete notifications.digestSections;
      delete notifications.forecastPercentiles; delete notifications.anomalyAlerts;
      delete notifications.digestTitle; delete notifications.digestFooter;
      delete notifications.alertWebhookUrl; delete notifications.alertWebhookType; delete notifications.thresholdAlerts;
      Object.assign(current.notifications, notifications);
    }
    if (body.roles) {
      if (!current.roles) current.roles = {};
      if (Array.isArray(body.roles.custom))   current.roles.custom    = body.roles.custom;
      if (body.roles.overrides !== undefined) current.roles.overrides = body.roles.overrides;
    }
    if (body.fieldMappings) {
      if (!current.fieldMappings) current.fieldMappings = {};
      const { workItemTypes, fields, stateValues, piStructure } = body.fieldMappings;
      if (workItemTypes) current.fieldMappings.workItemTypes = workItemTypes;
      if (fields)        current.fieldMappings.fields        = fields;
      if (stateValues)   current.fieldMappings.stateValues   = stateValues;
      if (piStructure)   current.fieldMappings.piStructure   = piStructure;
    }
    if (body.kpi) {
      if (!current.kpi) current.kpi = {};
      if (body.kpi.tags !== undefined)                 current.kpi.tags                 = body.kpi.tags;
      if (body.kpi.attachmentKeywords !== undefined)   current.kpi.attachmentKeywords   = body.kpi.attachmentKeywords;
      if (body.kpi.targets !== undefined)              current.kpi.targets              = body.kpi.targets;
      if (body.kpi.defectAnalysisTimeBaseline !== undefined) current.kpi.defectAnalysisTimeBaseline = Number(body.kpi.defectAnalysisTimeBaseline);
      // preserve pipeline data (set via separate endpoint)
      if (current.kpi.pipeline) current.kpi.pipeline = current.kpi.pipeline;
    }
    if (body.azureAd) {
      if (!current.azureAd) current.azureAd = {};
      if (body.azureAd.tenantId    !== undefined) current.azureAd.tenantId    = body.azureAd.tenantId;
      if (body.azureAd.clientId    !== undefined) current.azureAd.clientId    = body.azureAd.clientId;
      if (body.azureAd.clientSecret && body.azureAd.clientSecret !== '***') current.azureAd.clientSecret = body.azureAd.clientSecret;
      if (body.azureAd.redirectUrl !== undefined) current.azureAd.redirectUrl = body.azureAd.redirectUrl;
      require('../middleware/auth').resetOidcClient();
    }
    if (body.roleMappings !== undefined) current.roleMappings = body.roleMappings;
    if (body.adminRoles   !== undefined) current.adminRoles   = body.adminRoles;
    if (body.policies     !== undefined) current.policies     = body.policies;
    if (body.tfsAuth?.userRoles !== undefined) {
      if (!current.tfsAuth) current.tfsAuth = {};
      current.tfsAuth.userRoles = body.tfsAuth.userRoles;
    }
    saveConfig(current, req.deptId);
    bustCache(req.deptId);
    if (current.tfs?.baseUrl) bustTeamsCache(current.tfs.baseUrl);
    if (body.notifications) {
      try { require('../scheduler').restartScheduler(req.app); } catch (_) {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
