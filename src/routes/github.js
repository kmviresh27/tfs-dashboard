'use strict';
const express = require('express');
const fetch   = require('node-fetch');
const { loadConfig } = require('../config');

const router = express.Router();

// ─── GitHub test-case matrix ──────────────────────────────────────────────────
// Scans test files from the repo tree and reads blob contents to count
// actual test methods — no CI run or artifact upload required.
// type "angular" : counts *.spec.ts  →  it( / test( occurrences
// type "dotnet"  : counts *Tests.cs  →  [TestMethod] / [Test] / [Fact] / [Theory]

async function countBlobTestMethods(owner, repo, files, hdrs, type, apiBase) {
  const BASE = (apiBase || 'https://api.github.com').replace(/\/$/, '');
  const pat    = type === 'angular'
    ? /\bit\s*\(/g
    : /\[(?:TestMethod|Test|Fact|Theory)\]/g;

  const BATCH = 10;
  const out   = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH);
    const rows  = await Promise.all(slice.map(async f => {
      try {
        const r = await fetch(
          `${BASE}/repos/${owner}/${repo}/git/blobs/${f.sha}`,
          { headers: hdrs }
        );
        if (!r.ok) return { path: f.path, testCases: 0 };
        const d       = await r.json();
        const content = Buffer.from(d.content.replace(/\n/g, ''), 'base64').toString('utf8');
        const testCases = (content.match(pat) || []).length;
        return { path: f.path, testCases };
      } catch {
        return { path: f.path, testCases: 0 };
      }
    }));
    out.push(...rows);
  }
  return out;
}

async function scanTestFiles(owner, repo, hdrs, type, searchPath, apiBase) {
  const BASE = (apiBase || 'https://api.github.com').replace(/\/$/, '');
  // Angular: match *.spec.ts / *.spec.js files
  // dotnet:  match files NAMED *Tests.cs OR files inside a *Tests/* directory
  //          (av-apps uses Given_*.cs convention inside FcmrTests/, SpatialTests/, etc.)
  const isTestFile = type === 'angular'
    ? f => f.type === 'blob' && /\.spec\.(ts|js)$/i.test(f.path)
    : f => f.type === 'blob' && /\.cs$/i.test(f.path) &&
           (/[Tt]ests?\.cs$/i.test(f.path) || /[Tt]ests?\//.test(f.path));

  // 1. Default branch
  const repoR = await fetch(`${BASE}/repos/${owner}/${repo}`, { headers: hdrs });
  if (!repoR.ok) {
    const b = await repoR.json().catch(() => ({}));
    const e = new Error(`HTTP ${repoR.status}: ${b.message || repoR.statusText}`);
    e.httpStatus = repoR.status;
    throw e;
  }
  const { default_branch } = await repoR.json();

  // 2. HEAD SHA
  const brR = await fetch(
    `${BASE}/repos/${owner}/${repo}/branches/${default_branch}`,
    { headers: hdrs }
  );
  if (!brR.ok) throw new Error(`Branch: HTTP ${brR.status}`);
  const { commit: { sha: headSha } } = await brR.json();

  // 3. If searchPath is set, walk into that sub-tree to avoid root-level truncation
  let treeSha = headSha;
  if (searchPath) {
    const segments = searchPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let parentSha = headSha;
    for (const seg of segments) {
      const pR = await fetch(
        `${BASE}/repos/${owner}/${repo}/git/trees/${parentSha}`,
        { headers: hdrs }
      );
      if (!pR.ok) break;
      const entry = ((await pR.json()).tree || []).find(e => e.path === seg && e.type === 'tree');
      if (!entry) break;
      parentSha = entry.sha;
      treeSha   = entry.sha;
    }
  }

  // 4. Recursive tree from the (possibly narrowed) SHA
  const trR = await fetch(
    `${BASE}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    { headers: hdrs }
  );
  if (!trR.ok) throw new Error(`Tree: HTTP ${trR.status}`);
  const { tree, truncated } = await trR.json();

  // 5. Filter to test files using path-aware detection
  const files = (tree || []).filter(isTestFile);

  // 6. Count actual test methods by reading each blob (batched 10 at a time)
  const methodCounts = await countBlobTestMethods(owner, repo, files, hdrs, type, apiBase);
  const methodMap    = Object.fromEntries(methodCounts.map(m => [m.path, m.testCases]));

  // 7. Group by component (3rd-from-last path segment = module name)
  const modMap = {};
  files.forEach(f => {
    const parts   = f.path.split('/');
    const key     = parts.length >= 3 ? parts[parts.length - 3] : (parts[0] || 'root');
    const cases   = methodMap[f.path] || 0;
    if (!modMap[key]) modMap[key] = { testFiles: 0, testCases: 0 };
    modMap[key].testFiles++;
    modMap[key].testCases += cases;
  });

  const totalCases = Object.values(modMap).reduce((s, m) => s + m.testCases, 0);

  const modules = Object.entries(modMap)
    .sort((a, b) => b[1].testCases - a[1].testCases)
    .slice(0, 20)
    .map(([name, m]) => ({ name, testFiles: m.testFiles, testCases: m.testCases }));

  return {
    testFileCount : files.length,
    testCaseCount : totalCases,
    moduleCount   : Object.keys(modMap).length,
    modules,
    truncated     : !!truncated,
    scannedAt     : new Date().toISOString()
  };
}

router.get('/github-coverage', async (req, res) => {
  try {
    const cfg    = loadConfig(req.deptId);
    const gh     = cfg.github;
    if (!gh?.token) return res.json({ configured: false, repos: [] });

    const apiBase = gh.apiBase || 'https://api.github.com';
    const hdrs = {
      Authorization: `token ${gh.token}`,
      Accept:        'application/vnd.github.v3+json',
      'User-Agent':  'AV-Dashboard/1.0'
    };

    const results = await Promise.all((gh.repos || []).map(async rCfg => {
      const base = { label: rCfg.label, repo: rCfg.repo, owner: rCfg.owner };
      try {
        const scan = await scanTestFiles(
          rCfg.owner, rCfg.repo, hdrs,
          rCfg.type || 'dotnet',
          rCfg.searchPath,
          apiBase
        );
        return {
          ...base,
          status: scan.testFileCount > 0 ? 'test_scan' : 'no_tests',
          scan
        };
      } catch (err) {
        return { ...base, status: 'api_error', error: err.message };
      }
    }));

    res.json({ configured: true, repos: results });
  } catch (e) {
    console.error('[github-coverage]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
