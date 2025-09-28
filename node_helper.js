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
      if (this.league === "mlb") {
        this._fetchStandings();
      } else {
        // Immediately clear out any previous standings on the front-end
        this.sendSocketNotification("STANDINGS", []);
      }

      const scoreInterval = Math.max(10 * 1000, this.config.updateIntervalScores || (60 * 1000));
      setInterval(() => this._fetchGames(), scoreInterval);

      if (this.league === "mlb") {
        const standInterval = Math.max(60 * 1000, this.config.updateIntervalStandings || (15 * 60 * 1000));
        setInterval(() => this._fetchStandings(), standInterval);
      }
    }
  },

  async _fetchGames() {
    const league = this._getLeague();
    if (league === "nhl") return this._fetchNhlGames();
    if (league === "nfl") return this._fetchNflGames();
    return this._fetchMlbGames();
  },

  async _fetchStandings() {
    if (this._getLeague() !== "mlb") return;

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
