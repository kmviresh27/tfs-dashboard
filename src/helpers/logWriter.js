'use strict';

/**
 * File-based log writer.
 *
 * Intercepts process.stdout and process.stderr so ALL output — from routes,
 * middleware, scheduler, TFS client, etc. — is automatically written to both
 * the terminal AND rotating daily log files.
 *
 * Log files:
 *   logs/app-YYYY-MM-DD.log    — combined (stdout + stderr)
 *   logs/error-YYYY-MM-DD.log  — errors only (stderr)
 *
 * Rotation:  new file at midnight (checked every minute)
 * Retention: files older than KEEP_DAYS are deleted automatically
 *
 * Call initLogging() once at the very start of server.js.
 */

const fs   = require('fs');
const path = require('path');

const LOGS_DIR  = path.join(__dirname, '..', '..', 'logs');
const KEEP_DAYS = 30;

let _currentDate = '';
let _appStream   = null;  // combined (stdout + stderr)
let _errStream   = null;  // errors only

const _origStdout = process.stdout.write.bind(process.stdout);
const _origStderr = process.stderr.write.bind(process.stderr);

function _getDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _openStreams(date) {
  // Close old streams gracefully
  if (_appStream) { try { _appStream.end(); } catch {} }
  if (_errStream) { try { _errStream.end(); } catch {} }

  const appPath = path.join(LOGS_DIR, `app-${date}.log`);
  const errPath = path.join(LOGS_DIR, `error-${date}.log`);

  _appStream = fs.createWriteStream(appPath, { flags: 'a' });
  _errStream = fs.createWriteStream(errPath, { flags: 'a' });

  _appStream.on('error', e => _origStderr(`[logWriter] app stream error: ${e.message}\n`));
  _errStream.on('error', e => _origStderr(`[logWriter] err stream error: ${e.message}\n`));

  _currentDate = date;
}

function _checkRotate() {
  const today = _getDate();
  if (today !== _currentDate) {
    _openStreams(today);
    _purgeOldLogs();
  }
}

function _purgeOldLogs() {
  try {
    const cutoffMs = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(LOGS_DIR)) {
      if (!/^(app|error)-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;
      const fpath = path.join(LOGS_DIR, file);
      if (fs.statSync(fpath).mtimeMs < cutoffMs) {
        fs.unlinkSync(fpath);
        _origStdout(`[logWriter] Purged old log: ${file}\n`);
      }
    }
  } catch { /* non-fatal */ }
}

/**
 * Initialize file logging. Call once at server startup before anything else.
 */
function initLogging() {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch (e) {
    _origStderr(`[logWriter] Cannot create logs directory: ${e.message}\n`);
    return; // fail open — app still runs, just without file logs
  }

  _openStreams(_getDate());

  // Check for midnight rotation every minute (timer doesn't block shutdown)
  const rotateTimer = setInterval(_checkRotate, 60 * 1000);
  if (rotateTimer.unref) rotateTimer.unref();

  // ── Tee stdout → terminal + app.log ────────────────────────────────────────
  process.stdout.write = function (chunk, encoding, cb) {
    _checkRotate();
    if (_appStream?.writable) _appStream.write(chunk);
    return _origStdout(chunk, encoding, cb);
  };

  // ── Tee stderr → terminal + error.log + app.log (so app.log is complete) ──
  process.stderr.write = function (chunk, encoding, cb) {
    _checkRotate();
    if (_errStream?.writable) _errStream.write(chunk);
    if (_appStream?.writable) _appStream.write(chunk);
    return _origStderr(chunk, encoding, cb);
  };

  console.log(`[${new Date().toISOString()}] [logWriter] Logs → ${LOGS_DIR}`);
}

/** Flush and close log streams (call from graceful shutdown if needed). */
function closeLogging() {
  process.stdout.write = _origStdout;
  process.stderr.write = _origStderr;
  try { _appStream?.end(); } catch {}
  try { _errStream?.end(); } catch {}
}

function getLogsDir() { return LOGS_DIR; }

module.exports = { initLogging, closeLogging, getLogsDir };
