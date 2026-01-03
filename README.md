# MMM-ScoresAndStandings

A MagicMirror² module that cycles through MLB, NHL, NFL, and NBA scoreboards and optionally shows league standings. Scores and standings are fetched automatically from public APIs with sensible fallbacks.

---

## Table of Contents
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Layout controls](#layout-controls)
  - [League rotation](#league-rotation)
  - [Highlighting](#highlighting)
  - [Standings](#standings)
- [Assets & Styling](#assets--styling)
- [Data Sources](#data-sources)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features
- **Four-league scoreboards**: MLB (R/H/E linescore), NHL (goals & shots), NFL (quarter-by-quarter totals plus bye list), and NBA (quarter/OT breakdown).
- **Built-in standings pages**: NHL and NBA by conference; NFL and MLB by division. Pages rotate after the current league's games.
- **Automatic league rotation**: Show a single league, a custom sequence, or all supported leagues with timed page flips.
- **Flexible layout**: Control columns, rows, or total games per page per league and scale everything with a single `layoutScale` value.
- **Favorite team highlighting**: Per-league highlight lists add a subtle accent to matching teams on scoreboards and standings.
- **Times Square-inspired font option**: Apply the included font to scoreboard content while keeping the default MagicMirror header font.
- **Width cap for MagicMirror regions**: Keep headers and content aligned inside `middle_center` or other constrained regions.

---

## Requirements
- **MagicMirror²** v2.20.0 or newer.
- **Node.js 18+** on the MagicMirror host (uses the built-in `fetch`).
- Optional: Team logo PNGs and the `TimesSquare-m105.ttf` font (see [Assets & Styling](#assets--styling)).

---

## Installation
```bash
cd ~/MagicMirror/modules
git clone https://github.com/yourname/MMM-ScoresAndStandings.git
cd MMM-ScoresAndStandings
# No npm install required; the helper uses Node 18's global fetch.
```

Place any custom logos or font files as described below, then add the module to your `config/config.js`.

---

## Quick Start
Add this entry to `config/config.js`:
```js
{
  module: "MMM-ScoresAndStandings",
  position: "middle_center",
  config: {
    league: "all",                 // "mlb", "nhl", "nfl", "nba", array, or "all"
    updateIntervalScores: 60 * 1000, // helper refresh frequency
    rotateIntervalScores: 15 * 1000, // front-end page flip interval
    layoutScale: 0.95,               // scale everything uniformly
    highlightedTeams_mlb: ["CUBS"],
    maxWidth: "720px"
  }
}
```
By default the module cycles through every supported league. Supply a string, array, or comma-separated list to `league`/`leagues` to control the order.

---

## Configuration
Every option may be declared globally, as an object keyed by league (`{ mlb: value, nhl: value, ... }`), or with a per-league suffix (`gamesPerColumn_nhl`). When both exist, per-league values win.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `league` / `leagues` | `string \| string[]` | `"mlb"` | League(s) to display. Accepts `"mlb"`, `"nhl"`, `"nfl"`, `"nba"`, or `"all"`. Arrays define the rotation order. |
| `updateIntervalScores` | `number` | `60000` | Milliseconds between helper fetches. Minimum enforced interval is 10 seconds. |
| `rotateIntervalScores` | `number` | `15000` | Milliseconds between scoreboard/standings page rotations. |
| `timeZone` | `string` | `"America/Chicago"` | Time zone used to decide the scoreboard date (requests the previous day before 09:30 local). |
| `scoreboardColumns` | `number` | auto | Columns per page. Defaults to 2 for MLB (capped at 2) and 4 for NHL/NFL/NBA. |
| `gamesPerColumn` (`scoreboardRows`) | `number` | auto | Games stacked in each column (4 for all leagues unless overridden). |
| `gamesPerPage` | `number` | derived | Override the total games per page; rows adjust automatically per league. |
| `layoutScale` | `number` | `1` | Scales the entire module (clamped between 0.6 and 1.4). |
| `highlightedTeams_mlb` | `string \| string[]` | `[]` | Team abbreviations to highlight. Also available as `_nhl`, `_nfl`, `_nba`. |
| `showNhlStandings` | `boolean \| string` | `true` | Show NHL standings pages when viewing NHL games. Set `false` (or `"off"`) to hide them. |
| `showTitle` | `boolean` | `true` | Toggles the module header (`MLB Scoreboard`, etc.). |
| `useTimesSquareFont` | `boolean` | `true` | Applies the Times Square font to scoreboard cards. |
| `maxWidth` | `string \| number` | `"800px"` | Caps the module width and header alignment. Numbers are treated as pixels. |

### Layout controls
- **Per-league overrides**: Append the league suffix (`_nhl`, `_nfl`, `_nba`, `_mlb`) to `scoreboardColumns`, `gamesPerColumn`, or `gamesPerPage` to change a single league's layout.
- **Object form**: For `layoutScale` or highlight lists, you can pass an object with `default` and per-league keys.

### League rotation
The module keeps an internal rotation list derived from `league`/`leagues`. It fetches games for every configured league on each helper poll and flips the front-end page every `rotateIntervalScores` milliseconds.

### Highlighting
Highlight any number of teams per league using the appropriate `_mlb`, `_nhl`, `_nfl`, or `_nba` suffix. Highlights apply to both scoreboards and standings rows.

### Standings
- Standings pages are shown after the active league's scoreboards when data is available.
- NHL and NBA standings are grouped by **conference**. NFL and MLB standings are grouped by **division**.
- NHL standings respect `showNhlStandings`; other leagues always display standings when fetched.
- NFL bye-week teams are listed alongside the week's schedule.

---

## Assets & Styling
```
MMM-ScoresAndStandings/
├─ MMM-ScoresAndStandings.js
├─ MMM-ScoresAndStandings.css
├─ node_helper.js
├─ fonts/
│  └─ TimesSquare-m105.ttf
└─ images/
   ├─ mlb/
   │  └─ ATL.png (etc.)
   ├─ nhl/
   │  └─ BOS.png (etc.)
   ├─ nfl/
   │  └─ kc.png  (lowercase filenames)
   └─ nba/
      └─ ATL.png (etc.)
```
- **Logos**: Place transparent PNG logos named with the abbreviations used in-game data (`CUBS.png`, `NYR.png`, `kc.png`, `CHI.png`, etc.). The module falls back to text when a logo is missing.
- **Font**: Drop `fonts/TimesSquare-m105.ttf` into `fonts/`. The CSS registers it with `@font-face`.
- **Styling tweaks**: Override CSS variables in `MMM-ScoresAndStandings.css` or globally (e.g., `css/custom.css`). Useful variables include `--scoreboard-card-width-base`, `--scoreboard-team-font-base`, `--scoreboard-value-font-base`, `--scoreboard-gap-base`, and `--matrix-gap-base`.

Example:
```css
:root {
  --scoreboard-team-font-base: 30px;
  --scoreboard-value-font-base: 34px;
  --matrix-gap-base: 10px;
}
```

---

## Data Sources
Scoreboard and standings data come from league-specific feeds with fallbacks where needed.

- **MLB scores**: `https://statsapi.mlb.com/api/v1/schedule/games?sportId=1&hydrate=linescore` (date based on `timeZone`).
- **MLB standings**: `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=<year>&standingsTypes=regularSeason` grouped by division for AL and NL.
- **NHL scores**: Prefers `statsapi.web.nhl.com` endpoints with automatic fallbacks to the public scoreboard and REST feeds; the date adjusts for early-morning previous-day fetches.
- **NHL standings**: `https://statsapi.web.nhl.com/api/v1/standings/byDivision` with a fallback to `https://api-web.nhle.com/v1/standings/now`, rendered by conference.
- **NBA scores**: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard` for the selected date.
- **NBA standings**: `https://cdn.nba.com/static/json/liveData/standings/league.json` with fallback to `https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings`, grouped by conference.
- **NFL scores**: Weekly schedules from `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=<YYYYMMDD>` aggregated across the current week; includes bye-week teams.
- **NFL standings**: CSV from `https://raw.githubusercontent.com/nflverse/nfldata/master/data/standings.csv`, grouped by AFC and NFC divisions.

---

## Troubleshooting
- **Header font changes unexpectedly**: Remove broad overrides like `.module.MMM-ScoresAndStandings * { font-family: 'Times Square' !important; }` so the MagicMirror header keeps its default font.
- **Font not loading**: Confirm `fonts/TimesSquare-m105.ttf` exists and is readable. CSS references it with `url('fonts/TimesSquare-m105.ttf')`.
- **Logos missing**: Ensure filenames exactly match the abbreviations used in game/standings data (case-sensitive per league). Missing files fall back to text labels.
- **"Cannot find module 'node-fetch'"**: Upgrade to Node.js 18+; the helper relies on the built-in `fetch`.
- **CSS 404s for `/css/custom.css`**: Only reference `css/custom.css` if the file exists to avoid MIME errors.

---

## License
MIT License. See [LICENSE](LICENSE) for full text.
