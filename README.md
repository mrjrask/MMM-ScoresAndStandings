# MMM-ScoresAndStandings

A sleek multi-league scoreboard module for [MagicMirror²](https://magicmirror.builders). It renders MLB, NHL, and NFL scoreboards with configurable layouts, team highlighting, and an optional Times Square–style font.

> ✅ **Works great in `middle_center`** thanks to a configurable width cap.
> ✅ **MLB / NHL / NFL** scoreboards share one layout with configurable columns and rows.
> ✅ **Statuses**: `Final`, `Final/11` (extras), `Postponed`, `Suspended`, `Warmup`, and live inning/period clocks.
> ✅ **Times Square** font for the scoreboard body — the header stays in MagicMirror’s default font.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Images & Fonts](#images--fonts)
- [Styling & CSS Variables](#styling--css-variables)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Credits & License](#credits--license)

---

## Features

- **Multi-league scoreboard**: MLB (R/H/E with innings), NHL (goals & shots), and NFL (quarter-by-quarter totals).
- **Configurable grid**: choose columns, rows, or an explicit games-per-page value.
- **Automatic rotation** across scoreboard pages with `rotateIntervalScores`.
- **Team highlighting**: accentuate your favorite clubs per league.
- **Width cap** keeps the module tidy in `middle_center`.
- **`layoutScale` option** shrinks or enlarges the whole scoreboard without editing CSS.
- **Status text** handles `Final/11`, `Postponed`, `Suspended`, `Warmup`, and live clocks/innings.
- **No external deps** in the helper — uses Node’s built-in `fetch`.

---

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/yourname/MMM-ScoresAndStandings.git
cd MMM-ScoresAndStandings
# No npm install required (uses global.fetch from Node 18+)
```

> **Node Requirement:** Node **18+** (for built-in `fetch`). If you must run older Node, install `node-fetch@3` and adapt `node_helper.js` accordingly.

Place your team **images** and the **Times Square** font as described below.

---

## Configuration

Add to your `config/config.js`:

```js
{
  module: "MMM-ScoresAndStandings",
  position: "middle_center", // or wherever you prefer
  config: {
    // Refresh
    updateIntervalScores: 60 * 1000,

    league: "mlb",             // "mlb", "nhl", "nfl", array of leagues, or "all"

    // Scoreboard layout
    scoreboardColumns: null,  // columns per page (auto: 2 for MLB/NHL, 4 for NFL)
    gamesPerColumn: 2,        // games stacked in each column
    // (optional) gamesPerPage: 8, // override derived columns × gamesPerColumn
    layoutScale: 0.9,          // shrink (<1) or grow (>1) everything at once (clamped 0.6 – 1.4)
    rotateIntervalScores: 15 * 1000,

    // Behavior
    timeZone: "America/Chicago",
    highlightedTeams_mlb: ["CUBS"], // string or array of 3–5 letter abbrs (per league)
    highlightedTeams_nhl: [],
    highlightedTeams_nfl: [],
    showTitle: true,
    useTimesSquareFont: true,   // set false to use the MagicMirror default font

    // Width cap to keep module tidy in middle_center
    maxWidth: "720px"
  }
}
```

**Notes**
- **League**: set `league` to `"nhl"` or `"nfl"` for hockey or football scoreboards. Use `"all"` (or provide an array via `league` or `leagues`) to rotate through every supported league automatically.
- **Header width** matches `maxWidth` and stays in the default MM font (Roboto Condensed).
- **Highlighted teams** accept a single string `"CUBS"` or an array like `["CUBS","NYY"]` for the league-specific settings `highlightedTeams_mlb`, `highlightedTeams_nhl`, and `highlightedTeams_nfl`.
- **layoutScale** is the quickest way to fix oversize boxes—values below `1` compact the layout.
- The default scoreboard layout shows **two columns and up to four games** for MLB/NHL, and **four columns** for NFL. Adjust `scoreboardColumns`, `gamesPerColumn`, or `gamesPerPage` to taste.

---

## Images & Fonts

```
MMM-ScoresAndStandings/
├─ MMM-ScoresAndStandings.js
├─ node_helper.js
├─ MMM-ScoresAndStandings.css
├─ fonts/
│  └─ TimesSquare-m105.ttf
└─ images/
   ├─ mlb/
   │  └─ ATL.png (etc.)
   ├─ nhl/
   │  └─ BOS.png (etc.)
   └─ nfl/
      └─ kc.png (etc., lowercase filenames)
```

- **Images**: PNGs named by **abbr** (e.g., `CUBS.png`, `NYR.png`, `kc.png`) under `images/<league>/`.
- **Font**: `fonts/TimesSquare-m105.ttf` is loaded by `@font-face` inside the module CSS.

---

## Styling & CSS Variables

Most sizing is controlled by CSS variables in `MMM-ScoresAndStandings.css`.
You now have two ways to rein in the layout when it feels oversized:

1. **Quick fix** – use the `layoutScale` config option (or override `--box-scale`) to shrink or enlarge everything uniformly.
2. **Fine tuning** – override the `*-base` variables to change specific parts; the stylesheet multiplies each base value by `--box-scale`.

### Common variables to tweak

| Variable | What it affects |
| --- | --- |
| `--scoreboard-card-width-base` | Base width of each scoreboard card |
| `--scoreboard-team-font-base` | Team abbreviation text size |
| `--scoreboard-value-font-base` | Score number size |
| `--scoreboard-metric-width-base` | Width of the metric columns (R/H/E, Q1–Q4, etc.) |
| `--scoreboard-gap-base` | Spacing between values inside a card |
| `--matrix-gap-base` | Spacing between game cards |

Example override (drop into your `css/custom.css`):

```css
:root {
  --scoreboard-team-font-base: 30px;
  --scoreboard-value-font-base: 34px;
  --matrix-gap-base: 10px;
}
```

---

## Troubleshooting

**Header font switched to Times Square**  
Remove any global rules like:
```css
.module.MMM-ScoresAndStandings * { font-family: 'Times Square' !important; }
```
and use the header override shown above.

**Font not loading**  
- Ensure `fonts/TimesSquare-m105.ttf` exists.
- The CSS `@font-face` uses a relative URL: `url('fonts/TimesSquare-m105.ttf')` since the CSS lives in the same module folder.

**Logos not showing**  
- Confirm file names match abbreviations (e.g., `CUBS.png`).
- The code hides broken images automatically (falls back to abbreviation).

**“Cannot find module 'node-fetch'”**  
- This module uses **global `fetch` from Node 18+**. Upgrade Node.  
  If you must use older Node, install `node-fetch@3` and adjust `node_helper.js` to `require('node-fetch')` and use it.

**MIME errors for `/css/custom.css`**  
- Don’t reference `css/custom.css` unless the file exists; otherwise MagicMirror serves a 404 as HTML which fails strict MIME checking.

## FAQ

**Does the scoreboard show extra innings?**
Yes—`Final/11`, etc. Live MLB games display R/H/E in yellow, NHL shows SOG, and NFL shows quarter scores.

---

## Credits & License

- **MLB data**: [statsapi.mlb.com](https://statsapi.mlb.com/) (unofficial public API).
- **Font**: *Times Square* (you must have rights to use/distribute).
- **MagicMirror²**: © Michael Teeuw and contributors.  
- Module © You, released under the **MIT License** (see below).

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
