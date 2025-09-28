// node_helper.js
const NodeHelper = require("node_helper");
const fetch      = global.fetch;

module.exports = NodeHelper.create({
  start() {
    console.log("🛰️ MMM-MLBScoresAndStandings helper started");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INIT") {
      this.config = payload;
      this._fetchGames();
      this._fetchStandings();
      setInterval(() => this._fetchGames(), this.config.updateIntervalScores);
      setInterval(() => this._fetchStandings(), this.config.updateIntervalStandings);
    }
  },

  async _fetchGames() {
    try {
      const tz      = this.config.timeZone || "America/Chicago";
      let dateCT    = new Date().toLocaleDateString("en-CA", { timeZone: tz });
      const timeCT  = new Date().toLocaleTimeString("en-GB", {
        timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit"
      });
      const [hStr, mStr] = timeCT.split(":");
      const h = parseInt(hStr, 10), m = parseInt(mStr, 10);

      // Before 8:45 AM CT show yesterday's games
      if (h < 8 || (h === 8 && m < 45)) {
        const dt = new Date(dateCT);
        dt.setDate(dt.getDate() - 1);
        dateCT = dt.toISOString().slice(0, 10);
      }

      const url  = `https://statsapi.mlb.com/api/v1/schedule/games?sportId=1&date=${dateCT}&hydrate=linescore`;
      const res  = await fetch(url);
      const json = await res.json();
      const games = (json.dates[0] && json.dates[0].games) || [];

      console.log(`📡 Sending ${games.length} games to front-end.`);
      this.sendSocketNotification("GAMES", games);
    } catch (e) {
      console.error("🚨 fetchGames failed:", e);
    }
  },

  async _fetchStandings() {
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
  }
});
