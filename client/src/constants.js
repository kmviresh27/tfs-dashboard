// Colour palette (Filament tokens, must match main.css)
export const COLORS = {
  feature: {
    Forecasted: '#1492ff',
    New:        '#858FFF',
    Activated:  '#9B5CFF',
    Approved:   '#ff7f0f',
    Done:       '#068443',
    Removed:    '#757575'
  },
  defect: {
    New:          '#eb3f3f',
    Accepted:     '#ff7f0f',
    Investigated: '#e06c1f',
    Planned:      '#F5CC00',
    Resolved:     '#21837c',
    Closed:       '#068443',
    Removed:      '#757575'
  }
};

export const FEATURE_STATES = ['Forecasted', 'New', 'Activated', 'Approved', 'Done', 'Removed'];
export const DEFECT_STATES  = ['New', 'Accepted', 'Investigated', 'Planned', 'Resolved', 'Closed', 'Removed'];

export const ROLE_DEFS = {
  all:  { label: 'All',  icon: '🔓' },
  exec: { label: 'Exec', icon: '👔' },
  rte:  { label: 'RTE',  icon: '🚂' },
  pm:   { label: 'PM',   icon: '📋' },
  sm:   { label: 'SM',   icon: '🏃' }
};

export const TEAM_COLORS = [
  '#1492ff','#068443','#eb3f3f','#ff7f0f','#858FFF',
  '#F5CC00','#21837c','#fa7000','#e040fb','#00bcd4'
];

export const PI_BADGE_COLORS = ['#1492ff','#06b6d4','#f5a623','#a855f7'];
export const TM_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316'];
export const RAG_LOWER_IS_BETTER = ['escapeRatio', 'defectDensity'];
export const SLIDESHOW_ROWS_PER_PAGE  = 12;
export const SLIDESHOW_INTERVAL_MS    = 10000;
export const ALL_SECTIONS = ['executive', 'overview', 'features', 'defects', 'teams', 'sprint-trend', 'velocity', 'pi-delivery', 'release-health', 'test-coverage', 'roadmap', 'risks', 'insights', 'scope-change', 'settings'];

// All navigable sections — single source of truth (used by Sidebar + RolesManager)
// Ordered by SAFe PI workflow: Year Strategy → PI Planning → Execution → Quality → Tracking → Improve → Analysis
export const NAV_ITEMS = [
  // ── Programme (year-level view) ───────────────────────────────────────────
  { id: 'executive',       icon: '🏆', label: 'Programme',       group: 'Programme' },
  { id: 'kpi',             icon: '📊', label: 'KPI Tracker',     group: 'Programme' },
  { id: 'roadmap',         icon: '🗺',  label: 'Roadmap',         group: 'Programme' },

  // ── PI Planning ──────────────────────────────────────────────────────────
  { id: 'objectives-plan', icon: '🎯', label: 'Objectives',      group: 'PI Planning' },
  { id: 'pi-readiness',    icon: '✅', label: 'PI Readiness',    group: 'PI Planning' },
  { id: 'pi-board',        icon: '📌', label: 'PI Board',        group: 'PI Planning' },

  // ── Execution (during PI) ─────────────────────────────────────────────────
  { id: 'features',        icon: '🚀', label: 'Features',        group: 'Execution' },
  { id: 'defects',         icon: '🛡',  label: 'Defects',         group: 'Execution' },
  { id: 'sprint',          icon: '📈', label: 'Sprint Health',   group: 'Execution' },
  { id: 'velocity',        icon: '⚡', label: 'Velocity',        group: 'Execution' },
  { id: 'teams',           icon: '👥', label: 'Teams',           group: 'Execution' },

  // ── Delivery & Quality ────────────────────────────────────────────────────
  { id: 'pi-delivery',     icon: '🏃', label: 'PI Delivery',     group: 'Delivery & Quality' },
  { id: 'release-health',  icon: '📦', label: 'Release Health',  group: 'Delivery & Quality' },
  { id: 'test-coverage',   icon: '🧪', label: 'Test Coverage',   group: 'Delivery & Quality' },
  { id: 'health',          icon: '❤️', label: 'Health',          group: 'Delivery & Quality' },

  // ── Tracking ──────────────────────────────────────────────────────────────
  { id: 'scope-change',    icon: '📊', label: 'Scope Change',    group: 'Tracking' },
  { id: 'blockers',        icon: '🚧', label: 'Blockers',        group: 'Tracking' },
  { id: 'risks',           icon: '⚠️', label: 'Risks',           group: 'Tracking' },

  // ── Improve ───────────────────────────────────────────────────────────────
  { id: 'retro',           icon: '🔁', label: 'Retro Actions',   group: 'Improve' },

  // ── Analysis ──────────────────────────────────────────────────────────────
  { id: 'cross-pi',        icon: '📉', label: 'Cross-PI Trends', group: 'Analysis' },
  { id: 'insights',        icon: '🔬', label: 'Insights',        group: 'Analysis' },

  // ── Admin (accessible via FloatingBar gear icon — not shown in sidebar) ─────
  { id: 'admin',    icon: '⚙️', label: 'Admin',    group: 'Admin', adminOnly: true, superAdminOnly: true },
  { id: 'settings', icon: '🔧', label: 'Settings', group: 'Admin', adminOnly: true },
];

// Built-in role defaults (ordered by workflow)
export const ROLE_SECTIONS = {
  all:  ['executive', 'kpi', 'roadmap', 'objectives-plan', 'pi-readiness', 'pi-board', 'features', 'defects', 'sprint', 'velocity', 'teams', 'pi-delivery', 'release-health', 'test-coverage', 'health', 'scope-change', 'blockers', 'risks', 'retro', 'cross-pi', 'insights'],
  exec: ['executive', 'kpi', 'roadmap', 'objectives-plan', 'pi-readiness', 'features', 'defects', 'health', 'scope-change', 'risks', 'cross-pi', 'insights'],
  rte:  ['executive', 'kpi', 'roadmap', 'objectives-plan', 'pi-readiness', 'pi-board', 'features', 'defects', 'velocity', 'teams', 'pi-delivery', 'release-health', 'health', 'scope-change', 'blockers', 'risks', 'cross-pi', 'insights'],
  pm:   ['executive', 'kpi', 'objectives-plan', 'pi-readiness', 'pi-board', 'features', 'defects', 'sprint', 'velocity', 'pi-delivery', 'release-health', 'health', 'roadmap', 'scope-change', 'blockers', 'risks', 'retro', 'insights'],
  sm:   ['pi-board', 'features', 'defects', 'sprint', 'velocity', 'teams', 'test-coverage', 'health', 'blockers', 'retro'],
};

/** Merge built-in role defs with any custom roles from config */
export function getEffectiveRoleDefs(customRoles = []) {
  const result = { ...ROLE_DEFS };
  customRoles.forEach(r => { result[r.id] = { label: r.label, icon: r.icon }; });
  return result;
}

/** Merge built-in section maps with overrides + custom roles */
export function getEffectiveRoleSections(customRoles = [], roleOverrides = {}) {
  const result = { ...ROLE_SECTIONS };
  Object.entries(roleOverrides).forEach(([id, s]) => { if (s?.length) result[id] = s; });
  if (customRoles.length > 0) {
    // Pages added to NAV_ITEMS after a custom role was last saved won't be in that role's
    // sections list. Auto-include them — mirrors RolesManager's "start with all sections" init.
    const allCustomIds = new Set(customRoles.flatMap(r => r.sections || []));
    const brandNew = NAV_ITEMS.map(n => n.id).filter(id => !allCustomIds.has(id));
    customRoles.forEach(r => {
      result[r.id] = brandNew.length
        ? [...new Set([...(r.sections || []), ...brandNew])]
        : (r.sections || []);
    });
  }
  return result;
}

export const SECTION_PAGES = {
  executive:        2,
  'objectives-plan': 1,
  features:         4,
  defects:          5,
  teams:            2,
  'pi-board':       1,
  sprint:           1,
  velocity:         1,
  'pi-delivery':    1,
  'release-health': 1,
  'test-coverage':  1,
  health:           1,
  roadmap:          1,
  risks:            1,
  compare:          1,
  'cross-pi':       1,
  'scope-change':   1,
  insights:         1,
  retro:            1,
  blockers:         1,
  'pi-readiness':   1,
  kpi:              1,
  settings:         1,
};

// ── Policy schema – single source of truth for all pages / tabs / charts ─────
export const POLICY_SCHEMA = [
  {
    id: 'executive', label: 'Programme', icon: '🏆',
    tabs: [
      { id: 'health',     label: 'Health' },
      { id: 'scorecard',  label: 'Scorecard' },
      { id: 'objectives', label: 'Objectives' },
      { id: 'pichecks',   label: 'PI Checks' },
    ],
    charts: [
      { id: 'pi-score-hero',     label: 'PI Score Hero' },
      { id: 'health-hero',       label: 'Health Overview' },
      { id: 'bv-predictability', label: 'BV Predictability' },
    ],
  },
  {
    id: 'objectives-plan', label: 'Objectives', icon: '🎯',
    tabs: [],
    charts: [
      { id: 'kpi-strip',       label: 'KPI Summary Strip' },
      { id: 'objectives-list', label: 'Objectives List (by team)' },
    ],
  },
  {
    id: 'features', label: 'Features', icon: '🚀',
    tabs: [
      { id: 'overview',       label: 'Overview' },
      { id: 'features',       label: 'Features List' },
      { id: 'confidence',     label: 'Confidence Voting' },
      { id: 'wsjf',           label: 'WSJF' },
      { id: 'pi-checks',      label: 'PI Checks' },
      { id: 'predictability', label: 'Predictability' },
    ],
    charts: [
      { id: 'funnel',           label: 'Feature Lifecycle Funnel' },
      { id: 'team-summary',     label: 'Team Summary (Count / Man-Days + Capacity)' },
      { id: 'cycle-time',       label: 'Cycle Time Distribution (last 4 PIs)' },
      { id: 'state-progress',   label: 'Feature State Progress' },
      { id: 'dependencies',     label: 'Cross-Team Dependencies' },
      { id: 'stale-features',   label: 'Stale Features' },
      { id: 'age-distribution', label: 'Feature Age Distribution' },
    ],
  },
  {
    id: 'defects', label: 'Defects', icon: '🛡',
    tabs: [
      { id: 'overview',  label: 'Overview' },
      { id: 'trend',     label: 'Trend' },
      { id: 'defects',   label: 'Defects List' },
      { id: 'analysis',  label: 'Analysis' },
      { id: 'versions',  label: '📦 Versions' },
    ],
    charts: [
      { id: 'distribution',  label: 'Defect Distribution' },
      { id: 'by-team',       label: 'Defects by Team' },
      { id: 'escape-ratio',  label: 'Defect Escape Ratio' },
      { id: 'injection',     label: 'Defect Injection by Sprint' },
      { id: 'found-in',      label: 'Found-In Breakdown' },
      { id: 'aging',         label: 'Defect Aging' },
      { id: 'critical',      label: 'Critical Defects (P1/P2)' },
      { id: 'quarterly',              label: 'Quarterly Raised vs Closed' },
      { id: 'field-defects',          label: 'Field Defects by Project' },
      { id: 'team-priority-heatmap',  label: 'Team × Priority Heatmap' },
      { id: 'team-priority-open',     label: 'Open Defects by Team × Priority' },
      { id: 'density-trend',          label: 'Defect Density Trend' },
      { id: 'sla-breach',             label: 'SLA Breach' },
    ],
  },
  {
    id: 'teams', label: 'Teams', icon: '👥',
    tabs: [],
    charts: [
      { id: 'health-radar',     label: 'Team Health Radar' },
      { id: 'features-by-team', label: 'Features by Team' },
      { id: 'defects-by-team',  label: 'Defects by Team' },
    ],
  },
  {
    id: 'pi-board', label: 'PI Board', icon: '📌',
    tabs: [],
    charts: [
      { id: 'program-board', label: 'Program Board' },
    ],
  },
  {
    id: 'sprint', label: 'Sprint Health', icon: '📈',
    tabs: [
      { id: 'overview',  label: 'Overview' },
      { id: 'capacity',  label: 'Capacity' },
    ],
    charts: [
      { id: 'sprint-summary',    label: 'Sprint Summary Table' },
      { id: 'done-resolve-rate', label: 'Done Rate & Resolve Rate' },
      { id: 'escape-ratio',      label: 'Defect Escape Ratio' },
      { id: 'stories-committed', label: 'Stories Committed vs Done' },
      { id: 'activity',          label: 'Activity Breakdown' },
      { id: 'capacity-hours',    label: 'Capacity Hours by Sprint' },
    ],
  },
  {
    id: 'velocity', label: 'Velocity', icon: '⚡',
    tabs: [
      { id: 'overview',       label: 'Overview' },
      { id: 'per-sprint',     label: 'Per-Sprint' },
      { id: 'story-velocity', label: 'Story Velocity' },
      { id: 'burnup',         label: 'Burnup' },
      { id: 'burndown',       label: 'Burndown' },
      { id: 'cfd',            label: 'CFD' },
    ],
    charts: [],
  },
  {
    id: 'pi-delivery', label: 'PI Delivery', icon: '🏃',
    tabs: [],
    charts: [
      { id: 'delivery-progress', label: 'PI Feature Delivery Progress' },
    ],
  },
  {
    id: 'release-health', label: 'Release Health', icon: '📦',
    tabs: [], charts: [],
  },
  {
    id: 'test-coverage', label: 'Test Coverage', icon: '🧪',
    tabs: [],
    charts: [
      { id: 'github',          label: 'GitHub Coverage' },
      { id: 'automation',      label: 'Automation Breakdown' },
      { id: 'team-coverage',   label: 'Team Coverage' },
      { id: 'test-runs',       label: 'Test Runs Summary' },
      { id: 'feature-coverage', label: 'Feature Coverage' },
      { id: 'uncovered',       label: 'Uncovered Features' },
      { id: 'delta',           label: 'Test Coverage Delta' },
    ],
  },
  {
    id: 'health', label: 'Health', icon: '❤️',
    tabs: [],
    charts: [
      { id: 'cycle-time-per-team', label: 'Feature Cycle Time per Team' },
      { id: 'defect-aging',        label: 'Defect Aging' },
      { id: 'escape-by-quarter',   label: 'Defect Escape Ratio by Quarter' },
    ],
  },
  {
    id: 'roadmap', label: 'Roadmap', icon: '🗺',
    tabs: [
      { id: 'timeline', label: 'Timeline' },
      { id: 'heatmap',  label: 'Heatmap' },
    ],
    charts: [],
  },
  {
    id: 'risks', label: 'Risks', icon: '⚠️',
    tabs: [],
    charts: [
      { id: 'roam-board',    label: 'ROAM Board' },
      { id: 'roam-heatmap',  label: 'ROAM Team Heatmap' },
      { id: 'by-state',      label: 'Risks by State' },
      { id: 'by-priority',   label: 'Risks by Priority' },
      { id: 'by-team',       label: 'Risks by Team' },
      { id: 'rmm',           label: 'Product Risk RMM' },
      { id: 'open-risks',    label: "Open / Unroam'd Risks" },
    ],
  },
  {
    id: 'compare', label: 'Compare PI', icon: '⚖️',
    tabs: [], charts: [],
  },
  {
    id: 'scope-change', label: 'Scope Change', icon: '📊',
    tabs: [],
    charts: [
      { id: 'scope-bar',        label: 'Scope Points Comparison' },
      { id: 'change-breakdown', label: 'Change Breakdown' },
      { id: 'change-table',     label: 'Change Detail Table' },
    ],
  },
  {
    id: 'insights', label: 'Insights', icon: '🔬',
    tabs: [],
    charts: [
      { id: 'flow-metrics',     label: 'SAFe Flow Metrics' },
      { id: 'whats-changed',    label: "What's Changed Feed" },
      { id: 'cfd',              label: 'Cumulative Throughput' },
      { id: 'monte-carlo',      label: 'Monte Carlo PI Forecast' },
      { id: 'cycle-control',    label: 'Cycle Time Control Chart' },
      { id: 'lead-time',        label: 'Lead Time Control Chart' },
      { id: 'wip-age',          label: 'WIP Age Chart' },
      { id: 'dora',             label: 'DORA Metrics' },
      { id: 'outliers',         label: 'Cycle Time Outliers' },
      { id: 'investment',       label: 'Work Investment Distribution' },
      { id: 'throughput-trend', label: 'Throughput Trend by Team' },
      { id: 'narrative',        label: 'Programme Narrative' },
      { id: 'review-pack',      label: 'PI Review Pack' },
    ],
  },
  {
    id: 'retro', label: 'Retro Actions', icon: '🔁',
    tabs: [],
    charts: [
      { id: 'close-rate',    label: 'Action Close Rate by Sprint' },
      { id: 'by-category',   label: 'Actions by Category' },
      { id: 'by-team',       label: 'Actions by Team' },
    ],
  },
  {
    id: 'blockers', label: 'Blockers', icon: '🚧',
    tabs: [],
    charts: [
      { id: 'by-team',   label: 'Blockers by Team' },
      { id: 'age',       label: 'Blocker Age Distribution' },
    ],
  },
  {
    id: 'pi-readiness', label: 'PI Readiness', icon: '🎯',
    tabs: [],
    charts: [
      { id: 'score',    label: 'Readiness Score' },
      { id: 'heatmap',  label: 'Criteria Heatmap' },
    ],
  },
  {
    id: 'cross-pi', label: 'Cross-PI Trends', icon: '📈',
    tabs: [],
    charts: [
      { id: 'density-line',   label: 'Defect Density Trend Line' },
      { id: 'velocity-trend', label: 'Velocity Trend' },
      { id: 'defects-bar',    label: 'Live Defects vs Features' },
      { id: 'portfolio-mix',  label: 'Portfolio Mix Doughnut' },
    ],
  },
  {
    id: 'kpi', label: 'KPI Tracker', icon: '📊',
    tabs: [
      { id: 'all',     label: 'All KPIs' },
      { id: 'quality', label: '🧪 Quality' },
      { id: 'process', label: '⚙️ Process' },
      { id: 'change',  label: '🔄 Change Mgmt' },
      { id: 'ai',      label: '🤖 AI / Auto' },
    ],
    charts: [
      { id: 'summary-scorecard', label: 'KPI Summary Scorecard' },
      { id: 'team-heatmap',      label: 'KPI Team Heatmap' },
    ],
  },
];
