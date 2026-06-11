'use strict';
const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet } = require('../tfsClient');
const { parsePILabels, getDefaultPIs } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

function workingDays(startIso, finishIso) {
  if (!startIso || !finishIso) return 0;
  let days = 0;
  const cur = new Date(startIso);
  const end = new Date(finishIso);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function memberDaysOffInSprint(daysOff, startIso, finishIso) {
  if (!daysOff?.length || !startIso || !finishIso) return 0;
  const spStart = new Date(startIso), spEnd = new Date(finishIso);
  let total = 0;
  for (const range of daysOff) {
    const os = new Date(range.start) < spStart ? spStart : new Date(range.start);
    const oe = new Date(range.end)   > spEnd   ? spEnd   : new Date(range.end);
    if (os <= oe) total += workingDays(os.toISOString(), oe.toISOString());
  }
  return total;
}

/**
 * GET /api/team-capacities
 * Returns capacity summary (total available hours, member count) per team for a PI.
 * Query: pi=26-PI2&teams=Avyay,Hercules,...
 */
router.get('/team-capacities', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const fm = getFieldMappings(cfg);
    const sprintLabels = fm.piStructure.sprintLabels;

    let piLabel = req.query.pi;
    if (!piLabel) {
      const pis = parsePILabels(req.query);
      piLabel = pis?.length ? pis[0] : getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern)[0];
    }
    if (!piLabel) return res.status(400).json({ error: 'pi param required' });

    const teamsRaw = req.query.teams || req.query['teams[]'] || '';
    const teams = Array.isArray(teamsRaw)
      ? teamsRaw
      : teamsRaw.split(',').map(t => t.trim()).filter(Boolean);

    if (!teams.length) return res.json({ pi: piLabel, teams: {} });

    // Fetch capacity for all teams in parallel
    const results = await Promise.all(teams.map(async teamName => {
      try {
        const teamEnc = encodeURIComponent(teamName);
        const itersUrl = `${cfg.tfs.baseUrl}/${teamEnc}/_apis/work/teamsettings/iterations?api-version=${cfg.tfs.apiVersion}`;
        const itersRes = await tfsGet(itersUrl, cfg.tfs.pat);
        const sprints  = (itersRes.value || []).filter(i =>
          i.name && i.name.includes(piLabel) &&
          sprintLabels.some(s => i.name.endsWith(s))
        );

        let totalAvailHours = 0, totalMembers = 0;
        const byActivity = {};

        await Promise.all(sprints.map(async sp => {
          const wdays = workingDays(sp.attributes?.startDate, sp.attributes?.finishDate);
          try {
            const capUrl = `${cfg.tfs.baseUrl}/${teamEnc}/_apis/work/teamsettings/iterations/${sp.id}/capacities?api-version=${cfg.tfs.apiVersion}`;
            const capRes = await tfsGet(capUrl, cfg.tfs.pat);
            const members = capRes.value || [];

            // Team-level days off
            let teamDaysOff = 0;
            try {
              const tdUrl = `${cfg.tfs.baseUrl}/${teamEnc}/_apis/work/teamsettings/iterations/${sp.id}/teamdaysoff?api-version=${cfg.tfs.apiVersion}`;
              const tdRes = await tfsGet(tdUrl, cfg.tfs.pat);
              teamDaysOff = memberDaysOffInSprint(tdRes.daysOff, sp.attributes?.startDate, sp.attributes?.finishDate);
            } catch { /* ignore */ }

            totalMembers = Math.max(totalMembers, members.length);
            for (const m of members) {
              const indivOff = memberDaysOffInSprint(m.daysOff, sp.attributes?.startDate, sp.attributes?.finishDate);
              const effDays  = Math.max(0, wdays - indivOff - teamDaysOff);
              for (const act of (m.activities || [])) {
                const actName = act.name || 'Unspecified';
                const hrs     = (act.capacityPerDay || 0) * effDays;
                if (!byActivity[actName]) byActivity[actName] = 0;
                byActivity[actName] += hrs;
                // Only count Development activity towards capacity
                if (/^development$/i.test(actName)) {
                  totalAvailHours += hrs;
                }
              }
            }
          } catch { /* capacity unavailable for this sprint */ }
        }));

        return { team: teamName, totalAvailHours: Math.round(totalAvailHours), members: totalMembers, byActivity };
      } catch {
        return { team: teamName, totalAvailHours: 0, members: 0, byActivity: {} };
      }
    }));

    const teamsMap = {};
    for (const r of results) teamsMap[r.team] = r;

    const hoursPerPoint = fm.piStructure?.hoursPerPoint || 8;
    // Add capacity in story points for each team
    for (const t of Object.keys(teamsMap)) {
      teamsMap[t].capacityPoints = Math.round(teamsMap[t].totalAvailHours / hoursPerPoint);
    }

    res.json({ pi: piLabel, hoursPerPoint, teams: teamsMap });
  } catch (e) {
    console.error('[team-capacities]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


