import { create } from 'zustand';

const useStore = create((set, get) => ({
  // Data
  data: null,
  selectedPIs: [],
  availablePIs: [],
  currentPI: '',
  piFilterYear: null,
  selectedTeam: '',
  activeRole: 'all',
  activeSection: typeof window !== 'undefined'
    ? (localStorage.getItem('av-last-section') || 'executive')
    : 'executive',
  theme: typeof window !== 'undefined' ? (localStorage.getItem('av-theme') || 'dark') : 'dark',
  teamRootPath: [],
  ragThresholds: {},
  tfsBaseUrl: '',
  iterationPath: '',
  areaPath: '',
  customRoles: [],     // [{ id, label, icon, sections[] }]
  roleOverrides: {},   // { builtInRoleId: sections[] }
  branding: {
    companyName: 'AV Dashboard',
    appName: 'AV Dashboard',
    appSubtitle: '',
    logoType: 'text',
    logoSvg: '',
    logoUrl: '',
    primaryColor: '#1492ff',
    adminEmail: '',
  },
  refreshInterval: 30,
  lastRefreshAt: null,
  lastRefreshOk: true,
  charts: {},
  activeSnapshotId: null,
  activeSnapshotLabel: null,
  sprintLabels: ['S1', 'S2', 'S3', 'IP'],
  policies: {},

  // Multi-tenant: active department
  // { id, name, tfsOrg, userRole, isActive } — null = not yet selected / single-tenant mode
  activeDept: (() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem('av-activeDept');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  })(),

  // Slideshow
  slideshowRunning: false,
  slideshowRole: 'all',
  slideshowInterval: 10,
  slideshowSections: [],
  slideshowCharts: null,   // null = all charts; array = explicit whitelist of "sectionId.chartId"
  slideshowPage: 0,
  slideshowTotalPages: 1,  // updated by SlideshowPager on mount; reset on section change

  // Actions
  setData: (data) => set({ data }),
  setSelectedPIs: (selectedPIs) => set({ selectedPIs }),
  setAvailablePIs: (availablePIs) => set({ availablePIs }),
  setCurrentPI: (currentPI) => set({ currentPI }),
  setPiFilterYear: (piFilterYear) => set({ piFilterYear }),
  setSelectedTeam: (selectedTeam) => set({ selectedTeam }),
  setActiveRole: (activeRole) => set({ activeRole }),
  setActiveSection: (activeSection) => {
    if (typeof window !== 'undefined') localStorage.setItem('av-last-section', activeSection);
    set({ activeSection, slideshowTotalPages: 1 });
  },
  setCustomRoles: (customRoles) => set({ customRoles }),
  setRoleOverrides: (roleOverrides) => set({ roleOverrides }),
  setSprintLabels: (sprintLabels) => set({ sprintLabels }),
  setTheme: (theme) => {
    localStorage.setItem('av-theme', theme);
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : theme);
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
    set({ theme });
  },
  setTeamRootPath: (teamRootPath) => set({ teamRootPath }),
  setRagThresholds: (ragThresholds) => set({ ragThresholds }),
  setTfsBaseUrl: (tfsBaseUrl) => set({ tfsBaseUrl }),
  setIterationPath: (iterationPath) => set({ iterationPath }),
  setAreaPath: (areaPath) => set({ areaPath }),
  setBranding: (branding) => set({ branding }),
  setRefreshInterval: (refreshInterval) => set({ refreshInterval }),
  setLastRefresh: (ok) => set({ lastRefreshAt: new Date(), lastRefreshOk: ok }),
  setActiveSnapshot: (id, label) => set({ activeSnapshotId: id || null, activeSnapshotLabel: label || null }),
  setPolicies: (policies) => set({ policies }),
  setSlideshowRunning: (v) => set({ slideshowRunning: v }),
  setSlideshowTotalPages: (n) => set({ slideshowTotalPages: n }),
  setSlideshowConfig: (cfg) => set({
    slideshowRole:     cfg.role,
    slideshowInterval: cfg.interval,
    slideshowSections: cfg.sections,
    slideshowCharts:   cfg.charts ?? null,
  }),
  setSlideshowPage: (p) => set({ slideshowPage: p }),

  // Multi-tenant: set the active department and persist to localStorage.
  // Also clears all dept-scoped data so the new dept starts fresh.
  setActiveDept: (dept) => {
    if (typeof window !== 'undefined') {
      if (dept?.id) localStorage.setItem('av-activeDept', JSON.stringify(dept));
      else localStorage.removeItem('av-activeDept');
    }
    set({
      activeDept: dept || null,
      // Reset dept-scoped data so the new dept loads its own values
      selectedPIs: [],
      availablePIs: [],
      currentPI: '',
      piFilterYear: null,
      selectedTeam: '',
      activeSnapshotId: null,
      activeSnapshotLabel: null,
      sprintLabels: ['S1', 'S2', 'S3', 'IP'], // reset to default; applyConfig will override
      // Config values will be re-applied when useConfig() refreshes
      tfsBaseUrl: '',
      iterationPath: '',
      areaPath: '',
      teamRootPath: [],
      ragThresholds: {},
      branding: get().branding, // keep until new config arrives (avoids flash)
    });
  },

  // config is the /api/config response shape:
  // { tfs: { baseUrl, areaPath, teamRootPath, iterationPath }, app: { refreshIntervalMinutes }, ragThresholds, branding }
  applyConfig: (config) => {
    const trp = config.tfs?.teamRootPath || '';
    const patch = {
      tfsBaseUrl:     config.tfs?.baseUrl       || '',
      iterationPath:  config.tfs?.iterationPath || '',
      areaPath:       config.tfs?.areaPath      || '',
      teamRootPath:   Array.isArray(trp) ? trp : trp ? [trp] : [],
      ragThresholds:  config.ragThresholds       || {},
      branding:       config.branding || get().branding,
      refreshInterval: config.app?.refreshIntervalMinutes || 30,
    };
    if (config.roles) {
      patch.customRoles   = Array.isArray(config.roles.custom) ? config.roles.custom : [];
      patch.roleOverrides = config.roles.overrides || {};
    }
    if (config.fieldMappings?.piStructure?.sprintLabels?.length) {
      patch.sprintLabels = config.fieldMappings.piStructure.sprintLabels;
    }
    if (config.policies) patch.policies = config.policies;
    set(patch);
  },
}));

export default useStore;
