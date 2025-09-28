// node_helper.js
const NodeHelper = require("node_helper");
const fetch      = global.fetch;

const SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl"];

module.exports = NodeHelper.create({
  start() {
    console.log("🛰️ MMM-ScoresAndStandings helper started");
    this.scoreIntervals = {};
    this.standInterval = null;
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INIT") {
      this.config = payload || {};
      this.leagues = this._getLeagues();
      this.league = this.leagues[0] || "mlb";

      this._clearIntervals();

      const scoreInterval = Math.max(10 * 1000, this.config.updateIntervalScores || (60 * 1000));
      for (const league of this.leagues) {
        this._fetchGamesForLeague(league);
        this.scoreIntervals[league] = setInterval(() => this._fetchGamesForLeague(league), scoreInterval);
      }

      if (this.leagues.includes("mlb")) {
        this._fetchStandings();
        const standInterval = Math.max(60 * 1000, this.config.updateIntervalStandings || (15 * 60 * 1000));
        this.standInterval = setInterval(() => this._fetchStandings(), standInterval);
      } else {
        this.sendSocketNotification("STANDINGS", []);
      }
    }
  },

  _clearIntervals() {
    if (this.scoreIntervals) {
      for (const key of Object.keys(this.scoreIntervals)) {
        clearInterval(this.scoreIntervals[key]);
      }
    }
    this.scoreIntervals = {};
    if (this.standInterval) {
      clearInterval(this.standInterval);
      this.standInterval = null;
    }
  },

  async _fetchGames() {
    return this._fetchGamesForLeague(this._getLeague());
  },

  async _fetchGamesForLeague(league) {
    const sanitized = this._sanitizeLeague(league) || "mlb";
    if (sanitized === "nhl") return this._fetchNhlGames();
    if (sanitized === "nfl") return this._fetchNflGames();
    return this._fetchMlbGames();
  },

  async _fetchStandings() {
    const leagues = Array.isArray(this.leagues) ? this.leagues : this._getLeagues();
    if (!leagues.includes("mlb")) return;

    try {
      const season = new Date().getFullYear();

      // 1) Regular division records (NL + AL)
      const [nlRes, alRes] = await Promise.all([
        fetch(`https://statsapi.mlb.com/api/v1/standings?season=${season}&leagueId=104`),
        fetch(`https://statsapi.mlb.com/api/v1/standings?season=${season}&leagueId=103`)
      ]);
      const [nlJson, alJson] = await Promise.all([nlRes.json(), alRes.json()]);
      const regular = [
        ...(nlJson.records || []),
        ...(alJson.records || [])
      ];
      // Sort by numeric division ID
      regular.sort((a, b) => a.division.id - b.division.id);

      // 2) Wild Card standings (league-wide)
      const [nlWCRes, alWCRes] = await Promise.all([
        fetch(`https://statsapi.mlb.com/api/v1/standings?season=${season}&leagueId=104&standingsTypes=wildCard`),
        fetch(`https://statsapi.mlb.com/api/v1/standings?season=${season}&leagueId=103&standingsTypes=wildCard`)
      ]);
      const [nlWCJson, alWCJson] = await Promise.all([nlWCRes.json(), alWCRes.json()]);
      const nlWCRecs = nlWCJson.records?.[0]?.teamRecords || [];
      const alWCRecs = alWCJson.records?.[0]?.teamRecords || [];

      // Append as pseudo-records for NL & AL Wild Card
      regular.push(
        { division: { id: "NL", name: "NL Wild Card" }, teamRecords: nlWCRecs },
        { division: { id: "AL", name: "AL Wild Card" }, teamRecords: alWCRecs }
      );

      console.log(`📊 Sending ${regular.length} division standings to front-end.`);
      this.sendSocketNotification("STANDINGS", regular);
    } catch (e) {
      console.error("🚨 fetchStandings failed:", e);
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
      this.sendSocketNotification("GAMES", { league: "mlb", games });
    } catch (e) {
      console.error("🚨 MLB fetchGames failed:", e);
    }
  },

  async _fetchNhlGames() {
    try {
      const { dateIso } = this._getTargetDate();
      const url  = `https://statsapi.web.nhl.com/api/v1/schedule?date=${dateIso}&expand=schedule.linescore`;
      const res  = await fetch(url);
      const json = await res.json();
      const games = (json.dates && json.dates[0] && json.dates[0].games) || [];

      console.log(`🏒 Sending ${games.length} NHL games to front-end.`);
      this.sendSocketNotification("GAMES", { league: "nhl", games });
    } catch (e) {
      console.error("🚨 NHL fetchGames failed:", e);
    }
  },

  async _fetchNflGames() {
    try {
      const { dateCompact } = this._getTargetDate();
      const url  = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateCompact}`;
      const res  = await fetch(url);
      const json = await res.json();
      const games = json.events || [];

      console.log(`🏈 Sending ${games.length} NFL games to front-end.`);
      this.sendSocketNotification("GAMES", { league: "nfl", games });
    } catch (e) {
      console.error("🚨 NFL fetchGames failed:", e);
    }
  },

  _sanitizeLeague(value) {
    if (typeof value !== "string") return null;
    const lower = value.trim().toLowerCase();
    return SUPPORTED_LEAGUES.includes(lower) ? lower : null;
  },

  _getLeagues() {
    const leagues = [];
    if (this.config && Array.isArray(this.config.leagues)) {
      for (const entry of this.config.leagues) {
        const cleaned = this._sanitizeLeague(entry);
        if (cleaned && !leagues.includes(cleaned)) leagues.push(cleaned);
      }
    } else if (this.config && typeof this.config.leagues === "string" && this.config.leagues.trim() !== "") {
      const single = this._sanitizeLeague(this.config.leagues);
      if (single) leagues.push(single);
    }

    if (!leagues.length) {
      const fallback = this._sanitizeLeague(this.config && this.config.league);
      leagues.push(fallback || "mlb");
    }

    return leagues;
  },

  _getLeague() {
    if (Array.isArray(this.leagues) && this.leagues.length) {
      return this.leagues[0];
    }
    const fromConfig = this._getLeagues();
    return fromConfig[0] || "mlb";
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
