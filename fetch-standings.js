#!/usr/bin/env node
// fetch-standings.js
// Utility to write a snapshot standings.json including divisions + wild cards.
// NOTE: The MagicMirror module computes Wild Card from division data at runtime,
// so this file is optional for the live module.

const fs   = require("fs");
const path = require("path");
const nf   = require("node-fetch");
const fetch = nf.default || nf;

const SEASON = new Date().getFullYear();
const OUT = path.join(__dirname, "standings.json");

const DIVISIONS = [
  { name: "NL East",    leagueId: 104, divisionId: 204 },
  { name: "NL Central", leagueId: 104, divisionId: 205 },
  { name: "NL West",    leagueId: 104, divisionId: 203 },
  { name: "AL East",    leagueId: 103, divisionId: 201 },
  { name: "AL Central", leagueId: 103, divisionId: 202 },
  { name: "AL West",    leagueId: 103, divisionId: 200 }
];

function pct(rec) {
  const w = parseInt(rec.leagueRecord?.wins || 0, 10);
  const l = parseInt(rec.leagueRecord?.losses || 0, 10);
  return (w + l) ? (w / (w + l)) : 0;
}

(async () => {
  const divisionResults = [];

  // Fetch division standings
  for (const d of DIVISIONS) {
    const url = `https://statsapi.mlb.com/api/v1/standings?sportId=1&season=${SEASON}&leagueId=${d.leagueId}&divisionId=${d.divisionId}`;
    try {
      const res  = await fetch(url);
      const json = await res.json();
      const recs = json.records || [];
      const match = recs.find(r => Number(r.division.id) === d.divisionId) || recs[0];

      divisionResults.push({
        division: { id: d.divisionId, name: d.name, leagueId: d.leagueId },
        teamRecords: (match && match.teamRecords) ? match.teamRecords : []
      });
    } catch (err) {
      console.error(`[fetch-standings] Error fetching ${d.name}:`, err);
      divisionResults.push({ division: { id: d.divisionId, name: d.name, leagueId: d.leagueId }, teamRecords: [] });
    }
  }

  // Build Wild Card arrays from divisionResults
  const leaders = new Map(); // divisionId -> teamId
  divisionResults.forEach(gr => {
    const lead = [...(gr.teamRecords||[])].sort((a,b) => pct(b) - pct(a))[0];
    if (lead?.team?.id) leaders.set(gr.division.id, lead.team.id);
  });

  const buildWC = (leagueId) => {
    const teams = divisionResults
      .filter(gr => gr.division.leagueId === leagueId)
      .flatMap(gr => gr.teamRecords || []);
    const wc = teams.filter(tr => ![...leaders.values()].includes(tr.team?.id));
    return wc.sort((a,b) => pct(b) - pct(a));
  };

  const nlWildCard = buildWC(104);
  const alWildCard = buildWC(103);

  const out = {
    season: SEASON,
    divisions: divisionResults,
    wildcard: {
      NL: nlWildCard,
      AL: alWildCard
    }
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`[fetch-standings] Wrote divisions (${divisionResults.length}) and Wild Cards to ${OUT}`);
})();
