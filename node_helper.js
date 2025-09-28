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
    try {
      const { dateIso } = this._getTargetDate();
      const url  = `https://statsapi.web.nhl.com/api/v1/schedule?date=${dateIso}&expand=schedule.linescore`;
      const res  = await fetch(url);
      const json = await res.json();
      const games = (json.dates && json.dates[0] && json.dates[0].games) || [];

      console.log(`🏒 Sending ${games.length} NHL games to front-end.`);
      this.sendSocketNotification("GAMES", games);
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
