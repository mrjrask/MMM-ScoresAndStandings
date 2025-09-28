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

  var SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl"];

  Module.register("MMM-ScoresAndStandings", {
    defaults: {
      updateIntervalScores:            60 * 1000,
      scoreboardColumns:               DEFAULT_SCOREBOARD_COLUMNS,
      gamesPerColumn:                  DEFAULT_GAMES_PER_COLUMN,
      gamesPerPage:                      null,
      league:                        "mlb",
      layoutScale:                     1.0,
      rotateIntervalScores:           15 * 1000,
      timeZone:               "America/Chicago",
      highlightedTeams_mlb:             [],
      highlightedTeams_nhl:             [],
      highlightedTeams_nfl:             [],
      showTitle:                        true,
      useTimesSquareFont:               true,

      // Width cap so it behaves in middle_center
      maxWidth:                      "800px"
    },

    getHeader: function () {
      if (!this.config.showTitle) return null;
      var league = this._getLeague();
      if (league === "mlb") return "MLB Scoreboard";
      if (league === "nhl") return "NHL Scoreboard";
      if (league === "nfl") return "NFL Scoreboard";
      return "Scoreboard";
    },

    getScripts: function () {
      return ["https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.1/moment.min.js"];
    },

    getStyles: function () {
      return ["MMM-ScoresAndStandings.css"];
    },

    start: function () {
      this.games       = [];
      this.loadedGames = false;
      this.gamesByLeague   = {};
      this.loadedLeagues   = {};

      this._leagueRotation    = this._resolveConfiguredLeagues();
      if (!Array.isArray(this._leagueRotation) || this._leagueRotation.length === 0) {
        this._leagueRotation = ["mlb"];
      }
      this._activeLeagueIndex = 0;

      this._scoreboardColumns = DEFAULT_SCOREBOARD_COLUMNS;
      this._scoreboardRows    = DEFAULT_GAMES_PER_COLUMN;
      this._gamesPerPage      = this._scoreboardColumns * this._scoreboardRows;
      this._layoutScale       = 1;

      this.totalGamePages = 1;
      this.currentScreen  = 0;
      this.rotateTimer    = null;
      this._headerStyleInjectedFor = null;

      this._applyActiveLeagueState();

      var self = this;
      var sendInit = function () { self.sendSocketNotification("INIT", self._buildHelperConfig()); };
      sendInit();
      var refreshInterval = this._asPositiveInt(this.config.updateIntervalScores, 60 * 1000);
      setInterval(sendInit, refreshInterval);

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
      if (Array.isArray(this._leagueRotation) && this._leagueRotation.length > 0) {
        var idx = (typeof this._activeLeagueIndex === "number") ? this._activeLeagueIndex : 0;
        if (idx < 0 || idx >= this._leagueRotation.length) idx = 0;
        return this._leagueRotation[idx];
      }
      var leagues = this._resolveConfiguredLeagues();
      if (leagues.length > 0) return leagues[0];
      return "mlb";
    },

    _normalizeLeagueKey: function (value) {
      if (value == null) return null;
      var str = String(value).trim().toLowerCase();
      return (SUPPORTED_LEAGUES.indexOf(str) !== -1) ? str : null;
    },

    _coerceLeagueArray: function (input) {
      var tokens = [];
      var collect = function (entry) {
        if (entry == null) return;
        if (Array.isArray(entry)) {
          for (var i = 0; i < entry.length; i++) collect(entry[i]);
          return;
        }
        var str = String(entry).trim();
        if (!str) return;
        var parts = str.split(/[\s,]+/);
        for (var j = 0; j < parts.length; j++) {
          var part = parts[j].trim();
          if (part) tokens.push(part);
        }
      };
      collect(input);

      var normalized = [];
      var seen = {};
      for (var k = 0; k < tokens.length; k++) {
        var token = tokens[k];
        var lower = token.toLowerCase();
        if (lower === "all") {
          return SUPPORTED_LEAGUES.slice();
        }
        if (SUPPORTED_LEAGUES.indexOf(lower) !== -1 && !seen[lower]) {
          normalized.push(lower);
          seen[lower] = true;
        }
      }
      return normalized;
    },

    _resolveConfiguredLeagues: function () {
      var cfg = this.config || {};
      var source = (typeof cfg.leagues !== "undefined") ? cfg.leagues : cfg.league;
      var leagues = this._coerceLeagueArray(source);
      return Array.isArray(leagues) ? leagues : [];
    },

    _buildHelperConfig: function () {
      var leagues = this._resolveConfiguredLeagues();
      if (!Array.isArray(leagues) || leagues.length === 0) leagues = ["mlb"];
      var payload = Object.assign({}, this.config);
      payload.leagues = leagues.slice();
      payload.league  = leagues[0];
      payload.activeLeague = this._getLeague();
      return payload;
    },

    _applyActiveLeagueState: function () {
      this._syncScoreboardLayout();
      var league = this._getLeague();
      var byLeague = this.gamesByLeague || {};
      var storedGames = byLeague[league];
      this.games = Array.isArray(storedGames) ? storedGames : [];
      var loaded = this.loadedLeagues || {};
      this.loadedGames = !!loaded[league];
      this.totalGamePages = Math.max(1, Math.ceil(this.games.length / this._gamesPerPage));
      if (this.currentScreen >= this.totalGamePages) this.currentScreen = 0;
    },

    _getHighlightedTeamsConfig: function () {
      var league = this._getLeague();
      if (league === "nhl") return this.config.highlightedTeams_nhl;
      if (league === "nfl") return this.config.highlightedTeams_nfl;
      return this.config.highlightedTeams_mlb;
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
      var delay = this._asPositiveInt(this.config.rotateIntervalScores, 15 * 1000);

      var self = this;
      clearTimeout(this.rotateTimer);
      this.rotateTimer = setTimeout(function () {
        self._advanceRotation();
        self.updateDom(300);
        self._scheduleRotate();
      }, delay);
    },

    _advanceRotation: function () {
      var total = Math.max(1, this.totalGamePages);
      if (this.currentScreen + 1 < total) {
        this.currentScreen += 1;
        return;
      }

      this.currentScreen = 0;

      if (!Array.isArray(this._leagueRotation) || this._leagueRotation.length <= 1) {
        return;
      }

      var idx = (typeof this._activeLeagueIndex === "number") ? this._activeLeagueIndex : 0;
      idx = (idx + 1) % this._leagueRotation.length;
      this._activeLeagueIndex = idx;
      this._applyActiveLeagueState();
    },

    _toNumberOrNull: function (value) {
      if (value == null) return null;
      if (typeof value === "number" && Number.isFinite(value)) return value;

      var str = String(value).trim();
      if (!str) return null;

      var num = Number(str);
      if (Number.isFinite(num)) return num;

      var intVal = parseInt(str, 10);
      return Number.isFinite(intVal) ? intVal : null;
    },

    _firstNumber: function () {
      for (var i = 0; i < arguments.length; i++) {
        var candidate = this._toNumberOrNull(arguments[i]);
        if (candidate != null) return candidate;
      }
      return null;
    },

    _metricsContainValues: function (metrics) {
      if (!Array.isArray(metrics)) return false;
      for (var i = 0; i < metrics.length; i++) {
        var metric = metrics[i];
        if (metric == null) continue;
        if (typeof metric === "object" && !Array.isArray(metric)) {
          if (metric.value != null && metric.value !== "") return true;
        } else if (metric !== "") {
          return true;
        }
      }
      return false;
    },

    _rowsContainValues: function (rows) {
      if (!Array.isArray(rows)) return false;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row) continue;
        if (this._metricsContainValues(row.metrics)) return true;
      }
      return false;
    },

    socketNotificationReceived: function (notification, payload) {
      try {
        if (notification === "GAMES") {
          var league = null;
          var games = [];

          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            league = this._normalizeLeagueKey(payload.league);
            if (Array.isArray(payload.games)) games = payload.games;
          } else if (Array.isArray(payload)) {
            games = payload;
          }

          if (!league) league = this._getLeague();

          if (!this.gamesByLeague) this.gamesByLeague = {};
          this.gamesByLeague[league] = games;

          if (!this.loadedLeagues) this.loadedLeagues = {};
          this.loadedLeagues[league] = true;

          if (!Array.isArray(this._leagueRotation) || this._leagueRotation.length === 0) {
            this._leagueRotation = [league];
            this._activeLeagueIndex = 0;
          } else if (this._leagueRotation.indexOf(league) === -1) {
            this._leagueRotation.push(league);
          }

          this._applyActiveLeagueState();
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
      wrapper.className = "scores-screen";

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

      if (!this.loadedGames) return this._noData("Loading games...");
      if (this.games.length === 0) return this._noData("No games to display.");

      try {
        wrapper.appendChild(this._buildGames());
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
      if (config && config.teamTotalLabel) {
        var totalLabelEl = document.createElement("span");
        totalLabelEl.className = "scoreboard-team-total-label";
        totalLabelEl.textContent = config.teamTotalLabel;
        statusEl.appendChild(totalLabelEl);
      }
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

        if (Object.prototype.hasOwnProperty.call(rowData, "total") || Object.prototype.hasOwnProperty.call(rowData, "totalPlaceholder")) {
          var totalEl = document.createElement("span");
          totalEl.className = "scoreboard-team-total";
          var totalPlaceholder = (rowData.totalPlaceholder != null) ? rowData.totalPlaceholder : "—";
          if (showVals) {
            if (rowData.total == null || rowData.total === "") {
              totalEl.textContent = "";
            } else {
              totalEl.textContent = String(rowData.total);
            }
          } else {
            totalEl.textContent = totalPlaceholder;
          }
          team.appendChild(totalEl);
        }
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

      awayShots = this._firstNumber(awayShots, lsTeams.away && lsTeams.away.sog, away && away.shotsOnGoal);
      homeShots = this._firstNumber(homeShots, lsTeams.home && lsTeams.home.sog, home && home.shotsOnGoal);

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

        var goals = this._firstNumber(entry.score, entry.goals, entry.team && entry.team.score);
        var metrics = [
          goals,
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

      if (!showVals && this._rowsContainValues(rows)) showVals = true;

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

        var scoreNum = this._firstNumber(entry.score, entry.points, entry.team && entry.team.score);

        var lineScores = Array.isArray(entry.linescores) ? entry.linescores : [];
        var quarters = [null, null, null, null];
        for (var lsIdx = 0; lsIdx < lineScores.length; lsIdx++) {
          var ls = lineScores[lsIdx];
          var period = ls && ls.period;
          if (period >= 1 && period <= 4) {
            quarters[period - 1] = this._firstNumber(
              ls.value,
              ls.displayValue,
              ls.score,
              ls.points
            );
          }
        }

        var metrics = quarters.slice();

        var totalScore = scoreNum;
        if (totalScore == null) {
          var runningTotal = 0;
          var haveQuarterScore = false;
          for (var qIdx = 0; qIdx < quarters.length; qIdx++) {
            var quarterVal = quarters[qIdx];
            if (quarterVal == null || quarterVal === "") continue;
            var numericQuarter = Number(quarterVal);
            if (!isNaN(numericQuarter)) {
              runningTotal += numericQuarter;
              haveQuarterScore = true;
            }
          }
          if (haveQuarterScore) {
            totalScore = runningTotal;
          }
        }

        var otherScore = null;
        if (idx === 0 && home) {
          otherScore = this._firstNumber(home.score, home.points, home.team && home.team.score);
        } else if (idx === 1 && away) {
          otherScore = this._firstNumber(away.score, away.points, away.team && away.team.score);
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
          metrics: metrics,
          total: totalScore,
          totalPlaceholder: isPreview ? "" : "—"
        });
      }

      if (!showVals && this._rowsContainValues(rows)) showVals = true;

      return this._createScoreboardCard({
        league: league,
        live: isLive,
        showValues: showVals,
        statusText: statusText,
        metricLabels: ["Q1", "Q2", "Q3", "Q4"],
        rows: rows,
        cardClasses: cardClasses,
        teamTotalLabel: "TOT"
      });
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
      var h = this._getHighlightedTeamsConfig();

      // Backwards compatibility for legacy `highlightedTeams`
      if ((h == null || (Array.isArray(h) && h.length === 0)) && this.config.highlightedTeams != null) {
        h = this.config.highlightedTeams;
      }

      if (Array.isArray(h)) {
        var upper = String(abbr || "").toUpperCase();
        for (var i = 0; i < h.length; i++) {
          if (String(h[i] || "").toUpperCase() === upper) return true;
        }
        return false;
      }

      if (typeof h === "string") {
        return String(h).toUpperCase() === String(abbr || "").toUpperCase();
      }

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
