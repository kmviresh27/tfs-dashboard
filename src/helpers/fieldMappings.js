'use strict';

const DEFAULTS = {
  workItemTypes: {
    feature:     'Feature',
    story:       'Story',
    defect:      'Defect',
    objective:   'Objective',
    risk:        'Risk',
    productRisk: 'Product Risk',
    testCase:    'Test Case',
    epic:        'Epic',
    task:        'Task',
  },
  fields: {
    effortField:                 'Microsoft.VSTS.Scheduling.Effort',
    storyPointsField:            'Microsoft.VSTS.Scheduling.StoryPoints',
    releaseField:                '',
    defectClassificationField:   '',
    defectProjectField:          '',
    howFoundField:               'Microsoft.VSTS.CMMI.HowFound',
    whereFoundField:             '',
    severityField:               'Microsoft.VSTS.Common.Severity',
    rankField:                   '',
    businessValueField:          'Microsoft.VSTS.Common.BusinessValue',
    foundInBuildField:           'Microsoft.VSTS.Build.FoundIn',
    resolveByField:              '',
    stateChangeDateField:        'Microsoft.VSTS.Common.StateChangeDate',
    closedDateField:             'Microsoft.VSTS.Common.ClosedDate',
    resolvedDateField:           'Microsoft.VSTS.Common.ResolvedDate',
    fixedVersionField:           '',
    priorityField:               'Microsoft.VSTS.Common.Priority',
    hcTypeField:                 '',
    automationStatusField:       'Microsoft.VSTS.TCM.AutomationStatus',
    // Sprint assignment field — used when System.IterationPath is only at PI level.
    // On-prem TFS may store planned sprint in a dedicated field (e.g. 'Custom.PlannedFor').
    // Leave empty ('') to derive sprint solely from System.IterationPath.
    plannedForField:             '',
  },
  stateValues: {
    featureDone:              'Done',
    featureRemoved:           'Removed',
    featureWip:               ['Activated', 'Approved', 'In Progress', 'Active'],
    featureAllStates:         ['Forecasted', 'New', 'Activated', 'Approved', 'Done', 'Removed'],
    storyDone:                ['Done', 'Closed', 'Resolved', 'Completed'],
    storyRemoved:             'Removed',
    storyWip:                 ['Active', 'In Progress', 'Committed'],
    defectClosed:             ['Resolved', 'Closed'],
    defectRemoved:            'Removed',
    defectEnhancementValue:   'Enhancement',
    defectFieldFoundValue:    'Found In Field',
  },
  piStructure: {
    sprintLabels:         ['S1', 'S2', 'S3', 'IP'],
    pisPerYear:           4,
    piNamingPattern:      '{yy}-PI{n}',
    // How sprint nodes are named inside the PI folder in TFS/ADO.
    // '{pi} {sprint}' → on-prem TFS default: '26-PI1\26-PI1 S1'
    // '{sprint}'      → ADO cloud / simple naming: 'PI26.2\SP1'
    sprintSubpathPattern: '{pi} {sprint}',
    hoursPerPoint:        6,
  },
};

/**
 * Merge stored fieldMappings (from config.json) with defaults.
 * Also maps legacy cfg.sizeField and cfg.defectFields for backward compat.
 */
function getFieldMappings(cfg) {
  const stored = (cfg && cfg.fieldMappings) || {};
  const legacy = cfg || {};

  const wit = Object.assign({}, DEFAULTS.workItemTypes, stored.workItemTypes || {});
  const fields = Object.assign({}, DEFAULTS.fields, stored.fields || {});
  const sv = Object.assign({}, DEFAULTS.stateValues, stored.stateValues || {});
  const pi = Object.assign({}, DEFAULTS.piStructure, stored.piStructure || {});

  // Backward compat: cfg.sizeField overrides effortField if fieldMappings not set
  if (legacy.sizeField && !(stored.fields && stored.fields.effortField)) {
    fields.effortField = legacy.sizeField;
  }
  // Backward compat: cfg.defectFields
  const df = legacy.defectFields || {};
  if (df.howFoundField   && !(stored.fields && stored.fields.howFoundField))   fields.howFoundField   = df.howFoundField;
  if (df.whereFoundField && !(stored.fields && stored.fields.whereFoundField)) fields.whereFoundField = df.whereFoundField;
  if (df.severityField   && !(stored.fields && stored.fields.severityField))   fields.severityField   = df.severityField;
  if (df.rankField       && !(stored.fields && stored.fields.rankField))       fields.rankField       = df.rankField;

  // Ensure array fields are arrays
  function toArr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
  sv.featureWip       = toArr(sv.featureWip);
  sv.featureAllStates = toArr(sv.featureAllStates);
  sv.storyDone        = toArr(sv.storyDone);
  sv.storyWip         = toArr(sv.storyWip);
  sv.defectClosed     = toArr(sv.defectClosed);
  pi.sprintLabels     = toArr(pi.sprintLabels).length ? toArr(pi.sprintLabels) : DEFAULTS.piStructure.sprintLabels;

  return { workItemTypes: wit, fields, stateValues: sv, piStructure: pi };
}

module.exports = { getFieldMappings, DEFAULTS };
