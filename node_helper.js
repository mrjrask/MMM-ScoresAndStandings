// node_helper.js
const NodeHelper = require("node_helper");
const fetch      = global.fetch;
const dns        = require("dns");

const SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl", "nba"];

const DNS_LOOKUP = (dns && dns.promises && typeof dns.promises.lookup === "function")
  ? (host) => dns.promises.lookup(host)
  : (host) => new Promise((resolve, reject) => {
    dns.lookup(host, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });

module.exports = NodeHelper.create({
  start() {
    console.log("🛰️ MMM-ScoresAndStandings helper started");
    this.fetchTimer = null;
    this._nhlStatsDnsStatus = { available: null, checkedAt: 0 };
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INIT") {
      this.config = payload || {};
      this.leagues = this._resolveConfiguredLeagues();
      if (!Array.isArray(this.leagues) || this.leagues.length === 0) {
        this.leagues = [this._getLeague()];
      }

      if (this.fetchTimer) {
        clearInterval(this.fetchTimer);
        this.fetchTimer = null;
      }

      this._fetchGames();

      const scoreInterval = Math.max(10 * 1000, this.config.updateIntervalScores || (60 * 1000));
      this.fetchTimer = setInterval(() => this._fetchGames(), scoreInterval);
    }
  },

  async _fetchGames() {
    const leagues = Array.isArray(this.leagues) && this.leagues.length > 0
      ? this.leagues
      : [this._getLeague()];

    for (let i = 0; i < leagues.length; i++) {
      const league = leagues[i];
      if (league === "nhl") {
        await this._fetchNhlGames();
      } else if (league === "nfl") {
        await this._fetchNflGames();
      } else if (league === "nba") {
        await this._fetchNbaGames();
      } else {
        await this._fetchMlbGames();
      }
    }
  },

  async _fetchMlbGames() {
    try {
      const { dateIso } = this._getTargetDate();
      const url  = `https://statsapi.mlb.com/api/v1/schedule/games?sportId=1&date=${dateIso}&hydrate=linescore`;
      const res  = await fetch(url);
      const json = await res.json();
      const games = (json.dates && json.dates[0] && json.dates[0].games) || [];

      console.log(`⚾️ Sending ${games.length} MLB games to front-end.`);
      this._notifyGames("mlb", games);
    } catch (e) {
      console.error("🚨 MLB fetchGames failed:", e);
    }
  },

  async _fetchNhlGames() {
    const { dateIso } = this._getTargetDate();
    const scoreboardDateIso = this._getNhlScoreboardDate();
    const targetDate = scoreboardDateIso || dateIso;

    const includeStandings = this._shouldIncludeNhlStandings();
    const extrasPromise = includeStandings
      ? this._fetchNhlStandingsExtras()
      : Promise.resolve(null);

    let delivered = false;
    let sent = false;

    let statsApiAvailable = false;
    try {
      statsApiAvailable = await this._nhlStatsApiAvailable();
    } catch (availabilityError) {
      console.warn("⚠️ Unable to verify NHL stats API availability:", availabilityError);
    }

    if (statsApiAvailable) {
      try {
        const statsGames = await this._fetchNhlStatsGames(targetDate);
        const games = Array.isArray(statsGames) ? statsGames : [];
        const count = games.length;

        const extras = await extrasPromise;
        this._notifyGames("nhl", games, extras);
        sent = true;

        if (count > 0) {
          console.log(`🏒 Sending ${count} NHL games to front-end (stats API).`);
          delivered = true;
        } else {
          console.info(`ℹ️ NHL stats API returned no games for ${targetDate}; trying scoreboard API.`);
        }
      } catch (statsError) {
        console.error("🚨 NHL stats API fetchGames failed:", statsError);
        console.info(`ℹ️ Attempting NHL scoreboard API for ${targetDate}`);
      }
    } else {
      console.info("ℹ️ NHL stats API appears unreachable; using scoreboard fallback.");
    }

    if (!delivered) {
      try {
        const scoreboardGames = await this._fetchNhlScoreboardGames(targetDate);
        const games = Array.isArray(scoreboardGames) ? scoreboardGames : [];
        const count = games.length;

        const extras = await extrasPromise;
        this._notifyGames("nhl", games, extras);
        sent = true;

        if (count > 0) {
          console.log(`🏒 Sending ${count} NHL games to front-end (scoreboard API).`);
          delivered = true;
        } else {
          console.info(`ℹ️ NHL scoreboard API returned no games for ${targetDate}; trying stats REST fallback.`);
        }
      } catch (scoreboardError) {
        console.error("🚨 NHL scoreboard API fetchGames failed:", scoreboardError);
        console.info(`ℹ️ Attempting NHL stats REST fallback for ${targetDate}`);
      }
    }

    if (!delivered) {
      try {
        const restGames = await this._fetchNhlStatsRestGames(targetDate);
        if (restGames.length > 0) {
          console.log(`🏒 Sending ${restGames.length} NHL games to front-end (stats REST fallback).`);
          const extras = await extrasPromise;
          this._notifyGames("nhl", restGames, extras);
          delivered = true;
          sent = true;
        } else {
          console.warn(`⚠️ NHL stats REST fallback returned no games for ${targetDate}.`);
        }
      } catch (restError) {
        console.error("🚨 NHL stats REST fallback failed:", restError);
      }
    }

    if (!delivered && !sent) {
      console.warn(`⚠️ Unable to fetch NHL games for ${targetDate}; sending empty schedule to front-end.`);
      const extras = await extrasPromise;
      this._notifyGames("nhl", [], extras);
    }
  },

  async _nhlStatsApiAvailable() {
    const status = this._nhlStatsDnsStatus || {};
    const now = Date.now();
    const ttl = 5 * 60 * 1000; // cache DNS reachability for 5 minutes
    if (status.checkedAt && (now - status.checkedAt) < ttl && typeof status.available === "boolean") {
      return status.available;
    }

    const host = "statsapi.web.nhl.com";
    const deadline = now + 4000;
    let available = false;
    let lastError = null;

    while (!available && Date.now() < deadline) {
      try {
        await DNS_LOOKUP(host);
        available = true;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (!available && lastError) {
      console.debug(`🔍 DNS lookup for ${host} failed:`, lastError.message || lastError);
    }

    this._nhlStatsDnsStatus = { available, checkedAt: now };
    return available;
  },

  async _fetchNhlStatsGames(dateIso) {
    const url = `https://statsapi.web.nhl.com/api/v1/schedule?date=${dateIso}&expand=schedule.linescore,schedule.teams`;
    const res  = await fetch(url, { headers: this._nhlRequestHeaders() });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const dates = Array.isArray(json.dates) ? json.dates : [];
    const games = [];
    for (let i = 0; i < dates.length; i += 1) {
      const bucket = dates[i];
      if (!bucket || !Array.isArray(bucket.games)) continue;
      for (let j = 0; j < bucket.games.length; j += 1) {
        games.push(bucket.games[j]);
      }
    }

    return this._hydrateNhlGames(games);
  },

  async _fetchNhlScoreboardGames(dateIso) {
    const headers = this._nhlRequestHeaders({
      "x-nhl-stats-origin": "https://www.nhl.com",
      "x-nhl-stats-referer": "https://www.nhl.com"
    });

    const urls = [
      `https://api-web.nhle.com/v1/scoreboard/${dateIso}?site=en_nhl`,
      `https://api-web.nhle.com/v1/scoreboard/now?site=en_nhl`
    ];

    for (let u = 0; u < urls.length; u += 1) {
      const fallbackUrl = urls[u];
      try {
        const res = await fetch(fallbackUrl, { headers });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const json = await res.json();
        const rawGames = this._collectNhlScoreboardGames(json, dateIso);
        const normalized = [];

        for (let i = 0; i < rawGames.length; i += 1) {
          const mapped = this._normalizeNhlScoreboardGame(rawGames[i]);
          if (mapped) normalized.push(mapped);
        }

        const hydrated = this._hydrateNhlGames(normalized);
        if (hydrated.length > 0 || u === urls.length - 1) {
          return hydrated;
        }
      } catch (err) {
        if (u === urls.length - 1) throw err;
      }
    }

    return [];
  },

  _collectNhlScoreboardGames(json, dateIso) {
    if (!json) return [];

    const targetDate = (dateIso || "").slice(0, 10);
    const games = [];
    const seen = new Set();

    const normalizeDate = (value) => {
      if (!value) return null;
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
      }
      const str = String(value).trim();
      if (!str) return null;
      if (str.includes("T")) {
        return str.split("T", 1)[0];
      }
      if (str.length >= 10) {
        return str.slice(0, 10);
      }
      return str;
    };

    const pushGame = (game) => {
      if (!game) return;

      if (targetDate) {
        const gameDate = normalizeDate(
          game.gameDate || game.startTimeUTC || game.startTime || game.gameDateTime || game.startTimeLocal
        );
        if (gameDate && gameDate !== targetDate) return;
      }

      const key = game.id || game.gamePk || game.gameId;
      const keyStr = (key != null) ? String(key) : null;
      if (keyStr && seen.has(keyStr)) return;
      if (keyStr) seen.add(keyStr);

      games.push(game);
    };

    const pushGames = (entries) => {
      if (!Array.isArray(entries)) return;
      for (let i = 0; i < entries.length; i += 1) {
        pushGame(entries[i]);
      }
    };

    const processBucket = (bucket, fallbackDate) => {
      if (!bucket) return;

      if (Array.isArray(bucket)) {
        pushGames(bucket);
        return;
      }

      const bucketObj = (typeof bucket === "object") ? bucket : {};
      const bucketDate = normalizeDate(
        fallbackDate
        || bucketObj.date
        || bucketObj.gameDate
        || bucketObj.day
      );
      if (targetDate && bucketDate && bucketDate !== targetDate) return;

      if (Array.isArray(bucketObj.games)) {
        pushGames(bucketObj.games);
        return;
      }

      const possibleLists = ["items", "events", "matchups"];
      for (let i = 0; i < possibleLists.length; i += 1) {
        const list = bucketObj[possibleLists[i]];
        if (Array.isArray(list)) {
          pushGames(list);
        }
      }

      const values = Object.values(bucketObj);
      for (let j = 0; j < values.length; j += 1) {
        if (Array.isArray(values[j])) {
          pushGames(values[j]);
        }
      }
    };

    const processBuckets = (buckets) => {
      if (!buckets) return;

      if (Array.isArray(buckets)) {
        for (let i = 0; i < buckets.length; i += 1) {
          processBucket(buckets[i]);
        }
        return;
      }

      if (typeof buckets === "object") {
        const keys = Object.keys(buckets);
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i];
          processBucket(buckets[key], normalizeDate(key));
        }
      }
    };

    if (Array.isArray(json.games)) {
      pushGames(json.games);
    }

    processBuckets(json.gameWeek);
    processBuckets(json.dates);
    processBuckets(json.gamesByDate);
    processBuckets(json.gamesByDay);
    processBuckets(json.gamesByDateV2);

    if (json.scoreboard && typeof json.scoreboard === "object" && json.scoreboard !== json) {
      const nested = this._collectNhlScoreboardGames(json.scoreboard, dateIso);
      pushGames(nested);
    }

    return games;
  },

  _nhlRequestHeaders(extra) {
    const base = {
      "User-Agent": "Mozilla/5.0 (MMM-ScoresAndStandings)",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.nhl.com/",
      Origin: "https://www.nhl.com",
      Pragma: "no-cache",
      "Cache-Control": "no-cache"
    };

    if (!extra) return base;
    return Object.assign({}, base, extra);
  },

  async _fetchNhlStatsRestGames(dateIso) {
    const restUrl = `https://api.nhle.com/stats/rest/en/schedule?cayenneExp=gameDate=%22${dateIso}%22`;
    const res = await fetch(restUrl, { headers: this._nhlRequestHeaders({
      "x-nhl-stats-origin": "https://www.nhl.com",
      "x-nhl-stats-referer": "https://www.nhl.com"
    }) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const rawGames = Array.isArray(json.data) ? json.data : [];
    const normalized = [];

    for (let i = 0; i < rawGames.length; i += 1) {
      const mapped = this._normalizeNhlStatsRestGame(rawGames[i]);
      if (mapped) normalized.push(mapped);
    }

    return this._hydrateNhlGames(normalized);
  },

  _hydrateNhlGames(games) {
    if (!Array.isArray(games)) return [];

    const hydrated = [];
    for (let i = 0; i < games.length; i += 1) {
      const game = this._hydrateNhlGame(games[i]);
      if (game) hydrated.push(game);
    }

    hydrated.sort((a, b) => {
      const dateA = this._firstDate(
        a && a.startTimeUTC,
        a && a.gameDate,
        a && a.startTime,
        a && a.gameDateTime,
        a && a.startTimeLocal
      );
      const dateB = this._firstDate(
        b && b.startTimeUTC,
        b && b.gameDate,
        b && b.startTime,
        b && b.gameDateTime,
        b && b.startTimeLocal
      );

      if (dateA && dateB) return dateA - dateB;
      if (dateA) return -1;
      if (dateB) return 1;
      return 0;
    });

    return hydrated;
  },

  _shouldIncludeNhlStandings() {
    const cfg = this.config || {};
    if (!cfg || typeof cfg !== "object") return true;

    const value = cfg.showNhlStandings;
    if (value == null) return true;

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
      if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    }

    return !!value;
  },

  async _fetchNhlStandingsExtras() {
    try {
      const standings = await this._fetchNhlStandings();
      if (standings && Array.isArray(standings.pages) && standings.pages.length > 0) {
        return { standings };
      }
    } catch (err) {
      console.error("🚨 NHL standings fetch failed:", err);
    }
    return null;
  },

  async _fetchNhlStandings() {
    const url = "https://statsapi.web.nhl.com/api/v1/standings/byDivision";
    const res = await fetch(url, { headers: this._nhlRequestHeaders() });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const records = Array.isArray(json.records) ? json.records : [];

    const divisions = {};

    const addDivision = (key, division) => {
      if (!key) return;
      const normalizedKey = key.toLowerCase();
      divisions[normalizedKey] = division;
    };

    const resolveAbbr = (teamInfo = {}) => {
      const abbr = teamInfo.abbreviation || teamInfo.teamAbbrev || teamInfo.teamName || teamInfo.shortName || teamInfo.locationName;
      return abbr ? String(abbr).toUpperCase() : null;
    };

    const resolveName = (teamInfo = {}) => {
      if (teamInfo.name) return teamInfo.name;
      const parts = [teamInfo.locationName, teamInfo.teamName].filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
      if (teamInfo.shortName) return teamInfo.shortName;
      if (teamInfo.abbreviation) return teamInfo.abbreviation;
      return "";
    };

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i] || {};
      const divisionInfo = record.division || {};
      const conferenceInfo = record.conference || {};

      const divisionName = divisionInfo.nameShort || divisionInfo.name || record.divisionName || "";
      const conferenceName = conferenceInfo.name || conferenceInfo.nameShort || record.conferenceName || "";

      const keyCandidates = [divisionName, divisionInfo.name, divisionInfo.nameShort, divisionInfo.abbreviation, divisionInfo.id];
      const candidateKeys = keyCandidates
        .filter((candidate) => candidate != null && String(candidate).trim() !== "")
        .map((candidate) => String(candidate));
      if (candidateKeys.length === 0) continue;

      const teamRecords = Array.isArray(record.teamRecords) ? record.teamRecords : [];
      const teams = [];

      for (let j = 0; j < teamRecords.length; j += 1) {
        const teamRecord = teamRecords[j] || {};
        const teamInfo = teamRecord.team || {};
        const leagueRecord = teamRecord.leagueRecord || {};

        const abbr = resolveAbbr(teamInfo);
        if (!abbr) continue;

        const wins = Number.isFinite(leagueRecord.wins) ? leagueRecord.wins : Number(teamRecord.wins) || 0;
        const losses = Number.isFinite(leagueRecord.losses) ? leagueRecord.losses : Number(teamRecord.losses) || 0;
        const overtime = Number.isFinite(leagueRecord.ot) ? leagueRecord.ot : Number(teamRecord.ot) || Number(teamRecord.overtimeLosses) || 0;
        const gamesPlayed = Number(teamRecord.gamesPlayed) || (wins + losses + overtime);
        const points = Number(teamRecord.points) || 0;
        const regulationWins = Number(teamRecord.regulationWins) || 0;
        const pointsPct = Number(teamRecord.pointsPercentage) || 0;

        teams.push({
          id: teamInfo.id,
          name: resolveName(teamInfo),
          abbr,
          gamesPlayed,
          wins,
          losses,
          ot: overtime,
          points,
          regulationWins,
          pointsPercentage: pointsPct
        });
      }

      teams.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.regulationWins !== a.regulationWins) return b.regulationWins - a.regulationWins;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.pointsPercentage !== a.pointsPercentage) return b.pointsPercentage - a.pointsPercentage;
        return a.name.localeCompare(b.name);
      });

      const divisionData = {
        name: divisionName || candidateKeys[0],
        conference: conferenceName || null,
        teams
      };

      candidateKeys.forEach((key) => addDivision(key, divisionData));
    }

    const buildDivisions = (names) => {
      const result = [];
      names.forEach((name) => {
        if (!name) return;
        const key = String(name).toLowerCase();
        const division = divisions[key];
        if (division && Array.isArray(division.teams) && division.teams.length > 0) {
          result.push({
            name: division.name,
            teams: division.teams.map((team) => ({
              abbr: team.abbr,
              name: team.name,
              gamesPlayed: team.gamesPlayed,
              wins: team.wins,
              losses: team.losses,
              ot: team.ot,
              points: team.points
            }))
          });
        }
      });
      return result;
    };

    const pages = [];
    const western = buildDivisions(["Central", "Pacific"]);
    if (western.length > 0) {
      pages.push({ key: "western", title: "Western Conference", divisions: western });
    }

    const eastern = buildDivisions(["Metropolitan", "Atlantic"]);
    if (eastern.length > 0) {
      pages.push({ key: "eastern", title: "Eastern Conference", divisions: eastern });
    }

    let updated = null;
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      if (record && record.lastUpdated) {
        updated = record.lastUpdated;
        break;
      }
    }
    if (!updated && json && json.records && json.records[0] && json.records[0].teamRecords && json.records[0].teamRecords[0]) {
      const firstRecord = json.records[0].teamRecords[0];
      if (firstRecord && firstRecord.lastUpdated) updated = firstRecord.lastUpdated;
    }
    if (!updated && json && json.lastUpdated) updated = json.lastUpdated;

    return { pages, updated };
  },

  _hydrateNhlGame(game) {
    if (!game || typeof game !== "object") return null;

    const normalized = Object.assign({}, game);

    const startDate = this._firstDate(
      normalized && normalized.startTimeUTC,
      normalized && normalized.gameDate,
      normalized && normalized.startTime,
      normalized && normalized.gameDateTime,
      normalized && normalized.startTimeLocal
    );

    if (startDate) {
      const iso = startDate.toISOString();
      if (!normalized.gameDate) normalized.gameDate = iso;
      if (!normalized.startTimeUTC) normalized.startTimeUTC = iso;
    }

    const status = (normalized && typeof normalized.status === "object") ? normalized.status : {};
    normalized.status = Object.assign({
      abstractGameState: "Preview",
      detailedState: (status && status.detailedState) || ""
    }, status);

    const linescore = (normalized && typeof normalized.linescore === "object") ? normalized.linescore : {};
    const lsTeams = (linescore && typeof linescore.teams === "object") ? linescore.teams : {};
    linescore.teams = {
      away: this._hydrateNhlLinescoreTeam(lsTeams.away),
      home: this._hydrateNhlLinescoreTeam(lsTeams.home)
    };

    if (Object.prototype.hasOwnProperty.call(linescore, "currentPeriod")) {
      const cp = this._asNumberOrNull(linescore.currentPeriod);
      if (cp != null) linescore.currentPeriod = cp;
    } else {
      linescore.currentPeriod = null;
    }

    if (typeof linescore.currentPeriodTimeRemaining === "string") {
      linescore.currentPeriodTimeRemaining = linescore.currentPeriodTimeRemaining.trim();
    }

    normalized.linescore = Object.assign({
      currentPeriod: linescore.currentPeriod,
      currentPeriodOrdinal: linescore.currentPeriodOrdinal || "",
      currentPeriodTimeRemaining: linescore.currentPeriodTimeRemaining || "",
      teams: linescore.teams
    }, linescore);

    const teams = (normalized && typeof normalized.teams === "object") ? normalized.teams : {};
    normalized.teams = {
      away: this._hydrateNhlGameTeam(teams.away),
      home: this._hydrateNhlGameTeam(teams.home)
    };

    return normalized;
  },

  _hydrateNhlGameTeam(entry) {
    const teamEntry = Object.assign({}, entry || {});
    const team = Object.assign({}, teamEntry.team || {});

    if (team.abbreviation && typeof team.abbreviation === "string") {
      team.abbreviation = team.abbreviation.toUpperCase();
    }
    if (team.teamAbbreviation && typeof team.teamAbbreviation === "string") {
      team.teamAbbreviation = team.teamAbbreviation.toUpperCase();
    }
    if (!team.teamAbbreviation && team.abbreviation) {
      team.teamAbbreviation = team.abbreviation;
    }

    teamEntry.team = team;

    if (Object.prototype.hasOwnProperty.call(teamEntry, "score")) {
      const score = this._asNumberOrNull(teamEntry.score);
      teamEntry.score = (score != null) ? score : teamEntry.score;
    }

    const shotCandidates = [
      teamEntry.shotsOnGoal,
      teamEntry.sog,
      teamEntry.shots,
      teamEntry.shotsTotal,
      teamEntry.totalShots,
      teamEntry.shotsOnGoalTotal
    ];

    const nestedShotSources = [
      teamEntry.stats,
      teamEntry.teamStats,
      teamEntry.statistics,
      teamEntry.teamSkaterStats,
      teamEntry.skaterStats
    ];

    for (let ns = 0; ns < nestedShotSources.length; ns += 1) {
      const source = nestedShotSources[ns];
      if (source && typeof source === "object") {
        shotCandidates.push(
          source.shotsOnGoal,
          source.sog,
          source.shots,
          source.shotsTotal,
          source.totalShots
        );

        if (source.teamSkaterStats && typeof source.teamSkaterStats === "object") {
          shotCandidates.push(
            source.teamSkaterStats.shotsOnGoal,
            source.teamSkaterStats.sog,
            source.teamSkaterStats.shots
          );
        }
      }
    }
    let shots = null;
    for (let i = 0; i < shotCandidates.length; i += 1) {
      const val = this._asNumberOrNull(shotCandidates[i]);
      if (val != null) {
        shots = val;
        break;
      }
    }
    if (shots != null) teamEntry.shotsOnGoal = shots;
    else if (!Object.prototype.hasOwnProperty.call(teamEntry, "shotsOnGoal")) teamEntry.shotsOnGoal = null;

    return teamEntry;
  },

  _hydrateNhlLinescoreTeam(entry) {
    const team = Object.assign({}, entry || {});
    const shotKeys = [
      "shotsOnGoal",
      "sog",
      "shots",
      "shotsTotal",
      "totalShots",
      "shotsOnGoalTotal"
    ];

    let sog = null;
    for (let i = 0; i < shotKeys.length; i += 1) {
      const key = shotKeys[i];
      if (Object.prototype.hasOwnProperty.call(team, key)) {
        sog = this._asNumberOrNull(team[key]);
        if (sog != null) break;
      }
    }

    if (sog == null) {
      const nestedSources = [team.stats, team.teamStats, team.statistics, team.teamSkaterStats, team.skaterStats];
      for (let j = 0; j < nestedSources.length; j += 1) {
        const src = nestedSources[j];
        if (src && typeof src === "object") {
          const nestedCandidates = [
            src.shotsOnGoal,
            src.sog,
            src.shots,
            src.shotsTotal,
            src.totalShots
          ];
          for (let nk = 0; nk < nestedCandidates.length; nk += 1) {
            const candidate = this._asNumberOrNull(nestedCandidates[nk]);
            if (candidate != null) {
              sog = candidate;
              break;
            }
          }
        }
        if (sog != null) break;
      }
    }

    team.shotsOnGoal = (sog != null) ? sog : null;
    return team;
  },

  _normalizeNhlScoreboardGame(game) {
    if (!game) return null;

    const periodDescriptor = game.periodDescriptor || {};
    const status = this._nhlScoreboardStatus(game, periodDescriptor);

    const awayTeam = this._normalizeNhlScoreboardTeam(game.awayTeam);
    const homeTeam = this._normalizeNhlScoreboardTeam(game.homeTeam);

    const periodRemainingText = this._nhlScoreboardText(periodDescriptor.periodTimeRemaining || "");
    const clockText = this._nhlScoreboardText(game.clock || "");
    const currentPeriodTimeRemaining = periodRemainingText || clockText;

    const linescore = {
      currentPeriod: this._asNumberOrNull(periodDescriptor.number),
      currentPeriodOrdinal: this._nhlScoreboardPeriodOrdinal(periodDescriptor),
      currentPeriodTimeRemaining,
      teams: {
        away: { shotsOnGoal: this._asNumberOrNull(awayTeam.shotsOnGoal) },
        home: { shotsOnGoal: this._asNumberOrNull(homeTeam.shotsOnGoal) }
      }
    };

    return {
      gamePk: game.id || game.gamePk,
      gameDate: game.startTimeUTC || game.gameDate || null,
      startTimeUTC: game.startTimeUTC || null,
      season: game.season,
      status: status,
      linescore: linescore,
      teams: {
        away: { team: awayTeam.team, score: awayTeam.score },
        home: { team: homeTeam.team, score: homeTeam.score }
      }
    };
  },

  _normalizeNhlStatsRestGame(game) {
    if (!game) return null;

    const periodDescriptor = {
      number: this._asNumberOrNull(game.period),
      periodType: game.periodType,
      periodTimeRemaining: game.gameClock
    };

    const status = this._nhlScoreboardStatus({
      gameState: game.gameState,
      gameScheduleState: game.gameScheduleState,
      clock: game.gameClock
    }, periodDescriptor);

    const away = this._normalizeNhlStatsRestTeam(game, "away");
    const home = this._normalizeNhlStatsRestTeam(game, "home");

    const linescore = {
      currentPeriod: this._asNumberOrNull(game.period),
      currentPeriodOrdinal: this._nhlScoreboardPeriodOrdinal(periodDescriptor),
      currentPeriodTimeRemaining: this._nhlScoreboardText(game.gameClock || ""),
      teams: {
        away: { shotsOnGoal: away.shotsOnGoal },
        home: { shotsOnGoal: home.shotsOnGoal }
      }
    };

    const gamePk = this._asNumberOrNull(game.gamePk || game.gameId || game.id);
    const gameDate = game.gameDate || game.startTimeUTC || null;

    return {
      gamePk: gamePk != null ? gamePk : (game.gamePk || game.gameId || game.id),
      gameDate,
      startTimeUTC: game.startTimeUTC || gameDate || null,
      season: game.seasonId || game.season || null,
      status,
      linescore,
      teams: {
        away: { team: away.team, score: away.score },
        home: { team: home.team, score: home.score }
      }
    };
  },

  _normalizeNhlStatsRestTeam(game, side) {
    const prefix = side === "home" ? "home" : "away";

    const abbr = this._nhlScoreboardText(
      game[`${prefix}TeamAbbrev`]
        || game[`${prefix}TeamAbbreviation`]
        || game[`${prefix}TeamTriCode`]
        || game[`${prefix}TeamShortName`]
        || ""
    ).toUpperCase();

    const location = this._nhlScoreboardText(
      game[`${prefix}TeamPlaceName`]
        || game[`${prefix}TeamLocation`]
        || game[`${prefix}TeamCity`]
        || game[`${prefix}TeamMarket`]
        || ""
    );

    const name = this._nhlScoreboardText(
      game[`${prefix}TeamCommonName`]
        || game[`${prefix}TeamName`]
        || game[`${prefix}TeamNickName`]
        || game[`${prefix}TeamFullName`]
        || ""
    );

    const shortName = this._nhlScoreboardText(game[`${prefix}TeamShortName`] || name || abbr || "");

    const display = (location && name) ? `${location} ${name}`.trim() : (name || location || abbr || "");

    const shotKeys = [
      `${prefix}TeamShotsOnGoal`,
      `${prefix}TeamSOG`,
      `${prefix}TeamSoG`,
      `${prefix}TeamShots`,
      `${prefix}ShotsOnGoal`,
      `${prefix}Shots`
    ];
    let shots = null;
    for (let i = 0; i < shotKeys.length; i += 1) {
      shots = this._asNumberOrNull(game[shotKeys[i]]);
      if (shots != null) break;
    }

    const id = this._asNumberOrNull(game[`${prefix}TeamId`] || game[`${prefix}TeamID`] || game[`${prefix}Team`]);

    const scoreKeys = [
      `${prefix}TeamScore`,
      `${prefix}Score`
    ];
    let score = null;
    for (let j = 0; j < scoreKeys.length; j += 1) {
      score = this._asNumberOrNull(game[scoreKeys[j]]);
      if (score != null) break;
    }

    return {
      team: {
        id: id != null ? id : undefined,
        name: display,
        teamName: name || display,
        locationName: location,
        abbreviation: abbr,
        teamAbbreviation: abbr,
        shortName
      },
      score,
      shotsOnGoal: shots
    };
  },

  _normalizeNhlScoreboardTeam(team) {
    if (!team) {
      return {
        team: {},
        score: null,
        shotsOnGoal: null
      };
    }

    const abbrRaw = this._nhlScoreboardText(team.teamAbbrev || team.abbrev || team.triCode || team.teamCode || team.shortName || "");
    const abbr = abbrRaw ? abbrRaw.toUpperCase() : "";
    const place = this._nhlScoreboardText(team.placeName || team.locationName || team.city || team.market || "");
    const name = this._nhlScoreboardText(team.teamName || team.nickName || team.name || "");
    const shortName = this._nhlScoreboardText(team.shortName || name || abbr || "");
    const display = (place && name) ? `${place} ${name}`.trim() : (name || place || abbr || "");

    return {
      team: {
        id: (typeof team.id !== "undefined") ? team.id : undefined,
        name: display,
        teamName: name || display,
        locationName: place,
        abbreviation: abbr,
        teamAbbreviation: abbr,
        shortName: shortName
      },
      score: this._asNumberOrNull((typeof team.score !== "undefined") ? team.score : team.goals),
      shotsOnGoal: this._asNumberOrNull(team.sog != null ? team.sog : team.shotsOnGoal)
    };
  },

  _nhlScoreboardText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const text = this._nhlScoreboardText(value[i]);
        if (text) return text;
      }
      return "";
    }

    if (typeof value === "object") {
      const preferredKeys = ["default", "en", "en_US", "en-us", "english", "text", "name"]; // scoreboard locales vary
      for (let i = 0; i < preferredKeys.length; i += 1) {
        const key = preferredKeys[i];
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const text = this._nhlScoreboardText(value[key]);
          if (text) return text;
        }
      }

      const keys = Object.keys(value);
      for (let j = 0; j < keys.length; j += 1) {
        const text = this._nhlScoreboardText(value[keys[j]]);
        if (text) return text;
      }
      return "";
    }

    return String(value);
  },

  _nhlScoreboardStatus(game, periodDescriptor) {
    const stateRaw = (game && game.gameState) ? this._nhlScoreboardText(game.gameState) : "";
    const state = stateRaw.toUpperCase();
    const scheduleRaw = (game && game.gameScheduleState) ? this._nhlScoreboardText(game.gameScheduleState) : "";
    const schedule = scheduleRaw.toUpperCase();
    const clockRaw = (game && game.clock) ? this._nhlScoreboardText(game.clock) : "";
    const periodRemainingRaw = (periodDescriptor && periodDescriptor.periodTimeRemaining)
      ? this._nhlScoreboardText(periodDescriptor.periodTimeRemaining)
      : "";
    const timeRemainingRaw = periodRemainingRaw || clockRaw;

    let abstract = "Preview";
    let detailed = "";

    if (state === "LIVE" || state === "CRIT" || state === "CRIT_NONOT") {
      abstract = "Live";
      const ord = this._nhlScoreboardPeriodOrdinal(periodDescriptor);
      const remaining = (timeRemainingRaw || "").trim();
      if (remaining && remaining.toUpperCase() === "END") {
        detailed = ((ord ? ord + " " : "") + "End").trim();
      } else {
        const parts = [];
        if (ord) parts.push(ord);
        if (remaining) parts.push(remaining);
        detailed = parts.join(" ").trim();
      }
      if (!detailed) detailed = "Live";
    } else if (state === "FINAL" || state === "OFF" || state === "COMPLETE" || state === "COMPLETED") {
      abstract = "Final";
      detailed = this._nhlScoreboardFinalDetail(periodDescriptor);
    } else if (state === "POSTPONED" || schedule === "PPD") {
      abstract = "Preview";
      detailed = "Postponed";
    } else if (state === "SUSP" || schedule === "SUSP") {
      abstract = "Preview";
      detailed = "Suspended";
    } else if (state === "FUT" || state === "PRE" || state === "SCHEDULED") {
      abstract = "Preview";
      detailed = "Scheduled";
    } else if (state === "CANCELLED" || state === "CNCL") {
      abstract = "Preview";
      detailed = "Cancelled";
    }

    if (!detailed) {
      if (scheduleRaw) detailed = scheduleRaw;
      else detailed = stateRaw;
    }

    return {
      abstractGameState: abstract,
      detailedState: detailed
    };
  },

  _nhlScoreboardPeriodOrdinal(periodDescriptor) {
    const number = this._asNumberOrNull(periodDescriptor && periodDescriptor.number);
    const type = ((periodDescriptor && periodDescriptor.periodType) || "").toString().toUpperCase();

    if (!Number.isFinite(number)) return "";

    if (type === "SO") return "SO";
    if (type === "OT") {
      if (number <= 4) return "OT";
      return `${number - 3}OT`;
    }

    if (number === 1) return "1st";
    if (number === 2) return "2nd";
    if (number === 3) return "3rd";
    return `${number}th`;
  },

  _nhlScoreboardFinalDetail(periodDescriptor) {
    const type = ((periodDescriptor && periodDescriptor.periodType) || "").toString().toUpperCase();
    const number = this._asNumberOrNull(periodDescriptor && periodDescriptor.number);

    if (type === "SO") return "Final/SO";
    if (type === "OT") {
      if (number && number > 4) {
        return `Final/${number - 3}OT`;
      }
      return "Final/OT";
    }
    return "Final";
  },

  _asNumberOrNull(value) {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;

    const intVal = parseInt(value, 10);
    return Number.isFinite(intVal) ? intVal : null;
  },

  async _fetchNbaGames() {
    try {
      const { dateIso, dateCompact } = this._getTargetDate();
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateCompact}`;
      const res = await fetch(url);
      const json = await res.json();
      const events = Array.isArray(json.events) ? json.events : [];

      events.sort((a, b) => {
        const dateA = this._firstDate(
          a && a.date,
          a && a.startDate,
          a && a.startTimeUTC,
          a && a.competitions && a.competitions[0] && (a.competitions[0].date || a.competitions[0].startDate || a.competitions[0].startTimeUTC)
        );
        const dateB = this._firstDate(
          b && b.date,
          b && b.startDate,
          b && b.startTimeUTC,
          b && b.competitions && b.competitions[0] && (b.competitions[0].date || b.competitions[0].startDate || b.competitions[0].startTimeUTC)
        );

        if (dateA && dateB) return dateA - dateB;
        if (dateA) return -1;
        if (dateB) return 1;
        return 0;
      });

      console.log(`🏀 Sending ${events.length} NBA games for ${dateIso} to front-end.`);
      this._notifyGames("nba", events);
    } catch (e) {
      console.error("🚨 NBA fetchGames failed:", e);
    }
  },

  async _fetchNflGames() {
    try {
      const {
        startIso,
        endIso,
        dateIsos
      } = this._getNflWeekDateRange();

      const aggregated = new Map();
      const byeTeams = new Map();

      for (let i = 0; i < dateIsos.length; i += 1) {
        const dateIso = dateIsos[i];
        const dateCompact = dateIso.replace(/-/g, "");
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateCompact}`;

        try {
          const res = await fetch(url);
          const json = await res.json();
          const events = Array.isArray(json.events) ? json.events : [];
          const week = json && json.week;
          const teamsOnBye = week && Array.isArray(week.teamsOnBye) ? week.teamsOnBye : [];

          for (let j = 0; j < events.length; j += 1) {
            const event = events[j];
            if (!event) continue;
            const key = event.id || event.uid || `${dateIso}-${j}`;
            if (!aggregated.has(key)) aggregated.set(key, event);
          }

          for (let b = 0; b < teamsOnBye.length; b += 1) {
            const bye = this._normalizeNflByeTeam(teamsOnBye[b]);
            if (bye) byeTeams.set(bye.abbreviation, bye);
          }
        } catch (err) {
          console.error(`🚨 NFL fetchGames failed for ${dateIso}:`, err);
        }
      }

      const games = Array.from(aggregated.values());
      games.sort((a, b) => {
        const dateA = this._firstDate(
          a && a.date,
          a && a.startDate,
          a && a.startTimeUTC,
          a && a.competitions && a.competitions[0] && (a.competitions[0].date || a.competitions[0].startDate || a.competitions[0].startTimeUTC)
        );
        const dateB = this._firstDate(
          b && b.date,
          b && b.startDate,
          b && b.startTimeUTC,
          b && b.competitions && b.competitions[0] && (b.competitions[0].date || b.competitions[0].startDate || b.competitions[0].startTimeUTC)
        );

        if (dateA && dateB) return dateA - dateB;
        if (dateA) return -1;
        if (dateB) return 1;
        return 0;
      });

      const byeList = Array.from(byeTeams.values());
      byeList.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

      console.log(`🏈 Sending ${games.length} NFL games (${startIso} → ${endIso}) to front-end.${byeList.length ? ` ${byeList.length} teams on bye.` : ""}`);
      this._notifyGames("nfl", games, { teamsOnBye: byeList });
    } catch (e) {
      console.error("🚨 NFL fetchGames failed:", e);
    }
  },

  _firstDate(...values) {
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (!value) continue;
      const dt = new Date(value);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return null;
  },

  _getLeague() {
    if (Array.isArray(this.leagues) && this.leagues.length > 0) {
      return this.leagues[0];
    }
    const cfg = this.config || {};
    const source = (typeof cfg.leagues !== "undefined") ? cfg.leagues : cfg.league;
    const leagues = this._coerceLeagueArray(source);
    if (leagues.length > 0) return leagues[0];
    return "mlb";
  },

  _normalizeNflByeTeam(team) {
    if (!team) return null;

    const abbreviationSource =
      team.abbreviation || team.shortDisplayName || team.name || team.location || "";
    const abbreviation = String(abbreviationSource).trim();
    if (!abbreviation) return null;

    const normalizedAbbr = abbreviation.toUpperCase();
    const nameSource =
      team.displayName || team.name || team.shortDisplayName || team.location || normalizedAbbr;
    const displayName = String(nameSource).trim() || normalizedAbbr;

    return {
      id: team.id || team.uid || normalizedAbbr,
      abbreviation: normalizedAbbr,
      displayName,
      shortDisplayName: team.shortDisplayName || null
    };
  },

  _notifyGames(league, games, extras = null) {
    const normalizedLeague = this._normalizeLeagueKey(league) || this._getLeague();
    let normalizedGames;
    if (Array.isArray(games)) normalizedGames = games;
    else if (games && typeof games === "object" && Array.isArray(games.games)) {
      normalizedGames = games.games;
    } else {
      normalizedGames = [];
    }

    const payload = { league: normalizedLeague, games: normalizedGames };

    if (extras && typeof extras === "object") {
      Object.keys(extras).forEach((key) => {
        payload[key] = extras[key];
      });
    }

    this.sendSocketNotification("GAMES", payload);
  },

  _normalizeLeagueKey(value) {
    if (value == null) return null;
    const str = String(value).trim().toLowerCase();
    return SUPPORTED_LEAGUES.includes(str) ? str : null;
  },

  _coerceLeagueArray(input) {
    const tokens = [];
    const collect = (entry) => {
      if (entry == null) return;
      if (Array.isArray(entry)) {
        for (let i = 0; i < entry.length; i += 1) collect(entry[i]);
        return;
      }
      const str = String(entry).trim();
      if (!str) return;
      const parts = str.split(/[\s,]+/);
      for (let j = 0; j < parts.length; j += 1) {
        const part = parts[j].trim();
        if (part) tokens.push(part);
      }
    };

    collect(input);

    const normalized = [];
    const seen = new Set();
    for (let k = 0; k < tokens.length; k += 1) {
      const token = tokens[k];
      const lower = token.toLowerCase();
      if (lower === "all") {
        return SUPPORTED_LEAGUES.slice();
      }
      if (SUPPORTED_LEAGUES.includes(lower) && !seen.has(lower)) {
        normalized.push(lower);
        seen.add(lower);
      }
    }
    return normalized;
  },

  _resolveConfiguredLeagues() {
    const cfg = this.config || {};
    const source = (typeof cfg.leagues !== "undefined") ? cfg.leagues : cfg.league;
    const leagues = this._coerceLeagueArray(source);
    return Array.isArray(leagues) ? leagues : [];
  },

  _getTargetDate() {
    const tz = this.config && this.config.timeZone ? this.config.timeZone : "America/Chicago";
    const now = new Date();
    let dateIso = now.toLocaleDateString("en-CA", { timeZone: tz });
    const timeCT  = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [hStr, mStr] = timeCT.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    // Before 9:30 AM local time, show yesterday's schedule (catch late finishes)
    if (h < 9 || (h === 9 && m < 30)) {
      const dt = new Date(dateIso);
      dt.setDate(dt.getDate() - 1);
      dateIso = dt.toISOString().slice(0, 10);
    }

    return {
      dateIso,
      dateCompact: dateIso.replace(/-/g, "")
    };
  },

  _getNhlScoreboardDate() {
    const tz = this.config && this.config.timeZone ? this.config.timeZone : "America/Chicago";
    const now = new Date();
    let dateIso = now.toLocaleDateString("en-CA", { timeZone: tz });
    const timeStr = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [hStr, mStr] = timeStr.split(":");
    const hour = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);

    if (hour < 9 || (hour === 9 && minute < 30)) {
      const dt = new Date(dateIso);
      dt.setDate(dt.getDate() - 1);
      dateIso = dt.toISOString().slice(0, 10);
    }

    return dateIso;
  },

  _getNflWeekDateRange() {
    const tz = this.config && this.config.timeZone ? this.config.timeZone : "America/Chicago";
    const now = new Date();

    const dateIso = now.toLocaleDateString("en-CA", { timeZone: tz });
    const timeStr = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [hStr, mStr] = timeStr.split(":");
    const hour = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);

    const localMidnight = new Date(`${dateIso}T00:00:00Z`);
    const dayOfWeek = localMidnight.getUTCDay();

    const weekStart = new Date(localMidnight);
    const offset = (dayOfWeek - 4 + 7) % 7; // 4 === Thursday
    weekStart.setUTCDate(weekStart.getUTCDate() - offset);

    const minutes = (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
    if (dayOfWeek === 3 && minutes >= (9 * 60)) {
      weekStart.setUTCDate(weekStart.getUTCDate() + 7);
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 4);

    const dateIsos = [];
    const cursor = new Date(weekStart);
    while (cursor.getTime() <= weekEnd.getTime()) {
      dateIsos.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      startIso: weekStart.toISOString().slice(0, 10),
      endIso: weekEnd.toISOString().slice(0, 10),
      dateIsos
    };
  }
});
