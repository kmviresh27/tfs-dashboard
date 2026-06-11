'use strict';

const express = require('express');
const { loadConfig } = require('../config');
const { tfsGet, tfsPost } = require('../tfsClient');
const { parsePILabels, getDefaultPIs } = require('../helpers/piHelpers');
const { getFieldMappings } = require('../helpers/fieldMappings');

const router = express.Router();

// Count working days between two dates (inclusive), Mon–Fri only
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

// Count individual days-off that fall within the sprint window
function memberDaysOffInSprint(daysOff, startIso, finishIso) {
  if (!daysOff || !daysOff.length || !startIso || !finishIso) return 0;
  const spStart = new Date(startIso);
  const spEnd   = new Date(finishIso);
  let total = 0;
  for (const range of daysOff) {
    const rs = new Date(range.start);
    const re = new Date(range.end);
    const os = rs < spStart ? spStart : rs;
    const oe = re > spEnd   ? spEnd   : re;
    if (os <= oe) total += workingDays(os.toISOString(), oe.toISOString());
  }
  return total;
}

// ─── GET /api/sprint-capacity ─────────────────────────────────────────────────
// Query params:
//   pi       — e.g. 26-PI2 (required, single PI)
//   team     — TFS team name (default: Avyay)
router.get('/sprint-capacity', async (req, res) => {
  try {
    const cfg = loadConfig(req.deptId);
    if (!cfg.tfs.pat) return res.status(400).json({ error: 'PAT not configured' });

    const fm = getFieldMappings(cfg);
    const sprintLabels = fm.piStructure.sprintLabels;

    // Resolve PI label: accept single pi or first of pis[]
    let piLabel = req.query.pi;
    if (!piLabel) {
      const pis = parsePILabels(req.query);
      piLabel = pis && pis.length ? pis[0] : getDefaultPIs(fm?.piStructure?.pisPerYear, fm?.piStructure?.piNamingPattern)[0];
    }
    if (!piLabel) return res.status(400).json({ error: 'pi query param required' });

    const teamName = req.query.team || '';
    if (!teamName) {
      return res.json({ team: '', pi: piLabel, noTeamSelected: true, sprints: [], totalAvailableHours: 0, totalStories: 0, totalDone: 0 });
    }
    const teamEnc  = encodeURIComponent(teamName);

    // Step 1: Get team area path
    let teamAreaPath = null;
    try {
      const areasUrl = `${cfg.tfs.baseUrl}/${teamEnc}/_apis/work/teamsettings/teamfieldvalues?api-version=${cfg.tfs.apiVersion}`;
      const areas    = await tfsGet(areasUrl, cfg.tfs.pat);
      teamAreaPath   = areas?.defaultValue || areas?.values?.[0]?.value || null;
    } catch { /* area path optional */ }

    // Step 2: Get team iterations for this PI — return empty if team not found (404)
    let itersRes;
    try {
      const itersUrl = `${cfg.tfs.baseUrl}/${teamEnc}/_apis/work/teamsettings/iterations?api-version=${cfg.tfs.apiVersion}`;
      itersRes = await tfsGet(itersUrl, cfg.tfs.pat);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('404') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist')) {
        return res.json({ team: teamName, pi: piLabel, teamNotFound: true, sprints: [], totalAvailableHours: 0, totalStories: 0, totalDone: 0 });
      }
      throw e;
    }
    const sprints  = (itersRes.value || []).filter(i =>
      i.name && i.name.includes(piLabel) &&
      sprintLabels.some(s => i.name.endsWith(s))
    );

    if (!sprints.length) {
      return res.json({
        team: teamName, teamAreaPath, pi: piLabel,
        meta: { fetchedAt: new Date().toISOString() },
        sprints: [], totalAvailableHours: 0, totalStories: 0, totalDone: 0
      });
    }

    // Step 3: Fetch capacity + story counts concurrently per sprint
    const wiqlUrl = `${cfg.tfs.baseUrl}/_apis/wit/wiql?api-version=${cfg.tfs.apiVersion}`;

    const sprintData = await Promise.all(sprints.map(async sp => {
      const sprintPath = sp.path || '';
      const wdays      = workingDays(sp.attributes?.startDate, sp.attributes?.finishDate);

      // Capacity — per member, per activity, with individual days-off deduction
      let members = [], teamCapHpd = 0, totalAvailHours = 0;
      const memberDetails = [];
      const byActivity    = {};   // { "Development": { count, hpd, availHours }, ... }

      try {
        const capUrl = `${cfg.tfs.baseUrl}/${teamEnc}/_apis/work/teamsettings/iterations/${sp.id}/capacities?api-version=${cfg.tfs.apiVersion}`;
        const capRes  = await tfsGet(capUrl, cfg.tfs.pat);
        members       = capRes.value || [];

        // Fetch team-level days off once, counted in working days
        let teamDaysOffCount = 0;
        try {
          const tdUrl = `${cfg.tfs.baseUrl}/${teamEnc}/_apis/work/teamsettings/iterations/${sp.id}/teamdaysoff?api-version=${cfg.tfs.apiVersion}`;
          const tdRes  = await tfsGet(tdUrl, cfg.tfs.pat);
          teamDaysOffCount = memberDaysOffInSprint(tdRes.daysOff, sp.attributes?.startDate, sp.attributes?.finishDate);
        } catch { /* ignore */ }

        for (const m of members) {
          const displayName  = m.teamMember?.displayName || '';
          // Individual days off (working days within sprint window)
          const indivDaysOff = memberDaysOffInSprint(m.daysOff, sp.attributes?.startDate, sp.attributes?.finishDate);
          // Effective working days = sprint working days − individual days off − team days off
          const effDays = Math.max(0, wdays - indivDaysOff - teamDaysOffCount);

          const memberActivities = [];
          let memberTotalHours = 0;

          for (const act of (m.activities || [])) {
            const actName  = act.name || 'Unspecified';
            const hpd      = act.capacityPerDay || 0;
            const actHours = hpd * effDays;

            memberActivities.push({ activity: actName, hpd, availHours: actHours });
            memberTotalHours += actHours;
            teamCapHpd       += hpd;

            // Accumulate byActivity
            if (!byActivity[actName]) byActivity[actName] = { count: 0, hpd: 0, availHours: 0 };
            byActivity[actName].count++;
            byActivity[actName].hpd      += hpd;
            byActivity[actName].availHours += actHours;
          }

          totalAvailHours += memberTotalHours;
          memberDetails.push({
            name:       displayName,
            daysOff:    indivDaysOff,
            effDays,
            activities: memberActivities,
            totalHours: Math.round(memberTotalHours)
          });
        }

        // Round all byActivity hours
        for (const act of Object.keys(byActivity)) {
          byActivity[act].availHours = Math.round(byActivity[act].availHours);
        }
      } catch { /* capacity may be unavailable */ }

      const availableHours = Math.round(totalAvailHours);
      const teamDaysOff    = members.length > 0
        ? memberDaysOffInSprint([], sp.attributes?.startDate, sp.attributes?.finishDate) // placeholder; real value fetched above
        : 0;

      // Stories committed to this sprint (scoped to team area path if available)
      let storiesCommitted = 0, storiesDone = 0;
      try {
        const areaFilter = teamAreaPath ? ` AND [System.AreaPath] UNDER '${teamAreaPath}'` : '';
        const storyRes   = await tfsPost(wiqlUrl, {
          query: `SELECT [System.Id],[System.State] FROM WorkItems
            WHERE [System.WorkItemType] = 'Story'
              AND [System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${piLabel}\\${sp.name}'
              ${areaFilter}
            ORDER BY [System.Id]`
        }, cfg.tfs.pat);
        storiesCommitted = (storyRes.workItems || []).length;
        // For done count, fetch states via second WIQL
        const doneRes = await tfsPost(wiqlUrl, {
          query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.WorkItemType] = 'Story'
              AND [System.State] = 'Done'
              AND [System.IterationPath] UNDER '${cfg.tfs.iterationPath}\\${piLabel}\\${sp.name}'
              ${areaFilter}
            ORDER BY [System.Id]`
        }, cfg.tfs.pat);
        storiesDone = (doneRes.workItems || []).length;
      } catch { /* story counts optional */ }

      const completionRate  = storiesCommitted > 0 ? Math.round(storiesDone / storiesCommitted * 100) : 0;
      const loadPerPerson   = members.length > 0 ? Math.round((storiesCommitted / members.length) * 10) / 10 : null;

      return {
        name:            sp.name,
        startDate:       sp.attributes?.startDate?.slice(0, 10) || null,
        finishDate:      sp.attributes?.finishDate?.slice(0, 10) || null,
        workingDays:     wdays,
        membersCount:    members.length,
        availableHours,
        byActivity,
        storiesCommitted,
        storiesDone,
        completionRate,
        loadPerPerson,
        memberDetails:   memberDetails.sort((a, b) => b.availHours - a.availHours)
      };
    }));

    const totAvail  = sprintData.reduce((s, sp) => s + sp.availableHours, 0);
    const totStories = sprintData.reduce((s, sp) => s + sp.storiesCommitted, 0);
    const totDone   = sprintData.reduce((s, sp) => s + sp.storiesDone, 0);

    res.json({
      team: teamName,
      teamAreaPath,
      pi:   piLabel,
      meta: { fetchedAt: new Date().toISOString() },
      sprints: sprintData,
      totalAvailableHours: Math.round(totAvail),
      totalStories:  totStories,
      totalDone:     totDone,
      totalCompletionRate: totStories > 0 ? Math.round(totDone / totStories * 100) : 0
    });
  } catch (e) {
    console.error('[sprint-capacity]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


