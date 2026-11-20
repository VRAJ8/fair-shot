"""Fair Value: what a player's production is worth on the open market.

Method (wins-based, the standard sports-economics approach):
  1. Wins over replacement  WAR = 2.7 x VORP (Basketball-Reference's BPM-based
     estimate of wins above a freely available replacement player).
  2. Replacement price      R = the league-minimum salary that season (what any
     team pays for a replacement-level player).
  3. Market price of a win  $/WAR = sum(salary - R) / sum(WAR+) across every
     player with both a salary and a stat line that season.
  4. Fair value             R + max(WAR, 0) x $/WAR.
Surplus = fair value - actual salary. Positive = the player is underpaid.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .common import connect, player_seasons, write

MAX_PCT = {0: 0.25, 7: 0.30, 10: 0.35}  # CBA max salary by years of service (% of cap)


def league_minimum(sal: pd.Series, cap: float) -> float:
    """Rookie minimum, estimated from the data: the smallest salary amount that
    at least 5 players share within 0.45%-1.0% of the cap. Shared amounts are
    scale contracts; prorated 10-day deals are unique amounts, and two-way
    deals (half the minimum) sit below the band. The band is wide because the
    2016 cap spike briefly pushed the minimum down to 0.58% of the cap."""
    band = sal[(sal >= 0.0045 * cap) & (sal <= 0.010 * cap)].round(-3)
    counts = band.value_counts()
    shared = counts[counts >= 5]
    if shared.empty:
        return 0.0082 * cap
    return float(shared.index.min())


def contract_tier(pct: float) -> str:
    if pct >= 0.25:
        return "Max"
    if pct >= 0.175:
        return "Near-max"
    if pct >= 0.075:
        return "Middle class"
    if pct >= 0.025:
        return "Rotation"
    return "Minimum"


def build() -> pd.DataFrame:
    con = connect()
    ps = player_seasons(con)
    sal = con.sql("SELECT season, player_id, salary FROM stg.salaries").df()
    cap = con.sql("SELECT season, salary_cap FROM stg.cap").df()
    df = ps.merge(sal, on=["season", "player_id"], how="left").merge(cap, on="season", how="left")

    rows = []
    for season, g in df.groupby("season"):
        paid = g[g.salary.notna()]
        if paid.empty:
            continue
        c = float(g.salary_cap.iloc[0])
        r = league_minimum(paid.salary, c)
        # Use WAR scaled to a full season so the in-progress season prices fairly.
        dollars_per_war = (paid.salary - r).clip(lower=0).sum() / paid.war82.clip(lower=0).sum()
        rows.append({"season": season, "salary_cap": c, "replacement_salary": r,
                     "dollars_per_war": dollars_per_war, "n_paid_players": len(paid)})
    market = pd.DataFrame(rows)

    df = df.merge(market.drop(columns="salary_cap"), on="season", how="inner")
    df["fair_value"] = df.replacement_salary + df.war82.clip(lower=0) * df.dollars_per_war
    # Prorate to the share of the season actually played so far (current season).
    df["surplus"] = df.fair_value - df.salary
    df["salary_pct_cap"] = df.salary / df.salary_cap
    df["fair_pct_cap"] = df.fair_value / df.salary_cap
    df["tier"] = df.salary_pct_cap.map(lambda p: contract_tier(p) if pd.notna(p) else None)
    df["max_salary_35"] = 0.35 * df.salary_cap
    df["value_above_max"] = (df.fair_value - df.max_salary_35).clip(lower=0)
    keep = ["season", "player_id", "player_name", "team", "teams", "age", "pos", "games", "games_started",
            "mp", "mpg", "pts", "trb", "ast", "ts_pct", "usg_pct", "bpm", "obpm", "dbpm", "vorp", "war",
            "war82", "ws", "per", "salary", "salary_cap", "salary_pct_cap", "tier", "fair_value",
            "fair_pct_cap", "surplus", "value_above_max", "awards"]
    out = df[keep].copy()
    write(con, "model.fair_value", out)
    write(con, "model.market", market)
    con.close()
    return out


if __name__ == "__main__":
    out = build()
    latest = out[out.salary.notna()].season.max()
    v = out[(out.season == latest) & out.salary.notna()]
    print(v.nlargest(8, "surplus")[["player_name", "team", "salary", "fair_value", "surplus"]].to_string())
    print(v.nsmallest(5, "surplus")[["player_name", "team", "salary", "fair_value", "surplus"]].to_string())
