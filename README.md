# MMM-ScoresAndStandings

A polished multi-league scoreboard for [MagicMirror²](https://magicmirror.builders) with configurable layouts, team highlighting, and built-in assets support. Scoreboards for MLB, NHL, NFL, and NBA rotate automatically so you never miss a final, and NHL divisional standings keep conference races front and center.

---

## Table of Contents

- [Features at a Glance](#features-at-a-glance)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start Configuration](#quick-start-configuration)
- [Configuration Reference](#configuration-reference)
- [Logos, Fonts & Styling](#logos-fonts--styling)
- [Data Refresh & Sources](#data-refresh--sources)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Credits & License](#credits--license)

---

## Features at a Glance

- **Multi-league scoreboards** for MLB (linescore with R/H/E), NHL (goals & shots), NFL (quarter-by-quarter totals), and NBA (quarter/OT breakdown).
- **Automatic league rotation** – show one league, a custom list, or all supported leagues with seamless transitions.
- **Configurable layout** – control columns, rows, or total games per page per league, plus an all-in-one `layoutScale` to resize everything.
- **Favorite team highlighting** – accentuate specific clubs in each league with a subtle highlight style.
- **MagicMirror-friendly width cap** – keep the module tidy in `middle_center` or other regions.
- **Zero external dependencies in the helper** – uses the global `fetch` provided by Node.js 18+.
- **Times Square scoreboard font** option for the body while preserving the default MagicMirror header font.
- **NHL divisional standings** – two-page view for Western (Central & Pacific) and Eastern (Metropolitan & Atlantic) conferences with logos, records, and points.

---

## Requirements

- **MagicMirror²** v2.20.0 or newer (or any version with ES module compatibility).
- **Node.js 18+** on the MagicMirror host so the helper can use the built-in `fetch` implementation.
- Optional: Custom team logos and the Times Square font file (see [Logos, Fonts & Styling](#logos-fonts--styling)).

---

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/yourname/MMM-ScoresAndStandings.git
cd MMM-ScoresAndStandings
# No npm install required – everything runs on core MagicMirror dependencies.
```

After cloning, add logos and the optional font as described below, then configure the module in your `config/config.js`.

---

## Quick Start Configuration

Add the module to `config/config.js`:

```js
{
  module: "MMM-ScoresAndStandings",
  position: "middle_center",
  config: {
    league: "all",                 // "mlb", "nhl", "nfl", "nba", array, or "all"
    updateIntervalScores: 60 * 1000, // refresh scores every minute
    rotateIntervalScores: 15 * 1000, // advance to the next page/league
    layoutScale: 0.95,               // shrink the entire layout slightly
    highlightedTeams_mlb: ["CUBS"],
    maxWidth: "720px"               // keep the header aligned with the body
  }
}
```

By default the module rotates through every supported league. Supply a string, array, or comma-separated list to `league`/`leagues` to control the rotation order.

---

## Configuration Reference

Every option can be declared globally, as an object keyed by league (`{ mlb: value, nhl: value, ... }`), or via a per-league suffix (for example `gamesPerColumn_nhl`). When both are provided, per-league values win.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `league` / `leagues` | `string \| string[]` | `"mlb"` | League(s) to show. Accepts `"mlb"`, `"nhl"`, `"nfl"`, `"nba"`, or `"all"`. Arrays determine rotation order. |
| `updateIntervalScores` | `number` | `60000` | Milliseconds between helper fetches. Minimum enforced interval is 10 seconds. |
| `rotateIntervalScores` | `number` | `15000` | Milliseconds between page/league rotations on the front-end. |
| `timeZone` | `string` | `"America/Chicago"` | Time zone used to decide which day’s schedule to request (fetches the previous day before 09:30 local). |
| `scoreboardColumns` | `number` | auto | Columns per page. Defaults to 2 for MLB (capped at 2) and 4 for NHL/NFL/NBA. |
| `gamesPerColumn` (`scoreboardRows`) | `number` | auto | Games stacked in each column (4 for MLB/NHL/NFL/NBA). |
| `gamesPerPage` | `number` | derived | Override the total games per page; rows will adjust automatically per league. |
| `layoutScale` | `number` | `1` | Uniformly scales the scoreboard (clamped between 0.6 and 1.4). |
| `highlightedTeams_mlb` | `string \| string[]` | `[]` | Team abbreviations to highlight for MLB. Also available as `_nhl`, `_nfl`, `_nba`. |
| `showNhlStandings` | `boolean \| string` | `true` | Displays NHL divisional standings pages when viewing NHL games. Set to `false` (or "off") to hide them. |
| `showTitle` | `boolean` | `true` | Toggles the module header (`MLB Scoreboard`, etc.). |
| `useTimesSquareFont` | `boolean` | `true` | Applies the Times Square font to scoreboard cards. |
| `maxWidth` | `string \| number` | `"800px"` | Caps the module width and header alignment. Numbers are treated as pixels. |

### Per-league Overrides

You can tailor layouts per league using suffixes:

```js
config: {
  scoreboardColumns_nhl: 3,
  gamesPerColumn_nhl: 5,
  gamesPerPage_nfl: 8
}
```

Alternatively, pass an object:

```js
config: {
  layoutScale: { default: 0.9, nhl: 0.8 },
  highlightedTeams_nba: { default: ["CHI"], playoffs: ["BOS", "DEN"] }
}
```

---

## Logos, Fonts & Styling

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

- **Logos**: Place transparent PNG logos named with the team abbreviation the module outputs (`CUBS.png`, `NYR.png`, `kc.png`, `CHI.png`, etc.). When a logo is missing, the abbreviation is shown instead.
- **Font**: Drop `TimesSquare-m105.ttf` into `fonts/`. The CSS already registers it with `@font-face`.
- **Styling**: Override variables in `MMM-ScoresAndStandings.css` or from your global `css/custom.css`. Key variables include `--scoreboard-card-width-base`, `--scoreboard-team-font-base`, `--scoreboard-value-font-base`, `--scoreboard-gap-base`, and `--matrix-gap-base`.

Example customization:

```css
:root {
  --scoreboard-team-font-base: 30px;
  --scoreboard-value-font-base: 34px;
  --matrix-gap-base: 10px;
}
```

---

## Data Refresh & Sources

- **MLB**: `https://statsapi.mlb.com` schedule endpoint (with linescores hydrated).
- **NHL**: Checks `statsapi.web.nhl.com` first, falls back to the public scoreboard REST API when necessary, and finally a REST fallback.
- **NFL & NBA**: `https://site.api.espn.com/apis/site/v2` scoreboards. NFL requests cover the entire current week.

The helper refreshes every `updateIntervalScores` milliseconds (default 60 seconds) and rotates front-end pages based on `rotateIntervalScores` (default 15 seconds).

---

## Troubleshooting

- **Header font switched to Times Square** – Remove global overrides such as `.module.MMM-ScoresAndStandings * { font-family: 'Times Square' !important; }` so the header can keep MagicMirror’s default typeface.
- **Font not loading** – Confirm `fonts/TimesSquare-m105.ttf` exists and is readable. The CSS references it relatively (`url('fonts/TimesSquare-m105.ttf')`).
- **Logos not showing** – Verify filenames match the abbreviations used in-game data (case-sensitive per league). Broken images fall back to the abbreviation text automatically.
- **“Cannot find module 'node-fetch'”** – Upgrade to Node.js 18+ so the helper can use the global `fetch`. Installing `node-fetch` is no longer necessary.
- **MIME errors for `/css/custom.css`** – Only reference `css/custom.css` if the file exists; otherwise, browsers may treat the 404 response as invalid CSS.

---

## Roadmap

- Expand standings views with streaks, last-ten form, and wildcard perspectives.
- Additional layout presets and playoff indicators are under consideration.

---

## Credits & License

- **MLB data**: [statsapi.mlb.com](https://statsapi.mlb.com/)
- **NHL data**: [statsapi.web.nhl.com](https://statsapi.web.nhl.com/) and the public scoreboard REST API.
- **NFL/NBA data**: [ESPN Scoreboard APIs](https://site.api.espn.com/apis/site/v2/)
- **MagicMirror²**: © Michael Teeuw and contributors.

```
MIT License

Copyright (c) 2025 <Your Name>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
