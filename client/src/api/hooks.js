import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { applyTeamFilter } from '../utils.js';
import { apiFetch } from './apiClient.js';
import useStore from '../store/useStore.js';

function buildQs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      v.forEach(item => parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(item)}`));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.join('&');
}

// Private: returns active department id for query key isolation
function useDeptId() {
  return useStore(s => s.activeDept?.id || 'default');
}

export function useConfig() {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'config'],
    queryFn: () => apiFetch('/api/config'),
    staleTime: Infinity,
  });
}

export function usePIList() {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'pi-list'],
    queryFn: () => apiFetch('/api/pi-list'),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePIDelivery(pi, team) {
  const deptId = useDeptId();
  const enabled = Boolean(pi);
  return useQuery({
    queryKey: [deptId, 'pi-delivery', pi, team],
    queryFn: () => apiFetch(`/api/pi-delivery?${buildQs({ pi, teamPath: team })}`),
    enabled,
    staleTime: 3 * 60 * 1000,
  });
}

export function useProgress(pi, granularity, team) {
  const deptId = useDeptId();
  const enabled = Boolean(pi);
  return useQuery({
    queryKey: [deptId, 'progress', pi, granularity, team],
    queryFn: () => apiFetch(`/api/progress?${buildQs({ pi, granularity, teamPath: team })}`),
    enabled,
    staleTime: 3 * 60 * 1000,
  });
}

export function useDashboard(pis) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'dashboard', pis],
    queryFn: () => apiFetch(`/api/dashboard?${buildQs({ pis })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

/** Client-side team filter wrapper — no extra API call on team change */
export function useFilteredDashboard(pis, team) {
  const result = useDashboard(pis);
  const data = useMemo(
    () => (result.data && team ? applyTeamFilter(result.data, team) : result.data),
    [result.data, team]
  );
  return { ...result, data };
}

export function useVelocity(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'velocity', pis, team],
    queryFn: () => apiFetch(`/api/velocity?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useInsightsFlow(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'insights-flow', pis, team],
    queryFn: () => apiFetch(`/api/insights/flow?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSprintTrend(pi, team) {
  const deptId = useDeptId();
  const enabled = Boolean(pi);
  return useQuery({
    queryKey: [deptId, 'sprint-trend', pi, team],
    queryFn: () => apiFetch(`/api/sprint-trend?${buildQs({ pi, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSprintBurndown(pi, team) {
  const deptId = useDeptId();
  const enabled = Boolean(pi);
  return useQuery({
    queryKey: [deptId, 'sprint-burndown', pi, team],
    queryFn: () => apiFetch(`/api/sprint-burndown?${buildQs({ pi, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useTestCoverage(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'test-coverage', pis, team],
    queryFn: () => apiFetch(`/api/test-coverage?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function usePredictability(snapshotId, teamPath) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'predictability', snapshotId, teamPath],
    queryFn: () => apiFetch(`/api/predictability?snapshotId=${encodeURIComponent(snapshotId)}${teamPath ? `&teamPath=${encodeURIComponent(teamPath)}` : ''}`),
    enabled: Boolean(snapshotId),
    staleTime: 2 * 60 * 1000,
  });
}

export function useSnapshots(pi) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'snapshots', pi],
    queryFn: () => apiFetch(`/api/snapshots${pi ? `?pi=${encodeURIComponent(pi)}` : ''}`),
    staleTime: 60 * 1000,
  });
}

export function useSnapshotTCDelta(snapshotId, teamPath) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'snapshot-tc-delta', snapshotId, teamPath],
    queryFn: () => apiFetch(`/api/snapshot-tc-delta?snapshotId=${encodeURIComponent(snapshotId)}${teamPath ? `&teamPath=${encodeURIComponent(teamPath)}` : ''}`),
    enabled: Boolean(snapshotId),
    staleTime: 2 * 60 * 1000,
  });
}

export function usePIChecks(team) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'pi-checks', team],
    queryFn: () => apiFetch(`/api/pi-checks?${buildQs({ teamPath: team })}`),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCycleTimeDistribution(teamPath, piCount = 4) {
  const deptId = useDeptId();
  const byTeam = !teamPath;
  return useQuery({
    queryKey: [deptId, 'cycle-time-distribution', teamPath, piCount, byTeam],
    queryFn: () => apiFetch(`/api/cycle-time-distribution?${buildQs({ teamPath: teamPath || undefined, piCount, byTeam: byTeam ? 'true' : undefined })}`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTeamCapacities(pi, teams) {
  const deptId = useDeptId();
  const enabled = !!pi && Array.isArray(teams) && teams.length > 0;
  return useQuery({
    queryKey: [deptId, 'team-capacities', pi, teams],
    queryFn: () => apiFetch(`/api/team-capacities?pi=${encodeURIComponent(pi)}&teams=${teams.map(encodeURIComponent).join(',')}`),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useObjectives(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'objectives', pis, team],
    queryFn: () => apiFetch(`/api/objectives?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRisks(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'risks', pis, team],
    queryFn: () => apiFetch(`/api/risks?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRoadmap(year, team) {
  const deptId = useDeptId();
  const enabled = Boolean(year);
  return useQuery({
    queryKey: [deptId, 'roadmap', year, team],
    queryFn: () => apiFetch(`/api/roadmap?${buildQs({ year, teamPath: team })}`),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useStoryMetrics(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'story-metrics', pis, team],
    queryFn: () => apiFetch(`/api/story-metrics?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDependencies(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'dependencies', pis, team],
    queryFn: () => apiFetch(`/api/dependencies?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDependencyMatrix(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'dependency-matrix', pis, team],
    queryFn: () => apiFetch(`/api/dependencies/matrix?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDefectFieldStats(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'defect-field-stats', pis, team],
    queryFn: () => apiFetch(`/api/defect-field-stats?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDefectDensityTrend(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'defect-density-trend', pis, team],
    queryFn: () => apiFetch(`/api/defect-density-trend?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDefectVersionStats(team) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'defect-version-stats', team],
    queryFn: () => apiFetch(`/api/defect-version-stats?${buildQs({ teamPath: team })}`),
    staleTime: 2 * 60 * 1000,
  });
}

export function useDefectEscapeByQuarter(year, team) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'defect-escape-by-quarter', year, team],
    queryFn: () => apiFetch(`/api/defect-escape-by-quarter?${buildQs({ year, teamPath: team || undefined })}`),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePIStoryVelocity(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'pi-story-velocity', pis, team],
    queryFn: () => apiFetch(`/api/pi-story-velocity?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useObjectivesPlan(pis, team, snapshotId) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'objectives-plan', pis, team, snapshotId],
    queryFn: () => apiFetch(`/api/objectives-plan?${buildQs({ pis, teamPath: team, snapshotId: snapshotId || undefined })}`),
    enabled,
    staleTime: 3 * 60 * 1000,
  });
}

export function useGithubCoverage() {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'github-coverage'],
    queryFn: () => apiFetch('/api/github-coverage'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRetroActions(pi, team) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'retro', pi, team],
    queryFn: () => apiFetch(`/api/retro?${buildQs({ pi, team })}`),
    staleTime: 60 * 1000,
  });
}

export function useBlockers(pis, team) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'blockers', pis, team],
    queryFn: () => apiFetch(`/api/blockers?${buildQs({ pis, teamPath: team })}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function usePIReadiness(pis, teamPath) {
  const deptId = useDeptId();
  const enabled = Array.isArray(pis) && pis.length > 0;
  return useQuery({
    queryKey: [deptId, 'pi-readiness', pis, teamPath],
    queryFn: () => apiFetch(`/api/pi-readiness?${buildQs({ pis, teamPath })}`),
    enabled,
    staleTime: 3 * 60 * 1000,
  });
}

export function useAnnotations(section, pi, team) {
  const deptId = useDeptId();
  return useQuery({
    queryKey: [deptId, 'annotations', section, pi, team],
    queryFn: () => apiFetch(`/api/annotations?${buildQs({ section, pi, team })}`),
    staleTime: 60 * 1000,
  });
}

export function useKPI(pi, team) {
  const deptId = useDeptId();
  const enabled = Boolean(pi);
  return useQuery({
    queryKey: [deptId, 'kpi', pi, team],
    queryFn: () => apiFetch(`/api/kpi?${buildQs({ pi, teamPath: team })}`),
    enabled,
    staleTime: 15 * 60 * 1000, // 15-min stale — relation fetches are expensive
  });
}
