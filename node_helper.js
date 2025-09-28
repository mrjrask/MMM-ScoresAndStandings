// node_helper.js
const NodeHelper = require("node_helper");
const fetch      = global.fetch;

const SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl"];

module.exports = NodeHelper.create({
  start() {
    console.log("🛰️ MMM-ScoresAndStandings helper started");
    this.fetchTimer = null;
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
    const primaryUrl = `https://statsapi.web.nhl.com/api/v1/schedule?date=${dateIso}&expand=schedule.linescore`;

    try {
      const res  = await fetch(primaryUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json = await res.json();
      const games = (json.dates && json.dates[0] && json.dates[0].games) || [];

      if (Array.isArray(games) && games.length > 0) {
        console.log(`🏒 Sending ${games.length} NHL games to front-end.`);
        this._notifyGames("nhl", games);
        return;
      }

      console.info(`ℹ️ Primary NHL stats API returned no games for ${dateIso}; attempting scoreboard fallback.`);
    } catch (e) {
      console.error("🚨 NHL fetchGames failed:", e);
      console.info(`ℹ️ Falling back to api-web NHL scoreboard endpoint for ${dateIso}`);
    }

    try {
      const fallbackGames = await this._fetchNhlScoreboardFallback(dateIso);
      console.log(`🏒 Sending ${fallbackGames.length} NHL games to front-end (fallback).`);
      this._notifyGames("nhl", fallbackGames);
    } catch (fallbackError) {
      console.error("🚨 NHL fallback fetchGames failed:", fallbackError);
    }
  },

  async _fetchNhlScoreboardFallback(dateIso) {
    const fallbackUrl = `https://api-web.nhle.com/v1/scoreboard/${dateIso}`;
    const res = await fetch(fallbackUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const rawGames = Array.isArray(json.games) ? json.games : [];
    const normalized = [];

    for (let i = 0; i < rawGames.length; i++) {
      const mapped = this._normalizeNhlScoreboardGame(rawGames[i]);
      if (mapped) normalized.push(mapped);
    }

    return normalized;
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

    // Before 8:45 AM local time, show yesterday's schedule (catch late finishes)
    if (h < 8 || (h === 8 && m < 45)) {
      const dt = new Date(dateIso);
      dt.setDate(dt.getDate() - 1);
      dateIso = dt.toISOString().slice(0, 10);
    }

    return {
      dateIso,
      dateCompact: dateIso.replace(/-/g, "")
    };
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
