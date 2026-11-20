"""Comps: the historical player-seasons most like a player's latest season.

This is how contract talks actually start ("he's this generation's X; X got
22% of the cap"). Each player-season becomes a vector of role and production
features. Rate stats that drift over the era (3-point rate, usage, true
shooting) are standardized within their season, so a 2014 stretch big and a
2026 stretch big look alike. Nearest neighbours are found with weighted
Euclidean distance, excluding the player himself. Each comp carries what that
player was paid the next season, as a share of that year's cap, so it can be
translated into today's dollars.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

from ..config import LAST_FULL_SEASON
from .common import connect, player_seasons, write

WITHIN_SEASON_Z = ["fg3a_rate", "usg_pct", "ts_pct", "ast_pct", "trb_pct", "stl_pct", "blk_pct", "fta_rate"]
ABSOLUTE = ["age", "war82", "bpm", "obpm", "dbpm", "mpg"]
WEIGHTS = {"war82": 2.0, "bpm": 1.5, "age": 1.5, "mpg": 1.2, "obpm": 1.0, "dbpm": 1.0,
           "usg_pct": 1.0, "fg3a_rate": 0.8, "ts_pct": 0.8, "ast_pct": 0.8, "trb_pct": 0.8,
           "stl_pct": 0.4, "blk_pct": 0.5, "fta_rate": 0.4}
K = 6


def build() -> None:
    con = connect()
    ps = player_seasons(con)
    ps = ps[(ps.season <= LAST_FULL_SEASON) & (ps.mp >= 500)].copy()
    for col in WITHIN_SEASON_Z:
        g = ps.groupby("season")[col]
        ps[f"z_{col}"] = (ps[col] - g.transform("mean")) / g.transform("std")
    cols = [f"z_{c}" for c in WITHIN_SEASON_Z] + ABSOLUTE
    X = ps[cols].copy()
    X[ABSOLUTE] = (X[ABSOLUTE] - X[ABSOLUTE].mean()) / X[ABSOLUTE].std()
    w = np.array([WEIGHTS[c.removeprefix("z_")] for c in cols])
    X = X.fillna(0).to_numpy() * np.sqrt(w)

    pay = con.sql("""SELECT s.season - 1 AS season, s.player_id, s.salary / c.salary_cap AS next_pct_cap
                     FROM stg.salaries s JOIN stg.cap c USING (season)""").df()
    hist_mask = (ps.season < LAST_FULL_SEASON).to_numpy()
    hist = ps[hist_mask].reset_index(drop=True).merge(pay, on=["season", "player_id"], how="left")
    nn = NearestNeighbors(n_neighbors=K + 30).fit(X[hist_mask])

    query = ps[ps.season == LAST_FULL_SEASON].reset_index(drop=True)
    dist, idx = nn.kneighbors(X[~hist_mask & (ps.season == LAST_FULL_SEASON).to_numpy()])
    # Similarity 0-100: a Gaussian kernel on distance, scaled by the typical
    # nearest-neighbour distance, so "100" = identical and a typical closest
    # comp lands around 80.
    scale = float(np.median(dist[:, 1])) * 1.5
    rows = []
    for qi, q in query.iterrows():
        taken, seen = 0, {q.player_id}
        for d, j in zip(dist[qi], idx[qi]):
            c = hist.iloc[j]
            if c.player_id in seen:  # skip himself, and one season per comp player
                continue
            seen.add(c.player_id)
            rows.append({"player_id": q.player_id, "season": q.season, "rank": taken + 1,
                         "comp_player_id": c.player_id, "comp_name": c.player_name, "comp_season": int(c.season),
                         "comp_age": int(c.age), "comp_war82": round(float(c.war82), 2),
                         "comp_bpm": float(c.bpm), "comp_mpg": round(float(c.mpg), 1),
                         "comp_next_pct_cap": None if pd.isna(c.next_pct_cap) else round(float(c.next_pct_cap), 4),
                         "similarity": round(float(100 * np.exp(-0.5 * (d / scale) ** 2)), 1)})
            taken += 1
            if taken == K:
                break
    write(con, "model.comps", pd.DataFrame(rows))
    con.close()


if __name__ == "__main__":
    build()
