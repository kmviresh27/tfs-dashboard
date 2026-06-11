'use strict';
const path = require('path');
const fs   = require('fs');

const LOG_PATH = path.join(__dirname, '..', 'notifications-log.json');
const MAX = 50;
let history = [];

function loadHistory() {
  try { if (fs.existsSync(LOG_PATH)) history = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch {}
}

function saveHistory() {
  try { fs.writeFileSync(LOG_PATH, JSON.stringify(history, null, 2)); } catch {}
}

function record(entry) {
  history.unshift({ id: Date.now(), sentAt: new Date().toISOString(), ...entry });
  if (history.length > MAX) history.length = MAX;
  saveHistory();
}

function getHistory() { return history; }

loadHistory();
module.exports = { record, getHistory };
