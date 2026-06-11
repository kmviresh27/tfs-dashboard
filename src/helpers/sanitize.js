'use strict';

/**
 * Input validation + WIQL escaping helpers.
 *
 * Design:
 *  - validateXxx() returns { valid, value, reason } — routes reject with 400 on invalid
 *  - wiqlEscape() is applied to ALL string values before interpolation into WIQL strings
 *  - Never mutate/strip content silently; either accept (escaped) or reject (400)
 */

// Characters that would break out of a WIQL string literal or clause
const WIQL_INJECTION_RE = /['";]/;

/**
 * Escape a string for safe embedding inside a WIQL single-quoted literal.
 * ' → '' (WIQL standard)
 */
function wiqlEscape(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/'/g, "''");
}

/**
 * Validate a PI label like "26-PI1", "PI26.2", "25-PI4".
 * Allows: alphanumeric, hyphen, dot. Max 30 chars.
 */
function validatePiLabel(s) {
  if (!s || typeof s !== 'string') return { valid: false, reason: 'pi label required' };
  const v = s.trim();
  if (v.length > 30) return { valid: false, reason: 'pi label too long' };
  if (!/^[A-Za-z0-9.\-]+$/.test(v)) return { valid: false, reason: 'invalid characters in pi label' };
  return { valid: true, value: wiqlEscape(v) };
}

/**
 * Validate an array of PI labels. Returns { valid, values, reason }.
 */
function validatePiLabels(arr) {
  if (!Array.isArray(arr)) arr = arr ? [arr] : [];
  if (arr.length === 0) return { valid: false, reason: 'at least one pi label required' };
  if (arr.length > 20) return { valid: false, reason: 'too many pi labels' };
  const values = [];
  for (const s of arr) {
    const r = validatePiLabel(s);
    if (!r.valid) return { valid: false, reason: r.reason };
    values.push(r.value);
  }
  return { valid: true, values };
}

/**
 * Validate a TFS path (AreaPath / IterationPath / teamPath).
 * Allows: alphanumeric, space, backslash, hyphen, dot, underscore, parentheses, ampersand, slash.
 * Rejects: quotes, semicolons, angle brackets, curly braces (WIQL injection chars).
 * Max 500 chars.
 */
function validatePath(s) {
  if (!s || typeof s !== 'string') return { valid: true, value: '' }; // optional paths are OK empty
  const v = s.trim();
  if (v.length > 500) return { valid: false, reason: 'path too long' };
  if (WIQL_INJECTION_RE.test(v)) return { valid: false, reason: 'invalid characters in path' };
  if (/[<>{}|]/.test(v)) return { valid: false, reason: 'invalid characters in path' };
  return { valid: true, value: wiqlEscape(v) };
}

/**
 * Validate an integer query param. Returns parsed int or defaultVal.
 */
function validateInt(s, defaultVal = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = parseInt(s, 10);
  if (isNaN(n)) return defaultVal;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validate a positive integer ID (work item ID).
 */
function validateId(s) {
  const n = parseInt(s, 10);
  if (isNaN(n) || n <= 0) return { valid: false, reason: 'invalid id' };
  return { valid: true, value: n };
}

/**
 * Validate a generic short string (labels, names). Max 200 chars, no WIQL injection chars.
 */
function validateStr(s, maxLen = 200) {
  if (!s || typeof s !== 'string') return { valid: true, value: '' };
  const v = s.trim();
  if (v.length > maxLen) return { valid: false, reason: 'value too long' };
  if (WIQL_INJECTION_RE.test(v)) return { valid: false, reason: 'invalid characters in value' };
  return { valid: true, value: wiqlEscape(v) };
}

/**
 * Express middleware factory: validate common TFS query params and attach sanitized values
 * to req.san (sanitized). Routes can use req.san.pi, req.san.teamPath, etc.
 * Rejects with 400 if any present param is invalid.
 *
 * Does NOT reject if params are absent — routes decide what's required.
 */
function sanitizeMiddleware(req, res, next) {
  req.san = {};

  // pi (single)
  if (req.query.pi !== undefined) {
    const r = validatePiLabel(req.query.pi);
    if (!r.valid) return res.status(400).json({ error: `Invalid pi: ${r.reason}` });
    req.san.pi = r.value;
  }

  // pis[] (array)
  const pisRaw = req.query['pis[]'] || req.query.pis;
  if (pisRaw !== undefined) {
    const arr = Array.isArray(pisRaw) ? pisRaw : [pisRaw];
    const r = validatePiLabels(arr);
    if (!r.valid) return res.status(400).json({ error: `Invalid pis: ${r.reason}` });
    req.san.pis = r.values;
  }

  // teamPath / team
  for (const key of ['teamPath', 'team']) {
    if (req.query[key] !== undefined) {
      const r = validatePath(req.query[key]);
      if (!r.valid) return res.status(400).json({ error: `Invalid ${key}: ${r.reason}` });
      req.san[key] = r.value;
    }
  }

  // iterPath
  if (req.query.iterPath !== undefined) {
    const r = validatePath(req.query.iterPath);
    if (!r.valid) return res.status(400).json({ error: `Invalid iterPath: ${r.reason}` });
    req.san.iterPath = r.value;
  }

  // top (integer limit)
  if (req.query.top !== undefined) {
    req.san.top = validateInt(req.query.top, 200, 1, 5000);
  }

  // snapshotId (short alphanum+hyphen)
  if (req.query.snapshotId !== undefined) {
    const r = validateStr(req.query.snapshotId, 100);
    if (!r.valid) return res.status(400).json({ error: `Invalid snapshotId: ${r.reason}` });
    req.san.snapshotId = r.value;
  }

  next();
}

module.exports = {
  wiqlEscape,
  validatePiLabel,
  validatePiLabels,
  validatePath,
  validateInt,
  validateId,
  validateStr,
  sanitizeMiddleware,
};
