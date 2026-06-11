'use strict';

/**
 * OpenAPI 3.0 specification for AV Dashboard API.
 * Served at /api-docs via swagger-ui-express.
 *
 * Route pattern:
 *   Legacy (default dept)   : /api/{endpoint}
 *   Dept-scoped             : /api/d/{deptId}/{endpoint}
 *
 * All authenticated endpoints require a valid session cookie.
 */

const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'AV Dashboard — TFS Intelligence API',
    version: '1.0.0',
    description: `
Live TFS intelligence dashboard for ISP / Healthcare IT.

**Authentication**: Session cookie obtained via \`POST /api/auth/tfs-login\` (TFS auth) or \`GET /api/auth/login\` (Azure AD / OIDC).

**Multi-tenant**: All data endpoints are available at both:
- \`/api/{endpoint}\` — uses your active (default) department
- \`/api/d/{deptId}/{endpoint}\` — explicitly scoped to a department

**Rate limit**: 200 requests / minute per IP.
    `.trim(),
    contact: {
      name: 'KM Viresh',
      email: '320043346@philips.com',
    },
  },
  servers: [
    { url: '/api', description: 'Default department (active session dept)' },
    { url: '/api/d/{deptId}', description: 'Explicit department scope', variables: { deptId: { default: 'default', description: 'Department ID' } } },
  ],
  tags: [
    { name: 'Health',        description: 'Liveness, readiness and observability probes' },
    { name: 'Auth',          description: 'Authentication, session and user management' },
    { name: 'Config',        description: 'Department configuration (TFS, area paths, field mappings)' },
    { name: 'Dashboard',     description: 'High-level summary: teams, features, defects' },
    { name: 'Sprint',        description: 'Sprint trend, burndown and capacity' },
    { name: 'Velocity',      description: 'PI and sprint velocity metrics' },
    { name: 'PI',            description: 'PI tracking, checks, comparisons and delivery' },
    { name: 'PI Readiness',  description: 'Pre-PI readiness checks and scope change analysis' },
    { name: 'Defects',       description: 'Defect ratios, escape rates, density trends' },
    { name: 'Features',      description: 'Feature lifecycle, story metrics, cycle time' },
    { name: 'Test Coverage', description: 'Test case counts, snapshots and delta analysis' },
    { name: 'KPI',           description: 'KPI tracker — 30 metrics across 4 categories' },
    { name: 'Objectives',    description: 'PI objectives planning and tracking' },
    { name: 'Roadmap',       description: 'Feature roadmap across PIs' },
    { name: 'Risks',         description: 'Risk register and blockers board' },
    { name: 'Scope Change',  description: 'Scope change comparison and reports' },
    { name: 'Release Health',description: 'Release health and predictability' },
    { name: 'Snapshots',     description: 'Point-in-time data snapshots' },
    { name: 'Reports',       description: 'Pre-built exportable reports (JSON / CSV / Excel)' },
    { name: 'Insights',      description: 'AI-style flow insights and summary' },
    { name: 'Notifications', description: 'Webhook, digest and threshold notifications' },
    { name: 'Retro',         description: 'Sprint retrospective notes' },
    { name: 'Annotations',   description: 'Chart annotations' },
    { name: 'Departments',   description: 'Department CRUD and user management (admin)' },
    { name: 'Admin',         description: 'Cache bust, circuit reset and full reset (admin)' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'Session cookie set after successful login',
      },
    },
    parameters: {
      piFilter: {
        name: 'pis[]',
        in: 'query',
        description: 'One or more PI labels to filter by (e.g. `25-PI5`, `26-PI1`). Repeatable or comma-separated.',
        schema: { type: 'array', items: { type: 'string', example: '26-PI1' } },
        style: 'form',
        explode: true,
      },
      teamPath: {
        name: 'teamPath',
        in: 'query',
        description: 'TFS area path of the team to scope results (URL-encoded).',
        schema: { type: 'string', example: 'Healthcare IT%5CISP%5CTeam Alpha' },
      },
      sprint: {
        name: 'sprint',
        in: 'query',
        description: 'Sprint label (e.g. `26-PI1 S1`).',
        schema: { type: 'string', example: '26-PI1 S1' },
      },
      deptId: {
        name: 'deptId',
        in: 'path',
        required: true,
        description: 'Department identifier.',
        schema: { type: 'string', example: 'default' },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'PAT not configured' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status:      { type: 'string', example: 'ok' },
          uptime:      { type: 'integer', example: 3600 },
          uptimeHuman: { type: 'string',  example: '0d 1h 0m 0s' },
          memory: {
            type: 'object',
            properties: {
              rss:       { type: 'string', example: '120MB' },
              heapUsed:  { type: 'string', example: '45MB' },
              heapTotal: { type: 'string', example: '70MB' },
            },
          },
          cache: { type: 'object' },
          circuits: { type: 'object' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      UserSession: {
        type: 'object',
        properties: {
          id:          { type: 'string' },
          displayName: { type: 'string' },
          email:       { type: 'string' },
          role:        { type: 'string', enum: ['admin', 'dept_admin', 'member'] },
          isAdmin:     { type: 'boolean' },
          isSuperAdmin:{ type: 'boolean' },
          departments: { type: 'array', items: { type: 'object' } },
          activeDeptId:{ type: 'string' },
        },
      },
      Department: {
        type: 'object',
        properties: {
          id:       { type: 'string', example: 'isp' },
          name:     { type: 'string', example: 'ISP' },
          areaPath: { type: 'string', example: 'Healthcare IT\\ISP' },
          tfs: {
            type: 'object',
            properties: {
              baseUrl:  { type: 'string' },
              project:  { type: 'string' },
              areaPath: { type: 'string' },
            },
          },
        },
      },
      Annotation: {
        type: 'object',
        properties: {
          id:        { type: 'string' },
          chartKey:  { type: 'string', example: 'velocity-chart' },
          label:     { type: 'string', example: 'PI5 scope freeze' },
          date:      { type: 'string', format: 'date', example: '2025-03-14' },
          createdBy: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {

    // ── Health ──────────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description: 'No auth required. Returns server uptime, memory, cache and circuit-breaker stats.',
        security: [],
        responses: {
          200: { description: 'Server is alive', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } },
        },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        description: 'Pings TFS for all departments. Cached for 30 seconds.',
        security: [],
        responses: {
          200: { description: 'All departments reachable' },
          503: { description: 'One or more departments unreachable' },
        },
      },
    },
    '/health/metrics': {
      get: {
        tags: ['Health'],
        summary: 'Observability metrics',
        description: 'Returns slow query log, circuit state per host, and cache statistics. Requires auth.',
        responses: {
          200: { description: 'Metrics payload' },
          401: { description: 'Unauthorized' },
        },
      },
    },

    // ── Admin ───────────────────────────────────────────────────────────────────
    '/cache/bust': {
      post: {
        tags: ['Admin'],
        summary: 'Bust response cache',
        description: 'Clears in-memory cache. Super admin clears all departments; dept admin clears own dept.',
        responses: {
          200: { description: 'Cache cleared' },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
    },
    '/circuit/reset': {
      post: {
        tags: ['Admin'],
        summary: 'Reset circuit breakers',
        description: 'Force-closes all open circuit breakers so TFS calls resume immediately.',
        responses: {
          200: { description: 'Circuits reset' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/full-reset': {
      post: {
        tags: ['Admin'],
        summary: 'Full reset (cache + circuits)',
        description: 'Busts cache and resets all circuit breakers in one call. Recommended after TFS outages.',
        responses: {
          200: { description: 'Full reset complete' },
          401: { description: 'Unauthorized' },
        },
      },
    },

    // ── Auth ────────────────────────────────────────────────────────────────────
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user session',
        security: [],
        responses: {
          200: {
            description: 'Authenticated user',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                authenticated: { type: 'boolean' },
                authMode: { type: 'string', enum: ['azure-ad', 'tfs', 'setup'] },
                user: { $ref: '#/components/schemas/UserSession' },
              },
            }}},
          },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/auth/login': {
      get: {
        tags: ['Auth'],
        summary: 'Initiate Azure AD / OIDC login',
        security: [],
        description: 'Redirects to Azure AD authorization endpoint.',
        responses: { 302: { description: 'Redirect to identity provider' } },
      },
    },
    '/auth/callback': {
      get: {
        tags: ['Auth'],
        summary: 'OIDC callback (GET)',
        security: [],
        responses: { 302: { description: 'Redirect to app after successful login' } },
      },
      post: {
        tags: ['Auth'],
        summary: 'OIDC callback (POST — form_post flow)',
        security: [],
        responses: { 302: { description: 'Redirect to app after successful login' } },
      },
    },
    '/auth/tfs-login': {
      post: {
        tags: ['Auth'],
        summary: 'TFS PAT login',
        security: [],
        description: 'Authenticate with TFS username and Personal Access Token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'pat'],
                properties: {
                  username: { type: 'string', example: 'viresh.km' },
                  pat: { type: 'string', example: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful, session cookie set' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout — destroy session',
        responses: { 200: { description: 'Session destroyed' } },
      },
    },
    '/auth/switch-dept': {
      post: {
        tags: ['Auth'],
        summary: 'Switch active department',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { deptId: { type: 'string' } } } } },
        },
        responses: {
          200: { description: 'Active department updated in session' },
          403: { description: 'No access to requested department' },
        },
      },
    },
    '/auth/departments': {
      get: {
        tags: ['Auth'],
        summary: 'Departments accessible to current user',
        responses: { 200: { description: 'List of departments' } },
      },
    },
    '/auth/tfs-check-user': {
      get: {
        tags: ['Auth'],
        summary: 'Check if stored PAT exists for username',
        security: [],
        parameters: [{ name: 'username', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '{ hasPat: boolean }' } },
      },
    },
    '/auth/tfs-teams': {
      get: {
        tags: ['Auth'],
        summary: 'List TFS teams',
        responses: { 200: { description: 'Array of TFS team objects' } },
      },
    },
    '/auth/tfs-teams/{teamId}/members': {
      get: {
        tags: ['Auth'],
        summary: 'Members of a TFS team',
        parameters: [{ name: 'teamId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Array of team members' } },
      },
    },

    // ── Config ──────────────────────────────────────────────────────────────────
    '/config': {
      get: {
        tags: ['Config'],
        summary: 'Get department configuration',
        description: 'Returns sanitized config (PAT redacted) for the active department.',
        responses: {
          200: { description: 'Config object' },
          401: { description: 'Unauthorized' },
        },
      },
      post: {
        tags: ['Config'],
        summary: 'Save department configuration',
        description: 'Dept admin or super admin only.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', description: 'Partial config fields to update' } } },
        },
        responses: {
          200: { description: 'Config saved' },
          403: { description: 'Insufficient permissions' },
        },
      },
    },

    // ── Dashboard ───────────────────────────────────────────────────────────────
    '/teams': {
      get: {
        tags: ['Dashboard'],
        summary: 'List teams / area paths',
        description: 'Returns TFS area paths under the configured area root.',
        responses: { 200: { description: 'Array of team area path objects' } },
      },
    },
    '/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Executive summary dashboard',
        description: 'Aggregated feature, defect, test, velocity KPIs for the current PI.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: {
          200: { description: 'Dashboard payload' },
          400: { description: 'PAT not configured' },
        },
      },
    },
    '/features': {
      get: {
        tags: ['Dashboard'],
        summary: 'Features list',
        description: 'All features (work item type = Feature) with lifecycle state, team, PI, story points.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Array of feature objects' } },
      },
    },
    '/defects': {
      get: {
        tags: ['Dashboard'],
        summary: 'Defects list',
        description: 'All defects with severity, state, team and PI assignment.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Array of defect objects' } },
      },
    },

    // ── Sprint ──────────────────────────────────────────────────────────────────
    '/sprint-trend': {
      get: {
        tags: ['Sprint'],
        summary: 'Sprint-over-sprint trend',
        description: 'Stories completed, carry-over and churn per sprint.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Sprint trend data' } },
      },
    },
    '/sprint-burndown': {
      get: {
        tags: ['Sprint'],
        summary: 'Sprint burndown',
        description: 'Daily remaining story-point burndown for a given sprint.',
        parameters: [
          { $ref: '#/components/parameters/sprint' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Burndown series' } },
      },
    },
    '/sprint-capacity': {
      get: {
        tags: ['Sprint'],
        summary: 'Sprint capacity vs commitment',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Capacity data per sprint' } },
      },
    },

    // ── Velocity ────────────────────────────────────────────────────────────────
    '/velocity': {
      get: {
        tags: ['Velocity'],
        summary: 'PI and sprint velocity',
        description: 'Story points completed per sprint and per PI, broken down by team.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Velocity data' } },
      },
    },
    '/pi-story-velocity': {
      get: {
        tags: ['Velocity'],
        summary: 'PI story-level velocity',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Story velocity breakdown' } },
      },
    },

    // ── PI ──────────────────────────────────────────────────────────────────────
    '/pi-list': {
      get: {
        tags: ['PI'],
        summary: 'Available PI labels',
        description: 'Returns all PI labels derived from the configured iteration path.',
        responses: { 200: { description: 'Array of PI label strings, e.g. ["25-PI5","26-PI1"]' } },
      },
    },
    '/pi-checks': {
      get: {
        tags: ['PI'],
        summary: 'PI consistency checks',
        description: 'Runs TFS WIQL queries to detect inconsistencies: missing iteration, missing area path, stories without features, etc.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: {
          200: { description: 'Check results with pass/warn/fail per check' },
          503: { description: 'TFS circuit open — results unavailable' },
        },
      },
    },
    '/pi-comparison': {
      get: {
        tags: ['PI'],
        summary: 'PI-over-PI comparison',
        description: 'Side-by-side KPI comparison between two PIs.',
        parameters: [
          { name: 'pi1', in: 'query', required: true, schema: { type: 'string', example: '25-PI5' } },
          { name: 'pi2', in: 'query', required: true, schema: { type: 'string', example: '26-PI1' } },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Comparison payload' } },
      },
    },
    '/pi-delivery': {
      get: {
        tags: ['PI'],
        summary: 'PI feature delivery status',
        description: 'Features committed vs delivered for each PI.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Delivery status per PI' } },
      },
    },
    '/predictability': {
      get: {
        tags: ['PI'],
        summary: 'PI predictability score',
        description: 'Ratio of features delivered as planned vs total committed.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Predictability percentage per PI' } },
      },
    },
    '/progress': {
      get: {
        tags: ['PI'],
        summary: 'Current PI progress',
        description: 'Real-time completion percentage, features in flight, and days remaining.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Progress snapshot' } },
      },
    },

    // ── PI Readiness ────────────────────────────────────────────────────────────
    '/pi-readiness': {
      get: {
        tags: ['PI Readiness'],
        summary: 'Pre-PI readiness checks',
        description: 'Validates backlog grooming completeness, story point coverage, and team capacity alignment.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Readiness check results' } },
      },
    },
    '/scope-change/compare': {
      get: {
        tags: ['PI Readiness'],
        summary: 'Scope change comparison',
        description: 'Compares planned vs current scope — added, removed, and modified features.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { name: 'baseline', in: 'query', description: 'Snapshot ID to compare against', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Scope change delta' } },
      },
    },
    '/scope-change/report': {
      get: {
        tags: ['PI Readiness'],
        summary: 'Scope change report',
        description: 'Detailed narrative report of scope changes within a PI.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Scope change report' } },
      },
    },

    // ── Defects ─────────────────────────────────────────────────────────────────
    '/defect-field-stats': {
      get: {
        tags: ['Defects'],
        summary: 'Defect field (escaped) statistics',
        description: 'Defects with HowFound=\'Found In Field\' grouped by project/release, per quarter.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Field defect stats' } },
      },
    },
    '/defect-density-trend': {
      get: {
        tags: ['Defects'],
        summary: 'Defect density trend',
        description: 'Defects opened per sprint / PI normalised by story points delivered.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Density trend series' } },
      },
    },
    '/defect-version-stats': {
      get: {
        tags: ['Defects'],
        summary: 'Defect version distribution',
        description: 'Defects grouped by affected version / release.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Version distribution data' } },
      },
    },
    '/defect-escape-by-quarter': {
      get: {
        tags: ['Defects'],
        summary: 'Defect escape rate by quarter',
        description: 'Escape defects (found in field) vs total defects closed, per quarter.',
        parameters: [{ $ref: '#/components/parameters/teamPath' }],
        responses: { 200: { description: 'Escape rate per quarter' } },
      },
    },

    // ── Features ────────────────────────────────────────────────────────────────
    '/story-metrics': {
      get: {
        tags: ['Features'],
        summary: 'User story metrics',
        description: 'Story-level throughput, acceptance rate, and churn per sprint.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Story metrics' } },
      },
    },
    '/cycle-time-distribution': {
      get: {
        tags: ['Features'],
        summary: 'Cycle time distribution',
        description: 'Histogram and percentiles (P50/P85/P95) of feature cycle times.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Cycle time data' } },
      },
    },
    '/dependencies': {
      get: {
        tags: ['Features'],
        summary: 'Feature dependencies list',
        description: 'Cross-team feature dependencies from TFS link types.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Dependency objects' } },
      },
    },
    '/dependencies/matrix': {
      get: {
        tags: ['Features'],
        summary: 'Dependency matrix',
        description: 'Team × team dependency matrix (count of dependencies).',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Matrix data' } },
      },
    },
    '/team-capacities': {
      get: {
        tags: ['Features'],
        summary: 'Team capacity allocations',
        responses: { 200: { description: 'Capacity per team per sprint' } },
      },
    },
    '/github-coverage': {
      get: {
        tags: ['Features'],
        summary: 'GitHub code coverage integration',
        description: 'Code coverage percentages pulled from GitHub Actions workflow runs.',
        responses: { 200: { description: 'Coverage per repo/branch' } },
      },
    },

    // ── Test Coverage ───────────────────────────────────────────────────────────
    '/test-coverage': {
      get: {
        tags: ['Test Coverage'],
        summary: 'Test case count and coverage',
        description: 'Total test cases (automated + manual) with pass/fail/not-run breakdown per sprint.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Test coverage payload' } },
      },
    },

    // ── KPI ─────────────────────────────────────────────────────────────────────
    '/kpi': {
      get: {
        tags: ['KPI'],
        summary: 'KPI dashboard',
        description: '30 KPIs across Delivery, Quality, Team Health, and Process categories with RAG scoring.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'KPI payload with RAG, value, target per metric' } },
      },
    },
    '/kpi/pipeline': {
      post: {
        tags: ['KPI'],
        summary: 'Trigger KPI pipeline recalculation',
        description: 'Forces recalculation of all KPI metrics from live TFS data.',
        responses: {
          200: { description: 'Pipeline triggered successfully' },
          401: { description: 'Unauthorized' },
        },
      },
    },

    // ── Objectives ──────────────────────────────────────────────────────────────
    '/objectives': {
      get: {
        tags: ['Objectives'],
        summary: 'PI objectives tracking',
        description: 'Business objectives with RAG status, business value, and progress percentage.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Objectives array' } },
      },
    },
    '/objectives-plan': {
      get: {
        tags: ['Objectives'],
        summary: 'Objectives planning view',
        description: 'Objectives with linked features, story point allocation and risk indicators.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Objectives planning data' } },
      },
    },

    // ── Roadmap ─────────────────────────────────────────────────────────────────
    '/roadmap': {
      get: {
        tags: ['Roadmap'],
        summary: 'Feature roadmap',
        description: 'Features plotted across PIs with state, team, and milestone markers.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Roadmap payload' } },
      },
    },

    // ── Risks ───────────────────────────────────────────────────────────────────
    '/risks': {
      get: {
        tags: ['Risks'],
        summary: 'Risk register',
        description: 'Open risks from TFS with probability, impact, mitigation and owner.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Risk items' } },
      },
    },
    '/blockers': {
      get: {
        tags: ['Risks'],
        summary: 'Blocker board',
        description: 'Active blocked work items with days blocked and blocking team.',
        parameters: [
          { $ref: '#/components/parameters/piFilter' },
          { $ref: '#/components/parameters/teamPath' },
        ],
        responses: { 200: { description: 'Blocker items' } },
      },
    },

    // ── Release Health ──────────────────────────────────────────────────────────
    '/release-health': {
      get: {
        tags: ['Release Health'],
        summary: 'Release health indicators',
        description: 'Composite health score covering defect trend, test coverage, and scope stability.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Release health score and breakdown' } },
      },
    },

    // ── Snapshots ───────────────────────────────────────────────────────────────
    '/snapshot': {
      post: {
        tags: ['Snapshots'],
        summary: 'Create snapshot',
        description: 'Saves current dashboard data as a named point-in-time snapshot.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { label: { type: 'string', example: '26-PI1 S1 end' } } } } },
        },
        responses: {
          201: { description: 'Snapshot created, returns snapshot ID' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/snapshots': {
      get: {
        tags: ['Snapshots'],
        summary: 'List snapshots',
        responses: { 200: { description: 'Array of snapshot metadata objects' } },
      },
    },
    '/snapshots/{id}': {
      delete: {
        tags: ['Snapshots'],
        summary: 'Delete snapshot',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },
    '/snapshots/{id}/github-matrix': {
      get: {
        tags: ['Snapshots'],
        summary: 'GitHub coverage matrix for snapshot',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Coverage matrix at snapshot time' } },
      },
    },
    '/snapshot-tc-delta': {
      get: {
        tags: ['Snapshots'],
        summary: 'Test case delta since last snapshot',
        description: 'Difference in test case counts between current state and last snapshot.',
        responses: { 200: { description: 'Delta payload' } },
      },
    },

    // ── Reports ─────────────────────────────────────────────────────────────────
    '/reports/pi-feature-delivery': {
      get: { tags: ['Reports'], summary: 'PI feature delivery report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Report JSON / CSV' } } },
    },
    '/reports/sprint-progress': {
      get: { tags: ['Reports'], summary: 'Sprint progress report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Report data' } } },
    },
    '/reports/release-readiness': {
      get: { tags: ['Reports'], summary: 'Release readiness report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Readiness checklist' } } },
    },
    '/reports/dependency-risk': {
      get: { tags: ['Reports'], summary: 'Dependency risk report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Risk report' } } },
    },
    '/reports/executive-summary': {
      get: { tags: ['Reports'], summary: 'Executive summary report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Summary report' } } },
    },
    '/reports/sprint-close': {
      get: { tags: ['Reports'], summary: 'Sprint close report', parameters: [{ $ref: '#/components/parameters/piFilter' }, { $ref: '#/components/parameters/sprint' }], responses: { 200: { description: 'Close report' } } },
    },
    '/reports/excel': {
      get: { tags: ['Reports'], summary: 'Excel export', description: 'Full dashboard data as Excel workbook (XLSX).', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Excel file', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {} } } } },
    },
    '/reports/defect-summary': {
      get: { tags: ['Reports'], summary: 'Defect summary report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Defect summary' } } },
    },
    '/reports/story-by-feature': {
      get: { tags: ['Reports'], summary: 'Stories grouped by feature', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Story/feature mapping' } } },
    },
    '/reports/business-value': {
      get: { tags: ['Reports'], summary: 'Business value delivered report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Business value report' } } },
    },
    '/reports/backlog-readiness': {
      get: { tags: ['Reports'], summary: 'Backlog readiness report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Readiness metrics' } } },
    },
    '/reports/team-health': {
      get: { tags: ['Reports'], summary: 'Team health report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Team health indicators' } } },
    },
    '/reports/pi-predictability': {
      get: { tags: ['Reports'], summary: 'PI predictability report', parameters: [{ $ref: '#/components/parameters/piFilter' }], responses: { 200: { description: 'Predictability data' } } },
    },

    // ── Insights ────────────────────────────────────────────────────────────────
    '/insights/flow': {
      get: {
        tags: ['Insights'],
        summary: 'Flow efficiency insights',
        description: 'AI-style commentary on flow metrics: WIP, blocked time, throughput patterns.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Flow insight objects' } },
      },
    },
    '/insights/summary': {
      get: {
        tags: ['Insights'],
        summary: 'Executive insight summary',
        description: 'Auto-generated executive summary with key highlights and risks.',
        parameters: [{ $ref: '#/components/parameters/piFilter' }],
        responses: { 200: { description: 'Summary text and data points' } },
      },
    },

    // ── Notifications ───────────────────────────────────────────────────────────
    '/notifications/config': {
      get: {
        tags: ['Notifications'],
        summary: 'Notification configuration',
        responses: { 200: { description: 'Webhook URLs, thresholds and digest schedule' } },
      },
    },
    '/notifications/history': {
      get: {
        tags: ['Notifications'],
        summary: 'Notification history',
        responses: { 200: { description: 'Array of past notification events' } },
      },
    },
    '/notifications/webhook/test': {
      post: {
        tags: ['Notifications'],
        summary: 'Test webhook',
        description: 'Sends a test payload to the configured webhook URL.',
        responses: { 200: { description: 'Test sent' } },
      },
    },
    '/notifications/webhook/anomaly': {
      post: {
        tags: ['Notifications'],
        summary: 'Trigger anomaly webhook',
        responses: { 200: { description: 'Anomaly notification dispatched' } },
      },
    },
    '/notifications/digest/trigger': {
      post: {
        tags: ['Notifications'],
        summary: 'Trigger digest report',
        responses: { 200: { description: 'Digest triggered' } },
      },
    },
    '/notifications/thresholds/check': {
      post: {
        tags: ['Notifications'],
        summary: 'Check metric thresholds',
        description: 'Evaluates all KPIs against configured thresholds and fires alerts.',
        responses: { 200: { description: 'Threshold check results' } },
      },
    },

    // ── Retro ────────────────────────────────────────────────────────────────────
    '/retro': {
      get: {
        tags: ['Retro'],
        summary: 'List retro notes',
        parameters: [{ $ref: '#/components/parameters/sprint' }],
        responses: { 200: { description: 'Retro items' } },
      },
      post: {
        tags: ['Retro'],
        summary: 'Add retro note',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { category: { type: 'string', enum: ['went_well', 'improve', 'action'] }, text: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Note created' } },
      },
    },
    '/retro/{id}': {
      put: {
        tags: ['Retro'],
        summary: 'Update retro note',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated' } },
      },
      delete: {
        tags: ['Retro'],
        summary: 'Delete retro note',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ── Annotations ──────────────────────────────────────────────────────────────
    '/annotations': {
      get: {
        tags: ['Annotations'],
        summary: 'List chart annotations',
        parameters: [{ name: 'chartKey', in: 'query', schema: { type: 'string', example: 'velocity-chart' } }],
        responses: { 200: { description: 'Array of annotation objects', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Annotation' } } } } } },
      },
      post: {
        tags: ['Annotations'],
        summary: 'Create annotation',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Annotation' } } },
        },
        responses: { 201: { description: 'Annotation created' } },
      },
    },
    '/annotations/{id}': {
      delete: {
        tags: ['Annotations'],
        summary: 'Delete annotation',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },

    // ── Departments ──────────────────────────────────────────────────────────────
    '/departments': {
      get: {
        tags: ['Departments'],
        summary: 'List all departments',
        description: 'Super admin only.',
        responses: { 200: { description: 'Array of department objects', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Department' } } } } } },
      },
      post: {
        tags: ['Departments'],
        summary: 'Create department',
        description: 'Super admin only.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Department' } } } },
        responses: { 201: { description: 'Department created' } },
      },
    },
    '/departments/{id}': {
      get: {
        tags: ['Departments'],
        summary: 'Get department by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Department object' }, 404: { description: 'Not found' } },
      },
      put: {
        tags: ['Departments'],
        summary: 'Update department',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Department' } } } },
        responses: { 200: { description: 'Updated' } },
      },
      delete: {
        tags: ['Departments'],
        summary: 'Delete department',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },
    '/departments/{id}/test-connection': {
      post: {
        tags: ['Departments'],
        summary: 'Test TFS connection for department',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Connection OK or error details' } },
      },
    },
    '/departments/{id}/users': {
      get: { tags: ['Departments'], summary: 'List users in department', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'User list' } } },
      post: { tags: ['Departments'], summary: 'Add user to department', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: { description: 'User added' } } },
    },
    '/departments/{id}/users/{key}': {
      put: { tags: ['Departments'], summary: 'Update user in department', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Departments'], summary: 'Remove user from department', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removed' } } },
    },
    '/departments/{id}/clone': {
      post: { tags: ['Departments'], summary: 'Clone department config', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Cloned department' } } },
    },
    '/users': {
      get: { tags: ['Departments'], summary: 'List all users (admin)', responses: { 200: { description: 'All users across departments' } } },
    },
    '/admin/summary': {
      get: { tags: ['Admin'], summary: 'Admin summary stats', description: 'Super admin overview: dept count, user count, circuit states.', responses: { 200: { description: 'Summary payload' } } },
    },
    '/users/{key}/superadmin': {
      put: { tags: ['Departments'], summary: 'Toggle super admin status', parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { isSuperAdmin: { type: 'boolean' } } } } } }, responses: { 200: { description: 'Updated' } } },
    },
  },
};

module.exports = swaggerDefinition;
