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
  var DEFAULT_SCOREBOARD_COLUMNS        = 2;
  var DEFAULT_SCOREBOARD_COLUMNS_PRO    = 4;
  var DEFAULT_GAMES_PER_COLUMN          = 2;
  var DEFAULT_GAMES_PER_COLUMN_PRO      = 4;

  var SCOREBOARD_CARD_WIDTH_BASE        = 320;
  var SCOREBOARD_CARD_WIDTH_BASE_COMPACT = 170;
  var MATRIX_GAP_BASE                   = 12;

  var CONFIG_KEY_ALIASES = {
    gamesPerColumn: ["scoreboardRows", "rowsPerColumn"]
  };

  var EXTENDED_LAYOUT_LEAGUES = { nfl: true, nhl: true, nba: true };

  var SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl", "nba"];
  var MLB_MAX_GAMES_PER_PAGE = 8;

  Module.register("MMM-ScoresAndStandings", {
    defaults: {
      updateIntervalScores:            60 * 1000,
      scoreboardColumns:               null,
      gamesPerColumn:                  null,
      gamesPerPage:                      null,
      league:                        "mlb",
      layoutScale:                     1.0,
      rotateIntervalScores:           15 * 1000,
      timeZone:               "America/Chicago",
      highlightedTeams_mlb:             [],
      highlightedTeams_nhl:             [],
      highlightedTeams_nfl:             [],
      highlightedTeams_nba:             [],
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
      if (league === "nba") return "NBA Scoreboard";
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
      this.extrasByLeague  = {};
      this.currentExtras   = null;

      this._leagueRotation    = this._resolveConfiguredLeagues();
      if (!Array.isArray(this._leagueRotation) || this._leagueRotation.length === 0) {
        this._leagueRotation = ["mlb"];
      }
      this._activeLeagueIndex = 0;

      this._scoreboardColumns = this._defaultColumnsForLeague();
      this._scoreboardRows    = this._defaultRowsForLeague();
      this._gamesPerPage      = this._scoreboardColumns * this._scoreboardRows;
      this._layoutScale       = 1;

      this.totalGamePages = 1;
      this.currentScreen  = 0;
      this.rotateTimer    = null;
      this._headerStyleInjectedFor = null;
      this._rightPlacement = this._detectRightPlacement(false);
      this._placementCheckTimer = null;
      this._lastRenderedDom = null;

      this._applyActiveLeagueState();

      var self = this;
      var sendInit = function () { self.sendSocketNotification("INIT", self._buildHelperConfig()); };
      sendInit();
      var refreshInterval = this._asPositiveInt(this.config.updateIntervalScores, 60 * 1000);
      setInterval(sendInit, refreshInterval);

      this._scheduleRotate();
    },

    notificationReceived: function (notification) {
      if (notification === "MODULE_DOM_CREATED" || notification === "DOM_OBJECTS_CREATED") {
        this._schedulePlacementCheck(100);
      }
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

    _extractModulePosition: function () {
      if (this.data && typeof this.data.position === "string") {
        var pos = this.data.position.trim();
        if (pos) return pos;
      }
      if (this.config && typeof this.config.position === "string") {
        var cfgPos = this.config.position.trim();
        if (cfgPos) return cfgPos;
      }
      if (this.data && this.data.config && typeof this.data.config.position === "string") {
        var dataPos = this.data.config.position.trim();
        if (dataPos) return dataPos;
      }
      return null;
    },

    _detectRightPlacement: function (allowDom) {
      var pos = this._extractModulePosition();
      if (pos) {
        if (pos.indexOf("_right") !== -1 || /(^|_|-)right$/i.test(pos)) return true;
        if (pos.indexOf("_left") !== -1 || /(^|_|-)left$/i.test(pos)) return false;
        if (pos.indexOf("_center") !== -1 || /(^|_|-)center$/i.test(pos)) return false;
      }

      if (allowDom !== false && typeof document !== "undefined" && document.getElementById) {
        var dom = document.getElementById(this.identifier);
        if (!dom && this._lastRenderedDom) dom = this._lastRenderedDom;

        var node = dom;
        while (node) {
          if (node.classList && node.classList.contains("region")) {
            if (node.classList.contains("right")) return true;
            return false;
          }
          node = node.parentElement;
        }
      }

      return null;
    },

    _shouldUseRightPlacement: function () {
      if (typeof this._rightPlacement === "boolean") return this._rightPlacement;
      var detected = this._detectRightPlacement(false);
      if (typeof detected === "boolean") {
        this._rightPlacement = detected;
        return detected;
      }
      return false;
    },

    _schedulePlacementCheck: function (delay) {
      if (typeof delay !== "number" || !isFinite(delay) || delay < 0) delay = 200;
      if (this._placementCheckTimer != null) return;

      var self = this;
      this._placementCheckTimer = setTimeout(function () {
        self._placementCheckTimer = null;
        self._verifyPlacementFromDom();
      }, delay);
    },

    _verifyPlacementFromDom: function () {
      var detected = this._detectRightPlacement(true);
      if (typeof detected === "boolean") {
        if (detected !== this._rightPlacement) {
          this._rightPlacement = detected;
          this.updateDom();
        }
      } else {
        this._schedulePlacementCheck(500);
      }
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
      var extrasStore = this.extrasByLeague || {};
      if (Object.prototype.hasOwnProperty.call(extrasStore, league)) {
        this.currentExtras = extrasStore[league];
      } else {
        this.currentExtras = null;
      }
      this.totalGamePages = Math.max(1, Math.ceil(this.games.length / this._gamesPerPage));
      if (this.currentScreen >= this.totalGamePages) this.currentScreen = 0;
    },

    _getHighlightedTeamsConfig: function () {
      var league = this._getLeague();
      if (league === "nhl") return this.config.highlightedTeams_nhl;
      if (league === "nfl") return this.config.highlightedTeams_nfl;
      if (league === "nba") return this.config.highlightedTeams_nba;
      return this.config.highlightedTeams_mlb;
    },

    _injectHeaderWidthStyle: function () {
      var cap = this._toCssSize(this.config.maxWidth, "800px");
      if (this._headerStyleInjectedFor === cap) return;

      var styleId = this.identifier + "-width-style";
      var el = document.getElementById(styleId);
      var css =
        "#" + this.identifier + " .module-header{max-width:" + cap + ";margin:0 auto;display:block;width:min(100%,var(--scoreboard-content-width," + cap + "));}";

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

    _defaultColumnsForLeague: function () {
      var league = this._getLeague();
      if (EXTENDED_LAYOUT_LEAGUES[league]) return DEFAULT_SCOREBOARD_COLUMNS_PRO;
      return DEFAULT_SCOREBOARD_COLUMNS;
    },

    _defaultRowsForLeague: function () {
      var league = this._getLeague();
      if (EXTENDED_LAYOUT_LEAGUES[league]) return DEFAULT_GAMES_PER_COLUMN_PRO;
      return DEFAULT_GAMES_PER_COLUMN;
    },

    _minimumLayoutForLeague: function (league) {
      if (!league) league = this._getLeague();
      if (EXTENDED_LAYOUT_LEAGUES[league]) {
        return { columns: DEFAULT_SCOREBOARD_COLUMNS_PRO, rows: DEFAULT_GAMES_PER_COLUMN_PRO };
      }
      return { columns: DEFAULT_SCOREBOARD_COLUMNS, rows: DEFAULT_GAMES_PER_COLUMN };
    },

    _maximumGamesPerPageForLeague: function (league) {
      if (!league) league = this._getLeague();
      if (league === "mlb") return MLB_MAX_GAMES_PER_PAGE;
      return null;
    },

    _syncScoreboardLayout: function () {
      var league        = this._getLeague();
      var defaultCols   = this._defaultColumnsForLeague();
      var defaultRows   = this._defaultRowsForLeague();
      var minimums      = this._minimumLayoutForLeague(league);

      var columns = this._asPositiveInt(
        this._getConfigValueForLeague("scoreboardColumns"),
        defaultCols
      );
      var perColumn = this._asPositiveInt(
        this._getConfigValueForLeague("gamesPerColumn"),
        defaultRows
      );

      if (minimums) {
        if (columns < minimums.columns) columns = minimums.columns;
        if (perColumn < minimums.rows) perColumn = minimums.rows;
      }

      var gamesPerPage = columns * perColumn;
      var gamesPerPageConfig = this._getConfigValueForLeague("gamesPerPage");

      if (gamesPerPageConfig != null) {
        var override = this._asPositiveInt(gamesPerPageConfig, gamesPerPage);
        if (override < columns) override = columns;
        var computedRows = Math.max(1, Math.ceil(override / columns));
        if (minimums && computedRows < minimums.rows) computedRows = minimums.rows;
        perColumn = computedRows;
        gamesPerPage = columns * perColumn;
        if (gamesPerPage < override) {
          perColumn = Math.max(perColumn, Math.ceil(override / columns));
          if (minimums && perColumn < minimums.rows) perColumn = minimums.rows;
          gamesPerPage = columns * perColumn;
        }
      } else {
        gamesPerPage = columns * perColumn;
      }

      var maxGames = this._maximumGamesPerPageForLeague(league);
      if (typeof maxGames === "number" && isFinite(maxGames) && maxGames > 0) {
        var minColumns = minimums ? minimums.columns : 1;
        var minRows = minimums ? minimums.rows : 1;

        if (columns > maxGames) columns = Math.max(minColumns, Math.min(columns, maxGames));
        if (perColumn > maxGames) perColumn = Math.max(minRows, Math.min(perColumn, maxGames));

        var maxRowsForColumns = Math.floor(maxGames / Math.max(columns, 1));
        if (maxRowsForColumns < minRows) maxRowsForColumns = minRows;
        if (maxRowsForColumns < 1) maxRowsForColumns = 1;
        if (perColumn > maxRowsForColumns) perColumn = maxRowsForColumns;

        var layoutGames = columns * perColumn;
        if (layoutGames > maxGames) {
          while (columns > minColumns && layoutGames > maxGames) {
            columns -= 1;
            if (columns < minColumns) {
              columns = minColumns;
              break;
            }

            maxRowsForColumns = Math.floor(maxGames / Math.max(columns, 1));
            if (maxRowsForColumns < minRows) maxRowsForColumns = minRows;
            if (maxRowsForColumns < 1) maxRowsForColumns = 1;
            if (perColumn > maxRowsForColumns) perColumn = maxRowsForColumns;

            layoutGames = columns * perColumn;
          }

          if (layoutGames > maxGames) {
            var allowableRows = Math.floor(maxGames / Math.max(columns, 1));
            if (allowableRows < minRows) allowableRows = minRows;
            if (allowableRows < 1) allowableRows = 1;
            perColumn = Math.min(perColumn, allowableRows);
            layoutGames = columns * perColumn;
          }
        }

        gamesPerPage = Math.min(maxGames, columns * perColumn);
      }

      this._scoreboardColumns = columns;
      this._scoreboardRows    = perColumn;
      this._gamesPerPage      = Math.max(1, gamesPerPage);
      this._layoutScale       = this._resolveLayoutScale();
    },

    _parsePixelValue: function (value) {
      if (value == null) return null;
      if (typeof value === "number" && isFinite(value)) return value;
      var str = String(value).trim();
      if (!str) return null;
      if (/^\d+$/.test(str)) return parseInt(str, 10);
      var match = str.match(/^(\d+(?:\.\d+)?)px$/i);
      if (match) return parseFloat(match[1]);
      return null;
    },

    _estimateContentWidth: function () {
      var columns = this._scoreboardColumns;
      if (!columns || columns <= 0) return null;

      var scale = (typeof this._layoutScale === "number") ? this._layoutScale : this._resolveLayoutScale();
      if (!(typeof scale === "number" && isFinite(scale) && scale > 0)) scale = 1;

      var league = this._getLeague();
      var baseWidth = EXTENDED_LAYOUT_LEAGUES[league]
        ? SCOREBOARD_CARD_WIDTH_BASE_COMPACT
        : SCOREBOARD_CARD_WIDTH_BASE;

      var cardWidth = baseWidth * scale;
      var gap = MATRIX_GAP_BASE * scale;
      var width = columns * cardWidth + Math.max(0, columns - 1) * gap;

      var cap = this._parsePixelValue(this.config && this.config.maxWidth);
      if (cap != null && width > cap) width = cap;

      return width;
    },

    _setModuleContentWidth: function (widthPx) {
      var id = this.identifier || (this.data && this.data.identifier);
      if (!id) return;
      var root = document.getElementById(id);
      if (!root) return;

      if (widthPx) root.style.setProperty("--scoreboard-content-width", widthPx);
      else root.style.removeProperty("--scoreboard-content-width");
    },

    _getConfigValueForLeague: function (key) {
      var cfg = this.config || {};
      var league = this._getLeague();
      if (!cfg) return null;

      var keysToCheck = this._expandConfigKeyAliases(key);

      for (var i = 0; i < keysToCheck.length; i++) {
        var currentKey = keysToCheck[i];

        if (league) {
          var leagueKey = currentKey + "_" + league;
          if (Object.prototype.hasOwnProperty.call(cfg, leagueKey)) {
            return cfg[leagueKey];
          }
        }

        var base = cfg[currentKey];
        if (base != null && typeof base === "object" && !Array.isArray(base)) {
          if (league) {
            var lower = base[league];
            if (typeof lower !== "undefined") return lower;

            var lcase = league.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(base, lcase)) return base[lcase];

            var ucase = league.toUpperCase();
            if (Object.prototype.hasOwnProperty.call(base, ucase)) return base[ucase];
          }

          if (Object.prototype.hasOwnProperty.call(base, "default")) {
            return base.default;
          }
        }

        if (typeof base !== "undefined") return base;
      }

      return undefined;
    },

    _expandConfigKeyAliases: function (key) {
      var seen = {};
      var list = [];
      var enqueue = function (k) {
        if (k && !seen[k]) {
          seen[k] = true;
          list.push(k);
        }
      };

      enqueue(key);

      var aliases = CONFIG_KEY_ALIASES[key];
      if (Array.isArray(aliases)) {
        for (var i = 0; i < aliases.length; i++) {
          enqueue(aliases[i]);
        }
      }

      return list;
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

    _resolveNhlShotsOnGoal: function () {
      var keys = [
        "shotsOnGoal",
        "shots",
        "shotsTotal",
        "totalShots",
        "shotsOnGoalTotal",
        "sog"
      ];

      var queue = Array.prototype.slice.call(arguments || []);
      var seen = (typeof Set !== "undefined") ? new Set() : [];

      var markSeen = function (entry) {
        if (!entry || typeof entry !== "object") return false;
        if (seen instanceof Set) {
          if (seen.has(entry)) return false;
          seen.add(entry);
          return true;
        }
        for (var si = 0; si < seen.length; si++) {
          if (seen[si] === entry) return false;
        }
        seen.push(entry);
        return true;
      };

      while (queue.length > 0) {
        var item = queue.shift();
        var numeric = this._toNumberOrNull(item);
        if (numeric != null) return numeric;

        if (!item || typeof item !== "object") continue;
        if (!markSeen(item)) continue;

        if (Array.isArray(item)) {
          for (var ai = 0; ai < item.length; ai++) {
            queue.push(item[ai]);
          }
          continue;
        }

        for (var ki = 0; ki < keys.length; ki++) {
          var key = keys[ki];
          if (Object.prototype.hasOwnProperty.call(item, key)) {
            var val = this._toNumberOrNull(item[key]);
            if (val != null) return val;
          }
        }

        var nestedKeys = [
          "stats",
          "teamStats",
          "statistics",
          "totals",
          "summary",
          "teamSkaterStats",
          "skaterStats",
          "linescore"
        ];

        for (var nk = 0; nk < nestedKeys.length; nk++) {
          var nested = item[nestedKeys[nk]];
          if (nested != null) queue.push(nested);
        }

        // Some APIs provide direct away/home objects with nested shots
        if (Object.prototype.hasOwnProperty.call(item, "away")) queue.push(item.away);
        if (Object.prototype.hasOwnProperty.call(item, "home")) queue.push(item.home);
      }

      return null;
    },

    _formatNhlTimeRemaining: function (remaining) {
      if (remaining == null) return "";

      if (typeof remaining === "string") {
        return remaining;
      }

      if (typeof remaining === "number") {
        if (!Number.isFinite(remaining)) return "";
        var totalSeconds = Math.max(0, Math.round(remaining));
        var minutes = Math.floor(totalSeconds / 60);
        var seconds = totalSeconds % 60;
        return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
      }

      if (Array.isArray(remaining)) {
        for (var idx = 0; idx < remaining.length; idx++) {
          var formatted = this._formatNhlTimeRemaining(remaining[idx]);
          if (formatted) return formatted;
        }
        return "";
      }

      if (typeof remaining === "object") {
        var keys = [
          "pretty",
          "displayValue",
          "display",
          "value",
          "text",
          "timeRemaining",
          "clock",
          "remaining",
          "formatted"
        ];

        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          if (Object.prototype.hasOwnProperty.call(remaining, key)) {
            var candidate = this._formatNhlTimeRemaining(remaining[key]);
            if (candidate) return candidate;
          }
        }

        var minutesVal = this._toNumberOrNull(remaining.minutes);
        var secondsVal = this._toNumberOrNull(remaining.seconds);
        if (minutesVal != null || secondsVal != null) {
          var secondsTotal = 0;
          if (minutesVal != null) secondsTotal += Math.max(0, minutesVal) * 60;
          if (secondsVal != null) secondsTotal += Math.max(0, secondsVal);
          secondsTotal = Math.max(0, Math.round(secondsTotal));
          var mins = Math.floor(secondsTotal / 60);
          var secs = secondsTotal % 60;
          return mins + ":" + (secs < 10 ? "0" : "") + secs;
        }

        for (var prop in remaining) {
          if (!Object.prototype.hasOwnProperty.call(remaining, prop)) continue;
          var val = remaining[prop];
          if (typeof val === "string") {
            var trimmed = val.trim();
            if (trimmed) return trimmed;
          }
        }
      }

      return "";
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

          var extras = null;

          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            league = this._normalizeLeagueKey(payload.league);
            if (Array.isArray(payload.games)) games = payload.games;
            if (Object.prototype.hasOwnProperty.call(payload, "teamsOnBye")) {
              extras = extras || {};
              extras.teamsOnBye = Array.isArray(payload.teamsOnBye) ? payload.teamsOnBye : [];
            }
          } else if (Array.isArray(payload)) {
            games = payload;
          }

          if (!league) league = this._getLeague();

          if (!this.gamesByLeague) this.gamesByLeague = {};
          this.gamesByLeague[league] = games;

          if (!this.loadedLeagues) this.loadedLeagues = {};
          this.loadedLeagues[league] = true;

          if (!this.extrasByLeague) this.extrasByLeague = {};
          if (extras && Object.keys(extras).length > 0) {
            this.extrasByLeague[league] = extras;
          } else if (Object.prototype.hasOwnProperty.call(this.extrasByLeague, league)) {
            delete this.extrasByLeague[league];
          }

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

      if (!this.loadedGames) {
        this._setModuleContentWidth(null);
        return this._noData("Loading games...");
      }
      if (this.games.length === 0) {
        this._setModuleContentWidth(null);
        return this._noData("No games to display.");
      }

      try {
        wrapper.appendChild(this._buildGames());
      } catch (e) {
        console.error("MMM-ScoresAndStandings: getDom build error", e);
        this._setModuleContentWidth(null);
        return this._noData("Error building view.");
      }
      this._lastRenderedDom = wrapper;
      return wrapper;
    },

    // ----------------- SCOREBOARD -----------------
    _buildGames: function () {
      this._syncScoreboardLayout();

      var container = document.createElement("div");
      container.className = "games-layout";

      var start = this.currentScreen * this._gamesPerPage;
      var games = this.games.slice(start, start + this._gamesPerPage);

      var matrix = document.createElement("div");
      matrix.className = "games-matrix";

      var activeLeague = this._getLeague();
      if (activeLeague) {
        matrix.classList.add("league-" + activeLeague);
        container.classList.add("league-" + activeLeague);
      }

      matrix.style.setProperty("--games-matrix-columns", this._scoreboardColumns);

      var totalSlots = this._scoreboardColumns * this._scoreboardRows;
      var orderedGames = new Array(totalSlots);
      var isRightPlacement = this._shouldUseRightPlacement();

      var limit = games.length < totalSlots ? games.length : totalSlots;
      for (var gi = 0; gi < limit; gi++) {
        var columnIndex = Math.floor(gi / this._scoreboardRows);
        if (isRightPlacement) columnIndex = (this._scoreboardColumns - 1) - columnIndex;
        var rowIndex = gi % this._scoreboardRows;
        var slotIndex = rowIndex * this._scoreboardColumns + columnIndex;
        orderedGames[slotIndex] = games[gi];
      }

      for (var r = 0; r < this._scoreboardRows; r++) {
        for (var c = 0; c < this._scoreboardColumns; c++) {
          var index = r * this._scoreboardColumns + c;
          var cell = document.createElement("div");
          cell.className = "games-matrix-cell";

          var game = orderedGames[index];
          if (game) {
            var card = this.createGameBox(game);
            if (card) {
              cell.appendChild(card);

              for (var cl = 0; cl < card.classList.length; cl++) {
                var cls = card.classList[cl];
                if (cls && cls.indexOf("league-") === 0) {
                  cell.classList.add(cls);
                  break;
                }
              }
            }
          } else {
            cell.classList.add("empty");
          }

          matrix.appendChild(cell);
        }
      }

      container.appendChild(matrix);

      var estimatedWidth = this._estimateContentWidth();
      var widthPx = null;
      if (typeof estimatedWidth === "number" && isFinite(estimatedWidth) && estimatedWidth > 0) {
        var widthStr = estimatedWidth.toFixed(2);
        if (widthStr.indexOf(".") !== -1) {
          widthStr = widthStr.replace(/\.00$/, "").replace(/(\.[0-9])0$/, "$1");
        }
        widthPx = widthStr + "px";
      }

      container.style.width = "100%";

      if (widthPx) {
        container.style.maxWidth = widthPx;
        container.style.setProperty("--scoreboard-content-width", widthPx);
      } else {
        container.style.removeProperty("max-width");
        container.style.removeProperty("--scoreboard-content-width");
      }

      this._setModuleContentWidth(widthPx);

      if (activeLeague === "nfl") {
        var extras = this.currentExtras;
        var byeTeams = extras && Array.isArray(extras.teamsOnBye) ? extras.teamsOnBye : [];
        var totalPages = Math.max(1, this.totalGamePages || 1);
        var onLastPage = this.currentScreen >= (totalPages - 1);
        if (onLastPage) {
          var byeSection = this._buildNflByeSection(byeTeams);
          if (byeSection) container.appendChild(byeSection);
        }
      }

      return container;
    },

    _buildNflByeSection: function (byeTeams) {
      if (!Array.isArray(byeTeams) || byeTeams.length === 0) return null;

      var normalized = [];
      for (var i = 0; i < byeTeams.length; i++) {
        var entry = byeTeams[i];
        if (!entry) continue;
        var abbr = entry.abbreviation || entry.abbr || entry.teamAbbr || entry.uid || entry.id;
        if (!abbr) continue;
        abbr = String(abbr).toUpperCase();
        var name = entry.displayName || entry.shortDisplayName || entry.name || entry.location || abbr;
        normalized.push({ abbr: abbr, name: name });
      }

      if (normalized.length === 0) return null;

      normalized.sort(function (a, b) {
        if (a.abbr < b.abbr) return -1;
        if (a.abbr > b.abbr) return 1;
        return a.name.localeCompare(b.name);
      });

      var section = document.createElement("div");
      section.className = "bye-week-section";

      var title = document.createElement("div");
      title.className = "bye-week-title";
      title.textContent = "Teams on Bye";
      section.appendChild(title);

      var list = document.createElement("div");
      list.className = "bye-week-list";
      section.appendChild(list);

      for (var j = 0; j < normalized.length; j++) {
        var team = normalized[j];
        var item = document.createElement("div");
        item.className = "bye-week-team";
        item.title = team.name;

        var logo = document.createElement("img");
        logo.className = "bye-week-team-logo";
        logo.src = this.getLogoUrl(team.abbr);
        logo.alt = team.abbr;
        logo.onerror = (function (imgEl) { return function () { imgEl.style.display = "none"; }; })(logo);
        item.appendChild(logo);

        var textWrap = document.createElement("div");
        textWrap.className = "bye-week-team-text";

        var abbrEl = document.createElement("span");
        abbrEl.className = "bye-week-team-abbr";
        abbrEl.textContent = team.abbr;
        textWrap.appendChild(abbrEl);

        if (team.name && team.name !== team.abbr) {
          var nameEl = document.createElement("span");
          nameEl.className = "bye-week-team-name";
          nameEl.textContent = team.name;
          textWrap.appendChild(nameEl);
        }

        item.appendChild(textWrap);
        list.appendChild(item);
      }

      return section;
    },

    createGameBox: function (game) {
      var league = this._getLeague();
      if (league === "nhl") return this._createNhlGameCard(game);
      if (league === "nfl") return this._createNflGameCard(game);
      if (league === "nba") return this._createNbaGameCard(game);
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
      var metricLabelClasses = (config && Array.isArray(config.metricLabelClasses)) ? config.metricLabelClasses : [];
      var metricValueClasses = (config && Array.isArray(config.metricValueClasses)) ? config.metricValueClasses : [];
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
        var labelClassEntry = metricLabelClasses[li];
        if (labelClassEntry) {
          if (Array.isArray(labelClassEntry)) {
            for (var lci = 0; lci < labelClassEntry.length; lci++) {
              if (labelClassEntry[lci]) label.classList.add(labelClassEntry[lci]);
            }
          } else if (typeof labelClassEntry === "string") {
            label.classList.add(labelClassEntry);
          }
        }
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
          var totalClass = "scoreboard-team-total";
          if (live) totalClass += " live";
          totalEl.className = totalClass;
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
          var valueClass = "scoreboard-value" + (live ? " live" : "");
          var valueClassEntry = metricValueClasses[mi];
          if (valueClassEntry) {
            if (Array.isArray(valueClassEntry)) {
              for (var vci = 0; vci < valueClassEntry.length; vci++) {
                if (valueClassEntry[vci]) valueClass += " " + valueClassEntry[vci];
              }
            } else if (typeof valueClassEntry === "string") {
              valueClass += " " + valueClassEntry;
            }
          }
          valueEl.className = valueClass;

          var placeholder = "—";
          var val = null;
          var superscript = null;
          var superscriptClasses = [];

          if (metric != null && typeof metric === "object" && !Array.isArray(metric)) {
            if (Object.prototype.hasOwnProperty.call(metric, "placeholder")) {
              placeholder = metric.placeholder;
            }
            if (Object.prototype.hasOwnProperty.call(metric, "value")) {
              val = metric.value;
            }
            if (Object.prototype.hasOwnProperty.call(metric, "superscript")) {
              superscript = metric.superscript;
            }
            var supClass = null;
            if (Object.prototype.hasOwnProperty.call(metric, "superscriptClass")) {
              supClass = metric.superscriptClass;
            } else if (Object.prototype.hasOwnProperty.call(metric, "supClass")) {
              supClass = metric.supClass;
            }
            if (supClass) {
              if (Array.isArray(supClass)) {
                for (var sci = 0; sci < supClass.length; sci++) {
                  if (supClass[sci]) superscriptClasses.push(supClass[sci]);
                }
              } else if (typeof supClass === "string") {
                superscriptClasses.push(supClass);
              }
            }
          } else {
            val = metric;
          }

          if (showVals) {
            if (val == null || val === "") {
              valueEl.textContent = "";
            } else {
              valueEl.textContent = String(val);
              if (superscript != null && superscript !== "") {
                var supEl = document.createElement("sup");
                supEl.className = "scoreboard-value-superscript";
                for (var supIdx = 0; supIdx < superscriptClasses.length; supIdx++) {
                  if (superscriptClasses[supIdx]) supEl.classList.add(superscriptClasses[supIdx]);
                }
                supEl.textContent = String(superscript);
                valueEl.appendChild(supEl);
              }
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
        var remaining = this._formatNhlTimeRemaining(ls.currentPeriodTimeRemaining).trim();
        if (remaining && remaining.toUpperCase && remaining.toUpperCase() === "END") {
          statusText = (period ? period + " " : "") + "End";
        } else if (remaining) {
          statusText = ((period ? period + " " : "") + remaining).trim();
        } else {
          statusText = (period || "").trim();
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
      var awayShots = this._resolveNhlShotsOnGoal(
        lsTeams.away,
        away,
        game && game.shotsOnGoal && game.shotsOnGoal.away,
        game && game.awayShotsOnGoal,
        game && game.linescore && game.linescore.away,
        game && game.linescore && game.linescore.teams && game.linescore.teams.away
      );
      var homeShots = this._resolveNhlShotsOnGoal(
        lsTeams.home,
        home,
        game && game.shotsOnGoal && game.shotsOnGoal.home,
        game && game.homeShotsOnGoal,
        game && game.linescore && game.linescore.home,
        game && game.linescore && game.linescore.teams && game.linescore.teams.home
      );

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
          {
            value: goals,
            placeholder: "—",
            superscript: (i === 0 ? awayShots : homeShots),
            superscriptClass: "shots-on-goal-superscript"
          }
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
        metricLabels: ["G"],
        metricValueClasses: ["shots-on-goal-value"],
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
        statusText = this._formatNflStartTime(competition.date || game.date);
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
          metrics: [],
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
        metricLabels: [],
        rows: rows,
        cardClasses: cardClasses
      });
    },

    _createNbaGameCard: function (game) {
      var league = "nba";
      var competition = game && game.competitions && game.competitions[0];
      if (!competition) competition = {};

      var status = (competition.status && competition.status.type) || game.status && game.status.type || {};
      var state = (status.state || "").toLowerCase();
      var detailed = status.shortDetail || status.detail || status.description || "";

      var isPreview = state === "pre" || state === "preview" || state === "scheduled";
      var isFinal = state === "post" || state === "final" || !!status.completed;
      var isLive = state === "in" || state === "live";

      var showVals = !isPreview;

      var statusText = "";
      if (isPreview) {
        statusText = this._formatStartTime(competition.date || game.date);
      } else if (isFinal) {
        statusText = detailed || "Final";
      } else if (isLive) {
        var period = this._firstNumber(
          competition.status && competition.status.period,
          status.period,
          game.status && game.status.period
        );
        var ord = this._ordinal(period);
        var clock = competition.status && (competition.status.displayClock || competition.status.clock);
        if (!clock && status) clock = status.displayClock || status.clock;
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

      if (!away && competitors.length > 0) away = competitors[0];
      if (!home && competitors.length > 1) home = competitors[1];

      var rows = [];
      var pair = [away, home];
      for (var idx = 0; idx < pair.length; idx++) {
        var entry = pair[idx] || {};
        var team = entry.team || {};
        var abbr = this._abbrForTeam(team, league);
        var highlight = this._isHighlighted(abbr);

        var scoreNum = this._firstNumber(entry.score, entry.points, team && team.score);

        var lineScores = Array.isArray(entry.linescores) ? entry.linescores : [];
        var quarters = [];
        for (var lsIdx = 0; lsIdx < lineScores.length; lsIdx++) {
          var ls = lineScores[lsIdx];
          var period = this._firstNumber(ls && ls.period, ls && ls.sequenceNumber);
          if (!Number.isFinite(period)) continue;
          var periodIndex = Math.max(0, parseInt(period, 10) - 1);
          quarters[periodIndex] = this._firstNumber(
            ls.value,
            ls.displayValue,
            ls.score,
            ls.points
          );
        }

        var totalScore = scoreNum;
        if (totalScore == null) {
          var running = 0;
          var haveQuarter = false;
          for (var qIdx = 0; qIdx < quarters.length; qIdx++) {
            var qVal = quarters[qIdx];
            if (qVal == null || qVal === "") continue;
            var numeric = Number(qVal);
            if (!isNaN(numeric)) {
              running += numeric;
              haveQuarter = true;
            }
          }
          if (haveQuarter) totalScore = running;
        }

        var otherScore = null;
        if (idx === 0 && home) {
          otherScore = this._firstNumber(home.score, home.points, home.team && home.team.score);
        } else if (idx === 1 && away) {
          otherScore = this._firstNumber(away.score, away.points, away.team && away.team.score);
        }

        var isLoser = false;
        if (isFinal && totalScore != null && otherScore != null && totalScore !== otherScore) {
          isLoser = totalScore < otherScore;
        }

        rows.push({
          type: (idx === 0) ? "away" : "home",
          abbr: abbr,
          logoAbbr: abbr,
          highlight: highlight,
          isLoser: isLoser,
          metrics: [],
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
        metricLabels: [],
        rows: rows,
        cardClasses: cardClasses
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

    _formatNflStartTime: function (isoDate) {
      var timeText = this._formatStartTime(isoDate);
      if (!isoDate) return timeText;
      try {
        var date = new Date(isoDate);
        if (isNaN(date.getTime())) return timeText;
        var tz = this.config.timeZone || "America/Chicago";
        var weekday = date.toLocaleDateString("en-US", {
          timeZone: tz,
          weekday: "short"
        });
        if (!weekday) return timeText;
        if (/^sun/i.test(weekday)) return timeText;
        if (!timeText) return weekday;
        return weekday + " " + timeText;
      } catch (e) {
        return timeText;
      }
    },

    _ordinal: function (period) {
      var n = parseInt(period, 10);
      if (!Number.isFinite(n) || n <= 0) return "";
      if (n === 1) return "Q1";
      if (n === 2) return "Q2";
      if (n === 3) return "Q3";
      if (n === 4) return "Q4";
      if (n === 5) return "OT";
      return (n - 4) + "OT";
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
      } else if (league === "nba") {
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
      } else if (league === "nba") {
        path = "images/nba/" + String(abbr || "").toUpperCase() + ".png";
      } else {
        path = "images/mlb/" + String(abbr || "").toUpperCase() + ".png";
      }
      return this.file(path);
    }
  });
})();
