'use strict';
const fs   = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/user-pats.json');

function _load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function _save(data) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/** Normalise username to lower-case for consistent key lookup */
function _key(username) {
  return (username || '').trim().toLowerCase();
}

function hasPat(username) {
  const store = _load();
  return !!store[_key(username)];
}

function getPat(username) {
  const store = _load();
  return store[_key(username)] || null;
}

function storePat(username, pat) {
  const store = _load();
  store[_key(username)] = pat;
  _save(store);
}

function removePat(username) {
  const store = _load();
  delete store[_key(username)];
  _save(store);
}

module.exports = { hasPat, getPat, storePat, removePat };
