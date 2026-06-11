'use strict';

const express = require('express');
const fetch = require('node-fetch');
const { loadConfig } = require('../config');
const { sendDigest, checkThresholds, getLastDigestSentAt } = require('../scheduler');
const { getHistory, record } = require('../notificationHistory');

const router = express.Router();

function normalizeWebhookType(value) {
  return String(value || 'teams').trim().toLowerCase() === 'slack' ? 'slack' : 'teams';
}

function getWebhookSettings(req) {
  const cfg = loadConfig(req.deptId);
  const notifications = cfg.notifications || {};
  return {
    url: String(notifications.webhookUrl || '').trim(),
    webhookType: normalizeWebhookType(notifications.webhookType),
    alertUrl: String(notifications.alertWebhookUrl || '').trim(),
    alertWebhookType: normalizeWebhookType(notifications.alertWebhookType || notifications.webhookType),
    enabled: Boolean(notifications.enabled)
  };
}

function getAlertSettings(req) {
  const settings = getWebhookSettings(req);
  return {
    ...settings,
    url: settings.alertUrl || settings.url,
    webhookType: settings.alertUrl ? settings.alertWebhookType : settings.webhookType
  };
}

async function postWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook POST failed: ${response.status} ${text.slice(0, 200)}`);
  }
}

async function sendWebhookMessage(req, message, title = 'AV Dashboard Alert', color = 'default', useAlertWebhook = false) {
  const settings = useAlertWebhook ? getAlertSettings(req) : getWebhookSettings(req);
  if (!settings.url) {
    const error = new Error('Webhook not configured');
    error.status = 400;
    throw error;
  }

  if (settings.webhookType === 'slack') {
    await postWebhook(settings.url, { text: `${title}\n${message}`.trim() });
  } else {
    const { buildAlertAdaptiveCard } = require('../scheduler');
    await postWebhook(settings.url, buildAlertAdaptiveCard({ title, message, color, webhookUrl: settings.url }));
  }
  return settings;
}

function formatAnomalyLine(alert) {
  return `${alert.pi || 'Selected PI'}: ${alert.label || 'Alert'} — current: ${alert.current}, avg: ${alert.mean}, z-score: ${alert.z}`;
}

router.get('/config', async (req, res) => {
  try {
    const settings = getWebhookSettings(req);
    res.json({
      configured: Boolean(settings.url),
      webhookType: settings.webhookType,
      enabled: settings.enabled,
      lastDigestSentAt: getLastDigestSentAt()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/webhook/test', async (req, res) => {
  try {
    const message = String(req.body?.message || 'Test message from AV Dashboard');
    const result = await sendWebhookMessage(req, message, 'AV Dashboard Alert');
    record({ type: 'test', status: 'ok', target: result.webhookType });
    res.json({ sent: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/webhook/anomaly', async (req, res) => {
  try {
    const alerts = Array.isArray(req.body?.alerts) ? req.body.alerts : [];
    if (!alerts.length) return res.json({ sent: true, count: 0 });

    const settings = getAlertSettings(req);
    if (!settings.enabled) return res.json({ sent: false, count: alerts.length, disabled: true });
    if (!settings.url) return res.status(400).json({ error: 'Webhook not configured' });

    const message = ['🚨 AV Dashboard Anomaly Detected', ...alerts.map(formatAnomalyLine)].join('\n');
    await sendWebhookMessage(req, message, 'AV Dashboard Alert', 'red', true);
    record({ type: 'anomaly-alert', status: 'ok', target: settings.webhookType, count: alerts.length, summary: alerts.map(formatAnomalyLine).join('; ') });
    res.json({ sent: true, count: alerts.length });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/digest/trigger', async (_req, res) => {
  try {
    const result = await sendDigest();
    res.json({ sent: true, lastSentAt: result.lastSentAt });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/history', (_req, res) => {
  try { res.json({ history: getHistory() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/thresholds/check', async (_req, res) => {
  try {
    const result = await checkThresholds();
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

module.exports = router;
