// node_helper.js
const NodeHelper = require("node_helper");
const fetch      = global.fetch;

module.exports = NodeHelper.create({
  start() {
    console.log("🛰️ MMM-ScoresAndStandings helper started");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INIT") {
      this.config = payload || {};
      this.league = this._getLeague();

      this._fetchGames();

      const scoreInterval = Math.max(10 * 1000, this.config.updateIntervalScores || (60 * 1000));
      setInterval(() => this._fetchGames(), scoreInterval);
    }
  },

  async _fetchGames() {
    const league = this._getLeague();
    if (league === "nhl") return this._fetchNhlGames();
    if (league === "nfl") return this._fetchNflGames();
    return this._fetchMlbGames();
  },

  async _fetchMlbGames() {
    try {
      const { dateIso } = this._getTargetDate();
      const url  = `https://statsapi.mlb.com/api/v1/schedule/games?sportId=1&date=${dateIso}&hydrate=linescore`;
      const res  = await fetch(url);
      const json = await res.json();
      const games = (json.dates && json.dates[0] && json.dates[0].games) || [];

      console.log(`⚾️ Sending ${games.length} MLB games to front-end.`);
      this.sendSocketNotification("GAMES", games);
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

      console.log(`🏒 Sending ${games.length} NHL games to front-end.`);
      this.sendSocketNotification("GAMES", games);
      return;
    } catch (e) {
      console.error("🚨 NHL fetchGames failed:", e);
      console.info(`ℹ️ Falling back to api-web NHL scoreboard endpoint for ${dateIso}`);
    }

    try {
      const fallbackGames = await this._fetchNhlScoreboardFallback(dateIso);
      console.log(`🏒 Sending ${fallbackGames.length} NHL games to front-end (fallback).`);
      this.sendSocketNotification("GAMES", fallbackGames);
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

    const abbr = (team.teamAbbrev || team.abbrev || team.triCode || team.teamCode || team.shortName || "").toString().toUpperCase();
    const place = (team.placeName || team.locationName || team.city || team.market || "") + "";
    const name = (team.teamName || team.nickName || team.name || "") + "";
    const shortName = (team.shortName || name || abbr || "") + "";
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
      const { dateCompact } = this._getTargetDate();
      const url  = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateCompact}`;
      const res  = await fetch(url);
      const json = await res.json();
      const games = json.events || [];

      console.log(`🏈 Sending ${games.length} NFL games to front-end.`);
      this.sendSocketNotification("GAMES", games);
    } catch (e) {
      console.error("🚨 NFL fetchGames failed:", e);
    }
  },

  _getLeague() {
    const league = this.config && this.config.league ? this.config.league : "mlb";
    return String(league).trim().toLowerCase();
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
  }
});
