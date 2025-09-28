/* MMM-ScoresAndStandings.js */
/* global Module */

(function () {
  "use strict";

  var MLB_ABBREVIATIONS = {
    "Chicago Cubs": "CUBS","Atlanta Braves": "ATL","Miami Marlins": "MIA",
    "New York Mets": "NYM","Philadelphia Phillies": "PHI","Washington Nationals": "WAS",
    "Cincinnati Reds": "CIN","Milwaukee Brewers": "MIL","Pittsburgh Pirates": "PIT",
    "St. Louis Cardinals": "STL","Arizona Diamondbacks": "ARI","Colorado Rockies": "COL",
    "Los Angeles Dodgers": "LAD","San Diego Padres": "SD","San Francisco Giants": "SF",
    "Baltimore Orioles": "BAL","Boston Red Sox": "BOS","New York Yankees": "NYY",
    "Tampa Bay Rays": "TB","Toronto Blue Jays": "TOR","Chicago White Sox": "SOX",
    "Cleveland Guardians": "CLE","Detroit Tigers": "DET","Kansas City Royals": "KC",
    "Minnesota Twins": "MIN","Houston Astros": "HOU","Los Angeles Angels": "LAA",
    "Athletics": "ATH","Seattle Mariners": "SEA","Texas Rangers": "TEX"
  };

  // Scoreboard layout defaults (can be overridden via config)
  var DEFAULT_SCOREBOARD_COLUMNS    = 2;
  var DEFAULT_GAMES_PER_COLUMN      = 2;

  // Division pairs (2 per page), then Wild Card pages (1 per page)
  var DIV_PAIRS = [
    [204, 201], // NL East & AL East
    [205, 202], // NL Central & AL Central
    [203, 200]  // NL West & AL West
  ];
  var WILD_CARD_ORDER = ["NL", "AL"];
  var NL_DIVS = { 203: true, 204: true, 205: true };
  var AL_DIVS = { 200: true, 201: true, 202: true };

  var DIVISION_LABELS = {
    204: "NL East", 205: "NL Central", 203: "NL West",
    201: "AL East", 202: "AL Central", 200: "AL West",
    "NL": "NL Wild Card", "AL": "AL Wild Card"
  };

  Module.register("MMM-ScoresAndStandings", {
    defaults: {
      updateIntervalScores:            60 * 1000,
      updateIntervalStandings:       15 * 60 * 1000,
      scoreboardColumns:               DEFAULT_SCOREBOARD_COLUMNS,
      gamesPerColumn:                  DEFAULT_GAMES_PER_COLUMN,
      gamesPerPage:                      null,
      league:                        "mlb",
      layoutScale:                     1.0,
      rotateIntervalScores:           15 * 1000,
      rotateIntervalEast:              7 * 1000,
      rotateIntervalCentral:          12 * 1000,
      rotateIntervalWest:              7 * 1000,
      timeZone:               "America/Chicago",
      highlightedTeams:                 [],
      showTitle:                        true,
      useTimesSquareFont:               true,

      // Standings options
      showHomeAwaySplits:               true,
      showDivisionStandings:            true,
      showWildCardStandings:            true,

      // Width cap so it behaves in middle_center
      maxWidth:                      "800px"
    },

    getHeader: function () {
      if (!this.config.showTitle) return null;
      var league = this._getLeague();
      var showingGames = (this.totalStandPages === 0) || (this.currentScreen < this.totalGamePages);
      if (league === "mlb") {
        return showingGames ? "MLB Scoreboard" : "MLB Standings";
      }
      var title = (league === "nhl") ? "NHL Scoreboard" : "NFL Scoreboard";
      return title;
    },

    getScripts: function () {
      return ["https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.1/moment.min.js"];
    },

    getStyles: function () {
      return ["MMM-ScoresAndStandings.css"];
    },

    start: function () {
      this.games           = [];
      this.recordGroups    = []; // six division records from helper
      this.loadedGames     = false;
      this.loadedStandings = false;

      this._scoreboardColumns = DEFAULT_SCOREBOARD_COLUMNS;
      this._scoreboardRows    = DEFAULT_GAMES_PER_COLUMN;
      this._gamesPerPage      = this._scoreboardColumns * this._scoreboardRows;
      this._layoutScale       = 1;

      // pages: N game pages + 3 division pages (pair) + 2 wild card pages
      this.totalGamePages  = 1;
      this.totalStandPages = 0;
      this.currentScreen   = 0;
      this.rotateTimer     = null;
      this._headerStyleInjectedFor = null;

      this._syncScoreboardLayout();
      this._standingsPages = [];
      this._refreshStandingsPagination();

      this.sendSocketNotification("INIT", this.config);
      var self = this;
      setInterval(function () { self.sendSocketNotification("INIT", self.config); },
        Math.min(this.config.updateIntervalScores, this.config.updateIntervalStandings));

      this._scheduleRotate();
    },

    // ---------- helpers ----------
    _toCssSize: function (v, fallback) {
      if (fallback == null) fallback = "800px";
      if (v == null) return fallback;
      if (typeof v === "number") return v + "px";
      var s = String(v).trim();
      if (/^\d+$/.test(s)) return s + "px";
      return s;
    },

    _getLeague: function () {
      var league = this.config && this.config.league ? this.config.league : "mlb";
      return String(league).trim().toLowerCase();
    },

    _injectHeaderWidthStyle: function () {
      var cap = this._toCssSize(this.config.maxWidth, "800px");
      if (this._headerStyleInjectedFor === cap) return;

      var styleId = this.identifier + "-width-style";
      var el = document.getElementById(styleId);
      var css =
        "#" + this.identifier + " .module-header{max-width:" + cap + ";margin:0 auto;display:block;}";

      if (!el) {
        el = document.createElement("style");
        el.id = styleId;
        el.type = "text/css";
        el.textContent = css;
        document.head.appendChild(el);
      } else {
        el.textContent = css;
      }
      this._headerStyleInjectedFor = cap;
    },

    _asPositiveInt: function (val, fallback) {
      var num = parseInt(val, 10);
      var finite = (typeof Number.isFinite === "function") ? Number.isFinite(num) : isFinite(num);
      return finite && num > 0 ? num : fallback;
    },

    _syncScoreboardLayout: function () {
      var columns   = this._asPositiveInt(this.config.scoreboardColumns, DEFAULT_SCOREBOARD_COLUMNS);
      var perColumn = this._asPositiveInt(this.config.gamesPerColumn, DEFAULT_GAMES_PER_COLUMN);

      var gamesPerPage = columns * perColumn;

      if (this.config.gamesPerPage != null) {
        var override = this._asPositiveInt(this.config.gamesPerPage, gamesPerPage);
        gamesPerPage = override;
        perColumn = Math.max(1, Math.ceil(gamesPerPage / columns));
      }

      this._scoreboardColumns = columns;
      this._scoreboardRows    = perColumn;
      this._gamesPerPage      = Math.max(1, gamesPerPage);
      this._layoutScale       = this._resolveLayoutScale();
    },

    _resolveLayoutScale: function () {
      var raw = parseFloat(this.config.layoutScale);
      var finite = (typeof Number.isFinite === "function") ? Number.isFinite(raw) : isFinite(raw);
      if (!finite || raw <= 0) return 1;
      var min = 0.6;
      var max = 1.4;
      if (raw < min) return min;
      if (raw > max) return max;
      return raw;
    },

    _scheduleRotate: function () {
      var total = this.totalGamePages + this.totalStandPages;
      var delay = this.config.rotateIntervalScores;

      if (this.currentScreen >= this.totalGamePages) {
        var idx = this.currentScreen - this.totalGamePages;
        var intervals = [
          this.config.rotateIntervalEast,    // pair 0
          this.config.rotateIntervalCentral, // pair 1
          this.config.rotateIntervalWest     // pair 2
        ];
        delay = intervals[idx] || this.config.rotateIntervalEast;
      }

      var self = this;
      clearTimeout(this.rotateTimer);
      this.rotateTimer = setTimeout(function () {
        self.currentScreen = (self.currentScreen + 1) % total;
        self.updateDom(300);
        self._scheduleRotate();
      }, delay);
    },

    socketNotificationReceived: function (notification, payload) {
      try {
        if (notification === "GAMES") {
          this.loadedGames    = true;
          this.games          = Array.isArray(payload) ? payload : [];
          this._syncScoreboardLayout();
          this.totalGamePages = Math.max(1, Math.ceil(this.games.length / this._gamesPerPage));
          this._refreshStandingsPagination();
          this.updateDom();
        }
        if (notification === "STANDINGS") {
          this.loadedStandings = true;
          this.recordGroups    = Array.isArray(payload) ? payload : [];
          this.updateDom();
        }
      } catch (e) {
        console.error("MMM-ScoresAndStandings: socket handler error", e);
      }
    },

    _noData: function (msg) {
      var div = document.createElement("div");
      div.className = "small dimmed";
      div.innerText = msg;
      return div;
    },

    getDom: function () {
      this._injectHeaderWidthStyle();

      var wrapper = document.createElement("div");
      var showingGames = (this.totalStandPages === 0) || (this.currentScreen < this.totalGamePages);
      wrapper.className = showingGames ? "scores-screen" : "standings-screen";

      var fontClass = (this.config.useTimesSquareFont === false) ? "font-default" : "font-times-square";
      wrapper.classList.add(fontClass);

      var scale = (typeof this._layoutScale === "number") ? this._layoutScale : this._resolveLayoutScale();
      if (scale !== 1) wrapper.style.setProperty("--box-scale", scale);
      else wrapper.style.removeProperty("--box-scale");

      if (this.data && this.data.position !== "fullscreen_above") {
        var cssSize = this._toCssSize(this.config.maxWidth, "800px");
        wrapper.style.maxWidth = cssSize;
        wrapper.style.margin = "0 auto";
        wrapper.style.display = "block";
        wrapper.style.width = "100%";
        wrapper.style.overflow = "hidden";
      }

      if (showingGames && !this.loadedGames)       return this._noData("Loading games...");
      if (!showingGames && !this.loadedStandings)  return this._noData("Loading standings...");
      if (showingGames && this.games.length === 0) return this._noData("No games to display.");
      if (!showingGames && this.recordGroups.length === 0) return this._noData("Standings unavailable.");

      try {
        wrapper.appendChild(showingGames ? this._buildGames() : this._buildStandings());
      } catch (e) {
        console.error("MMM-ScoresAndStandings: getDom build error", e);
        return this._noData("Error building view.");
      }
      return wrapper;
    },

    // ----------------- SCOREBOARD -----------------
    _buildGames: function () {
      this._syncScoreboardLayout();

      var start = this.currentScreen * this._gamesPerPage;
      var games = this.games.slice(start, start + this._gamesPerPage);

      var matrix = document.createElement("table");
      matrix.className = "games-matrix";

      var tbody = document.createElement("tbody");

      for (var r = 0; r < this._scoreboardRows; r++) {
        var row = document.createElement("tr");

        for (var c = 0; c < this._scoreboardColumns; c++) {
          var cell = document.createElement("td");
          cell.className = "games-matrix-cell";
          cell.style.setProperty("--games-matrix-col-width", (100 / this._scoreboardColumns) + "%");

          var index = r * this._scoreboardColumns + c;
          var game = games[index];
          if (game) {
            cell.appendChild(this.createGameBox(game));
          } else {
            cell.classList.add("empty");
          }

          row.appendChild(cell);
        }

        tbody.appendChild(row);
      }

      matrix.appendChild(tbody);
      return matrix;
    },

    createGameBox: function (game) {
      var league = this._getLeague();
      if (league === "nhl") return this._createNhlGameCard(game);
      if (league === "nfl") return this._createNflGameCard(game);
      return this._createMlbGameCard(game);
    },

    _createScoreboardCard: function (config) {
      var card = document.createElement("div");
      card.className = "scoreboard-card";

      var league = config && config.league ? config.league : this._getLeague();
      if (league) card.classList.add("league-" + league);

      var classes = config && config.cardClasses;
      if (Array.isArray(classes)) {
        for (var ci = 0; ci < classes.length; ci++) {
          if (classes[ci]) card.classList.add(classes[ci]);
        }
      }

      var metricLabels = (config && Array.isArray(config.metricLabels)) ? config.metricLabels : [];
      card.style.setProperty("--metric-count", metricLabels.length);

      var live = !!(config && config.live);
      var showVals = (config && typeof config.showValues !== "undefined") ? !!config.showValues : true;

      var header = document.createElement("div");
      header.className = "scoreboard-header";

      var statusEl = document.createElement("div");
      statusEl.className = "scoreboard-status" + (live ? " live" : "");
      statusEl.textContent = (config && config.statusText) ? config.statusText : "";
      header.appendChild(statusEl);

      for (var li = 0; li < metricLabels.length; li++) {
        var label = document.createElement("div");
        label.className = "scoreboard-label";
        label.textContent = metricLabels[li];
        header.appendChild(label);
      }

      card.appendChild(header);

      var body = document.createElement("div");
      body.className = "scoreboard-body";
      card.appendChild(body);

      var rows = (config && Array.isArray(config.rows)) ? config.rows : [];
      for (var ri = 0; ri < rows.length; ri++) {
        var rowData = rows[ri];
        if (!rowData) continue;

        var row = document.createElement("div");
        row.className = "scoreboard-row";
        if (rowData.type) row.classList.add(rowData.type);
        if (rowData.className) row.classList.add(rowData.className);
        if (rowData.isLoser) row.classList.add("loser");

        var team = document.createElement("div");
        team.className = "scoreboard-team";

        var abbr = rowData.abbr || "";
        var logoAbbr = rowData.logoAbbr || abbr;

        var logo = document.createElement("img");
        logo.className = "scoreboard-team-logo";
        if (logoAbbr) {
          logo.src = this.getLogoUrl(logoAbbr);
        } else {
          logo.style.display = "none";
        }
        logo.alt = abbr;
        logo.onerror = (function (imgEl) { return function () { imgEl.style.display = "none"; }; })(logo);
        team.appendChild(logo);

        var abbrEl = document.createElement("span");
        abbrEl.className = "scoreboard-team-abbr";
        abbrEl.textContent = abbr;
        team.appendChild(abbrEl);

        if (rowData.highlight) team.classList.add("team-highlight");
        row.appendChild(team);

        var metrics = Array.isArray(rowData.metrics) ? rowData.metrics : [];
        for (var mi = 0; mi < metricLabels.length; mi++) {
          var metric = metrics[mi];
          var valueEl = document.createElement("div");
          valueEl.className = "scoreboard-value" + (live ? " live" : "");

          var placeholder = "—";
          var val = null;

          if (metric != null && typeof metric === "object" && !Array.isArray(metric)) {
            if (Object.prototype.hasOwnProperty.call(metric, "placeholder")) {
              placeholder = metric.placeholder;
            }
            if (Object.prototype.hasOwnProperty.call(metric, "value")) {
              val = metric.value;
            }
          } else {
            val = metric;
          }

          if (showVals) {
            if (val == null || val === "") {
              valueEl.textContent = "";
            } else {
              valueEl.textContent = String(val);
            }
          } else {
            valueEl.textContent = placeholder;
          }

          row.appendChild(valueEl);
        }

        body.appendChild(row);
      }

      return card;
    },

    _createMlbGameCard: function (game) {
      var league = "mlb";
      var ls      = (game && game.linescore) || {};
      var state   = (game && game.status && game.status.abstractGameState) || "";
      var det     = (game && game.status && game.status.detailedState) || "";
      var innings = (ls && ls.innings) || [];

      var isSuspended = /Suspended/i.test(det) || state === "Suspended";
      var isPost      = /Postponed/i.test(det);
      var isWarmup    = det === "Warmup";
      var isPrev      = state === "Preview";
      var isFin       = state === "Final";
      var live        = !isPrev && !isFin && !isPost && !isWarmup && !isSuspended;
      var showVals    = !isPrev && !isPost && !isSuspended;

      var statusText;
      if (isSuspended)       statusText = "Suspended";
      else if (isPost)       statusText = "Postponed";
      else if (isWarmup)     statusText = "Warmup";
      else if (isPrev) {
        statusText = this._formatStartTime(game && game.gameDate);
      } else if (isFin) {
        statusText = (innings.length === 9) ? "Final" : ("Final/" + innings.length);
      } else {
        var st = (ls && ls.inningState) || "";
        var io = (ls && ls.currentInningOrdinal) || "";
        var tmp = (st + " " + io).replace(/\s+/g, " ").trim();
        statusText = tmp || "In Progress";
      }

      var cardClasses = [];
      if (isFin) cardClasses.push("is-final");
      else if (live) cardClasses.push("is-live");
      else if (isPrev) cardClasses.push("is-preview");
      else if (isPost) cardClasses.push("is-postponed");
      else if (isSuspended) cardClasses.push("is-suspended");
      else if (isWarmup) cardClasses.push("is-warmup");

      var away = game && game.teams && game.teams.away;
      var home = game && game.teams && game.teams.home;
      var awayScore = (away && typeof away.score !== "undefined") ? away.score : null;
      var homeScore = (home && typeof home.score !== "undefined") ? home.score : null;
      var lines = (ls && ls.teams) || {};
      var linesAway = lines.away || {};
      var linesHome = lines.home || {};

      var rows = [];
      var teams = [away, home];
      for (var i = 0; i < teams.length; i++) {
        var t = teams[i];
        if (!t || !t.team) continue;

        var abbr = this._abbrForTeam(t.team, league);
        var highlight = this._isHighlighted(abbr);
        var isLoser = false;
        if (isFin && awayScore != null && homeScore != null && awayScore !== homeScore) {
          var isAway = (i === 0);
          var isWinner = isAway ? (awayScore > homeScore) : (homeScore > awayScore);
          isLoser = !isWinner;
        }

        var hitVal = (i === 0 ? linesAway.hits : linesHome.hits);
        if (typeof hitVal === "undefined") hitVal = null;
        var errVal;
        if (typeof t.errors !== "undefined") errVal = t.errors;
        else errVal = (i === 0 ? linesAway.errors : linesHome.errors);
        if (typeof errVal === "undefined") errVal = null;

        var row = {
          type: (i === 0) ? "away" : "home",
          abbr: abbr,
          logoAbbr: abbr,
          highlight: highlight,
          isLoser: isLoser,
          metrics: [
            (typeof t.score !== "undefined") ? t.score : null,
            hitVal,
            errVal
          ]
        };
        rows.push(row);
      }

      return this._createScoreboardCard({
        league: league,
        live: live,
        showValues: showVals,
        statusText: statusText,
        metricLabels: ["R", "H", "E"],
        rows: rows,
        cardClasses: cardClasses
      });
    },

    _createNhlGameCard: function (game) {
      var league = "nhl";
      var ls = (game && game.linescore) || {};
      var status = (game && game.status) || {};
      var state = ((status.abstractGameState || status.detailedState || "") + "").toLowerCase();
      var detailed = status.detailedState || "";

      var isPostponed = /postponed/i.test(detailed);
      var isSuspended = /suspended/i.test(detailed);
      var isPreview = state === "preview" || state === "pre";
      var isFinal = state === "final";
      var isLive = !isFinal && !isPreview && !isPostponed && !isSuspended;

      var showVals = !(isPreview || isPostponed || isSuspended);

      var statusText = "";
      if (isPostponed) {
        statusText = "Postponed";
      } else if (isSuspended) {
        statusText = "Suspended";
      } else if (isPreview) {
        statusText = this._formatStartTime(game && (game.gameDate || game.startTimeUTC));
      } else if (isFinal) {
        statusText = detailed || "Final";
      } else if (isLive) {
        var period = ls.currentPeriodOrdinal || (ls.currentPeriod ? (ls.currentPeriod + "") : "");
        var remaining = ls.currentPeriodTimeRemaining || "";
        if (remaining && remaining.toUpperCase() === "END") {
          statusText = (period ? period + " " : "") + "End";
        } else {
          statusText = ((period ? period + " " : "") + remaining).trim();
        }
        if (!statusText) statusText = detailed || "Live";
      } else {
        statusText = detailed || "";
      }

      var cardClasses = [];
      if (isFinal) cardClasses.push("is-final");
      else if (isLive) cardClasses.push("is-live");
      else if (isPreview) cardClasses.push("is-preview");
      else if (isPostponed) cardClasses.push("is-postponed");
      else if (isSuspended) cardClasses.push("is-suspended");

      var teams = (game && game.teams) || {};
      var away = teams.away || {};
      var home = teams.home || {};

      var awayScore = (typeof away.score !== "undefined") ? away.score : null;
      var homeScore = (typeof home.score !== "undefined") ? home.score : null;

      var lsTeams = (ls && ls.teams) || {};
      var awayShots = lsTeams.away && typeof lsTeams.away.shotsOnGoal !== "undefined"
        ? lsTeams.away.shotsOnGoal : null;
      var homeShots = lsTeams.home && typeof lsTeams.home.shotsOnGoal !== "undefined"
        ? lsTeams.home.shotsOnGoal : null;

      var rows = [];
      var pair = [away, home];
      for (var i = 0; i < pair.length; i++) {
        var entry = pair[i] || {};
        if (!entry.team) continue;

        var abbr = this._abbrForTeam(entry.team, league);
        var highlight = this._isHighlighted(abbr);

        var isLoser = false;
        if (isFinal && awayScore != null && homeScore != null && awayScore !== homeScore) {
          var isAway = (i === 0);
          var isWinner = isAway ? (awayScore > homeScore) : (homeScore > awayScore);
          isLoser = !isWinner;
        }

        var metrics = [
          (typeof entry.score !== "undefined") ? entry.score : null,
          (i === 0 ? awayShots : homeShots)
        ];

        rows.push({
          type: (i === 0) ? "away" : "home",
          abbr: abbr,
          logoAbbr: abbr,
          highlight: highlight,
          isLoser: isLoser,
          metrics: metrics
        });
      }

      return this._createScoreboardCard({
        league: league,
        live: isLive,
        showValues: showVals,
        statusText: statusText,
        metricLabels: ["G", "SOG"],
        rows: rows,
        cardClasses: cardClasses
      });
    },

    _createNflGameCard: function (game) {
      var league = "nfl";
      var competition = game && game.competitions && game.competitions[0];
      if (!competition) competition = {};

      var status = (competition.status && competition.status.type) || game.status && game.status.type || {};
      var state = (status.state || "").toLowerCase();
      var detailed = status.shortDetail || status.detail || status.description || "";

      var isPreview = state === "pre" || state === "preview" || state === "scheduled";
      var isFinal = state === "post" || state === "final" || !!status.completed;
      var isLive = state === "in" || state === "live";

      var showVals = !(isPreview);

      var statusText = "";
      if (isPreview) {
        statusText = this._formatStartTime(competition.date || game.date);
      } else if (isFinal) {
        statusText = detailed || "Final";
      } else if (isLive) {
        var period = competition.status && competition.status.period;
        var ord = this._ordinal(period);
        var clock = competition.status && (competition.status.displayClock || competition.status.clock);
        var parts = [];
        if (ord) parts.push(ord);
        if (clock) parts.push(clock);
        statusText = parts.join(" ") || detailed || "Live";
      } else {
        statusText = detailed || "";
      }

      var cardClasses = [];
      if (isFinal) cardClasses.push("is-final");
      else if (isLive) cardClasses.push("is-live");
      else if (isPreview) cardClasses.push("is-preview");

      var competitors = competition.competitors || [];
      var away = null, home = null;
      for (var i = 0; i < competitors.length; i++) {
        var comp = competitors[i];
        if (!comp) continue;
        var side = (comp.homeAway || comp.homeAway === 0) ? String(comp.homeAway).toLowerCase() : "";
        if (side === "home") home = comp;
        else if (side === "away") away = comp;
      }

      // Ensure away/home order fallback
      if (!away && competitors.length > 0) away = competitors[0];
      if (!home && competitors.length > 1) home = competitors[1];

      var rows = [];
      var pair = [away, home];
      for (var idx = 0; idx < pair.length; idx++) {
        var entry = pair[idx] || {};
        var team = entry.team || {};
        var abbr = this._abbrForTeam(team, league);
        var highlight = this._isHighlighted(abbr);

        var scoreNum = (typeof entry.score !== "undefined" && entry.score !== null) ? parseInt(entry.score, 10) : null;
        if (!Number.isFinite(scoreNum)) scoreNum = null;

        var lineScores = Array.isArray(entry.linescores) ? entry.linescores : [];
        var quarters = [null, null, null, null];
        for (var lsIdx = 0; lsIdx < lineScores.length; lsIdx++) {
          var ls = lineScores[lsIdx];
          var period = ls && ls.period;
          if (period >= 1 && period <= 4) {
            quarters[period - 1] = (typeof ls.value !== "undefined") ? ls.value : null;
          }
        }

        var metrics = quarters.slice();
        metrics.push(scoreNum);

        var otherScore = null;
        if (idx === 0 && home) {
          var hs = (typeof home.score !== "undefined" && home.score !== null) ? parseInt(home.score, 10) : null;
          if (Number.isFinite(hs)) otherScore = hs;
        } else if (idx === 1 && away) {
          var as = (typeof away.score !== "undefined" && away.score !== null) ? parseInt(away.score, 10) : null;
          if (Number.isFinite(as)) otherScore = as;
        }

        var isLoser = false;
        if (isFinal && scoreNum != null && otherScore != null && scoreNum !== otherScore) {
          isLoser = scoreNum < otherScore;
        }

        rows.push({
          type: (idx === 0) ? "away" : "home",
          abbr: abbr,
          logoAbbr: abbr,
          highlight: highlight,
          isLoser: isLoser,
          metrics: metrics
        });
      }

      return this._createScoreboardCard({
        league: league,
        live: isLive,
        showValues: showVals,
        statusText: statusText,
        metricLabels: ["Q1", "Q2", "Q3", "Q4", "TOT"],
        rows: rows,
        cardClasses: cardClasses
      });
    },

    // ----------------- STANDINGS -----------------
    _buildStandings: function () {
      var wrapper = document.createElement("div");
      if (!this._standingsPages || !this._standingsPages.length) {
        wrapper.className = "standings-empty";
        return wrapper;
      }

      var idx = this.currentScreen - this.totalGamePages;
      if (idx < 0 || idx >= this._standingsPages.length) idx = 0;

      var page = this._standingsPages[idx];
      if (!page) return wrapper;

      if (page.type === "divisionPair") {
        wrapper.className = "standings-pair";
        var divs = page.divisions || [];
        for (var i = 0; i < divs.length; i++) {
          wrapper.appendChild(this._createDivisionBlock(divs[i]));
        }
      } else if (page.type === "wildCard") {
        wrapper.className = "standings-single";
        wrapper.appendChild(this._createWildCardBlock(page.league));
      }
      return wrapper;
    },

    _coerceBoolean: function (value, fallback) {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        var lower = value.trim().toLowerCase();
        if (lower === "true") return true;
        if (lower === "false") return false;
      }
      if (typeof value === "number") return value !== 0;
      return fallback;
    },

    _refreshStandingsPagination: function () {
      if (this._getLeague() !== "mlb") {
        this._standingsPages = [];
        this.totalStandPages = 0;
        if (this.currentScreen >= this.totalGamePages) this.currentScreen = 0;
        return;
      }

      var showDivisions = this._coerceBoolean(this.config.showDivisionStandings, true);
      var showWildCards = this._coerceBoolean(this.config.showWildCardStandings, true);

      var pages = [];
      if (showDivisions) {
        for (var i = 0; i < DIV_PAIRS.length; i++) {
          pages.push({ type: "divisionPair", divisions: DIV_PAIRS[i] });
        }
      }
      if (showWildCards) {
        for (var j = 0; j < WILD_CARD_ORDER.length; j++) {
          pages.push({ type: "wildCard", league: WILD_CARD_ORDER[j] });
        }
      }

      this._standingsPages = pages;
      this.totalStandPages = pages.length;

      var totalScreens = this.totalGamePages + this.totalStandPages;
      if (totalScreens === 0) totalScreens = 1;
      if (this.currentScreen >= totalScreens) this.currentScreen = 0;
    },

    _createDivisionBlock: function (divId) {
      var block = document.createElement("div");
      block.className = "standings-division";

      var title = document.createElement("h3");
      title.className = "division-title";
      title.innerText = DIVISION_LABELS[divId];
      title.style.margin = "0";
      block.appendChild(title);

      var group = null;
      for (var i = 0; i < this.recordGroups.length; i++) {
        var g = this.recordGroups[i];
        if (g && g.division && g.division.id === divId) { group = g; break; }
      }
      if (!group) group = { teamRecords: [] };

      block.appendChild(this.createStandingsTable(group, { isWildCard: false }));
      return block;
    },

    _createWildCardBlock: function (league) {
      var block = document.createElement("div");
      block.className = "standings-division";

      var title = document.createElement("h3");
      title.className = "division-title";
      title.innerText = DIVISION_LABELS[league];
      title.style.margin = "0";
      block.appendChild(title);

      var wcGroup = this._buildWildCardGroup(league === "NL" ? NL_DIVS : AL_DIVS);
      block.appendChild(this.createStandingsTable(wcGroup, { isWildCard: true }));
      return block;
    },

    _pct: function (rec) {
      var w = parseInt(rec && rec.leagueRecord && rec.leagueRecord.wins || 0, 10);
      var l = parseInt(rec && rec.leagueRecord && rec.leagueRecord.losses || 0, 10);
      return (w + l) ? (w / (w + l)) : 0;
    },

    _cmpPctDesc: function (a, b) { return this._pct(b) - this._pct(a); },

    _leadersByDivision: function () {
      var m = {};
      for (var i = 0; i < this.recordGroups.length; i++) {
        var gr = this.recordGroups[i];
        var divId = gr && gr.division && gr.division.id;
        var trs = gr && gr.teamRecords || [];
        if (!divId || !trs.length) continue;
        var sorted = trs.slice().sort(this._cmpPctDesc.bind(this));
        var leader = sorted[0];
        if (leader && leader.team && typeof leader.team.id !== "undefined") {
          m[divId] = leader.team.id;
        }
      }
      return m;
    },

    _buildWildCardGroup: function (leagueDivsMap) {
      // Gather league’s division groups
      var leagueGroups = [];
      for (var i = 0; i < this.recordGroups.length; i++) {
        var gr = this.recordGroups[i];
        if (gr && gr.division && leagueDivsMap[gr.division.id]) leagueGroups.push(gr);
      }
      if (!leagueGroups.length) return { teamRecords: [] };

      var leaders = this._leadersByDivision();
      function isLeader(rec, divId) {
        return leaders[divId] === (rec && rec.team && rec.team.id);
      }

      // Pool of non-division-leaders
      var pool = [];
      for (var g = 0; g < leagueGroups.length; g++) {
        var divId = leagueGroups[g].division.id;
        var trs = leagueGroups[g].teamRecords || [];
        for (var t = 0; t < trs.length; t++) {
          if (!isLeader(trs[t], divId)) pool.push(trs[t]);
        }
      }
      if (!pool.length) return { teamRecords: [] };

      // Sort by pct desc, then wins desc
      var sortedByPct = pool.slice().sort(function (a, b) {
        var pctDelta = (this._cmpPctDesc(a, b));
        if (pctDelta !== 0) return pctDelta;
        var aw = parseInt(a && a.leagueRecord && a.leagueRecord.wins || 0, 10);
        var bw = parseInt(b && b.leagueRecord && b.leagueRecord.wins || 0, 10);
        return bw - aw;
      }.bind(this));

      // Baseline = 3rd team
      var base = sortedByPct[Math.min(2, sortedByPct.length - 1)];

      function wcgbNum(r) {
        if (!base || !r) return 0;
        var bw = parseInt(base.leagueRecord && base.leagueRecord.wins || 0, 10);
        var bl = parseInt(base.leagueRecord && base.leagueRecord.losses || 0, 10);
        var rw = parseInt(r.leagueRecord && r.leagueRecord.wins || 0, 10);
        var rl = parseInt(r.leagueRecord && r.leagueRecord.losses || 0, 10);
        return Math.max(0, ((bw - rw) + (rl - bl)) / 2);
      }

      var withWCGB = sortedByPct.map(function (r) {
        var n = wcgbNum(r);
        r._wcgbNum = n;
        r._wcgbText = this._formatGB(n);
        return r;
      }.bind(this)).sort(function (a, b) {
        if (a._wcgbNum !== b._wcgbNum) return a._wcgbNum - b._wcgbNum; // closer to 0 first
        var pctDelta = (this._cmpPctDesc(a, b));
        if (pctDelta !== 0) return pctDelta;
        var aw = parseInt(a.leagueRecord && a.leagueRecord.wins || 0, 10);
        var bw = parseInt(b.leagueRecord && b.leagueRecord.wins || 0, 10);
        return bw - aw;
      }.bind(this));

      return { teamRecords: withWCGB };
    },

    _formatGB: function (num) {
      if (num == null) return "-";
      if (typeof num === "string") {
        if (num === "-" || num.trim() === "") return "-";
        var f = parseFloat(num);
        if (!isNaN(f)) num = f; else return "-";
      }
      if (Math.abs(num) < 1e-6) return "--";
      var m = Math.floor(num + 1e-9);
      var r = num - m;
      if (Math.abs(r - 0.5) < 1e-6) {
        return (m === 0)
          ? "<span class=\"fraction\">1/2</span>"
          : (m + "<span class=\"fraction\">1/2</span>");
      }
      if (Math.abs(r) < 1e-6) return String(m);
      return num.toFixed(1).replace(/\.0$/, "");
    },

    _formatENum: function (val) {
      if (val == null) return "-";
      if (val === "-" || val === "--") return val;
      var n = parseInt(val, 10);
      if (!isNaN(n)) return n === 0 ? "--" : String(n);
      return String(val);
    },

    _appendHeaderCell: function (tr, label, cls, sepRight) {
      var th = document.createElement("th");
      th.innerText = label;
      if (cls) th.classList.add(cls);
      if (sepRight) th.classList.add("sep-right");
      tr.appendChild(th);
    },

    createStandingsTable: function (group, opts) {
      opts = opts || {};
      var isWildCard = !!opts.isWildCard;
      var showSplits = !!this.config.showHomeAwaySplits;

      var table = document.createElement("table");
      table.className = isWildCard ? "mlb-standings mlb-standings--wc" : "mlb-standings mlb-standings--div";

      // HEADERS
      var trH = document.createElement("tr");
      if (isWildCard) {
        // ["", "W-L", "W%", "WCGB", "E#", "Streak", "L10", [Home, Away]]
        this._appendHeaderCell(trH, "",     "team-col");
        this._appendHeaderCell(trH, "W-L",  "wl-col");
        this._appendHeaderCell(trH, "W%",   "pct-col", true); // thick after W%
        this._appendHeaderCell(trH, "WCGB", "wcgb-col");
        this._appendHeaderCell(trH, "E#",   "wce-col", true); // thick after WCE#
        this._appendHeaderCell(trH, "Streak","streak-col");
        this._appendHeaderCell(trH, "L10",  "l10-col");
        if (showSplits) {
          this._appendHeaderCell(trH, "Home","home-col");
          this._appendHeaderCell(trH, "Away","away-col");
        }
      } else {
        // ["", "W-L", "W%", "GB", "E#", "WCGB", "E#", "Streak", "L10", [Home, Away]]
        this._appendHeaderCell(trH, "",     "team-col");
        this._appendHeaderCell(trH, "W-L",  "wl-col");
        this._appendHeaderCell(trH, "W%",   "pct-col", true); // thick after W%
        this._appendHeaderCell(trH, "GB",   "gb-col");
        this._appendHeaderCell(trH, "E#",   "e-col",  true);  // thick between E# and WCGB
        this._appendHeaderCell(trH, "WCGB", "wcgb-col");
        this._appendHeaderCell(trH, "E#",   "wce-col", true); // thick between WCE# and Streak
        this._appendHeaderCell(trH, "Streak","streak-col");
        this._appendHeaderCell(trH, "L10",  "l10-col");
        if (showSplits) {
          this._appendHeaderCell(trH, "Home","home-col");
          this._appendHeaderCell(trH, "Away","away-col");
        }
      }
      table.appendChild(trH);

      // ROWS
      var trs = (group && group.teamRecords) ? group.teamRecords : [];
      for (var i = 0; i < trs.length; i++) {
        var rec = trs[i];
        var tr = document.createElement("tr");
        if (isWildCard && i === 3) tr.style.borderTop = "2px solid #FFD242"; // separator after top 3

        var ab = "";
        if (rec && rec.team) {
          ab = MLB_ABBREVIATIONS[rec.team.name] || rec.team.abbreviation || "";
        }
        if (this._isHighlighted(ab)) tr.classList.add("team-highlight");

        // Team
        var tdT = document.createElement("td");
        tdT.className = "team-col team-cell";

        var img = document.createElement("img");
        img.src = this.getLogoUrl(ab);
        img.alt = ab;
        img.className = "logo-cell";
        img.onerror = (function (imgEl) { return function () { imgEl.style.display = "none"; }; })(img);
        tdT.appendChild(img);

        var sp = document.createElement("span");
        sp.className = "abbr";
        sp.innerText = ab;
        tdT.appendChild(sp);

        tr.appendChild(tdT);

        // W-L, W%
        var lr = rec && rec.leagueRecord || {};
        var W  = parseInt(lr.wins || 0, 10);
        var L  = parseInt(lr.losses || 0, 10);
        var pct = (W + L > 0) ? ((W / (W + L)).toFixed(3).replace(/^0/, "")) : "-";

        var tdWL = document.createElement("td");
        tdWL.className = "wl-col";
        tdWL.innerText = (W + "-" + L);
        tr.appendChild(tdWL);

        var tdPct = document.createElement("td");
        tdPct.className = "pct-col sep-right"; // thick after W%
        tdPct.innerText = pct;
        tr.appendChild(tdPct);

        if (isWildCard) {
          // WCGB, E#(wildcard)
          var tdWC = document.createElement("td");
          tdWC.className = "wcgb-col";
          tdWC.innerHTML = (typeof rec._wcgbText === "string")
            ? rec._wcgbText
            : this._formatGB(rec && rec.wildCardGamesBack);
          tr.appendChild(tdWC);

          var tdEw = document.createElement("td");
          tdEw.className = "wce-col sep-right";
          tdEw.innerText = this._formatENum(rec && rec.wildCardEliminationNumber);
          tr.appendChild(tdEw);
        } else {
          // GB, E# (division)
          var tdGB = document.createElement("td");
          tdGB.className = "gb-col";
          tdGB.innerHTML = this._formatGB(rec && rec.divisionGamesBack);
          tr.appendChild(tdGB);

          var tdEd = document.createElement("td");
          tdEd.className = "e-col sep-right";
          tdEd.innerText = this._formatENum(rec && rec.eliminationNumber);
          tr.appendChild(tdEd);

          // WCGB, E# (wildcard)
          var tdWC2 = document.createElement("td");
          tdWC2.className = "wcgb-col";
          tdWC2.innerHTML = this._formatGB(rec && rec.wildCardGamesBack);
          tr.appendChild(tdWC2);

          var tdEwc2 = document.createElement("td");
          tdEwc2.className = "wce-col sep-right";
          tdEwc2.innerText = this._formatENum(rec && rec.wildCardEliminationNumber);
          tr.appendChild(tdEwc2);
        }

        // Streak
        var tdStreak = document.createElement("td");
        tdStreak.className = "streak-col";
        tdStreak.innerText = (rec && rec.streak && rec.streak.streakCode) ? rec.streak.streakCode : "-";
        tr.appendChild(tdStreak);

        // L10
        var splitRecs = (rec && rec.records && rec.records.splitRecords) ? rec.records.splitRecords : [];
        var s10 = null;
        for (var s = 0; s < splitRecs.length; s++) {
          var typ = (splitRecs[s].type || "").toLowerCase();
          if (typ === "lastten") { s10 = splitRecs[s]; break; }
        }
        var tdL10 = document.createElement("td");
        tdL10.className = "l10-col";
        tdL10.innerText = s10 ? (s10.wins + "-" + s10.losses) : "-";
        tr.appendChild(tdL10);

        // Home/Away (optional)
        if (showSplits) {
          var home = null, away = null;
          for (var s2 = 0; s2 < splitRecs.length; s2++) {
            var typ2 = (splitRecs[s2].type || "").toLowerCase();
            if (typ2 === "home") home = splitRecs[s2];
            if (typ2 === "away") away = splitRecs[s2];
          }
          var tdHome = document.createElement("td");
          tdHome.className = "home-col";
          tdHome.innerText = home ? (home.wins + "-" + home.losses) : "-";
          tr.appendChild(tdHome);

          var tdAway = document.createElement("td");
          tdAway.className = "away-col";
          tdAway.innerText = away ? (away.wins + "-" + away.losses) : "-";
          tr.appendChild(tdAway);
        }

        table.appendChild(tr);
      }

      return table;
    },

    _formatStartTime: function (isoDate) {
      if (!isoDate) return "";
      try {
        var date = new Date(isoDate);
        if (isNaN(date.getTime())) return "";
        return date.toLocaleTimeString("en-US", {
          timeZone: this.config.timeZone || "America/Chicago",
          hour12: true,
          hour: "numeric",
          minute: "2-digit"
        });
      } catch (e) {
        return "";
      }
    },

    _ordinal: function (period) {
      var n = parseInt(period, 10);
      if (!Number.isFinite(n) || n <= 0) return "";
      if (n === 1) return "Q1";
      if (n === 2) return "Q2";
      if (n === 3) return "Q3";
      if (n === 4) return "Q4";
      return "OT";
    },

    _abbrForTeam: function (team, league) {
      if (!team) return "";
      var abbr = "";
      var name = team.name || team.teamName || "";
      league = (league || this._getLeague() || "").toLowerCase();

      if (league === "mlb") {
        abbr = MLB_ABBREVIATIONS[name] || team.abbreviation || team.teamAbbreviation || team.triCode || "";
      } else if (league === "nhl") {
        abbr = team.teamAbbreviation || team.abbreviation || team.triCode || team.shortName || name;
      } else if (league === "nfl") {
        abbr = team.abbreviation || team.teamAbbreviation || team.shortDisplayName || team.nickname || name;
      }

      if (!abbr && typeof team.abbreviation === "string") abbr = team.abbreviation;
      return (abbr || "").toString().toUpperCase();
    },

    _isHighlighted: function (abbr) {
      var h = this.config.highlightedTeams;
      if (Array.isArray(h)) return h.indexOf(abbr) !== -1;
      if (typeof h === "string") return h.toUpperCase() === String(abbr).toUpperCase();
      return false;
    },

    getLogoUrl: function (abbr) {
      var league = this._getLeague();
      var path;
      if (league === "nhl") {
        path = "images/nhl/" + String(abbr || "").toUpperCase() + ".png";
      } else if (league === "nfl") {
        path = "images/nfl/" + String(abbr || "").toLowerCase() + ".png";
      } else {
        path = "images/mlb/" + String(abbr || "").toUpperCase() + ".png";
      }
      return this.file(path);
    }
  });
})();
