'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const { getDeptDataFile } = require('../helpers/deptPaths');

const router = express.Router();

// ── local store helpers ───────────────────────────────────────────────────────
function getDataFile(deptId) {
  return getDeptDataFile(deptId || 'default', 'retro-actions.json');
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

// ── GET /api/retro ────────────────────────────────────────────────────────────
router.get('/retro', (req, res) => {
  const { pi, team } = req.query;
  let items = readAll(req.deptId);
  if (pi)   items = items.filter(i => !i.pi   || i.pi   === pi);
  if (team) items = items.filter(i => !i.team || i.team === team || i.team.toLowerCase().includes(team.toLowerCase()));
  res.json({ items, fetchedAt: new Date().toISOString() });
});

// ── POST /api/retro ───────────────────────────────────────────────────────────
router.post('/retro', (req, res) => {
  const { title, team, teamPath, sprint, pi, category, owner, dueDate, notes } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const now   = new Date().toISOString();
  const actor = req.user?.displayName || req.user?.email || 'unknown';
  const item  = {
    id:         crypto.randomUUID(),
    title:      title.trim(),
    team:       team || '',
    teamPath:   teamPath || '',
    sprint:     sprint || '',
    pi:         pi || '',
    category:   category || 'other',
    owner:      owner || '',
    dueDate:    dueDate || '',
    notes:      notes || '',
    status:     'open',
    createdBy:  actor,
    createdAt:  now,
    updatedAt:  now,
    closedAt:   null,
    statusHistory: [{ status: 'open', at: now, by: actor }],
  };

  const all = readAll(req.deptId);
  all.push(item);
  writeAll(all, req.deptId);
  res.status(201).json(item);
});

// ── PUT /api/retro/:id ────────────────────────────────────────────────────────
router.put('/retro/:id', (req, res) => {
  const all = readAll(req.deptId);
  const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const prev  = all[idx];
  const now   = new Date().toISOString();
  const actor = req.user?.displayName || req.user?.email || 'unknown';
  const { title, team, teamPath, sprint, pi, category, owner, dueDate, notes, status } = req.body;

  const updated = {
    ...prev,
    title:    title    ?? prev.title,
    team:     team     ?? prev.team,
    teamPath: teamPath ?? prev.teamPath,
    sprint:   sprint   ?? prev.sprint,
    pi:       pi       ?? prev.pi,
    category: category ?? prev.category,
    owner:    owner    ?? prev.owner,
    dueDate:  dueDate  ?? prev.dueDate,
    notes:    notes    ?? prev.notes,
    status:   status   ?? prev.status,
    updatedAt: now,
  };

  // Track status transitions
  if (status && status !== prev.status) {
    updated.statusHistory = [
      ...(prev.statusHistory || []),
      { status, at: now, by: actor },
    ];
    if (status === 'done' && !prev.closedAt) updated.closedAt = now;
    if (status !== 'done') updated.closedAt = null;
  }

  all[idx] = updated;
  writeAll(all, req.deptId);
  res.json(updated);
});

// ── DELETE /api/retro/:id ─────────────────────────────────────────────────────
router.delete('/retro/:id', (req, res) => {
  const all = readAll(req.deptId);
  const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  all.splice(idx, 1);
  writeAll(all, req.deptId);
  res.json({ ok: true });
});

module.exports = router;


// ── GET /api/retro ────────────────────────────────────────────────────────────
router.get('/retro', (req, res) => {
  const { pi, team } = req.query;
  let items = readAll();
  if (pi)   items = items.filter(i => !i.pi   || i.pi   === pi);
  if (team) items = items.filter(i => !i.team || i.team === team || i.team.toLowerCase().includes(team.toLowerCase()));
  res.json({ items, fetchedAt: new Date().toISOString() });
});

// ── POST /api/retro ───────────────────────────────────────────────────────────
router.post('/retro', (req, res) => {
  const { title, team, teamPath, sprint, pi, category, owner, dueDate, notes } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const now   = new Date().toISOString();
  const actor = req.user?.displayName || req.user?.email || 'unknown';
  const item  = {
    id:         crypto.randomUUID(),
    title:      title.trim(),
    team:       team || '',
    teamPath:   teamPath || '',
    sprint:     sprint || '',
    pi:         pi || '',
    category:   category || 'other',
    owner:      owner || '',
    dueDate:    dueDate || '',
    notes:      notes || '',
    status:     'open',
    createdBy:  actor,
    createdAt:  now,
    updatedAt:  now,
    closedAt:   null,
    statusHistory: [{ status: 'open', at: now, by: actor }],
  };

  const all = readAll();
  all.push(item);
  writeAll(all);
  res.status(201).json(item);
});

// ── PUT /api/retro/:id ────────────────────────────────────────────────────────
router.put('/retro/:id', (req, res) => {
  const all = readAll();
  const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const prev  = all[idx];
  const now   = new Date().toISOString();
  const actor = req.user?.displayName || req.user?.email || 'unknown';
  const { title, team, teamPath, sprint, pi, category, owner, dueDate, notes, status } = req.body;

  const updated = {
    ...prev,
    title:    title    ?? prev.title,
    team:     team     ?? prev.team,
    teamPath: teamPath ?? prev.teamPath,
    sprint:   sprint   ?? prev.sprint,
    pi:       pi       ?? prev.pi,
    category: category ?? prev.category,
    owner:    owner    ?? prev.owner,
    dueDate:  dueDate  ?? prev.dueDate,
    notes:    notes    ?? prev.notes,
    status:   status   ?? prev.status,
    updatedAt: now,
  };

  // Track status transitions
  if (status && status !== prev.status) {
    updated.statusHistory = [
      ...(prev.statusHistory || []),
      { status, at: now, by: actor },
    ];
    if (status === 'done' && !prev.closedAt) updated.closedAt = now;
    if (status !== 'done') updated.closedAt = null;
  }

  all[idx] = updated;
  writeAll(all);
  res.json(updated);
});

// ── DELETE /api/retro/:id ─────────────────────────────────────────────────────
router.delete('/retro/:id', (req, res) => {
  const all = readAll();
  const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  all.splice(idx, 1);
  writeAll(all);
  res.json({ ok: true });
});

module.exports = router;
