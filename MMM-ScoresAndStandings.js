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

  var CONFIG_KEY_ALIASES = {
    gamesPerColumn: ["scoreboardRows", "rowsPerColumn"]
  };

  var EXTENDED_LAYOUT_LEAGUES = { nfl: true, nhl: true, nba: true };

  var SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl", "nba"];

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

@@ -269,76 +273,106 @@
          perColumn = computedRows;
          gamesPerPage = columns * perColumn;
          if (gamesPerPage < override) {
            perColumn = Math.max(perColumn, Math.ceil(override / columns));
            gamesPerPage = columns * perColumn;
          }
        } else {
          perColumn = computedRows;
          gamesPerPage = override;
        }
      } else {
        gamesPerPage = columns * perColumn;
      }

      this._scoreboardColumns = columns;
      this._scoreboardRows    = perColumn;
      this._gamesPerPage      = Math.max(1, gamesPerPage);
      this._layoutScale       = this._resolveLayoutScale();
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
