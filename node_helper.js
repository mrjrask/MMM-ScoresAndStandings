// node_helper.js
const NodeHelper = require("node_helper");
const fetch      = global.fetch;
const dns        = require("dns");

const SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl"];

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

        this._notifyGames("nhl", games);
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

        this._notifyGames("nhl", games);
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
          this._notifyGames("nhl", restGames);
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
      this._notifyGames("nhl", []);
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

    const shotCandidates = [teamEntry.shotsOnGoal, teamEntry.sog];
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
    if (Object.prototype.hasOwnProperty.call(team, "shotsOnGoal")) {
      const sog = this._asNumberOrNull(team.shotsOnGoal);
      team.shotsOnGoal = (sog != null) ? sog : team.shotsOnGoal;
    } else {
      team.shotsOnGoal = null;
    }
    return team;
  },

  _normalizeNhlScoreboardGame(game) {
    if (!game) return null;

    const periodDescriptor = game.periodDescriptor || {};
    const status = this._nhlScoreboardStatus(game, periodDescriptor);

    const awayTeam = this._normalizeNhlScoreboardTeam(game.awayTeam);
    const homeTeam = this._normalizeNhlScoreboardTeam(game.homeTeam);

    const linescore = {
      currentPeriod: this._asNumberOrNull(periodDescriptor.number),
      currentPeriodOrdinal: this._nhlScoreboardPeriodOrdinal(periodDescriptor),
      currentPeriodTimeRemaining: ((periodDescriptor.periodTimeRemaining || game.clock || "") + "").trim(),
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
    const stateRaw = (game && game.gameState ? String(game.gameState) : "");
    const state = stateRaw.toUpperCase();
    const scheduleRaw = (game && game.gameScheduleState ? String(game.gameScheduleState) : "");
    const schedule = scheduleRaw.toUpperCase();
    const clockRaw = (game && game.clock ? String(game.clock) : "");
    const timeRemainingRaw = periodDescriptor && periodDescriptor.periodTimeRemaining
      ? String(periodDescriptor.periodTimeRemaining)
      : clockRaw;

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

  async _fetchNflGames() {
    try {
      const {
        startIso,
        endIso,
        dateIsos
      } = this._getNflWeekDateRange();

      const aggregated = new Map();

      for (let i = 0; i < dateIsos.length; i += 1) {
        const dateIso = dateIsos[i];
        const dateCompact = dateIso.replace(/-/g, "");
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateCompact}`;

        try {
          const res = await fetch(url);
          const json = await res.json();
          const events = Array.isArray(json.events) ? json.events : [];

          for (let j = 0; j < events.length; j += 1) {
            const event = events[j];
            if (!event) continue;
            const key = event.id || event.uid || `${dateIso}-${j}`;
            if (!aggregated.has(key)) aggregated.set(key, event);
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

      console.log(`🏈 Sending ${games.length} NFL games (${startIso} → ${endIso}) to front-end.`);
      this._notifyGames("nfl", games);
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

  _notifyGames(league, games) {
    const normalizedLeague = this._normalizeLeagueKey(league) || this._getLeague();
    const payload = {
      league: normalizedLeague,
      games: Array.isArray(games) ? games : []
    };
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
