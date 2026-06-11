import { useState, useEffect, useMemo, useRef } from 'react';
import useStore from '../store/useStore.js';
import { apiFetch } from '../api/apiClient.js';
import { useConfig } from '../api/hooks.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import RolesManager from '../components/ui/RolesManager.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { POLICY_SCHEMA } from '../constants.js';

const ALL_TABS = ['tfs', 'branding', 'appearance', 'rag', 'fieldMappings', 'kpiConfig', 'notifications', 'advanced', 'azuread', 'roleMappings', 'tfsUsers', 'policies', 'members'];
// Tabs only super-admins can see (global/cross-dept settings)
// 'policies' (Roles & Visibility) is intentionally NOT here — dept admins can manage their own dept's role policies
const SUPERADMIN_ONLY_TABS = ['azuread', 'roleMappings', 'tfsUsers', 'advanced'];
const TAB_LABELS = {
  tfs: 'TFS Connection',
  branding: 'Branding',
  appearance: 'Appearance',
  rag: 'RAG Thresholds',
  fieldMappings: 'Field Mappings',
  kpiConfig: 'KPI Config',
  notifications: 'Notifications',
  advanced: 'Advanced',
  azuread: 'Azure AD',
  roleMappings: 'Role Mappings',
  tfsUsers: 'TFS User Roles',
  policies: 'Roles & Visibility',
  members:  'Members',
};

const DEFAULT_BRANDING = {
  companyName: 'AV Dashboard',
  appName: 'AV Dashboard',
  appSubtitle: 'ISP Programme',
  logoType: 'text',
  logoSvg: '',
  logoUrl: '',
  primaryColor: '#1492ff',
  adminEmail: '',
};

const DEFAULT_RAG = {
  doneRate:      { green: 80, amber: 50 },
  resolveRate:   { green: 70, amber: 40 },
  escapeRatio:   { green: 20, amber: 40 },
  defectDensity: { green: 2,  amber: 5  },
  healthScore:   { green: 70, amber: 40 },
};

const DEFAULT_NOTIFICATIONS = {
  webhookUrl: '',
  webhookType: 'teams',
  anomalyThreshold: 1.5,
  enabled: false,
  digestSchedule: { day: 'monday', hour: 9, minute: 0 },
  digestSections: { delivery: true, quality: true, forecast: true, risks: false, velocity: false, teamBreakdown: true, piReadiness: true, changes: true },
  forecastPercentiles: ['p50'],
  anomalyAlerts: { enabled: true, metrics: ['doneRate', 'defectCount', 'velocity'] },
  digestTitle: '',
  digestFooter: '',
  alertWebhookUrl: '',
  alertWebhookType: 'teams',
  thresholdAlerts: [],
};

const DEFAULT_AZURE_AD = { tenantId: '', clientId: '', clientSecret: '', redirectUrl: '' };
const DEFAULT_POLICIES = {};

const DEFAULT_FIELD_MAPPINGS = {
  workItemTypes: {
    feature: 'Feature',
    story: 'Story',
    defect: 'Defect',
    objective: 'Objective',
    risk: 'Risk',
    productRisk: 'Product Risk',
    testCase: 'Test Case',
    epic: 'Epic',
    task: 'Task',
  },
  fields: {
    effortField: 'Microsoft.VSTS.Scheduling.Effort',
    storyPointsField: 'Microsoft.VSTS.Scheduling.StoryPoints',
    releaseField: '',
    defectClassificationField: '',
    defectProjectField: '',
    howFoundField: 'Microsoft.VSTS.CMMI.HowFound',
    whereFoundField: '',
    severityField: 'Microsoft.VSTS.Common.Severity',
    rankField: '',
    businessValueField: 'Microsoft.VSTS.Common.BusinessValue',
    foundInBuildField: 'Microsoft.VSTS.Build.FoundIn',
    resolveByField: '',
    stateChangeDateField: 'Microsoft.VSTS.Common.StateChangeDate',
    closedDateField: 'Microsoft.VSTS.Common.ClosedDate',
    resolvedDateField: 'Microsoft.VSTS.Common.ResolvedDate',
    fixedVersionField: '',
    priorityField: 'Microsoft.VSTS.Common.Priority',
    hcTypeField: '',
    automationStatusField: 'Microsoft.VSTS.TCM.AutomationStatus',
  },
  stateValues: {
    featureDone: 'Done',
    featureRemoved: 'Removed',
    featureWip: ['Activated', 'Approved', 'In Progress', 'Active'],
    featureAllStates: ['Forecasted', 'New', 'Activated', 'Approved', 'Done', 'Removed'],
    storyDone: ['Done', 'Closed', 'Resolved', 'Completed'],
    storyRemoved: 'Removed',
    storyWip: ['Active', 'In Progress', 'Committed'],
    defectClosed: ['Resolved', 'Closed'],
    defectRemoved: 'Removed',
    defectEnhancementValue: 'Enhancement',
    defectFieldFoundValue: 'Found In Field',
  },
  piStructure: {
    sprintLabels: ['S1', 'S2', 'S3', 'IP'],
    pisPerYear: 4,
    piNamingPattern: '{yy}-PI{n}',
    hoursPerPoint: 6,
  },
};

const DEFAULT_KPI_CONFIG = {
  tags: {
    scenarioGap:    'Scenario-Gap',
    regression:     'Regression',
    missedStandard: 'Missed-Standard',
    aiAssisted:     'AI-Assisted',
    lateChange:     'Late-Change',
  },
  attachmentKeywords: {
    mindmap:     'mindmap, mind map, mind-map',
    fmea:        'fmea',
    impact:      'impact, impact analysis, impact-analysis',
    checklist:   'checklist, check list, dod',
    crossReview: 'review',
  },
  targets: {
    'exploratory-coverage':        80,
    'fmea-coverage':               70,
    'scenario-gap-defects':        15,
    'regression-defects':          15,
    'checklist-compliance':        80,
    'cross-team-review':           80,
    'missed-standard-defects':     15,
    'say-do-ratio':                90,
    'late-changes':                0,
    'impact-assessment':           80,
    'build-time-reduction':        25,
    'build-stability':             80,
    'ai-assisted-usage':           95,
    'post-integration-regression': 15,
    'defect-analysis-time':        1.5,
  },
  defectAnalysisTimeBaseline: 2.5,
};

const EMPTY_FIELD_MAPPINGS_FORM = {
  workItemTypes: { feature: '', story: '', defect: '', objective: '', risk: '', productRisk: '', testCase: '', epic: '', task: '' },
  fields: { effortField: '', storyPointsField: '', releaseField: '', defectClassificationField: '', defectProjectField: '', howFoundField: '', whereFoundField: '', severityField: '', rankField: '', businessValueField: '', foundInBuildField: '', resolveByField: '', stateChangeDateField: '', closedDateField: '', resolvedDateField: '', fixedVersionField: '', priorityField: '', hcTypeField: '', automationStatusField: '' },
  stateValues: { featureDone: '', featureRemoved: '', featureWip: '', featureAllStates: '', storyDone: '', storyRemoved: '', storyWip: '', defectClosed: '', defectRemoved: '', defectEnhancementValue: '', defectFieldFoundValue: '' },
  piStructure: { sprintLabels: '', pisPerYear: 4, piNamingPattern: '', hoursPerPoint: 6 }
};

const WORK_ITEM_TYPE_ROWS = [
  { key: 'feature',     label: 'Feature',      description: 'Epics/capabilities tracked at PI level', impacts: ['PI Delivery', 'Features', 'Sprint', 'Velocity', 'Compare', 'Roadmap', 'Dashboard', 'Executive', 'Insights', 'Reports'] },
  { key: 'story',       label: 'Story',         description: 'User stories / backlog items',            impacts: ['Sprint', 'Velocity', 'Features', 'Dashboard', 'Insights', 'Reports'] },
  { key: 'defect',      label: 'Defect',        description: 'Bugs and defects',                        impacts: ['Defects', 'Compare', 'Release Health', 'Insights', 'Reports'] },
  { key: 'objective',   label: 'Objective',     description: 'PI Objectives',                           impacts: ['PI Delivery', 'Executive', 'Reports'] },
  { key: 'risk',        label: 'Risk',          description: 'Programme risks',                         impacts: ['Risks', 'Reports'] },
  { key: 'productRisk', label: 'Product Risk',  description: 'Product-level risks',                     impacts: ['Risks', 'Reports'] },
  { key: 'testCase',    label: 'Test Case',     description: 'Test work items',                         impacts: ['Test Coverage'] },
  { key: 'epic',        label: 'Epic',          description: 'Portfolio epics',                         impacts: ['Features'] },
  { key: 'task',        label: 'Task',          description: 'Development tasks',                       impacts: ['Sprint', 'Velocity'] },
];

const CUSTOM_FIELD_ROWS = [
  { key: 'effortField',               label: 'Effort / Size',          description: 'Story points or effort estimation field',                   impacts: ['Velocity', 'Sprint', 'Features', 'PI Delivery', 'Release Health', 'Dashboard', 'Reports'] },
  { key: 'storyPointsField',          label: 'Story Points',           description: 'Fallback story points field',                               impacts: ['Velocity', 'Sprint', 'Reports'] },
  { key: 'releaseField',              label: 'Release',                description: 'Release grouping field (e.g. Custom.Planning.Release)',    impacts: ['Features', 'Sprint', 'Release Health', 'Reports'] },
  { key: 'defectClassificationField', label: 'Defect Classification',  description: 'Field used to classify defects (used to exclude Enhancements)', impacts: ['Defects'] },
  { key: 'defectProjectField',        label: 'Defect Project',         description: 'Project field on defects',                                 impacts: ['Defects'] },
  { key: 'howFoundField',             label: 'How Found',              description: 'How the defect was discovered',                            impacts: ['Defects', 'Release Health'] },
  { key: 'whereFoundField',           label: 'Where Found',            description: 'Where the defect was found',                               impacts: ['Defects'] },
  { key: 'severityField',             label: 'Severity',               description: 'Defect severity field',                                    impacts: ['Defects', 'Reports'] },
  { key: 'rankField',                 label: 'Rank / Priority',        description: 'Defect rank/priority field',                               impacts: ['Defects'] },
  { key: 'businessValueField',        label: 'Business Value',         description: 'Business value field on Objectives',                       impacts: ['PI Delivery', 'Executive', 'Reports'] },
  { key: 'foundInBuildField',         label: 'Found In Build',         description: 'Build version where defect was found',                     impacts: ['Defects', 'Release Health'] },
  { key: 'resolveByField',            label: 'Resolve By',             description: 'Target resolve-by date field on defects', impacts: ['Dashboard'] },
  { key: 'stateChangeDateField',      label: 'State Change Date',      description: 'Field recording when state last changed',                   impacts: ['Features', 'Cycle Time', 'Dashboard', 'Objectives', 'PI Delivery', 'Progress', 'Reports'] },
  { key: 'closedDateField',           label: 'Closed Date',            description: 'Date field set when a defect/story is closed',              impacts: ['Defects', 'Story Metrics'] },
  { key: 'resolvedDateField',         label: 'Resolved Date',          description: 'Date field set when a defect is resolved (fallback)',       impacts: ['Defects'] },
  { key: 'fixedVersionField',         label: 'Fixed Planned Version',  description: 'Target fix version on defects', impacts: ['Defects'] },
  { key: 'priorityField',             label: 'Priority',               description: 'Priority field on risks and defects',                       impacts: ['Risks', 'Reports'] },
  { key: 'hcTypeField',               label: 'HC Type',                description: 'Risk category field (Release / Team)', impacts: ['Risks'] },
  { key: 'automationStatusField',     label: 'Automation Status',      description: 'Test case automation status field',                         impacts: ['Test Coverage'] },
];

const STATE_VALUE_ROWS = [
  { key: 'featureDone',           label: 'Feature Done State',    description: 'State meaning a Feature is complete',                          impacts: ['PI Delivery', 'Features', 'Compare', 'Executive', 'Insights', 'Reports'] },
  { key: 'featureRemoved',        label: 'Feature Removed State', description: 'State meaning a Feature is excluded',                          impacts: ['PI Delivery', 'Features', 'Insights', 'Reports'] },
  { key: 'featureWip',            label: 'Feature WIP States',    description: 'Comma-separated active/in-progress states for Features',       impacts: ['PI Delivery', 'Features', 'Insights'] },
  { key: 'featureAllStates',      label: 'Feature All States',    description: 'Comma-separated all valid Feature states (for charts)',         impacts: ['PI Delivery', 'Features'] },
  { key: 'storyDone',             label: 'Story Done States',     description: 'Comma-separated done states for Stories',                       impacts: ['Velocity', 'Sprint', 'Features', 'Dashboard', 'Reports'] },
  { key: 'storyRemoved',          label: 'Story Removed State',   description: 'State meaning a Story is excluded',                            impacts: ['Velocity', 'Sprint'] },
  { key: 'storyWip',              label: 'Story WIP States',      description: 'Comma-separated active states for Stories',                    impacts: ['Sprint', 'Velocity'] },
  { key: 'defectClosed',          label: 'Defect Closed States',  description: 'Comma-separated closed/resolved states for Defects',           impacts: ['Defects', 'Release Health'] },
  { key: 'defectRemoved',         label: 'Defect Removed State',  description: 'State meaning a Defect is excluded',                           impacts: ['Defects'] },
  { key: 'defectEnhancementValue',label: 'Enhancement Value',     description: 'Classification value to exclude (e.g. Enhancement)',           impacts: ['Defects'] },
  { key: 'defectFieldFoundValue', label: 'Field Found Value',     description: 'HowFound value indicating a field defect (escape ratio)',      impacts: ['Release Health'] },
];

function listToString(value) {
  return Array.isArray(value) ? value.join(', ') : value || '';
}

function splitList(value) {
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

function toFieldMappingsForm(fieldMappings) {
  const merged = {
    workItemTypes: { ...DEFAULT_FIELD_MAPPINGS.workItemTypes, ...(fieldMappings?.workItemTypes || {}) },
    fields: { ...DEFAULT_FIELD_MAPPINGS.fields, ...(fieldMappings?.fields || {}) },
    stateValues: { ...DEFAULT_FIELD_MAPPINGS.stateValues, ...(fieldMappings?.stateValues || {}) },
    piStructure: { ...DEFAULT_FIELD_MAPPINGS.piStructure, ...(fieldMappings?.piStructure || {}) },
  };

  return {
    workItemTypes: { ...EMPTY_FIELD_MAPPINGS_FORM.workItemTypes, ...merged.workItemTypes },
    fields: { ...EMPTY_FIELD_MAPPINGS_FORM.fields, ...merged.fields },
    stateValues: {
      featureDone: merged.stateValues.featureDone || '',
      featureRemoved: merged.stateValues.featureRemoved || '',
      featureWip: listToString(merged.stateValues.featureWip),
      featureAllStates: listToString(merged.stateValues.featureAllStates),
      storyDone: listToString(merged.stateValues.storyDone),
      storyRemoved: merged.stateValues.storyRemoved || '',
      storyWip: listToString(merged.stateValues.storyWip),
      defectClosed: listToString(merged.stateValues.defectClosed),
      defectRemoved: merged.stateValues.defectRemoved || '',
      defectEnhancementValue: merged.stateValues.defectEnhancementValue || '',
      defectFieldFoundValue: merged.stateValues.defectFieldFoundValue || '',
    },
    piStructure: {
      sprintLabels: listToString(merged.piStructure.sprintLabels),
      pisPerYear: merged.piStructure.pisPerYear ?? DEFAULT_FIELD_MAPPINGS.piStructure.pisPerYear,
      piNamingPattern: merged.piStructure.piNamingPattern || '',
      hoursPerPoint: merged.piStructure.hoursPerPoint ?? DEFAULT_FIELD_MAPPINGS.piStructure.hoursPerPoint,
    },
  };
}

function trimRecordValues(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value ?? '').trim()]));
}

function toFieldMappingsPayload(form) {
  return {
    workItemTypes: trimRecordValues(form.workItemTypes),
    fields: trimRecordValues(form.fields),
    stateValues: {
      featureDone: String(form.stateValues.featureDone || '').trim(),
      featureRemoved: String(form.stateValues.featureRemoved || '').trim(),
      featureWip: splitList(form.stateValues.featureWip),
      featureAllStates: splitList(form.stateValues.featureAllStates),
      storyDone: splitList(form.stateValues.storyDone),
      storyRemoved: String(form.stateValues.storyRemoved || '').trim(),
      storyWip: splitList(form.stateValues.storyWip),
      defectClosed: splitList(form.stateValues.defectClosed),
      defectRemoved: String(form.stateValues.defectRemoved || '').trim(),
      defectEnhancementValue: String(form.stateValues.defectEnhancementValue || '').trim(),
      defectFieldFoundValue: String(form.stateValues.defectFieldFoundValue || '').trim(),
    },
    piStructure: {
      sprintLabels: splitList(form.piStructure.sprintLabels),
      pisPerYear: Number(form.piStructure.pisPerYear) || DEFAULT_FIELD_MAPPINGS.piStructure.pisPerYear,
      piNamingPattern: String(form.piStructure.piNamingPattern || '').trim(),
      hoursPerPoint: Number(form.piStructure.hoursPerPoint) || DEFAULT_FIELD_MAPPINGS.piStructure.hoursPerPoint,
    },
  };
}

const KPI_TAG_ROWS = [
  { key: 'scenarioGap',    label: 'Scenario Gap Tag',    description: 'Tag used on defects caused by missing scenarios.' },
  { key: 'regression',     label: 'Regression Tag',      description: 'Tag used on regression defects and post-integration regression.' },
  { key: 'missedStandard', label: 'Missed Standard Tag', description: 'Tag used when standards or process checks were missed.' },
  { key: 'aiAssisted',     label: 'AI Assisted Tag',     description: 'Tag used on feature work items delivered with AI assistance.' },
  { key: 'lateChange',     label: 'Late Change Tag',     description: 'Tag used on feature work items added after the sVer milestone.' },
];

const KPI_ATTACHMENT_ROWS = [
  { key: 'mindmap',     label: 'Mindmap Keywords',      description: 'Matched against relation names, comments, and URLs for exploratory coverage.' },
  { key: 'fmea',        label: 'FMEA Keywords',         description: 'Matched for FMEA evidence on feature work items.' },
  { key: 'impact',      label: 'Impact Keywords',       description: 'Matched for impact assessment evidence.' },
  { key: 'checklist',   label: 'Checklist Keywords',    description: 'Matched for checklist compliance evidence.' },
  { key: 'crossReview', label: 'Cross Review Keywords', description: 'Matched on related links for cross-team review coverage.' },
];

const KPI_TARGET_ROWS = [
  { key: 'exploratory-coverage',        label: 'Exploratory Coverage',          description: 'Minimum percentage of feature items with exploratory evidence.', step: '1' },
  { key: 'fmea-coverage',               label: 'FMEA Coverage',                 description: 'Minimum percentage of feature items with FMEA evidence.', step: '1' },
  { key: 'scenario-gap-defects',        label: 'Scenario Gap Defects',          description: 'Maximum acceptable percentage of tagged scenario gap defects.', step: '1' },
  { key: 'regression-defects',          label: 'Regression Defects',            description: 'Maximum acceptable percentage of regression defects.', step: '1' },
  { key: 'checklist-compliance',        label: 'Checklist Compliance',          description: 'Minimum percentage of feature items with checklist evidence.', step: '1' },
  { key: 'cross-team-review',           label: 'Cross-Team Review',             description: 'Minimum percentage of feature items with cross-team review evidence.', step: '1' },
  { key: 'missed-standard-defects',     label: 'Missed Standard Defects',       description: 'Maximum acceptable percentage of missed standard defects.', step: '1' },
  { key: 'say-do-ratio',                label: 'Say/Do Ratio',                  description: 'Minimum PI completion percentage for planned feature items.', step: '1' },
  { key: 'late-changes',                label: 'Late Changes',                  description: 'Maximum acceptable count of late change feature items.', step: '1' },
  { key: 'impact-assessment',           label: 'Impact Assessment',             description: 'Minimum percentage of feature items with impact assessment evidence.', step: '1' },
  { key: 'build-time-reduction',        label: 'Build Time Reduction',          description: 'Minimum build time reduction percentage.', step: '1' },
  { key: 'build-stability',             label: 'Build Stability',               description: 'Minimum build stability percentage after sVer.', step: '1' },
  { key: 'ai-assisted-usage',           label: 'AI-Assisted Usage',             description: 'Minimum percentage of feature items tagged as AI-assisted.', step: '1' },
  { key: 'post-integration-regression', label: 'Post-Integration Regression',   description: 'Maximum acceptable percentage of post-integration regression defects.', step: '1' },
  { key: 'defect-analysis-time',        label: 'Defect Analysis Time',          description: 'Maximum average time in days from defect creation to resolution.', step: '0.1' },
];

function toKpiConfigForm(kpi) {
  const merged = {
    ...DEFAULT_KPI_CONFIG,
    ...(kpi || {}),
    tags: { ...DEFAULT_KPI_CONFIG.tags, ...(kpi?.tags || {}) },
    attachmentKeywords: { ...DEFAULT_KPI_CONFIG.attachmentKeywords, ...(kpi?.attachmentKeywords || {}) },
    targets: { ...DEFAULT_KPI_CONFIG.targets, ...(kpi?.targets || {}) },
    defectAnalysisTimeBaseline: kpi?.defectAnalysisTimeBaseline ?? DEFAULT_KPI_CONFIG.defectAnalysisTimeBaseline,
  };

  return {
    tags: { ...merged.tags },
    attachmentKeywords: { ...merged.attachmentKeywords },
    targets: { ...merged.targets },
    defectAnalysisTimeBaseline: merged.defectAnalysisTimeBaseline,
  };
}

function toKpiConfigPayload(form) {
  const tags = Object.fromEntries(
    KPI_TAG_ROWS.map(({ key }) => [key, String(form.tags?.[key] ?? '').trim() || DEFAULT_KPI_CONFIG.tags[key]])
  );
  const attachmentKeywords = Object.fromEntries(
    KPI_ATTACHMENT_ROWS.map(({ key }) => [key, String(form.attachmentKeywords?.[key] ?? '').trim() || DEFAULT_KPI_CONFIG.attachmentKeywords[key]])
  );
  const targets = Object.fromEntries(
    KPI_TARGET_ROWS.map(({ key }) => {
      const value = Number(form.targets?.[key]);
      return [key, Number.isFinite(value) ? value : DEFAULT_KPI_CONFIG.targets[key]];
    })
  );
  const baseline = Number(form.defectAnalysisTimeBaseline);

  return {
    tags,
    attachmentKeywords,
    targets,
    defectAnalysisTimeBaseline: Number.isFinite(baseline) ? baseline : DEFAULT_KPI_CONFIG.defectAnalysisTimeBaseline,
  };
}

function KpiConfigTab({ cfg, queryClient }) {
  const [form, setForm] = useState(() => toKpiConfigForm(cfg?.kpi || {}));
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState({ tags: true, attachmentKeywords: true, targets: true });

  useEffect(() => {
    setForm(toKpiConfigForm(cfg?.kpi || {}));
  }, [cfg]);

  function setSectionValue(section, key, value) {
    setForm(current => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      }
    }));
  }

  async function saveKpiConfig(e) {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      const payload = toKpiConfigPayload(form);
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ kpi: payload }) });
      await queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      await queryClient.invalidateQueries({ queryKey: ['kpi'] });
      setForm(toKpiConfigForm(payload));
      setStatus('ok');
    } catch (err) {
      setStatus('err:' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleSection(section) {
    setSections(current => ({ ...current, [section]: !current[section] }));
  }

  return (
    <div className="settings-grid">
      <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-header">
          <span className="card-title">📈 KPI Config</span>
          <span className="card-sub">Configure KPI tags, evidence keywords, targets, and the defect analysis baseline.</span>
        </div>
        <form className="settings-form" onSubmit={saveKpiConfig}>
          <FieldMappingsSectionBlock
            title="1. Tags"
            info="These values drive KPI tag-based WIQL filters for defects and feature work items."
            open={sections.tags}
            onToggle={() => toggleSection('tags')}
          >
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Description</th>
                  <th>Configured Value</th>
                </tr>
              </thead>
              <tbody>
                {KPI_TAG_ROWS.map(row => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</td>
                    <td>
                      <input
                        className="form-input"
                        type="text"
                        value={form.tags[row.key]}
                        onChange={e => setSectionValue('tags', row.key, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </FieldMappingsSectionBlock>

          <FieldMappingsSectionBlock
            title="2. Attachment Keywords"
            info="Comma-separated keywords are matched against relation names, comments, and URLs."
            open={sections.attachmentKeywords}
            onToggle={() => toggleSection('attachmentKeywords')}
          >
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Description</th>
                  <th>Configured Value</th>
                </tr>
              </thead>
              <tbody>
                {KPI_ATTACHMENT_ROWS.map(row => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</td>
                    <td>
                      <input
                        className="form-input"
                        type="text"
                        value={form.attachmentKeywords[row.key]}
                        onChange={e => setSectionValue('attachmentKeywords', row.key, e.target.value)}
                      />
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>comma-separated</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </FieldMappingsSectionBlock>

          <FieldMappingsSectionBlock
            title="3. Targets"
            info="These targets drive KPI scoring, colouring, and defect analysis baseline comparisons."
            open={sections.targets}
            onToggle={() => toggleSection('targets')}
          >
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Description</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {KPI_TARGET_ROWS.map(row => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</td>
                    <td>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step={row.step}
                        value={form.targets[row.key]}
                        onChange={e => setSectionValue('targets', row.key, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 16, maxWidth: 260 }}>
              <label className="form-label">Defect Analysis Baseline (days)
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.defectAnalysisTimeBaseline}
                  onChange={e => setForm(current => ({ ...current, defectAnalysisTimeBaseline: e.target.value }))}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 350 }}>
                  Baseline used to calculate the reduction target.
                </span>
              </label>
            </div>
          </FieldMappingsSectionBlock>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save KPI Config'}
            </button>
            {status === 'ok'           && <span className="form-status ok">✅ KPI config saved</span>}
            {status.startsWith('err:') && <span className="form-status err">❌ {status.slice(4)}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

// ── TFS User Roles tab ────────────────────────────────────────────────────────
const BUILTIN_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'all',   label: 'All (default)' },
  { value: 'exec',  label: 'Exec' },
  { value: 'rte',   label: 'RTE' },
  { value: 'pm',    label: 'PM' },
  { value: 'sm',    label: 'SM' },
];

function TfsUsersTab({ cfg, queryClient }) {
  const [teams, setTeams]               = useState([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [teamSearch, setTeamSearch]     = useState('');
  const [showTeamList, setShowTeamList] = useState(false);
  const [members, setMembers]           = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedTeamName, setSelectedTeamName] = useState('');
  const [userRoles, setUserRoles]       = useState({});
  const [saving, setSaving]             = useState(false);
  const [status, setStatus]             = useState('');
  const [resolvedUsers, setResolvedUsers] = useState({}); // account → { displayName, email }
  const [resolving, setResolving]       = useState(false);

  // Merge built-in + custom roles for the dropdown
  const roleOptions = useMemo(() => [
    ...BUILTIN_ROLE_OPTIONS,
    ...(cfg?.roles?.custom || []).map(r => ({ value: r.id, label: r.label || r.id })),
  ], [cfg?.roles?.custom]);

  // Load initial userRoles from config
  useEffect(() => {
    if (cfg?.tfsAuth?.userRoles) setUserRoles(cfg.tfsAuth.userRoles);
  }, [cfg]);

  // Resolve display names & emails for all assigned users
  useEffect(() => {
    const accounts = Object.keys(userRoles);
    if (!accounts.length) { setResolvedUsers({}); return; }
    // Only resolve accounts we don't already have
    const unresolved = accounts.filter(a => !resolvedUsers[a]);
    if (!unresolved.length) return;
    setResolving(true);
    apiFetch('/api/auth/tfs-users/resolve', {
      method: 'POST',
      body: JSON.stringify({ accounts: unresolved }),
    })
      .then(d => setResolvedUsers(prev => ({ ...prev, ...(d || {}) })))
      .catch(() => {})
      .finally(() => setResolving(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRoles]);

  const searchTeams = () => {
    if (teamSearch.trim().length < 2) return;
    setLoadingTeams(true);
    setTeams([]);
    apiFetch(`/api/auth/tfs-teams?search=${encodeURIComponent(teamSearch.trim())}`)
      .then(d => setTeams(d || []))
      .catch(() => {})
      .finally(() => setLoadingTeams(false));
    setShowTeamList(true);
  };

  // Fetch members when team selection changes
  useEffect(() => {
    if (!selectedTeamName) return;
    setLoadingMembers(true);
    apiFetch(`/api/auth/tfs-teams/${encodeURIComponent(selectedTeamName)}/members`)
      .then(d => setMembers(d || []))
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, [selectedTeamName]);

  const setRole = (uniqueName, role) => {
    const key = uniqueName.toLowerCase();
    setUserRoles(prev => {
      const next = { ...prev };
      if (!role || role === 'all') delete next[key];
      else next[key] = role;
      return next;
    });
  };

  const removeUser = (key) => {
    setUserRoles(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setStatus('');
    try {
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ tfsAuth: { userRoles } }) });
      queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      setStatus('Saved');
    } catch { setStatus('Save failed'); }
    finally { setSaving(false); }
  };

  const cell  = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', color: 'var(--text)' };
  const roleColor = { admin: '#ef4444', exec: '#a78bfa', rte: '#3b82f6', pm: '#f59e0b', sm: '#10b981' };

  const assignedEntries = Object.entries(userRoles).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div>
      <div className="card-header" style={{ marginBottom: 16 }}>
        <span className="card-title">TFS User Roles</span>
        <span className="card-sub">Assign dashboard roles to TFS users. Roles apply on next login.</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '5px 16px', background: 'var(--primary)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save Roles'}
          </button>
          {status && <span style={{ fontSize: 12, color: status === 'Saved' ? '#4ade80' : '#f87171' }}>{status}</span>}
        </div>
      </div>

      {/* ── Section 1: Currently assigned users ─────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          👥 Onboarded Users
          <span style={{ fontSize: 11, fontWeight: 400, background: 'rgba(20,146,255,0.15)', color: 'var(--primary)', borderRadius: 10, padding: '1px 8px' }}>
            {assignedEntries.length}
          </span>
          {resolving && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>🔄 resolving identities…</span>}
        </div>

        {assignedEntries.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            No users have been assigned roles yet. Browse a team below to add users.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                <th style={{ ...cell, fontWeight: 600, textAlign: 'left' }}>Display Name</th>
                <th style={{ ...cell, fontWeight: 600, textAlign: 'left' }}>Email</th>
                <th style={{ ...cell, fontWeight: 600, textAlign: 'left' }}>Account</th>
                <th style={{ ...cell, fontWeight: 600, textAlign: 'left', width: 160 }}>Role</th>
                <th style={{ ...cell, fontWeight: 600, textAlign: 'center', width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {assignedEntries.map(([key, role]) => {
                const info = resolvedUsers[key] || {};
                return (
                  <tr key={key} style={{ background: 'rgba(20,146,255,0.04)' }}>
                    <td style={cell}>
                      {info.displayName
                        ? <span style={{ fontWeight: 600 }}>{info.displayName}</span>
                        : <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{resolving ? '…' : '–'}</span>
                      }
                    </td>
                    <td style={{ ...cell, color: 'var(--muted)' }}>
                      {info.email
                        ? <a href={`mailto:${info.email}`} style={{ color: 'var(--primary)', textDecoration: 'none' }}>{info.email}</a>
                        : <span style={{ fontStyle: 'italic' }}>{resolving ? '…' : '–'}</span>
                      }
                    </td>
                    <td style={{ ...cell, fontFamily: 'monospace', color: 'var(--muted)', fontSize: 11 }}>{key}</td>
                    <td style={cell}>
                      <select value={role} onChange={e => setRole(key, e.target.value)}
                        style={{ background: 'var(--surface-2)', border: `1px solid ${roleColor[role] || 'var(--border)'}`, color: roleColor[role] || 'var(--text)', fontSize: 12, padding: '2px 6px', width: '100%', fontWeight: 600 }}>
                        {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td style={{ ...cell, textAlign: 'center' }}>
                      <button onClick={() => removeUser(key)}
                        title="Remove user"
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: '#ef4444', fontSize: 12, padding: '2px 8px', cursor: 'pointer', lineHeight: 1 }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Section 2: Browse team to add users ──────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          🔍 Add Users by Team
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Team:</label>
          <div style={{ position: 'relative', flex: '0 0 300px' }}>
            <input
              value={teamSearch}
              onChange={e => { setTeamSearch(e.target.value); setSelectedTeam(''); setSelectedTeamName(''); setMembers([]); }}
              onKeyDown={e => { if (e.key === 'Enter') searchTeams(); }}
              onFocus={() => { if (teams.length) setShowTeamList(true); }}
              onBlur={() => setTimeout(() => setShowTeamList(false), 150)}
              placeholder="Type team name and press Enter…"
              style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, padding: '4px 8px', boxSizing: 'border-box' }}
            />
            {showTeamList && teamSearch.length >= 2 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface-1)', border: '1px solid var(--border)', maxHeight: 220, overflowY: 'auto', zIndex: 50 }}>
                {loadingTeams && <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--muted)' }}>Searching…</div>}
                {!loadingTeams && teams.map(t => (
                  <div key={t.id}
                    onMouseDown={() => { setSelectedTeam(t.id); setSelectedTeamName(t.name); setTeamSearch(t.name); setShowTeamList(false); }}
                    style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', background: t.id === selectedTeam ? 'rgba(20,146,255,0.15)' : 'transparent', color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(20,146,255,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = t.id === selectedTeam ? 'rgba(20,146,255,0.15)' : 'transparent'}
                  >{t.name}</div>
                ))}
                {!loadingTeams && teams.length === 0 &&
                  <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--muted)' }}>No teams found</div>
                }
              </div>
            )}
          </div>
          {loadingTeams && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Searching…</span>}
        </div>

        {loadingMembers
          ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8 }}>Loading members…</div>
          : !selectedTeamName
            ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                Search for a TFS team above to browse its members and assign roles.
              </div>
            : members.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8 }}>No members found for this team.</div>
              : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th style={{ ...cell, fontWeight: 600, textAlign: 'left' }}>Display Name</th>
                      <th style={{ ...cell, fontWeight: 600, textAlign: 'left' }}>Account (Domain\ID)</th>
                      <th style={{ ...cell, fontWeight: 600, textAlign: 'left', width: 160 }}>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => {
                      const key = (m.uniqueName || '').toLowerCase();
                      const currentRole = userRoles[key] || 'all';
                      return (
                        <tr key={m.uniqueName} style={{ background: currentRole !== 'all' ? 'rgba(20,146,255,0.05)' : 'transparent' }}>
                          <td style={cell}>{m.displayName}</td>
                          <td style={{ ...cell, color: 'var(--muted)', fontFamily: 'monospace' }}>{m.uniqueName}</td>
                          <td style={cell}>
                            <select value={currentRole} onChange={e => setRole(m.uniqueName, e.target.value)}
                              style={{ background: 'var(--surface-2)', border: `1px solid ${roleColor[currentRole] || 'var(--border)'}`, color: roleColor[currentRole] || 'var(--text)', fontSize: 12, padding: '2px 6px', width: '100%', fontWeight: currentRole !== 'all' ? 600 : 400 }}>
                              {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
        }
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)' }}>
        Roles stored by <code>DOMAIN\account</code> and applied at next login. Users not listed default to <strong>All</strong>.
      </div>
    </div>
  );
}


export default function SettingsSection() {
  const queryClient = useQueryClient();
  const { isAdmin, user } = useAuth();
  const { data: cfg } = useConfig();
  const isTfsAuth = !!(cfg?.tfsAuth?.enabled);
  const isSuperAdmin = !!(user?.isSuperAdmin);
  const activeDept = useStore(s => s.activeDept);
  const deptName = activeDept?.name || activeDept?.id || 'Default';

  // Full settings page is admin-only (dept admin or super admin)
  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
        <span style={{ fontSize: 36 }}>🔒</span>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Admin access required</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Only department administrators can access Settings.</div>
      </div>
    );
  }

  const TABS = ALL_TABS.filter(t => {
    if (!isSuperAdmin && SUPERADMIN_ONLY_TABS.includes(t)) return false;
    if (t === 'tfsUsers' && !isTfsAuth) return false;
    if (t === 'azuread'  && isTfsAuth)  return false;
    if (t === 'roleMappings' && isTfsAuth) return false;
    return true;
  });
  const firstVisibleTab = TABS[0] || 'tfs';
  const store = useStore();
  const theme    = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const [activeTab, setActiveTab] = useState('tfs');

  const [tfsForm, setTfsForm] = useState({ baseUrl: '', pat: '', areaPath: '', teamRootPath: '', iterationPath: '', githubToken: '', githubApiBase: '' });
  const [tfsStatus, setTfsStatus]   = useState('');
  const [tfsSaving, setTfsSaving]   = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [githubRepos, setGithubRepos] = useState([]);
  const [cacheBusting, setCacheBusting] = useState(false);
  const [cacheMsg, setCacheMsg] = useState('');

  const [brandingForm, setBrandingForm] = useState(DEFAULT_BRANDING);
  const [brandingStatus, setBrandingStatus] = useState('');
  const [brandingSaving, setBrandingSaving] = useState(false);
  const svgFileRef = useRef(null);

  const [ragForm, setRagForm]     = useState(DEFAULT_RAG);
  const [ragStatus, setRagStatus] = useState('');
  const [ragSaving, setRagSaving] = useState(false);

  const [fieldMappingsForm, setFieldMappingsForm] = useState(() => toFieldMappingsForm(DEFAULT_FIELD_MAPPINGS));
  const [fieldMappingsStatus, setFieldMappingsStatus] = useState('');
  const [fieldMappingsSaving, setFieldMappingsSaving] = useState(false);
  const [fieldMappingsSections, setFieldMappingsSections] = useState({
    workItemTypes: true,
    fields: true,
    stateValues: true,
    piStructure: true,
  });

  const [notificationsForm, setNotificationsForm] = useState(DEFAULT_NOTIFICATIONS);
  const [notificationsStatus, setNotificationsStatus] = useState('');
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationTestStatus, setNotificationTestStatus] = useState('');
  const [notificationTestLoading, setNotificationTestLoading] = useState(false);
  const [digestStatus, setDigestStatus] = useState('');
  const [digestLoading, setDigestLoading] = useState(false);
  const [notificationMeta, setNotificationMeta] = useState({ configured: false, webhookType: 'teams', enabled: false, lastDigestSentAt: '' });
  const [historyData,     setHistoryData]     = useState([]);
  const [historyLoading,  setHistoryLoading]  = useState(false);
  const [thresholdStatus, setThresholdStatus] = useState('');
  const [thresholdLoading,setThresholdLoading]= useState(false);

  const [advForm, setAdvForm]     = useState({ programmeStartYear: new Date().getFullYear(), refreshIntervalMinutes: 30 });
  const [advStatus, setAdvStatus] = useState('');
  const [advSaving, setAdvSaving] = useState(false);
  const [azureAd, setAzureAd] = useState(DEFAULT_AZURE_AD);
  const [roleMappings, setRoleMappings] = useState([]);
  const [adminRoles, setAdminRoles] = useState(['admin']);
  const [policies, setPoliciesState] = useState(DEFAULT_POLICIES);
  const [selectedPolicyRole, setSelectedPolicyRole] = useState('all');
  const [expandedPolicyPage, setExpandedPolicyPage] = useState(null);
  const [policySaveStatus, setPolicySaveStatus] = useState('');

  useEffect(() => {
    if (!cfg) return;
    const trp = cfg.tfs?.teamRootPath || '';
    setTfsForm({
      baseUrl:       cfg.tfs?.baseUrl       || '',
      pat:           '',
      areaPath:      cfg.tfs?.areaPath      || '',
      teamRootPath:  Array.isArray(trp) ? trp.join('\n') : trp,
      iterationPath: cfg.tfs?.iterationPath || '',
      githubToken:   '',
      githubApiBase: cfg.github?.apiBase || '',
    });
    setGithubRepos((cfg.github?.repos || []).map(r => ({ ...r })));
    setBrandingForm({
      ...DEFAULT_BRANDING,
      ...(cfg.branding || {}),
    });
    setRagForm({
      doneRate:      { ...DEFAULT_RAG.doneRate,      ...(cfg.ragThresholds?.doneRate      || {}) },
      resolveRate:   { ...DEFAULT_RAG.resolveRate,   ...(cfg.ragThresholds?.resolveRate   || {}) },
      escapeRatio:   { ...DEFAULT_RAG.escapeRatio,   ...(cfg.ragThresholds?.escapeRatio   || {}) },
      defectDensity: { ...DEFAULT_RAG.defectDensity, ...(cfg.ragThresholds?.defectDensity || {}) },
      healthScore:   { ...DEFAULT_RAG.healthScore,   ...(cfg.ragThresholds?.healthScore   || {}) },
    });
    setFieldMappingsForm(toFieldMappingsForm(cfg.fieldMappings || {}));
    setNotificationsForm({
      ...DEFAULT_NOTIFICATIONS,
      ...(cfg.notifications || {}),
      digestSchedule:      { ...DEFAULT_NOTIFICATIONS.digestSchedule,  ...(cfg.notifications?.digestSchedule || {}) },
      digestSections:      { ...DEFAULT_NOTIFICATIONS.digestSections,  ...(cfg.notifications?.digestSections || {}) },
      forecastPercentiles: cfg.notifications?.forecastPercentiles || DEFAULT_NOTIFICATIONS.forecastPercentiles,
      anomalyAlerts:       { ...DEFAULT_NOTIFICATIONS.anomalyAlerts,   ...(cfg.notifications?.anomalyAlerts  || {}) },
      digestTitle:       cfg.notifications?.digestTitle       || '',
      digestFooter:      cfg.notifications?.digestFooter      || '',
      alertWebhookType:  cfg.notifications?.alertWebhookType  || 'teams',
      thresholdAlerts:   cfg.notifications?.thresholdAlerts   || [],
      // Always blank — placeholder shows '*** (set)' if URL is configured
      alertWebhookUrl: '',
      webhookUrl: '',
    });
    setAdvForm({
      programmeStartYear:     cfg.app?.programmeStartYear     || new Date().getFullYear(),
      refreshIntervalMinutes: cfg.app?.refreshIntervalMinutes || 30,
    });
    if (cfg.azureAd)      setAzureAd({ ...DEFAULT_AZURE_AD, ...cfg.azureAd });
    if (cfg.roleMappings) setRoleMappings(cfg.roleMappings || []);
    if (cfg.adminRoles)   setAdminRoles(cfg.adminRoles || ['admin']);
    if (cfg.policies)     setPoliciesState(cfg.policies || {});
  }, [cfg]);

  async function refreshNotificationMeta() {
    try {
      const data = await apiFetch('/api/notifications/config');
      setNotificationMeta(data);
    } catch {
      setNotificationMeta({ configured: false, webhookType: 'teams', enabled: false, lastDigestSentAt: '' });
    }
  }

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const data = await apiFetch('/api/notifications/history');
      setHistoryData(data.history || []);
    } catch {}
    setHistoryLoading(false);
  }

  useEffect(() => {
    refreshNotificationMeta();
    refreshHistory();
  }, [cfg]);

  useEffect(() => {
    if (TABS.length && !TABS.includes(activeTab)) {
      setActiveTab(firstVisibleTab);
    }
  }, [TABS, activeTab, firstVisibleTab]);

  async function bustDeptCache() {
    setCacheBusting(true);
    setCacheMsg('');
    try {
      const res = await fetch('/api/full-reset', { method: 'POST', credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCacheMsg('✅ Cache cleared + TFS circuits reset — dashboard will fetch fresh data on next load.');
    } catch (e) {
      setCacheMsg(`❌ ${e.message}`);
    } finally {
      setCacheBusting(false);
      setTimeout(() => setCacheMsg(''), 6000);
    }
  }

  async function saveTfs(e) {
    e.preventDefault();
    setTfsSaving(true);
    setTfsStatus('');
    try {
      const body = { tfs: {
        baseUrl:       tfsForm.baseUrl.trim(),
        areaPath:      tfsForm.areaPath.trim(),
        teamRootPath:  tfsForm.teamRootPath.split('\n').map(s => s.trim()).filter(Boolean),
        iterationPath: tfsForm.iterationPath.trim(),
      }};
      if (tfsForm.pat.trim()) body.tfs.pat = tfsForm.pat.trim();
      body.github = { repos: githubRepos, apiBase: tfsForm.githubApiBase.trim() || 'https://api.github.com' };
      if (tfsForm.githubToken.trim()) body.github.token = tfsForm.githubToken.trim();
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(body) });
      const updated = await apiFetch('/api/config');
      store.applyConfig(updated);
      queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      setTfsStatus('ok');
    } catch (err) {
      setTfsStatus('err:' + err.message);
    } finally {
      setTfsSaving(false);
    }
  }

  async function testConnection() {
    setTestLoading(true);
    setTestStatus('');
    try {
      const res = await apiFetch('/api/teams');
      const names = (res.teams || []).join(', ');
      setTestStatus(`ok:Connected! Found ${res.teams?.length || 0} teams${names ? ': ' + names : ''}`);
    } catch (err) {
      setTestStatus('err:' + err.message);
    } finally {
      setTestLoading(false);
    }
  }

  async function saveBranding(e) {
    e.preventDefault();
    setBrandingSaving(true);
    setBrandingStatus('');
    try {
      const logoUrl = brandingForm.logoUrl.trim();
      const logoSvg = brandingForm.logoSvg.trim();
      const savedBranding = {
        ...DEFAULT_BRANDING,
        companyName: brandingForm.companyName.trim(),
        appName: brandingForm.appName.trim(),
        appSubtitle: brandingForm.appSubtitle.trim(),
        logoUrl,
        logoSvg,
        primaryColor: brandingForm.primaryColor || DEFAULT_BRANDING.primaryColor,
        adminEmail: brandingForm.adminEmail.trim(),
        logoType: logoUrl ? 'url' : logoSvg ? 'svg' : 'text',
      };
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ branding: savedBranding }) });
      store.setBranding(savedBranding);
      queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      setBrandingStatus('ok');
    } catch (err) {
      setBrandingStatus('err:' + err.message);
    } finally {
      setBrandingSaving(false);
    }
  }

  async function saveRag(e) {
    e.preventDefault();
    setRagSaving(true);
    setRagStatus('');
    try {
      const body = { ragThresholds: ragForm };
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(body) });
      store.setRagThresholds(ragForm);
      setRagStatus('ok');
    } catch (err) {
      setRagStatus('err:' + err.message);
    } finally {
      setRagSaving(false);
    }
  }

  async function saveFieldMappings(e) {
    e.preventDefault();
    setFieldMappingsSaving(true);
    setFieldMappingsStatus('');
    try {
      const body = { fieldMappings: toFieldMappingsPayload(fieldMappingsForm) };
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(body) });
      const updated = await apiFetch('/api/config');
      store.applyConfig(updated);
      queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      queryClient.invalidateQueries(); // flush all caches — sprint labels / pisPerYear may have changed
      setFieldMappingsForm(toFieldMappingsForm(updated.fieldMappings || body.fieldMappings));
      setFieldMappingsStatus('ok');
    } catch (err) {
      setFieldMappingsStatus('err:' + err.message);
    } finally {
      setFieldMappingsSaving(false);
    }
  }

  async function saveNotifications(e) {
    e.preventDefault();
    setNotificationsSaving(true);
    setNotificationsStatus('');
    setNotificationTestStatus('');
    try {
      const body = {
        notifications: {
          webhookType:         notificationsForm.webhookType,
          anomalyThreshold:    Number(notificationsForm.anomalyThreshold),
          enabled:             Boolean(notificationsForm.enabled),
          digestSchedule:      notificationsForm.digestSchedule,
          digestSections:      notificationsForm.digestSections,
          forecastPercentiles: notificationsForm.forecastPercentiles,
          anomalyAlerts:       notificationsForm.anomalyAlerts,
          digestTitle:         notificationsForm.digestTitle,
          digestFooter:        notificationsForm.digestFooter,
          alertWebhookType:    notificationsForm.alertWebhookType,
          thresholdAlerts:     notificationsForm.thresholdAlerts,
        }
      };
      if (notificationsForm.webhookUrl.trim()) body.notifications.webhookUrl = notificationsForm.webhookUrl.trim();
      if (notificationsForm.alertWebhookUrl.trim()) body.notifications.alertWebhookUrl = notificationsForm.alertWebhookUrl.trim();
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(body) });
      queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      setNotificationsStatus('ok');
      setNotificationsForm(form => ({ ...form, webhookUrl: '', alertWebhookUrl: '' }));
      await refreshNotificationMeta();
    } catch (err) {
      setNotificationsStatus('err:' + err.message);
    } finally {
      setNotificationsSaving(false);
    }
  }

  async function sendTestNotification() {
    setNotificationTestLoading(true);
    setNotificationTestStatus('');
    try {
      await apiFetch('/api/notifications/webhook/test', {
        method: 'POST',
        body: JSON.stringify({ message: 'Test message from AV Dashboard' })
      });
      setNotificationTestStatus('ok');
      await refreshNotificationMeta();
      await refreshHistory();
    } catch (err) {
      setNotificationTestStatus('err:' + err.message);
    } finally {
      setNotificationTestLoading(false);
    }
  }

  async function sendDigestNow() {
    setDigestLoading(true);
    setDigestStatus('');
    try {
      await apiFetch('/api/notifications/digest/trigger', { method: 'POST', body: JSON.stringify({}) });
      setDigestStatus('ok');
      await refreshNotificationMeta();
      await refreshHistory();
    } catch (err) {
      setDigestStatus('err:' + err.message);
    } finally {
      setDigestLoading(false);
    }
  }

  async function checkThresholdsNow() {
    setThresholdLoading(true);
    setThresholdStatus('');
    try {
      const result = await apiFetch('/api/notifications/thresholds/check', { method: 'POST', body: JSON.stringify({}) });
      setThresholdStatus(result.fired > 0 ? `ok:${result.fired} alert(s) fired` : 'ok:0 — no thresholds breached');
      await refreshHistory();
    } catch (err) {
      setThresholdStatus('err:' + err.message);
    } finally {
      setThresholdLoading(false);
    }
  }

  async function saveAdv(e) {
    e.preventDefault();
    setAdvSaving(true);
    setAdvStatus('');
    try {
      const body = { app: {
        programmeStartYear:     Number(advForm.programmeStartYear),
        refreshIntervalMinutes: Number(advForm.refreshIntervalMinutes),
      }};
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(body) });
      store.setRefreshInterval(body.app.refreshIntervalMinutes);
      setAdvStatus('ok');
    } catch (err) {
      setAdvStatus('err:' + err.message);
    } finally {
      setAdvSaving(false);
    }
  }

  async function saveAzureAd() {
    try {
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ azureAd }) });
      alert('Azure AD settings saved. Restart the server if the OIDC client was already initialized.');
    } catch (e) { alert('Save failed: ' + e.message); }
  }

  async function saveRoleMappings() {
    try {
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ roleMappings, adminRoles }) });
      alert('Role mappings saved.');
    } catch (e) { alert('Save failed: ' + e.message); }
  }

  const setPolicies = useStore(s => s.setPolicies);

  async function savePolicies() {
    try {
      await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ policies }) });
      setPolicies(policies); // apply immediately to the store so visibility changes take effect
      queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      setPolicySaveStatus('ok');
      setTimeout(() => setPolicySaveStatus(''), 3000);
    } catch (e) { setPolicySaveStatus('err:' + e.message); }
  }

  function setRagField(metric, side, value) {
    setRagForm(f => ({ ...f, [metric]: { ...f[metric], [side]: Number(value) } }));
  }

  function setFieldMappingValue(section, key, value) {
    setFieldMappingsForm(form => ({
      ...form,
      [section]: {
        ...form[section],
        [key]: value,
      }
    }));
  }

  function toggleFieldMappingsSection(section) {
    setFieldMappingsSections(current => ({ ...current, [section]: !current[section] }));
  }

  return (
    <div className="settings-layout">
      <div className="settings-header-area">
        <div className="section-header">
          <h1 className="section-title">⚙️ Settings</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--bg-card2)', padding: '2px 10px', borderRadius: 0 }}>
              🏢 Department: <strong style={{ color: 'var(--text)' }}>{deptName}</strong>
            </span>
            {isSuperAdmin && (
              <span style={{ fontSize: 11, color: 'var(--primary)', background: 'var(--bg-card2)', padding: '2px 10px', borderRadius: 0 }}>
                👑 Super Admin — all tabs visible
              </span>
            )}
          </div>
        </div>
        <div className="sub-nav">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`sub-nav-tab${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-content">
      {activeTab === 'tfs'&& (
        <div className="settings-grid">
          <div className="card settings-card">
            <div className="card-header"><span className="card-title">TFS Connection</span></div>
            <form className="settings-form" onSubmit={saveTfs}>
              <label className="form-label">TFS Base URL
                <input className="form-input" type="text" value={tfsForm.baseUrl}
                  placeholder="https://tfs.example.com/tfs/Project"
                  onChange={e => setTfsForm(f => ({ ...f, baseUrl: e.target.value }))} />
              </label>
              <label className="form-label">Personal Access Token (PAT)
                <input className="form-input" type="password" value={tfsForm.pat}
                  placeholder={cfg?.tfs?.pat ? '*** (set — leave blank to keep)' : 'Enter PAT…'}
                  autoComplete="current-password"
                  onChange={e => setTfsForm(f => ({ ...f, pat: e.target.value }))} />
              </label>
              <label className="form-label">Area Path
                <input className="form-input" type="text" value={tfsForm.areaPath}
                  onChange={e => setTfsForm(f => ({ ...f, areaPath: e.target.value }))} />
              </label>
              <label className="form-label">Team Root Path(s)
                <textarea className="form-input" rows={3} value={tfsForm.teamRootPath}
                  placeholder={"One path per line, e.g.\nHealthcare IT\\ICAP\\ISP\\Hercules"}
                  style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                  onChange={e => setTfsForm(f => ({ ...f, teamRootPath: e.target.value }))} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 350 }}>
                  One entry per line. Each path should be one level above the team nodes.
                </span>
              </label>
              <label className="form-label">Iteration Path
                <input className="form-input" type="text" value={tfsForm.iterationPath}
                  onChange={e => setTfsForm(f => ({ ...f, iterationPath: e.target.value }))} />
              </label>
              <label className="form-label">GitHub API Base URL
                <input className="form-input" type="text" value={tfsForm.githubApiBase}
                  placeholder="https://github.philips.com/api/v3  (leave blank for github.com)"
                  onChange={e => setTfsForm(f => ({ ...f, githubApiBase: e.target.value }))} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 350 }}>
                  For GitHub Enterprise, e.g. <code>https://github.philips.com/api/v3</code>
                </span>
              </label>
              <label className="form-label">GitHub Token (for Test Coverage)
                <input className="form-input" type="password" value={tfsForm.githubToken}
                  placeholder={cfg?.github?.token ? '*** (set — leave blank to keep)' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
                  autoComplete="off"
                  onChange={e => setTfsForm(f => ({ ...f, githubToken: e.target.value }))} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 350 }}>
                  GitHub PAT with <code>repo</code> read scope — used to scan unit test files.
                </span>
              </label>
              <div className="form-label">GitHub Repos to Scan
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                  {githubRepos.map((r, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px 100px 1fr auto', gap: 6, alignItems: 'center' }}>
                      <input className="form-input" placeholder="owner" value={r.owner || ''} style={{ fontSize: 12 }}
                        onChange={e => setGithubRepos(prev => prev.map((x, j) => j === i ? { ...x, owner: e.target.value } : x))} />
                      <input className="form-input" placeholder="repo" value={r.repo || ''} style={{ fontSize: 12 }}
                        onChange={e => setGithubRepos(prev => prev.map((x, j) => j === i ? { ...x, repo: e.target.value } : x))} />
                      <select className="form-input" value={r.type || 'dotnet'} style={{ fontSize: 12 }}
                        onChange={e => setGithubRepos(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                        <option value="dotnet">.NET</option>
                        <option value="angular">Angular</option>
                      </select>
                      <input className="form-input" placeholder="label" value={r.label || ''} style={{ fontSize: 12 }}
                        onChange={e => setGithubRepos(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                      <input className="form-input" placeholder="searchPath (optional)" value={r.searchPath || ''} style={{ fontSize: 12 }}
                        onChange={e => setGithubRepos(prev => prev.map((x, j) => j === i ? { ...x, searchPath: e.target.value } : x))} />
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px', color: 'var(--danger)' }}
                        onClick={() => setGithubRepos(prev => prev.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12, alignSelf: 'flex-start' }}
                    onClick={() => setGithubRepos(prev => [...prev, { owner: '', repo: '', type: 'dotnet', label: '', searchPath: '' }])}>
                    + Add Repo
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>owner / repo / type / label / searchPath(optional)</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="submit" disabled={tfsSaving}>
                  {tfsSaving ? 'Saving…' : 'Save TFS Settings'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={testConnection} disabled={testLoading}>
                  {testLoading ? 'Testing…' : 'Test Connection'}
                </button>
                <button className="btn btn-danger" type="button" onClick={bustDeptCache} disabled={cacheBusting}
                  title="Clear cache + reset circuit breakers — sections will reload fresh data from TFS">
                  {cacheBusting ? '…' : '🔄 Full Reset'}
                </button>
              </div>
              {tfsStatus === 'ok'            && <span className="form-status ok">✅ TFS settings saved</span>}
              {tfsStatus.startsWith('err:')  && <span className="form-status err">❌ {tfsStatus.slice(4)}</span>}
              {testStatus.startsWith('ok:')  && <span className="form-status ok">✅ {testStatus.slice(3)}</span>}
              {testStatus.startsWith('err:') && <span className="form-status err">❌ {testStatus.slice(4)}</span>}
              {cacheMsg && <span className={`form-status ${cacheMsg.startsWith('✅') ? 'ok' : 'err'}`}>{cacheMsg}</span>}
            </form>
          </div>
        </div>
      )}

      {activeTab === 'branding' && (
        <div className="settings-grid">
          <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title">🎨 Branding</span>
              <span className="card-sub">Customize company, product name, logo, and primary accent color</span>
            </div>
            <form className="settings-form" onSubmit={saveBranding}>
              <div className="form-row">
                <label className="form-label" style={{ flex: 1 }}>Company Name
                  <input className="form-input" type="text" value={brandingForm.companyName}
                    onChange={e => setBrandingForm(f => ({ ...f, companyName: e.target.value }))} />
                </label>
                <label className="form-label" style={{ flex: 1 }}>App Name
                  <input className="form-input" type="text" value={brandingForm.appName}
                    onChange={e => setBrandingForm(f => ({ ...f, appName: e.target.value }))} />
                </label>
              </div>
              <label className="form-label">App Subtitle
                <input className="form-input" type="text" value={brandingForm.appSubtitle}
                  onChange={e => setBrandingForm(f => ({ ...f, appSubtitle: e.target.value }))} />
              </label>
              <label className="form-label">Admin Contact Email
                <input className="form-input" type="email" value={brandingForm.adminEmail}
                  placeholder="admin@company.com"
                  onChange={e => setBrandingForm(f => ({ ...f, adminEmail: e.target.value }))} />
              </label>
              <label className="form-label">Logo URL
                <input className="form-input" type="text" value={brandingForm.logoUrl}
                  placeholder="https://...logo.png"
                  onChange={e => setBrandingForm(f => ({ ...f, logoUrl: e.target.value }))} />
              </label>
              <label className="form-label">Logo Image
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, marginBottom: 6 }}>
                  <button type="button" className="btn btn-sm btn-secondary"
                    onClick={() => svgFileRef.current?.click()}>
                    📁 Upload SVG / PNG / JPEG
                  </button>
                  {(brandingForm.logoSvg || (brandingForm.logoUrl || '').startsWith('data:')) && (
                    <button type="button" className="btn btn-sm"
                      style={{ background: 'var(--danger,#dc3545)', color: '#fff', border: 'none' }}
                      onClick={() => setBrandingForm(f => ({ ...f, logoSvg: '', logoUrl: f.logoUrl?.startsWith('data:') ? '' : f.logoUrl }))}>
                      ✕ Clear
                    </button>
                  )}
                  <input ref={svgFileRef} type="file"
                    accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
                        reader.onload = ev => setBrandingForm(f => ({ ...f, logoSvg: ev.target.result || '', logoUrl: f.logoUrl?.startsWith('data:') ? '' : f.logoUrl }));
                        reader.readAsText(file);
                      } else {
                        reader.onload = ev => setBrandingForm(f => ({ ...f, logoUrl: ev.target.result || '', logoSvg: '' }));
                        reader.readAsDataURL(file);
                      }
                      e.target.value = '';
                    }} />
                </div>
                {/* Preview */}
                {(brandingForm.logoSvg || (brandingForm.logoUrl || '').startsWith('data:')) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)',
                    borderRadius: 6, padding: '8px 12px', marginBottom: 6, background: 'var(--bg-secondary,#f8f9fa)' }}>
                    {brandingForm.logoSvg ? (
                      <span title={brandingForm.companyName || 'Logo preview'}
                        style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        dangerouslySetInnerHTML={{ __html: brandingForm.logoSvg }} />
                    ) : (
                      <img src={brandingForm.logoUrl} alt={brandingForm.companyName || 'Logo preview'}
                        title={brandingForm.companyName}
                        style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Preview · {brandingForm.logoSvg ? `SVG ${brandingForm.logoSvg.length.toLocaleString()} chars` : 'raster image'}
                    </span>
                  </div>
                )}
                {brandingForm.logoSvg && (
                  <textarea className="form-input" rows={4} value={brandingForm.logoSvg}
                    placeholder="<svg …>…</svg> — or use upload button above"
                    style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                    onChange={e => setBrandingForm(f => ({ ...f, logoSvg: e.target.value }))} />
                )}
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 350 }}>
                  Supports SVG (inline), PNG and JPEG (stored as data URL). Logo URL field takes priority over upload.
                </span>
              </label>
              <label className="form-label" style={{ maxWidth: 180 }}>Primary Color
                <input className="form-input" type="color" value={brandingForm.primaryColor}
                  style={{ height: 40, padding: 4 }}
                  onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} />
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="submit" disabled={brandingSaving}>
                  {brandingSaving ? 'Saving…' : 'Save Branding'}
                </button>
                {brandingStatus === 'ok'           && <span className="form-status ok">✅ Branding saved</span>}
                {brandingStatus.startsWith('err:') && <span className="form-status err">❌ {brandingStatus.slice(4)}</span>}
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'appearance' && (
        <div className="settings-grid">
          <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title">🌗 Appearance</span>
              <span className="card-sub">Choose a colour theme for the dashboard. Your selection is saved in the browser.</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '8px 0 4px' }}>
              {[
                { id: 'dark',      label: 'Dark',      desc: 'Default dark theme',       bg: '#242424', card: '#2B2B2B', sidebar: '#171717', text: '#ffffff', accent: '#1492ff' },
                { id: 'midnight',  label: 'Midnight',  desc: 'Deep navy / GitHub dark',  bg: '#0d1117', card: '#161b22', sidebar: '#010409', text: '#e6edf3', accent: '#58a6ff' },
                { id: 'oled',      label: 'OLED Black',desc: 'Pure black, max contrast', bg: '#000000', card: '#0d0d0d', sidebar: '#000000', text: '#ffffff', accent: '#1492ff' },
                { id: 'charcoal',  label: 'Charcoal',  desc: 'VS Code inspired grey',    bg: '#1e1e1e', card: '#252526', sidebar: '#141414', text: '#d4d4d4', accent: '#569cd6' },
                { id: 'light',     label: 'Light',     desc: 'Clean light mode',         bg: '#f0f2f5', card: '#ffffff', sidebar: '#ffffff', text: '#111827', accent: '#0072db' },
              ].map(t => {
                const active = theme === t.id;
                return (
                  <button key={t.id} onClick={() => setTheme(t.id)}
                    style={{
                      position: 'relative', cursor: 'pointer', padding: 0, border: 'none',
                      background: 'transparent', textAlign: 'left', width: 160,
                    }}>
                    <div style={{
                      borderRadius: 6, overflow: 'hidden',
                      border: active ? `2px solid ${t.accent}` : '2px solid var(--border)',
                      boxShadow: active ? `0 0 0 2px ${t.accent}44` : 'none',
                      transition: 'border 0.15s, box-shadow 0.15s',
                    }}>
                      <div style={{ display: 'flex', height: 90, background: t.bg }}>
                        <div style={{ width: 28, background: t.sidebar, borderRight: `1px solid ${t.text}11`, display: 'flex', flexDirection: 'column', padding: '6px 4px', gap: 4 }}>
                          {[t.accent, `${t.text}44`, `${t.text}44`, `${t.text}44`].map((c, i) => (
                            <div key={i} style={{ height: 5, borderRadius: 2, background: c }} />
                          ))}
                        </div>
                        <div style={{ flex: 1, padding: '6px 7px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ height: 7, width: '60%', borderRadius: 2, background: `${t.text}88` }} />
                          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                            {[t.accent, '#068443', '#eb3f3f', '#ff7f0f'].map((c, i) => (
                              <div key={i} style={{ flex: 1, height: 22, borderRadius: 3, background: t.card, border: `1px solid ${t.text}18`, display: 'flex', alignItems: 'flex-end', padding: '2px 3px' }}>
                                <div style={{ width: '100%', height: `${40 + i * 15}%`, background: c + 'cc', borderRadius: 1 }} />
                              </div>
                            ))}
                          </div>
                          <div style={{ height: 5, width: '80%', borderRadius: 2, background: `${t.text}22` }} />
                          <div style={{ height: 5, width: '55%', borderRadius: 2, background: `${t.text}16` }} />
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, paddingLeft: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--text)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {active && <span style={{ color: t.accent, fontSize: 10 }}>●</span>}
                        {t.label}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{t.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 4, fontSize: 12, color: 'var(--muted)' }}>
              ✅ Theme applies instantly and is remembered across sessions via <code style={{ background: 'var(--bg)', padding: '1px 4px', borderRadius: 3 }}>localStorage</code>.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'rag' && (
        <div className="settings-grid">
          <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title">🚦 RAG Thresholds</span>
              <span className="card-sub">Configure Red/Amber/Green boundaries for health indicators</span>
            </div>
            <form className="settings-form" onSubmit={saveRag}>
              <table className="data-table" style={{ marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ color: 'var(--success)' }}>Green threshold</th>
                    <th style={{ color: 'var(--caution)' }}>Amber threshold</th>
                    <th style={{ fontSize: 11, color: 'var(--text-muted)' }}>Direction</th>
                  </tr>
                </thead>
                <tbody>
                  <RagRow label="Done Rate"       metric="doneRate"      form={ragForm} onChange={setRagField} unit="%" direction="≥ is better" />
                  <RagRow label="Resolve Rate"    metric="resolveRate"   form={ragForm} onChange={setRagField} unit="%" direction="≥ is better" />
                  <RagRow label="Escape Ratio"    metric="escapeRatio"   form={ragForm} onChange={setRagField} unit="%" direction="≤ is better" />
                  <RagRow label="Defect Density"  metric="defectDensity" form={ragForm} onChange={setRagField} unit=""  direction="≤ is better" />
                  <RagRow label="Health Score"    metric="healthScore"   form={ragForm} onChange={setRagField} unit=""  direction="≥ is better" />
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary" type="submit" disabled={ragSaving}>
                  {ragSaving ? 'Saving…' : 'Save RAG Thresholds'}
                </button>
                {ragStatus === 'ok'           && <span className="form-status ok">✅ Saved</span>}
                {ragStatus.startsWith('err:') && <span className="form-status err">❌ {ragStatus.slice(4)}</span>}
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'fieldMappings' && (
        <div className="settings-grid">
          <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title">🧭 TFS Field Mappings</span>
              <span className="card-sub">Configure work item names, custom field references, state values, and PI structure.</span>
            </div>
            <form className="settings-form" onSubmit={saveFieldMappings}>
              <FieldMappingsSectionBlock
                title="1. Work Item Types"
                info="These names drive WIQL queries across dashboard, velocity, objectives, risks, and PI delivery routes."
                open={fieldMappingsSections.workItemTypes}
                onToggle={() => toggleFieldMappingsSection('workItemTypes')}
              >
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Purpose</th>
                      <th>Description</th>
                      <th>TFS Work Item Type Name</th>
                      <th style={{ width: 220 }}>Impacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WORK_ITEM_TYPE_ROWS.map(row => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</td>
                        <td>
                          <input
                            className="form-input"
                            type="text"
                            value={fieldMappingsForm.workItemTypes[row.key]}
                            onChange={e => setFieldMappingValue('workItemTypes', row.key, e.target.value)}
                          />
                        </td>
                        <td><ImpactBadges impacts={row.impacts} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </FieldMappingsSectionBlock>

              <FieldMappingsSectionBlock
                title="2. Custom Field Names"
                info="Use TFS reference names here if your process template differs from the dashboard defaults."
                open={fieldMappingsSections.fields}
                onToggle={() => toggleFieldMappingsSection('fields')}
              >
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Description</th>
                      <th>TFS Field Reference Name</th>
                      <th style={{ width: 220 }}>Impacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CUSTOM_FIELD_ROWS.map(row => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</td>
                        <td>
                          <input
                            className="form-input"
                            type="text"
                            value={fieldMappingsForm.fields[row.key]}
                            onChange={e => setFieldMappingValue('fields', row.key, e.target.value)}
                          />
                        </td>
                        <td><ImpactBadges impacts={row.impacts} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </FieldMappingsSectionBlock>

              <FieldMappingsSectionBlock
                title="3. State Values"
                info="These values control done, removed, WIP, defect closed, and escape-ratio calculations throughout the dashboard."
                open={fieldMappingsSections.stateValues}
                onToggle={() => toggleFieldMappingsSection('stateValues')}
              >
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>State Mapping</th>
                      <th>Description</th>
                      <th>Configured Value</th>
                      <th style={{ width: 220 }}>Impacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STATE_VALUE_ROWS.map(row => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</td>
                        <td>
                          <input
                            className="form-input"
                            type="text"
                            value={fieldMappingsForm.stateValues[row.key]}
                            onChange={e => setFieldMappingValue('stateValues', row.key, e.target.value)}
                          />
                        </td>
                        <td><ImpactBadges impacts={row.impacts} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </FieldMappingsSectionBlock>

              <FieldMappingsSectionBlock
                title="4. PI Structure"
                info="Sprint labels are used in PI delivery and velocity views. PI naming fields are stored for future helpers and admin workflows."
                open={fieldMappingsSections.piStructure}
                onToggle={() => toggleFieldMappingsSection('piStructure')}
              >
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Description</th>
                      <th>Value</th>
                      <th style={{ width: 220 }}>Impacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Sprint Labels</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>Comma-separated sprint labels within a PI</td>
                      <td>
                        <input
                          className="form-input"
                          type="text"
                          value={fieldMappingsForm.piStructure.sprintLabels}
                          placeholder="S1, S2, S3, IP"
                          onChange={e => setFieldMappingValue('piStructure', 'sprintLabels', e.target.value)}
                        />
                      </td>
                      <td><ImpactBadges impacts={['PI Delivery', 'Velocity', 'Sprint', 'Defects']} /></td>
                    </tr>
                    <tr>
                      <td>PIs Per Year</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>Number of PIs per year</td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          min="1"
                          value={fieldMappingsForm.piStructure.pisPerYear}
                          onChange={e => setFieldMappingValue('piStructure', 'pisPerYear', e.target.value)}
                        />
                      </td>
                      <td><ImpactBadges impacts={['Dashboard', 'Compare', 'Roadmap', 'PI Delivery', 'Velocity']} /></td>
                    </tr>
                    <tr>
                      <td>PI Naming Pattern</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pattern for PI names: {'{yy}'}=2-digit year, {'{n}'}=PI number</td>
                      <td>
                        <input
                          className="form-input"
                          type="text"
                          value={fieldMappingsForm.piStructure.piNamingPattern}
                          onChange={e => setFieldMappingValue('piStructure', 'piNamingPattern', e.target.value)}
                        />
                      </td>
                      <td><ImpactBadges impacts={['Dashboard', 'Compare', 'Roadmap', 'PI Delivery', 'Velocity']} /></td>
                    </tr>
                    <tr>
                      <td>Hours per Man-Day</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>Working hours counted per day for capacity conversion (capacity hours ÷ this = man-days)</td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          min="1"
                          max="24"
                          value={fieldMappingsForm.piStructure.hoursPerPoint}
                          onChange={e => setFieldMappingValue('piStructure', 'hoursPerPoint', e.target.value)}
                        />
                      </td>
                      <td><ImpactBadges impacts={['Velocity', 'Team Summary', 'PI Delivery']} /></td>
                    </tr>
                  </tbody>
                </table>
              </FieldMappingsSectionBlock>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="submit" disabled={fieldMappingsSaving}>
                  {fieldMappingsSaving ? 'Saving…' : 'Save Field Mappings'}
                </button>
                {fieldMappingsStatus === 'ok'           && <span className="form-status ok">✅ Field mappings saved</span>}
                {fieldMappingsStatus.startsWith('err:') && <span className="form-status err">❌ {fieldMappingsStatus.slice(4)}</span>}
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'kpiConfig' && (
        <KpiConfigTab cfg={cfg} queryClient={queryClient} />
      )}

      {activeTab === 'notifications' && (
        <div className="settings-grid">
          <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title">🔔 Notifications</span>
              <span className="card-sub">Configure webhook alerts, anomaly notifications, and the weekly digest</span>
            </div>
            <form className="settings-form" onSubmit={saveNotifications}>

              {/* ── Webhook ── */}
              <div className="form-section-hd">Webhook</div>
              <div className="form-row">
                <label className="form-label" style={{ flex: 1 }}>Webhook URL
                  <input
                    className="form-input"
                    type="password"
                    value={notificationsForm.webhookUrl}
                    placeholder={cfg?.notifications?.webhookUrl ? '*** (set — leave blank to keep)' : 'https://...'}
                    autoComplete="new-password"
                    onChange={e => setNotificationsForm(f => ({ ...f, webhookUrl: e.target.value }))}
                  />
                </label>
                <label className="form-label" style={{ width: 160 }}>Webhook Type
                  <select className="form-input" value={notificationsForm.webhookType} onChange={e => setNotificationsForm(f => ({ ...f, webhookType: e.target.value }))}>
                    <option value="teams">Microsoft Teams</option>
                    <option value="slack">Slack</option>
                  </select>
                </label>
                <div className="form-label" style={{ width: 160, justifyContent: 'flex-end' }}>
                  <span style={{ marginBottom: 8 }}>Enable notifications</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <input type="checkbox" checked={Boolean(notificationsForm.enabled)}
                      onChange={e => setNotificationsForm(f => ({ ...f, enabled: e.target.checked }))} />
                    {notificationsForm.enabled ? 'Enabled' : 'Disabled'}
                  </label>
                </div>
              </div>

              {/* ── Digest Schedule ── */}
              <div className="form-section-hd">Digest Schedule</div>
              <div className="form-row">
                <label className="form-label" style={{ width: 180 }}>Day of week
                  <select className="form-input"
                    value={notificationsForm.digestSchedule?.day || 'monday'}
                    onChange={e => setNotificationsForm(f => ({ ...f, digestSchedule: { ...f.digestSchedule, day: e.target.value } }))}>
                    {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label" style={{ width: 120 }}>Hour (24h)
                  <input className="form-input" type="number" min={0} max={23}
                    value={notificationsForm.digestSchedule?.hour ?? 9}
                    onChange={e => setNotificationsForm(f => ({ ...f, digestSchedule: { ...f.digestSchedule, hour: Number(e.target.value) } }))} />
                </label>
                <label className="form-label" style={{ width: 120 }}>Minute
                  <select className="form-input"
                    value={notificationsForm.digestSchedule?.minute ?? 0}
                    onChange={e => setNotificationsForm(f => ({ ...f, digestSchedule: { ...f.digestSchedule, minute: Number(e.target.value) } }))}>
                    {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                  </select>
                </label>
                <div className="form-label" style={{ flex: 1, justifyContent: 'flex-end', fontSize: 12, color: 'var(--muted)' }}>
                  <span>Current schedule:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {(notificationsForm.digestSchedule?.day || 'monday').charAt(0).toUpperCase() +
                     (notificationsForm.digestSchedule?.day || 'monday').slice(1)}&nbsp;
                    {String(notificationsForm.digestSchedule?.hour ?? 9).padStart(2,'0')}:
                    {String(notificationsForm.digestSchedule?.minute ?? 0).padStart(2,'0')}
                    &nbsp;(server time)
                  </span>
                </div>
              </div>

              {/* ── Digest Sections ── */}
              <div className="form-section-hd">Digest Sections</div>
              <div className="form-row" style={{ flexWrap: 'wrap', gap: 12 }}>
                {[
                  { key: 'delivery',      label: '📦 Delivery' },
                  { key: 'quality',       label: '🐛 Quality' },
                  { key: 'teamBreakdown', label: '👥 Team Breakdown' },
                  { key: 'piReadiness',   label: '🔍 PI Readiness' },
                  { key: 'changes',       label: '📅 Changes This Week' },
                  { key: 'forecast',      label: '🔮 Forecast' },
                  { key: 'velocity',      label: '⚡ Velocity' },
                  { key: 'risks',    label: '⚠️ Risks' },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={Boolean(notificationsForm.digestSections?.[key])}
                      onChange={e => setNotificationsForm(f => ({ ...f, digestSections: { ...f.digestSections, [key]: e.target.checked } }))} />
                    {label}
                  </label>
                ))}
              </div>

              {/* ── Forecast Percentiles ── */}
              {notificationsForm.digestSections?.forecast && (
                <>
                  <div className="form-section-hd">Forecast Percentiles</div>
                  <div className="form-row" style={{ flexWrap: 'wrap', gap: 12 }}>
                    {['p50', 'p85', 'p95'].map(p => (
                      <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox"
                          checked={(notificationsForm.forecastPercentiles || ['p50']).includes(p)}
                          onChange={e => {
                            const cur = notificationsForm.forecastPercentiles || ['p50'];
                            setNotificationsForm(f => ({
                              ...f,
                              forecastPercentiles: e.target.checked ? [...new Set([...cur, p])] : cur.filter(x => x !== p)
                            }));
                          }} />
                        {p.toUpperCase()} {p === 'p50' ? '(median)' : p === 'p85' ? '(likely)' : '(safe)'}
                      </label>
                    ))}
                  </div>
                </>
              )}

              {/* ── Anomaly Alerts ── */}
              <div className="form-section-hd">Anomaly Alerts</div>
              <div className="form-row" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                <label className="form-label" style={{ width: 180 }}>Threshold (z-score)
                  <input className="form-input" type="number" step="0.1" min="0.5"
                    value={notificationsForm.anomalyThreshold}
                    onChange={e => setNotificationsForm(f => ({ ...f, anomalyThreshold: e.target.value }))} />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Lower = more sensitive</span>
                </label>
                <div className="form-label" style={{ flex: 1 }}>
                  <span style={{ marginBottom: 8 }}>Enable anomaly push alerts</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 10 }}>
                    <input type="checkbox"
                      checked={Boolean(notificationsForm.anomalyAlerts?.enabled)}
                      onChange={e => setNotificationsForm(f => ({ ...f, anomalyAlerts: { ...f.anomalyAlerts, enabled: e.target.checked } }))} />
                    {notificationsForm.anomalyAlerts?.enabled ? 'Enabled' : 'Disabled'}
                  </label>
                  <span style={{ marginBottom: 6 }}>Metrics to watch:</span>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {[
                      { key: 'doneRate',     label: 'Done Rate' },
                      { key: 'defectCount',  label: 'Defect Count' },
                      { key: 'velocity',     label: 'Velocity' },
                    ].map(({ key, label }) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox"
                          checked={(notificationsForm.anomalyAlerts?.metrics || []).includes(key)}
                          onChange={e => {
                            const cur = notificationsForm.anomalyAlerts?.metrics || [];
                            setNotificationsForm(f => ({
                              ...f,
                              anomalyAlerts: {
                                ...f.anomalyAlerts,
                                metrics: e.target.checked ? [...new Set([...cur, key])] : cur.filter(x => x !== key)
                              }
                            }));
                          }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Customise Message ── */}
              <div className="form-section-hd">Customise Message</div>
              <div className="form-row">
                <label className="form-label" style={{ flex: 1 }}>Digest Title
                  <input className="form-input" type="text"
                    placeholder="📊 Weekly PI Health Digest — {date} (default)"
                    value={notificationsForm.digestTitle}
                    onChange={e => setNotificationsForm(f => ({ ...f, digestTitle: e.target.value }))} />
                </label>
                <label className="form-label" style={{ flex: 1 }}>Footer Text
                  <input className="form-input" type="text"
                    placeholder="AV Dashboard automated digest (default)"
                    value={notificationsForm.digestFooter}
                    onChange={e => setNotificationsForm(f => ({ ...f, digestFooter: e.target.value }))} />
                </label>
              </div>

              {/* ── Alert Routing ── */}
              <div className="form-section-hd">Alert Routing</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                Separate webhook for anomaly/threshold alerts. Leave blank to use the primary webhook.
              </div>
              <div className="form-row">
                <label className="form-label" style={{ flex: 1 }}>Alert Webhook URL
                  <input
                    className="form-input" type="password"
                    value={notificationsForm.alertWebhookUrl}
                    placeholder={cfg?.notifications?.alertWebhookUrl ? '*** (set — leave blank to keep)' : 'https://... (optional, falls back to primary)'}
                    autoComplete="new-password"
                    onChange={e => setNotificationsForm(f => ({ ...f, alertWebhookUrl: e.target.value }))}
                  />
                </label>
                <label className="form-label" style={{ width: 160 }}>Alert Webhook Type
                  <select className="form-input"
                    value={notificationsForm.alertWebhookType}
                    onChange={e => setNotificationsForm(f => ({ ...f, alertWebhookType: e.target.value }))}>
                    <option value="teams">Microsoft Teams</option>
                    <option value="slack">Slack</option>
                  </select>
                </label>
              </div>

              {/* ── Threshold Alerts ── */}
              <div className="form-section-hd">Threshold Alerts</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                Fire an alert when a metric crosses an absolute value. Checked daily at 08:00 (server time).
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(notificationsForm.thresholdAlerts || []).map((rule, i) => (
                  <div key={rule.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                      <input type="checkbox" checked={Boolean(rule.enabled)}
                        onChange={e => setNotificationsForm(f => ({
                          ...f,
                          thresholdAlerts: (f.thresholdAlerts || []).map((r, j) => j === i ? { ...r, enabled: e.target.checked } : r)
                        }))} />
                    </label>
                    <select className="form-input" style={{ width: 160, fontSize: 12 }} value={rule.metric}
                      onChange={e => setNotificationsForm(f => ({ ...f, thresholdAlerts: (f.thresholdAlerts || []).map((r, j) => j === i ? { ...r, metric: e.target.value } : r) }))}>
                      <option value="doneRate">Done Rate (%)</option>
                      <option value="defectCount">Open Defects</option>
                      <option value="p1p2Count">P1/P2 Count</option>
                      <option value="velocity">Avg Velocity</option>
                      <option value="remainingItems">Remaining Items</option>
                    </select>
                    <select className="form-input" style={{ width: 70, fontSize: 12 }} value={rule.operator}
                      onChange={e => setNotificationsForm(f => ({ ...f, thresholdAlerts: (f.thresholdAlerts || []).map((r, j) => j === i ? { ...r, operator: e.target.value } : r) }))}>
                      <option value="<">&lt;</option>
                      <option value=">">&gt;</option>
                      <option value="<=">&le;</option>
                      <option value=">=">&ge;</option>
                    </select>
                    <input className="form-input" type="number" style={{ width: 80, fontSize: 12 }} value={rule.value}
                      onChange={e => setNotificationsForm(f => ({ ...f, thresholdAlerts: (f.thresholdAlerts || []).map((r, j) => j === i ? { ...r, value: Number(e.target.value) } : r) }))} />
                    <input className="form-input" type="text" style={{ flex: 1, minWidth: 120, fontSize: 12 }} placeholder="Custom message (optional)"
                      value={rule.message || ''}
                      onChange={e => setNotificationsForm(f => ({ ...f, thresholdAlerts: (f.thresholdAlerts || []).map((r, j) => j === i ? { ...r, message: e.target.value } : r) }))} />
                    <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => setNotificationsForm(f => ({ ...f, thresholdAlerts: (f.thresholdAlerts || []).filter((_, j) => j !== i) }))}>
                      ✕
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => setNotificationsForm(f => ({
                      ...f,
                      thresholdAlerts: [...(f.thresholdAlerts || []), { id: `t${Date.now()}`, metric: 'doneRate', operator: '<', value: 40, enabled: true, message: '' }]
                    }))}>
                    + Add Rule
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={checkThresholdsNow} disabled={thresholdLoading}>
                    {thresholdLoading ? 'Checking…' : 'Check Now'}
                  </button>
                  {thresholdStatus.startsWith('ok:') && <span className="form-status ok">✅ {thresholdStatus.slice(3)}</span>}
                  {thresholdStatus.startsWith('err:') && <span className="form-status err">❌ {thresholdStatus.slice(4)}</span>}
                </div>
              </div>

              {/* ── Notification History ── */}
              <div className="form-section-hd">Notification History</div>
              {historyLoading ? (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
              ) : historyData.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>No notifications sent yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', textAlign: 'left' }}>
                        <th style={{ padding: '4px 8px' }}>When</th>
                        <th style={{ padding: '4px 8px' }}>Type</th>
                        <th style={{ padding: '4px 8px' }}>Target</th>
                        <th style={{ padding: '4px 8px' }}>Status</th>
                        <th style={{ padding: '4px 8px' }}>Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.slice(0, 10).map(entry => (
                        <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 8px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {new Date(entry.sentAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <span style={{ background: entry.type === 'digest' ? 'rgba(20,146,255,.15)' : entry.type.includes('alert') ? 'rgba(255,60,60,.15)' : 'rgba(100,100,100,.15)', color: entry.type === 'digest' ? 'var(--primary-light)' : entry.type.includes('alert') ? 'var(--danger)' : 'var(--muted)', padding: '2px 6px', borderRadius: 0, fontSize: 11, fontWeight: 700 }}>
                              {entry.type}
                            </span>
                          </td>
                          <td style={{ padding: '4px 8px', textTransform: 'uppercase', fontSize: 11 }}>{entry.target || '—'}</td>
                          <td style={{ padding: '4px 8px', color: entry.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
                            {entry.status === 'ok' ? '✅' : '❌'}
                          </td>
                          <td style={{ padding: '4px 8px', color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.summary || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Actions ── */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                <button className="btn btn-primary" type="submit" disabled={notificationsSaving}>
                  {notificationsSaving ? 'Saving…' : 'Save Notifications'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={sendTestNotification} disabled={notificationTestLoading}>
                  {notificationTestLoading ? 'Sending…' : '🧪 Send Test'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={sendDigestNow} disabled={digestLoading}>
                  {digestLoading ? 'Sending…' : '📤 Send Digest Now'}
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                <span>{notificationMeta.configured ? '✅ Webhook configured' : '⚠️ Webhook not configured'}</span>
                <span>Type: {(notificationMeta.webhookType || notificationsForm.webhookType || 'teams').toUpperCase()}</span>
                {notificationMeta.lastDigestSentAt && <span>Last sent: {new Date(notificationMeta.lastDigestSentAt).toLocaleString()}</span>}
              </div>
              {notificationsStatus === 'ok' && <span className="form-status ok">✅ Notifications saved</span>}
              {notificationsStatus.startsWith('err:') && <span className="form-status err">❌ {notificationsStatus.slice(4)}</span>}
              {notificationTestStatus === 'ok' && <span className="form-status ok">✅ Test notification sent</span>}
              {notificationTestStatus.startsWith('err:') && <span className="form-status err">❌ {notificationTestStatus.slice(4)}</span>}
              {digestStatus === 'ok' && <span className="form-status ok">✅ Digest sent</span>}
              {digestStatus.startsWith('err:') && <span className="form-status err">❌ {digestStatus.slice(4)}</span>}
            </form>
          </div>
        </div>
      )}

      {activeTab === 'advanced' && (
        <div className="settings-grid">
          <div className="card settings-card">
            <div className="card-header"><span className="card-title">Advanced</span></div>
            <form className="settings-form" onSubmit={saveAdv}>
              <label className="form-label">Programme Start Year
                <input className="form-input" type="number" value={advForm.programmeStartYear}
                  min={2000} max={2100}
                  onChange={e => setAdvForm(f => ({ ...f, programmeStartYear: e.target.value }))} />
              </label>
              <label className="form-label">Refresh Interval (minutes)
                <input className="form-input" type="number" value={advForm.refreshIntervalMinutes}
                  min={1} max={120}
                  onChange={e => setAdvForm(f => ({ ...f, refreshIntervalMinutes: e.target.value }))} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={advSaving}>
                {advSaving ? 'Saving…' : 'Save Advanced Settings'}
              </button>
              {advStatus === 'ok'           && <span className="form-status ok">✅ Saved</span>}
              {advStatus.startsWith('err:') && <span className="form-status err">❌ {advStatus.slice(4)}</span>}
            </form>
          </div>
        </div>
      )}

      {activeTab === 'azuread' && (
        <div>
          <h2 style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Azure AD / Entra ID</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 20 }}>
            Configure Single Sign-On via Azure Active Directory. Leave blank to run in admin-only setup mode.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
            {[
              { key: 'tenantId', label: 'Tenant ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
              { key: 'clientId', label: 'Client ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
              { key: 'clientSecret', label: 'Client Secret', placeholder: '(enter to change)', type: 'password' },
              { key: 'redirectUrl', label: 'Redirect URL', placeholder: 'http://localhost:3000/api/auth/callback' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
                <input
                  type={type || 'text'}
                  value={azureAd[key] || ''}
                  onChange={e => setAzureAd(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  style={{ width: '100%', background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(20,146,255,.08)', border: '1px solid #1492ff44', fontSize: 12, color: 'var(--muted)', maxWidth: 520 }}>
            💡 In Azure AD app registration: set Redirect URI to the value above, enable <strong>ID tokens</strong> and <strong>Access tokens</strong>, add API permissions: <em>GroupMember.Read.All</em> (delegated).
          </div>
          <button onClick={saveAzureAd} style={{ marginTop: 16, background: '#1492ff', color: '#fff', border: 'none', padding: '8px 20px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            Save Azure AD Settings
          </button>
        </div>
      )}

      {activeTab === 'roleMappings' && (
        <div>
          <h2 style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Role Mappings</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 20 }}>
            Map Azure AD groups (or email addresses) to dashboard roles. First matching rule wins.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 700 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Match Type', 'Value (Group Name / Group ID / Email / Domain)', 'Role', ''].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--muted)', fontSize: 11, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roleMappings.map((m, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <select value={Object.keys(m).find(k => k !== 'role') || 'groupName'}
                      onChange={e => {
                        const type = e.target.value;
                        const oldVal = m.groupName || m.groupId || m.email || m.domain || '';
                        setRoleMappings(prev => prev.map((x, idx) => idx === i ? { [type]: oldVal, role: x.role } : x));
                      }}
                      style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '4px 6px', fontSize: 12 }}>
                      <option value="groupName">Group Name</option>
                      <option value="groupId">Group ID</option>
                      <option value="email">Email</option>
                      <option value="domain">Domain</option>
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input value={m.groupName || m.groupId || m.email || m.domain || ''}
                      onChange={e => {
                        const type = Object.keys(m).find(k => k !== 'role') || 'groupName';
                        setRoleMappings(prev => prev.map((x, idx) => idx === i ? { [type]: e.target.value, role: x.role } : x));
                      }}
                      style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '4px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' }} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <select value={m.role || 'all'}
                      onChange={e => setRoleMappings(prev => prev.map((x, idx) => idx === i ? { ...x, role: e.target.value } : x))}
                      style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '4px 6px', fontSize: 12 }}>
                      {[
                        { id: 'admin', label: 'admin' },
                        { id: 'all',   label: 'all'   },
                        { id: 'exec',  label: 'exec'  },
                        { id: 'rte',   label: 'rte'   },
                        { id: 'pm',    label: 'pm'    },
                        { id: 'sm',    label: 'sm'    },
                        ...(cfg?.roles?.custom || []).map(r => ({ id: r.id, label: r.label || r.id })),
                      ].map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <button onClick={() => setRoleMappings(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--danger, #eb3f3f)', padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => setRoleMappings(prev => [...prev, { groupName: '', role: 'all' }])}
              style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}>
              + Add Mapping
            </button>
            <button onClick={saveRoleMappings}
              style={{ background: '#1492ff', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              Save Role Mappings
            </button>
          </div>
          <div style={{ marginTop: 20 }}>
            <label style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>Admin Roles (comma-separated)</label>
            <input value={adminRoles.join(', ')}
              onChange={e => setAdminRoles(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              placeholder="admin"
              style={{ display: 'block', marginTop: 6, width: '100%', maxWidth: 360, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>Roles that have access to Settings and admin functions.</div>
          </div>
        </div>
      )}

      {activeTab === 'tfsUsers' && (
        <TfsUsersTab cfg={cfg} queryClient={queryClient} />
      )}

      {activeTab === 'members' && (
        <MembersTab deptId={activeDept?.id} isSuperAdmin={isSuperAdmin} currentUserKey={user?.authKey} />
      )}

      {activeTab === 'policies' && (
        <div>
          {/* ── Role CRUD ── */}
          <div className="card settings-card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <span className="card-title">👥 Role Management</span>
              <span className="card-sub">Create custom roles or override built-in roles. Use Visibility Policies below to control section, tab, and chart access.</span>
            </div>
            <RolesManager />
          </div>

          {/* ── Visibility Policies ── */}
          {(() => {
            const ROLE_META = { all: { label: 'All', icon: '🔓' }, exec: { label: 'Exec', icon: '👔' }, rte: { label: 'RTE', icon: '🚂' }, pm: { label: 'PM', icon: '📋' }, sm: { label: 'SM', icon: '🏃' }, admin: { label: 'Admin', icon: '🛠' } };
            (cfg?.roles?.custom || []).forEach(r => {
              if (r.id && !ROLE_META[r.id]) ROLE_META[r.id] = { label: r.label || r.id, icon: r.icon || '👤' };
            });
            const roles = Object.keys(ROLE_META);
            const BUILT_IN_ROLE_IDS = new Set(['all', 'exec', 'rte', 'pm', 'sm', 'admin']);
            const ALL_HIDDEN = { hiddenPages: POLICY_SCHEMA.map(p => p.id), hiddenTabs: [], hiddenCharts: [] };
            const defaultPolicy = (roleId) => BUILT_IN_ROLE_IDS.has(roleId)
              ? { hiddenPages: [], hiddenTabs: [], hiddenCharts: [] }
              : ALL_HIDDEN;
            const rp = policies[selectedPolicyRole] ?? defaultPolicy(selectedPolicyRole);

            const isHiddenPage  = (pid)       => (rp.hiddenPages  || []).includes(pid);
            const isHiddenTab   = (pid, tid)  => (rp.hiddenTabs   || []).includes(`${pid}.${tid}`);
            const isHiddenChart = (pid, cid)  => (rp.hiddenCharts || []).includes(`${pid}.${cid}`);

            function toggle(type, key) {
              const cur = [...(rp[type] || [])];
              const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
              setPoliciesState(prev => ({ ...prev, [selectedPolicyRole]: { ...rp, [type]: next } }));
            }

            const visibleCount = POLICY_SCHEMA.filter(p => !isHiddenPage(p.id)).length;

            const Chip = ({ label, visible, onClick, accent }) => (
              <button type="button" onClick={onClick} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 0,
                border: `1px solid ${visible ? (accent || 'var(--primary)') : 'var(--border)'}`,
                background: visible ? (accent ? accent + '22' : 'rgba(20,146,255,.15)') : 'transparent',
                color: visible ? (accent || 'var(--primary-light)') : 'var(--muted)',
                transition: 'all .12s',
              }}>
                {visible ? '✓' : '○'} {label}
              </button>
            );

            return (
              <>
                {/* ── Header ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>Visibility Policies</h2>
                    <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
                      Control which sections, tabs, and charts each role can see. Changes take effect after saving.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {policySaveStatus === 'ok' && <span style={{ color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>✅ Saved</span>}
                    {policySaveStatus.startsWith('err:') && <span style={{ color: 'var(--danger)', fontSize: 12 }}>❌ {policySaveStatus.slice(4)}</span>}
                    <button onClick={savePolicies} className="btn btn-primary" style={{ fontSize: 13 }}>Save Policies</button>
                  </div>
                </div>

                {/* ── Role selector ── */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  {roles.map(r => {
                    const m = ROLE_META[r] || { label: r, icon: '👤' };
                    const active = selectedPolicyRole === r;
                    const rRp = policies[r] ?? defaultPolicy(r);
                    const vis = POLICY_SCHEMA.filter(p => !(rRp.hiddenPages || []).includes(p.id)).length;
                    return (
                      <button key={r} type="button"
                        onClick={() => { setSelectedPolicyRole(r); setExpandedPolicyPage(null); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                          fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          border: `2px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                          background: active ? 'rgba(20,146,255,.15)' : 'var(--bg-card)',
                          color: active ? 'var(--primary-light)' : 'var(--muted)',
                          borderRadius: 0, transition: 'all .12s',
                        }}>
                        <span style={{ fontSize: 16 }}>{m.icon}</span>
                        <span>{m.label}</span>
                        <span style={{
                          background: active ? 'rgba(20,146,255,.3)' : 'var(--bg-card2)',
                          color: active ? 'var(--primary-light)' : 'var(--muted)',
                          borderRadius: 0, fontSize: 10, fontWeight: 700, padding: '1px 7px',
                        }}>{vis}/{POLICY_SCHEMA.length}</span>
                      </button>
                    );
                  })}
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 16 }}>
                  {visibleCount} of {POLICY_SCHEMA.length} sections visible for <strong style={{ color: 'var(--text)' }}>{ROLE_META[selectedPolicyRole]?.label}</strong> role
                </p>

                {/* ── Section cards ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
                  {POLICY_SCHEMA.map(page => {
                    const hidden  = isHiddenPage(page.id);
                    const expanded = expandedPolicyPage === page.id;
                    const tabCount   = page.tabs?.length   || 0;
                    const chartCount = page.charts?.length || 0;
                    const hiddenTabCount   = page.tabs?.filter(t  => isHiddenTab(page.id, t.id)).length   || 0;
                    const hiddenChartCount = page.charts?.filter(c => isHiddenChart(page.id, c.id)).length || 0;

                    return (
                      <div key={page.id} style={{
                        border: `1px solid ${hidden ? 'rgba(235,63,63,.3)' : 'var(--border)'}`,
                        borderRadius: 0, overflow: 'hidden',
                        background: hidden ? 'rgba(235,63,63,.04)' : 'var(--bg-card)',
                        opacity: hidden ? 0.7 : 1, transition: 'all .15s',
                      }}>
                        {/* Card header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                          <span style={{ fontSize: 18 }}>{page.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: hidden ? 'var(--muted)' : 'var(--text)' }}>
                              {page.label}
                              {hidden && <span style={{ marginLeft: 8, fontSize: 10, color: '#eb3f3f', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Hidden</span>}
                            </div>
                            {!hidden && (tabCount > 0 || chartCount > 0) && (
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                                {tabCount > 0 && <span style={{ marginRight: 10 }}>📑 {tabCount - hiddenTabCount}/{tabCount} tabs</span>}
                                {chartCount > 0 && <span>📊 {chartCount - hiddenChartCount}/{chartCount} charts</span>}
                              </div>
                            )}
                          </div>
                          {/* Visibility toggle */}
                          <button type="button" onClick={() => toggle('hiddenPages', page.id)}
                            style={{
                              padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                              border: `1px solid ${hidden ? 'rgba(235,63,63,.4)' : 'rgba(6,132,67,.4)'}`,
                              background: hidden ? 'rgba(235,63,63,.1)' : 'rgba(6,132,67,.1)',
                              color: hidden ? '#eb3f3f' : '#068443',
                              borderRadius: 0, transition: 'all .12s', flexShrink: 0,
                            }}>
                            {hidden ? '⊘ Hidden' : '✓ Visible'}
                          </button>
                          {/* Expand if has tabs/charts */}
                          {!hidden && (tabCount > 0 || chartCount > 0) && (
                            <button type="button" onClick={() => setExpandedPolicyPage(expanded ? null : page.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}>
                              {expanded ? '▲' : '▼'}
                            </button>
                          )}
                        </div>

                        {/* Expanded: tabs + charts */}
                        {expanded && !hidden && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--bg-card2)' }}>
                            {tabCount > 0 && (
                              <div style={{ marginBottom: chartCount > 0 ? 10 : 0 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>📑 Tabs</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {page.tabs.map(t => (
                                    <Chip key={t.id} label={t.label}
                                      visible={!isHiddenTab(page.id, t.id)}
                                      onClick={() => toggle('hiddenTabs', `${page.id}.${t.id}`)}
                                      accent="#1492ff"
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                            {chartCount > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>📊 Charts & Cards</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {page.charts.map(c => (
                                    <Chip key={c.id} label={c.label}
                                      visible={!isHiddenChart(page.id, c.id)}
                                      onClick={() => toggle('hiddenCharts', `${page.id}.${c.id}`)}
                                      accent="#068443"
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
      </div>{/* settings-content */}
    </div>
  );
}

// ─── Members Tab (dept admin — manage users in this dept) ───────────────────

const BASE_MEMBER_ROLE_OPTIONS = [
  { value: 'exec',  label: 'Exec — executive view' },
  { value: 'rte',   label: 'RTE — release train engineer' },
  { value: 'pm',    label: 'PM — programme manager' },
  { value: 'sm',    label: 'SM — scrum master' },
  { value: 'all',   label: 'All — full dashboard access' },
  { value: 'admin', label: 'Admin — manage settings & members' },
];

function MembersTab({ deptId, isSuperAdmin, currentUserKey }) {
  const qc = useQueryClient();
  const customRoles = useStore(s => s.customRoles);
  const MEMBER_ROLE_OPTIONS = useMemo(() => [
    ...BASE_MEMBER_ROLE_OPTIONS,
    ...customRoles.map(r => ({ value: r.id, label: r.label || r.id })),
  ], [customRoles]);
  const [addKey,   setAddKey]   = useState('');
  const [addName,  setAddName]  = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole,  setAddRole]  = useState('exec');
  const [addErr,   setAddErr]   = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['dept-members', deptId],
    queryFn: () => apiFetch(`/api/d/${deptId}/members`),
    enabled: !!deptId,
  });

  const addMut = useMutation({
    mutationFn: () => apiFetch(`/api/d/${deptId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: addKey.trim(), displayName: addName.trim(), email: addEmail.trim(), role: addRole }),
    }),
    onSuccess: () => { setAddKey(''); setAddName(''); setAddEmail(''); setAddErr(''); qc.invalidateQueries({ queryKey: ['dept-members', deptId] }); },
    onError: e => setAddErr(e.message),
  });

  const roleMut = useMutation({
    mutationFn: ({ key, role }) => apiFetch(`/api/d/${deptId}/members/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dept-members', deptId] }),
  });

  const delMut = useMutation({
    mutationFn: (key) => apiFetch(`/api/d/${deptId}/members/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dept-members', deptId] }),
  });

  const members = data?.users || [];
  if (!deptId) return <p style={{ color: 'var(--text-muted)' }}>No active department.</p>;
  if (isLoading) return <p style={{ color: 'var(--text-muted)' }}>Loading members…</p>;
  if (error) return <p style={{ color: 'var(--danger)', padding: '8px 0', fontSize: 14 }}>Error: {error.message}</p>;

  return (
    <div>
      {/* Add member */}
      <div className="card settings-card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">➕ Add Member</span>
          <span className="card-sub">
            User key format: <code>tfs:user@domain.com</code> (TFS auth) or <code>aad:oid</code> (Azure AD).
            Display name &amp; email are optional — filled automatically on first login.
          </span>
        </div>
        <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">User Key *</label>
            <input className="form-input" style={{ width: 230 }} placeholder="tfs:user@domain.com"
              value={addKey} onChange={e => setAddKey(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Display Name</label>
            <input className="form-input" style={{ width: 150 }} placeholder="Jane Smith"
              value={addName} onChange={e => setAddName(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Email</label>
            <input className="form-input" style={{ width: 190 }} placeholder="jane@company.com"
              value={addEmail} onChange={e => setAddEmail(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Role</label>
            <select className="form-select" value={addRole} onChange={e => setAddRole(e.target.value)}>
              {MEMBER_ROLE_OPTIONS.filter(r => isSuperAdmin || r.value !== 'admin').map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => addMut.mutate()}
            disabled={!addKey.trim() || addMut.isPending}>
            {addMut.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addErr && <div className="card-body" style={{ paddingTop: 0, color: 'var(--danger)', fontSize: 13 }}>{addErr}</div>}
      </div>

      {/* Member list */}
      <div className="card settings-card">
        <div className="card-header">
          <span className="card-title">👥 Members ({members.length})</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {members.length === 0 ? (
            <p style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
              No members yet — add the first one above.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {['User', 'Key', 'Role', 'Last Login', ''].map(h => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: 'left', color: 'var(--text-muted)',
                      fontWeight: 500, borderBottom: '1px solid var(--border)', fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const isSelf = currentUserKey === m.key;
                  return (
                    <tr key={m.key} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ fontWeight: 500 }}>{m.displayName || m.key}</div>
                        {m.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.email}</div>}
                      </td>
                      <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: 12 }}>{m.key}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <select className="form-select" style={{ fontSize: 12, padding: '3px 8px' }}
                          value={m.role || 'read'}
                          disabled={isSelf || roleMut.isPending}
                          onChange={e => roleMut.mutate({ key: m.key, role: e.target.value })}>
                          {MEMBER_ROLE_OPTIONS.filter(r => isSuperAdmin || r.value !== 'admin').map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
                        {m.lastLogin ? new Date(m.lastLogin).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {isSelf
                          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>you</span>
                          : <button className="btn btn-danger" style={{ fontSize: 12, padding: '3px 10px' }}
                              onClick={() => delMut.mutate(m.key)} disabled={delMut.isPending}>
                              Remove
                            </button>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const IMPACT_COLORS = {
  'PI Delivery':    { bg: 'rgba(20,146,255,0.12)',  border: 'rgba(20,146,255,0.4)',  color: '#60aaff' },
  'Features':       { bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.4)',  color: '#b78bff' },
  'Sprint':         { bg: 'rgba(6,182,212,0.12)',   border: 'rgba(6,182,212,0.4)',   color: '#34d0e8' },
  'Velocity':       { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.4)',  color: '#fb923c' },
  'Executive':      { bg: 'rgba(234,179,8,0.12)',   border: 'rgba(234,179,8,0.4)',   color: '#fbbf24' },
  'Insights':       { bg: 'rgba(236,72,153,0.12)',  border: 'rgba(236,72,153,0.4)',  color: '#f472b6' },
  'Defects':        { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.4)',   color: '#f87171' },
  'Release Health': { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.4)',   color: '#4ade80' },
  'Risks':          { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.4)',  color: '#fcd34d' },
  'Test Coverage':  { bg: 'rgba(14,165,233,0.12)',  border: 'rgba(14,165,233,0.4)',  color: '#38bdf8' },
  'Roadmap':        { bg: 'rgba(168,85,247,0.12)',  border: 'rgba(168,85,247,0.4)',  color: '#c084fc' },
  'Compare':        { bg: 'rgba(20,184,166,0.12)',  border: 'rgba(20,184,166,0.4)',  color: '#2dd4bf' },
  'Dashboard':      { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.4)', color: '#94a3b8' },
};

function ImpactBadges({ impacts }) {
  if (!impacts?.length) return null;
  return (
    <div className="impact-badges">
      {impacts.map(p => {
        const c = IMPACT_COLORS[p] || { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.15)', color: 'var(--text-muted)' };
        return (
          <span key={p} className="impact-badge" style={{ background: c.bg, borderColor: c.border, color: c.color }}>
            {p}
          </span>
        );
      })}
    </div>
  );
}

function RagRow({ label, metric, form, onChange, unit, direction }) {
  const val = form[metric] || { green: 0, amber: 0 };
  return (
    <tr>
      <td>{label}</td>
      <td>
        <input type="number" className="form-input" style={{ width: 80 }}
          value={val.green}
          onChange={e => onChange(metric, 'green', e.target.value)} />
        {unit && <span style={{ marginLeft: 4 }}>{unit}</span>}
      </td>
      <td>
        <input type="number" className="form-input" style={{ width: 80 }}
          value={val.amber}
          onChange={e => onChange(metric, 'amber', e.target.value)} />
        {unit && <span style={{ marginLeft: 4 }}>{unit}</span>}
      </td>
      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{direction}</td>
    </tr>
  );
}

function FieldMappingsSectionBlock({ title, info, open, onToggle, children }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 0, overflow: 'hidden', background: 'var(--bg-card)' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 16px',
          border: 'none',
          background: 'var(--surface-2)',
          color: 'var(--text)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{info}</div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}
