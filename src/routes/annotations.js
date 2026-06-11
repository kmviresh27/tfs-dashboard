'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const { getDeptDataFile } = require('../helpers/deptPaths');

const router    = express.Router();

function getDataFile(deptId) {
  return getDeptDataFile(deptId || 'default', 'annotations.json');
}

function readAll(deptId) {
  try {
    const f = getDataFile(deptId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { /* ignore */ }
  return [];
}

function writeAll(items, deptId) {
  const f = getDataFile(deptId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(items, null, 2));
}

// ── GET /api/annotations ──────────────────────────────────────────────────────
// ?section=velocity&pi=26-PI2&team=...
router.get('/annotations', (req, res) => {
  const { section, pi, team } = req.query;
  // Normalize team: the global middleware strips ROOT: from req.query but stored
  // annotations may have been saved with the ROOT: prefix via req.body (unstripped).
  const normTeam = team ? team.replace(/^ROOT:/i, '') : team;
  let items = readAll(req.deptId);
  if (section)   items = items.filter(i => i.section === section);
  if (pi)        items = items.filter(i => !i.pi || i.pi === pi);
  if (normTeam)  items = items.filter(i => {
    const stored = (i.team || '').replace(/^ROOT:/i, '');
    return !stored || stored === normTeam;
  });
  res.json({ items });
});

// ── POST /api/annotations ─────────────────────────────────────────────────────
router.post('/annotations', (req, res) => {
  const { section, chartId, pi, team, sprint, text, color } = req.body;
  if (!section || !sprint || !text?.trim())
    return res.status(400).json({ error: 'section, sprint and text are required' });

  const now   = new Date().toISOString();
  const actor = req.user?.displayName || req.user?.email || 'unknown';
  const item  = {
    id:        crypto.randomUUID(),
    section:   section,
    chartId:   chartId || '',
    pi:        pi      || '',
    team:      (team || '').replace(/^ROOT:/i, ''),
    sprint:    sprint,
    text:      text.trim(),
    color:     color || '#F5CC00',
    author:    actor,
    createdAt: now,
  };

  const all = readAll(req.deptId);
  all.push(item);
  writeAll(all, req.deptId);
  res.status(201).json(item);
});

// ── DELETE /api/annotations/:id ───────────────────────────────────────────────
router.delete('/annotations/:id', (req, res) => {
  const all = readAll(req.deptId);
  const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  all.splice(idx, 1);
  writeAll(all, req.deptId);
  res.json({ ok: true });
});

module.exports = router;
