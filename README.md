# Fair Shot

**What every NBA player produces, what they're paid, and who keeps the difference.**

**Live: [fair-shot.vercel.app](https://fair-shot.vercel.app)**

Fair Shot is an end-to-end analytics project that looks at NBA pay from the **players' side**, the way a
players' association would. It collects 16 seasons of data from two independent sources, reconciles them in a
tested SQL warehouse, prices every player's production with a wins-based market model, projects the next three
seasons, and tells the story as a scroll-driven, interactive site. An AI analyst (Gemini on the free tier, or Claude) answers questions by
writing SQL against the same warehouse, and drafts negotiation briefs for any player.

> Seasons are named by the year they end in the code (2026 = 2025–26). The latest complete season is 2025–26;
> 2026–27 is in progress.

---

## Key findings (2025–26 unless noted)

| | |
|---|---|
| **$5.0M** | Market price of one win over replacement, up from $1.86M in 2011–12. |
| **$2.0B** | Value produced by the 236 (of 498) players who were paid less than their production was worth. |
| **12 players** | Worth more than the 35% max salary allows: **$252M** of production above the ceiling. Nikola Jokić: ~$126M of value on a $55M salary. |
| **+$459M / +$324M** | Net surplus created by minimum-salary and rookie-scale players. Pay set by formula, not by the market. |
| **33% → 27%** | Share of payroll going to "middle-class" contracts (7.5–17.5% of the cap), 2011–12 → 2025–26. The top 10% of contracts went from 35% to 40% of all salary dollars; the Gini coefficient rose from 0.53 to 0.60. |
| **−0.6 pts** (95% CI −5.4 to +4.0) | Measured effect of the 2023 CBA's 65-game award rule on how often stars play (difference-in-differences vs. the next tier of players). Availability fell for everyone, stars and non-stars alike. |
| **19.1 → 14.7** | Back-to-backs per team per 82 games, 2012–13 → 2025–26. |
| **14 vs. 2 seasons** | Median career length for top-5 picks vs. second-round and undrafted players (Kaplan–Meier on 2,342 players: everyone drafted 1995–2021 plus undrafted players who debuted in that window; log-rank p < 0.001). |

---

## What's inside

```
Sources ──► raw cache ──► DuckDB raw ──► staging SQL ──► ID crosswalk ──► marts
   │                                                                      │
   │                       models: fair value · projection · comps ◄──────┤
   │                               65-game DiD · survival · payroll tiers │
   │                                                                      ▼
   │                         data-quality tests (14 checks) ──► JSON export ──► React site
   └──────────────────────────────────────────────────────────────────────► LLM agent (SQL tool)
```

### 1. Data engineering (`pipeline/`)
- **Two independent sources.** Basketball-Reference supplies stats, team payrolls, schedules, drafts and the
  all-time player index. ESPN's public API supplies a second stat line per season and every game log. About 1,800 pages
  in total.
- **Polite, cached ingestion** (`pipeline/http.py`): every response is cached on disk, requests to
  Basketball-Reference are spaced 4 seconds apart, and a 429 triggers a long back-off. All later steps run in
  cache-only mode (`FAIRSHOT_OFFLINE=1`), so parsing can never add traffic.
- **DuckDB warehouse**, layered dbt-style: `raw` → `stg` (typed, one grain per table) → `mart` / `model`.
  The SQL lives in `pipeline/sql/`.
- **Messy realities handled in SQL:** traded players (combined vs. per-team rows), payroll rows duplicated
  across teams after trades and waivers (1,489 resolved), playoff and play-in detection (BBRef stopped
  marking playoffs on its pages in 2019–20), the NBA Cup final (not a regular-season game), neutral-site games
  (London, Paris, Berlin, Mexico City, the 2020 Orlando bubble, Cup semifinals in Las Vegas) for travel miles, and
  unplayed games in the current season.
- **Entity resolution** (`pipeline/crosswalk.py`): the sources share no player key. Names are normalized
  (accents, suffixes, punctuation), then matched within each season by name, team and games played, with fuzzy
  fallbacks and a majority vote across seasons. Result: 99.99% of 8,363 ESPN player-seasons matched, one-to-one.

### 2. Data quality (`pipeline/validate.py`)
14 checks run on every build. A failed error-level check stops the export. They include uniqueness, full
schedules, CBA salary bounds, crosswalk integrity, availability logic and projection-interval ordering. The checks
surfaced real-world edge cases that are now encoded in the rules:
- Boston and Indiana played **81 games** in 2012–13 (their game was canceled after the Boston Marathon bombing).
- Kobe Bryant earned **48–52% of the cap** in 2012–14. That was legal: the 105%-of-prior-salary max plus capped raises
  allowed it.
- ESPN "regular season" game logs include play-in games, the NBA Cup final and the 2026 All-Star Game. Each one is
  identified and excluded, and the report accounts for every dropped row.

### 3. Statistics & predictive modeling (`pipeline/models/`)
| Model | Method | Validation |
|---|---|---|
| **Fair value** (`value.py`) | League minimum + WAR × market $ per win. WAR = 2.7 × VORP, scaled to 82 games. The league minimum is estimated from the data. | Matches the published rookie minimum (to the nearest $1K) for every season from 2014–15 to 2025–26 |
| **3-season projection** (`projection.py`) | Gradient-boosted **quantile** regression, one model per horizon, from three seasons of history plus age and role. Players who leave the league count as 0 WAR. **Conformalized** intervals. | Out of time (train ≤ 2021–22, test 2022–23 → 2025–26). MAE 1.34 WAR vs. 1.44 Marcel-style vs. 1.60 "repeat last season"; R² 0.65; 80% intervals cover 80–82% |
| **Comps** (`comps.py`) | Weighted nearest neighbours on era-adjusted (within-season z-scored) role and production features; each comp carries what that player earned the next season | Brunson → Booker, Parker, DeRozan, Kyrie. The page flags "one-of-one" seasons (e.g. Jokić) instead of pretending |
| **65-game rule** (`stories.py`) | Difference-in-differences: top-40 players (ranked on the *prior* season) vs. ranks 61–200, before and after the 2023 CBA; cluster bootstrap by player | 95% CI reported |
| **Career survival** (`survival.py`) | Kaplan–Meier curves by draft slot with right-censoring for active careers; multivariate log-rank test | |
| **Payroll distribution** | Contract tiers as a share of the cap, payroll shares, Gini, top-10% share | |

### 4. Reporting & visualization (`web/`)
A React + TypeScript site, told as a game: **Tip-off → four quarters → Overtime → Post-game**, with a 24-second shot clock
that runs down as you scroll.
- **GSAP + ScrollTrigger**: pinned, scroll-scrubbed sequences ("the price of a win", a team's whole season of
  flights drawing arc by arc), SplitText headline reveals, DrawSVG line draws.
- **Lenis** smooth scrolling, wired to ScrollTrigger.
- **Three.js / React Three Fiber**: the hero ball and court are generated procedurally (canvas-drawn leather, seams,
  maple planks, court lines). There are no image assets.
- **D3** for every chart: a scrollytelling scatter of all players with Delaunay hover, bar charts, a stacked area,
  Kaplan–Meier step curves, a US flight map (`d3-geo` + `us-atlas`), fan charts and game strips.
- Chart colors were validated for color-vision deficiency against the dark surface. Each chart has a legend and
  tooltips, the site respects `prefers-reduced-motion`, and the layout works from phone width up.
- **Player pages** for all 647 players: an LED scoreboard (salary vs. fair value), career ledger, projection fan
  chart against the contract, comps translated to today's cap, and a game-by-game availability strip.
- Jersey avatars in team colors instead of player photos (no image-rights issues).

### 5. AI agent (`agent/server.py`)
- **Two interchangeable providers.** The live site runs **Google Gemini** (`gemini-3.8-flash`, free tier) through a
  manual function-calling loop with the `google-genai` SDK. **Anthropic Claude** (`claude-opus-5-5`, via the Anthropic
  SDK's tool runner) is a drop-in alternative: `AI_PROVIDER=claude`. Both use the same tool and sandbox.
- **Ask the Ledger**: the model answers plain-English questions by writing SQL through a `run_sql` tool.
  The tool is sandboxed: a read-only DuckDB connection,
  external file access disabled, configuration locked, a single SELECT/WITH statement per call, and capped rows.
  Every answer shows the SQL it ran.
- **Make the case**: streams a one-page negotiation brief from the player's side, grounded only in that
  player's exported numbers.
- The schema documentation is generated from the database into the system prompt. On Claude, the prompt is cached and server-side refusal fallbacks are enabled.

---

## Run it

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-pipeline.txt
```

```bash
.venv/bin/python -m pipeline.run --ingest   # first run downloads (~1 hour, rate-limited); later runs use the cache
```

```bash
npm --prefix web install && npm --prefix web run dev   # http://localhost:5173
```

Optional, the AI analyst. It needs a free Gemini key from Google AI Studio (or `AI_PROVIDER=claude` with an
`ANTHROPIC_API_KEY`):

```bash
GEMINI_API_KEY=... .venv/bin/python -m agent.server   # http://127.0.0.1:8787, proxied at /api
```

`npm --prefix web run build` produces a static site in `web/dist`. The site runs fully without the agent.

## Deploy (Vercel)
`vercel.json` deploys the site and the agent together. The site is a static Vite build on the CDN; the agent is a
Python function at `/api/*` (`api/index.py`) that queries the slim read-only database `agent/fairshot.duckdb`,
which `pipeline.run` rebuilds. Pushes to `main` deploy automatically.

To turn the AI analyst on, add a free Gemini key (Google AI Studio, no card) as an environment variable, then
redeploy:

```bash
vercel env add GEMINI_API_KEY production
```

The free tier can't produce a bill; if traffic exceeds its limits, the AI replies "busy, try again" until the limit
resets. Each visitor is also rate limited (10 questions and 4 briefs per 10 minutes, plus an hourly cap per instance),
questions are capped at 600 characters, and `AGENT_ENABLED=false` pauses the AI without a code change. Google may use
free-tier prompts to improve its models; everything the agent sees is public NBA data. To run Claude instead, set
`AI_PROVIDER=claude` and `ANTHROPIC_API_KEY`, plus a monthly spend limit in the Anthropic Console.

## Project layout

```
pipeline/
  http.py           cached, rate-limited fetcher
  ingest.py         download manifest (BBRef + ESPN)
  sources/          page parsers (bbref.py, espn.py)
  load_raw.py       parsed pages -> DuckDB raw schema
  sql/              staging + marts (games, travel, availability, draft, careers)
  crosswalk.py      ESPN <-> BBRef entity resolution
  warehouse.py      runs seeds, SQL and the crosswalk
  models/           value, projection, comps, stories (65-game, payroll tiers, schedule), survival
  validate.py       data-quality checks + reconciliation report
  export.py         JSON for the site
  run.py            the whole pipeline
agent/server.py     FastAPI agent: Gemini (default) or Claude, sandboxed SQL tool
web/                React + D3 + GSAP + Three.js site
```

## Limits & next steps
- Box-score value (VORP) undervalues some defensive roles and ignores playoff performance and marketing value.
  A natural next step is blending in an on/off or RAPM-style metric.
- Payroll pages list cap salaries. They can miss incentives, cap holds and dead money.
- In the season in progress, values are extrapolated from a small sample and are labeled "so far."
- Possible extensions: an injury-risk model from game-log workload, and an R/Tidyverse replication of the
  fair-value model.

## Data & attribution
Data from [Basketball-Reference.com](https://www.basketball-reference.com) (Sports Reference LLC) and ESPN's
public API, collected at a low request rate and cached. This is an independent portfolio project, not affiliated
with the NBA, the NBPA or any team.
