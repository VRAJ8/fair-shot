"""League-wide analyses behind the site's story chapters."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ..config import CURRENT_SEASON, LAST_FULL_SEASON, PROCESSED
from .common import connect, player_seasons, write

PRE = [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2022, 2023]   # skip lockout + COVID seasons
POST = [2024, 2025, 2026]                                      # 65-game award rule in force


def sixty_five_rule(ps: pd.DataFrame, rng: np.random.Generator) -> dict:
    """Did the 2023 CBA's 65-game minimum for awards change how often stars play?

    Design: difference-in-differences. Treated = top-40 players by the PRIOR
    season's WAR (defined before the season, so not on the outcome). Control =
    players ranked 61-200, for whom awards are not realistically at stake.
    Outcome = share of team games played, and whether they reached 65.
    95% CI from a bootstrap that resamples players (clustered).
    """
    prev = ps[["season", "player_id", "war82"]].assign(season=ps.season + 1)
    prev["prior_rank"] = prev.groupby("season").war82.rank(ascending=False, method="first")
    df = ps.merge(prev[["season", "player_id", "prior_rank"]], on=["season", "player_id"])
    df = df[df.season.isin(PRE + POST)]
    df["group"] = np.select([df.prior_rank <= 40, df.prior_rank.between(61, 200)], ["stars", "control"], "other")
    df = df[df.group != "other"].copy()
    df["period"] = np.where(df.season.isin(POST), "post", "pre")
    df["games_share"] = df.games / df.season_games
    df["reached_65"] = (df.games >= 65).astype(float)

    def did(d: pd.DataFrame, col: str) -> float:
        m = d.groupby(["group", "period"])[col].mean()
        return (m["stars", "post"] - m["stars", "pre"]) - (m["control", "post"] - m["control", "pre"])

    est = {c: did(df, c) for c in ("games_share", "reached_65")}
    players = df.player_id.unique()
    groups = {p: g for p, g in df.groupby("player_id")}
    boots = {c: [] for c in est}
    for _ in range(1000):
        sample = pd.concat([groups[p] for p in rng.choice(players, len(players))], ignore_index=True)
        for c in est:
            boots[c].append(did(sample, c))
    by_season = (df.groupby(["season", "group"])
                   .agg(games_share=("games_share", "mean"), reached_65=("reached_65", "mean"),
                        n=("player_id", "size")).reset_index())
    stars = df[df.group == "stars"][["season", "player_id", "player_name", "games", "season_games", "prior_rank"]]
    return {
        "did_games_share": round(est["games_share"], 4),
        "did_games_share_ci": [round(float(np.percentile(boots["games_share"], q)), 4) for q in (2.5, 97.5)],
        "did_reached_65": round(est["reached_65"], 4),
        "did_reached_65_ci": [round(float(np.percentile(boots["reached_65"], q)), 4) for q in (2.5, 97.5)],
        "means": df.groupby(["group", "period"])[["games_share", "reached_65"]].mean().round(4)
                   .reset_index().to_dict("records"),
        "by_season": by_season.round(4).to_dict("records"),
        "stars": stars.to_dict("records"),
        "pre_seasons": PRE, "post_seasons": POST,
    }


def gini(x: np.ndarray) -> float:
    x = np.sort(x[x > 0])
    n = len(x)
    if n == 0:
        return float("nan")
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum()))


TIERS = ["Minimum", "Rotation", "Middle class", "Near-max", "Max"]


def middle_class(con) -> dict:
    """How the league's payroll is split across contract tiers, by season."""
    sal = con.sql("""SELECT s.season, s.player_id, s.salary, s.salary / c.salary_cap AS pct
                     FROM stg.salaries s JOIN stg.cap c USING (season)""").df()
    if sal.empty:
        return {}
    from .value import contract_tier
    sal["tier"] = sal.pct.map(contract_tier)
    seasons = []
    for season, g in sal.groupby("season"):
        total = g.salary.sum()
        row = {"season": int(season), "n_players": int(len(g)), "payroll": float(total),
               "gini": round(gini(g.salary.to_numpy()), 4),
               "median_pct_cap": round(float(g.pct.median()), 4),
               "top10_share": round(float(g.salary.nlargest(int(len(g) * 0.1)).sum() / total), 4)}
        for t in TIERS:
            tg = g[g.tier == t]
            row[f"share_{t}"] = round(float(tg.salary.sum() / total), 4)
            row[f"count_{t}"] = int(len(tg))
        seasons.append(row)
    return {"tiers": TIERS, "seasons": seasons}


def schedule_trends(con) -> dict:
    tg = con.sql("""SELECT season, team, count(*) AS games, sum(travel_miles) AS miles,
                           sum(is_b2b_second::INT) AS b2b, avg(rest_days) AS avg_rest,
                           sum(CASE WHEN tz_shift >= 2 THEN 1 ELSE 0 END) AS big_tz_jumps
                    FROM stg.team_games GROUP BY ALL""").df()
    if tg.empty:
        return {}
    league = (tg.groupby("season").agg(b2b_per_team=("b2b", "mean"), miles_per_team=("miles", "mean"),
                                       games=("games", "mean")).reset_index())
    league["b2b_per_82"] = league.b2b_per_team * 82 / league.games
    league["miles_per_82"] = league.miles_per_team * 82 / league.games
    latest = tg[tg.season == LAST_FULL_SEASON].sort_values("miles", ascending=False)
    return {"league": league.round(2).to_dict("records"), "teams_latest": latest.round(1).to_dict("records")}


def build() -> None:
    rng = np.random.default_rng(42)
    con = connect()
    ps = player_seasons(con)
    ps = ps[ps.season <= LAST_FULL_SEASON]
    out = {"sixty_five": sixty_five_rule(ps, rng)}
    out["middle_class"] = middle_class(con)
    out["schedule"] = schedule_trends(con)
    (PROCESSED / "stories.json").write_text(json.dumps(out, indent=1, default=float))
    s = out["sixty_five"]
    print(f"  65-game rule DiD on games share: {s['did_games_share']:+.3f} CI {s['did_games_share_ci']}")
    print(f"  65-game rule DiD on reaching 65: {s['did_reached_65']:+.3f} CI {s['did_reached_65_ci']}")
    print("  ", s["means"])
    con.close()


if __name__ == "__main__":
    build()
