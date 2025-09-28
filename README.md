# MMM-ScoresAndStandings

A sleek MLB scoreboard + standings module for [MagicMirror²](https://magicmirror.builders) that now supports NHL and NFL scoreboards.
It rotates between game scoreboards and standings (division pairs and wild cards), supports team highlighting, compact layouts, and highly tunable fonts/sizing via CSS variables.

> ✅ **Works great in `middle_center`** thanks to a width cap.  
> ✅ **Wild Card** tables auto-computed from division feeds.  
> ✅ **Statuses**: `Final`, `Final/11` (extras), `Postponed`, `Suspended`, `Warmup`, **Live** yellow R/ H/ E.  
> ✅ **Optional Home/Away** splits in standings.  
> ✅ **Times Square** font for a ballpark look — header stays in MagicMirror’s default font.

---

## Table of Contents

- [Features](#features)
- [Screens](#screens)
- [Installation](#installation)
- [Configuration](#configuration)
- [Images & Fonts](#images--fonts)
- [Styling & CSS Variables](#styling--css-variables)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Credits & License](#credits--license)

---

## Features

- **Scoreboard** uses a fixed 4 × 3 grid (12 slots) per page.
- **Multi-league support**: MLB (scoreboard + standings), NHL (goals & shots on goal), NFL (quarter-by-quarter with totals).
- **Standings** cycle: NL/AL East, NL/AL Central, NL/AL West, NL Wild Card, AL Wild Card.
- **Wild Card**: division leaders are excluded; WCGB computed vs. the 3rd WC team.
- **“GB / WCGB / E#”**: `0` rendered as `--`; half-games show as `1/2` in smaller type.
- **Team highlighting**: show your favorites in accent color.
- **Width cap**: keep the module tidy in `middle_center`.
- **layoutScale** option: shrink or enlarge the entire layout without touching CSS.
- **Optional splits**: show/hide `Home`/`Away` with a single flag.
- **Status text**: `Final` (or `Final/##`), `Warmup`, `Postponed`, `Suspended`, **live** innings with yellow R/H/E.
- **No external deps** required in `node_helper` (uses Node’s global `fetch`).

---

## Screens

1. **Scoreboard** (may span multiple pages if there are many games)
2. **Standings (pairs)**:  
   - NL East & AL East  
   - NL Central & AL Central  
   - NL West & AL West
3. **Wild Card (single)**:  
   - NL Wild Card  
   - AL Wild Card

Rotation timing for each screen is configurable.

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
    updateIntervalStandings: 15 * 60 * 1000,

    league: "mlb",             // "mlb", "nhl", or "nfl"

    // Scoreboard layout
    scoreboardColumns: 2,     // number of columns of game boxes per page
    gamesPerColumn: 2,        // games stacked in each column
    // (optional) gamesPerPage: 8, // override derived columns × gamesPerColumn
    layoutScale: 0.9,          // shrink (<1) or grow (>1) everything at once (clamped 0.6 – 1.4)
    rotateIntervalScores: 15 * 1000,

    // Standings rotation
    rotateIntervalEast: 7 * 1000,
    rotateIntervalCentral: 12 * 1000,
    rotateIntervalWest: 7 * 1000,

    // Behavior
    timeZone: "America/Chicago",
    highlightedTeams_mlb: ["CUBS"], // string or array of 3–5 letter abbrs (per league)
    highlightedTeams_nhl: [],
    highlightedTeams_nfl: [],
    showTitle: true,
    useTimesSquareFont: true,   // set false to use the MagicMirror default font

    // NEW: standings Home/Away splits
    showHomeAwaySplits: true,   // set false to hide "Home" & "Away" columns
    showDivisionStandings: true,
    showWildCardStandings: true,

    // Width cap to keep module tidy in middle_center
    maxWidth: "720px"
  }
}
```

**Notes**
- **League**: set `league` to `"nhl"` or `"nfl"` for hockey or football scoreboards (standings are MLB-only).
- **Header width** matches `maxWidth` and stays in the default MM font (Roboto Condensed).
- **Highlighted teams** accept a single string `"CUBS"` or an array like `["CUBS","NYY"]` for
  the league-specific settings `highlightedTeams_mlb`, `highlightedTeams_nhl`, and
  `highlightedTeams_nfl`.
- **layoutScale** is the quickest way to fix oversize boxes—values below `1` compact the layout.
- When both standings views are enabled the rotation order is *Scoreboard → (NL/AL East) →
  (NL/AL Central) → (NL/AL West) → NL WC → AL WC*. Pages you disable are skipped entirely.
- The default scoreboard layout now shows **two columns and up to four games** at a time.
  Adjust `scoreboardColumns`, `gamesPerColumn`, or `gamesPerPage` to taste.
- Toggle `showDivisionStandings` or `showWildCardStandings` to hide those pages entirely if
  you only care about one view.

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
| `--box-square-base` | Size of the R/H/E squares and row height of each game card |
| `--box-abbr-size-base` | Team abbreviation text size |
| `--box-logo-size-base` | Team logo footprint in scoreboards |
| `--matrix-gap-base` | Spacing between game cards |
| `--font-size-standings-headers-base` | Header text in standings tables |
| `--font-size-standings-values-base` | Standings numbers (W-L, GB, etc.) |
| `--width-stand-team-base` | Width of the team column in standings |
| `--pad-standings-inline-base` | Left/right padding in standings cells |

Example override (drop into your `css/custom.css`):

```css
:root {
  --box-square-base: 1.7em;
  --box-abbr-size-base: 1.5em;
  --matrix-gap-base: 10px;
  --font-size-standings-values-base: 1.05em;
}
```

> The standings markup still exposes helper classes like `.team-col`, `.gb-col`, etc., so you can apply custom widths/borders when needed.

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

**Standings row height won’t change**  
- Row height is constrained by line-height + logo size. Reduce `--logo-size-stand` or `--font-size-standings-values` if needed.

---

## FAQ

**Q: What’s the Wild Card calculation?**  
A: We exclude each division’s leader, sort the rest by win% (tie-break by wins), and compute WCGB relative to the **3rd** wild-card team:  
`WCGB = ((wins_3rd - wins_team) + (losses_team - losses_3rd)) / 2`.  
Values render as `--` for zero, `m<span class="fraction">1/2</span>` for halves.

**Q: Can I hide Home/Away splits?**  
A: Yes—set `showHomeAwaySplits: false` in the module config.

**Q: Does the scoreboard show extra innings?**  
A: Yes—`Final/11`, etc. Live games display R/H/E in yellow.

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
