'use strict';

const { initLogging, closeLogging } = require('./src/helpers/logWriter');
initLogging(); // must be first — captures all subsequent console output

const express      = require('express');
const compression  = require('compression');
const path         = require('path');
const fs           = require('fs');
const http         = require('http');
const https        = require('https');
const { loadConfig } = require('./src/config');
const { runMigration } = require('./src/helpers/migration');
const { startScheduler } = require('./src/scheduler');
const { createSessionMiddleware, requireAuth, requireDeptAccess } = require('./src/middleware/auth');
const { deptIdMiddleware } = require('./src/middleware/dept');
const { requestLogger }    = require('./src/middleware/requestLogger');
const { rateLimiter }      = require('./src/middleware/rateLimiter');
const { requestTimeout }   = require('./src/middleware/requestTimeout');

// Run one-time migration before anything else (idempotent)
runMigration();

const app = express();

app.use(compression()); // gzip all responses > 1KB
app.use(express.json());
app.use(createSessionMiddleware());
app.use(express.static(path.join(__dirname, 'client', 'dist')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// ── Swagger UI (/api-docs) ─────────────────────────────────────────────────────
const swaggerUi         = require('swagger-ui-express');
const swaggerDefinition = require('./src/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDefinition, {
  customSiteTitle: 'AV Dashboard API',
  customCss: '.swagger-ui .topbar { background-color: #0b5ed7; } .swagger-ui .topbar-wrapper img { content: none; } .swagger-ui .topbar-wrapper::after { content: "AV Dashboard API"; color: #fff; font-size: 1.2rem; font-weight: 600; padding-left: 1rem; }',
  swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true, tagsSorter: 'alpha' },
}));

// ── Request logging (all /api routes) ─────────────────────────────────────────
app.use('/api', requestLogger);

// ── Rate limiter (200 req/min per IP) ─────────────────────────────────────────
app.use('/api', rateLimiter({ maxRequests: 200, windowMs: 60 * 1000 }));

// ── Incoming request timeout (35s — above TFS 30s fetch timeout) ──────────────
app.use('/api', requestTimeout(35_000));

// ── Health endpoints (no auth required) ───────────────────────────────────────
app.use('/api', require('./src/routes/health'));

// Strip ROOT: prefix from team/teamPath query params before any route handler sees them
app.use('/api', (req, _res, next) => {
  ['team', 'teamPath'].forEach(key => {
    if (req.query[key]) req.query[key] = req.query[key].replace(/^ROOT:/i, '');
  });
  next();
});

// ── Input validation + WIQL escaping ──────────────────────────────────────────
const { sanitizeMiddleware } = require('./src/helpers/sanitize');
app.use('/api', sanitizeMiddleware);

// Resolve deptId for all /api/* requests (sets req.deptId = 'default' for legacy routes)
app.use('/api', deptIdMiddleware);

// Auth routes (no authentication required)
app.use('/api', require('./src/routes/auth'));

// All other API routes require authentication
app.use('/api', requireAuth);

// ── Request context (route + user) for slow query attribution ─────────────────
const { requestContextMiddleware } = require('./src/helpers/requestContext');
app.use('/api', requestContextMiddleware);

// Department CRUD (admin only)
const departmentsRoute = require('./src/routes/departments');
app.use('/api', departmentsRoute);

// Load all route modules once so they can be mounted at both legacy and dept-scoped paths
const configRoute      = require('./src/routes/config');
const dashboardRoute   = require('./src/routes/dashboard');
const velocityRoute    = require('./src/routes/velocity');
const sprintRoute      = require('./src/routes/sprint');
const snapshotRoute    = require('./src/routes/snapshot');
const testCoverageRoute= require('./src/routes/testCoverage');
const piChecksRoute    = require('./src/routes/piChecks');
const defectsRoute     = require('./src/routes/defects');
const predictRoute     = require('./src/routes/predictability');
const githubRoute      = require('./src/routes/github');
const objectivesRoute  = require('./src/routes/objectives');
const objPlanRoute     = require('./src/routes/objectivesPlan');
const storyRoute       = require('./src/routes/storyMetrics');
const depsRoute        = require('./src/routes/dependencies');
const teamCapRoute     = require('./src/routes/teamCapacities');
const cycleTimeRoute   = require('./src/routes/cycleTime');
const roadmapRoute     = require('./src/routes/roadmap');
const risksRoute       = require('./src/routes/risks');
const sprintCapRoute   = require('./src/routes/sprintCapacity');
const progressRoute    = require('./src/routes/progress');
const piDeliveryRoute  = require('./src/routes/piDelivery');
const releaseRoute     = require('./src/routes/releaseHealth');
const scopeRoute       = require('./src/routes/scopeChange');
const reportsRoute     = require('./src/routes/reports');
const notifRoute       = require('./src/routes/notifications');
const insightsRoute    = require('./src/routes/insights');
const retroRoute       = require('./src/routes/retro');
const blockersRoute    = require('./src/routes/blockers');
const piReadyRoute     = require('./src/routes/piReadiness');
const annotRoute       = require('./src/routes/annotations');
const kpiRoute         = require('./src/routes/kpi');

// ── Legacy /api/* mounts (backward-compatible; req.deptId = 'default') ────────
app.use('/api', configRoute);
app.use('/api', dashboardRoute);
app.use('/api', velocityRoute);
app.use('/api', sprintRoute);
app.use('/api', snapshotRoute);
app.use('/api', testCoverageRoute);
app.use('/api', piChecksRoute);
app.use('/api', defectsRoute);
app.use('/api', predictRoute);
app.use('/api', githubRoute);
app.use('/api', objectivesRoute);
app.use('/api', objPlanRoute);
app.use('/api', storyRoute);
app.use('/api', depsRoute);
app.use('/api', teamCapRoute);
app.use('/api', cycleTimeRoute);
app.use('/api', roadmapRoute);
app.use('/api', risksRoute);
app.use('/api', sprintCapRoute);
app.use('/api', progressRoute);
app.use('/api', piDeliveryRoute);
app.use('/api', releaseRoute);
app.use('/api', scopeRoute);
app.use('/api/reports', reportsRoute);
app.use('/api/notifications', notifRoute);
app.use('/api/insights', insightsRoute);
app.use('/api', retroRoute);
app.use('/api', blockersRoute);
app.use('/api', piReadyRoute);
app.use('/api', annotRoute);
app.use('/api', kpiRoute);

// ── Dept-scoped /api/d/:deptId/* mounts (with access control) ─────────────────
app.use('/api/d/:deptId', requireDeptAccess);
app.use('/api/d/:deptId', configRoute);
app.use('/api/d/:deptId', dashboardRoute);
app.use('/api/d/:deptId', velocityRoute);
app.use('/api/d/:deptId', sprintRoute);
app.use('/api/d/:deptId', snapshotRoute);
app.use('/api/d/:deptId', testCoverageRoute);
app.use('/api/d/:deptId', piChecksRoute);
app.use('/api/d/:deptId', defectsRoute);
app.use('/api/d/:deptId', predictRoute);
app.use('/api/d/:deptId', githubRoute);
app.use('/api/d/:deptId', objectivesRoute);
app.use('/api/d/:deptId', objPlanRoute);
app.use('/api/d/:deptId', storyRoute);
app.use('/api/d/:deptId', depsRoute);
app.use('/api/d/:deptId', teamCapRoute);
app.use('/api/d/:deptId', cycleTimeRoute);
app.use('/api/d/:deptId', roadmapRoute);
app.use('/api/d/:deptId', risksRoute);
app.use('/api/d/:deptId', sprintCapRoute);
app.use('/api/d/:deptId', progressRoute);
app.use('/api/d/:deptId', piDeliveryRoute);
app.use('/api/d/:deptId', releaseRoute);
app.use('/api/d/:deptId', scopeRoute);
app.use('/api/d/:deptId/reports', reportsRoute);
app.use('/api/d/:deptId/notifications', notifRoute);
app.use('/api/d/:deptId/insights', insightsRoute);
app.use('/api/d/:deptId', retroRoute);
app.use('/api/d/:deptId', blockersRoute);
app.use('/api/d/:deptId', piReadyRoute);
app.use('/api/d/:deptId', annotRoute);
app.use('/api/d/:deptId', kpiRoute);

// SPA fallback – serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

const cfg  = loadConfig();
const PORT      = cfg.app?.port      || 3000;
const HTTPS_PORT = cfg.app?.httpsPort || (PORT + 443);

// ── HTTP server ────────────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`\n\u{1F680} AV Dashboard running \u2192 http://localhost:${PORT}`);
  console.log(`   TFS: ${cfg.tfs.baseUrl}`);
  console.log(`   Area: ${cfg.tfs.areaPath}`);
  console.log(`   PAT: ${cfg.tfs.pat ? '\u2705 configured' : '\u26A0\uFE0F  NOT SET \u2013 open Settings'}\n`);
  startScheduler(app);
});

// ── HTTPS server (enables clipboard API on non-localhost access) ───────────────
(async () => {
  try {
    const sslDir   = path.join(__dirname, 'ssl');
    const keyPath  = path.join(sslDir, 'key.pem');
    const certPath = path.join(sslDir, 'cert.pem');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      const selfsigned = require('selfsigned');
      const attrs = [{ name: 'commonName', value: 'localhost' }];
      const pems  = await selfsigned.generate(attrs, { days: 825, algorithm: 'sha256' });
      fs.mkdirSync(sslDir, { recursive: true });
      fs.writeFileSync(keyPath,  pems.private);
      fs.writeFileSync(certPath, pems.cert);
      console.log(`\u{1F511} Self-signed SSL cert generated \u2192 ${sslDir}`);
    }

    const httpsServer = https.createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      app
    );
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`\u{1F512} HTTPS available \u2192 https://localhost:${HTTPS_PORT}  (accept cert warning once for clipboard support)\n`);
    });

    process.on('SIGTERM', () => { httpsServer.close(); });
    process.on('SIGINT',  () => { httpsServer.close(); });
  } catch (e) {
    console.warn(`\u26A0\uFE0F  HTTPS not started: ${e.message}`);
  }
})();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[${new Date().toISOString()}] [${signal}] Graceful shutdown initiated...`);
  server.close(() => {
    console.log(`[${new Date().toISOString()}] [shutdown] HTTP server closed. Exiting.`);
    closeLogging();
    process.exit(0);
  });
  // Force-exit after 30s if in-flight requests don't finish
  setTimeout(() => {
    console.warn(`[${new Date().toISOString()}] [shutdown] Forced exit after 30s timeout.`);
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] [uncaughtException]`, err.stack || err.message);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] [unhandledRejection]`, reason);
});
