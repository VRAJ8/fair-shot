"""The career clock: how long do NBA careers last, by draft position?

Kaplan-Meier survival curves of seasons in the league for every player drafted
1995-2021 plus undrafted players who debuted in the same window. A player still
active in the current season is right-censored (his career hasn't ended).
Drafted players who never played count as zero-season careers.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from lifelines import KaplanMeierFitter
from lifelines.statistics import multivariate_logrank_test

from ..config import CURRENT_SEASON, PROCESSED
from .common import connect

FIRST_DRAFT, LAST_DRAFT = 1995, 2021
GROUPS = ["Picks 1–5", "Picks 6–14", "Picks 15–30", "2nd round", "Undrafted"]


def group(pick: float | None, rnd: float | None) -> str:
    if pick is None or pd.isna(pick):
        return "Undrafted"
    if rnd == 2:
        return "2nd round"
    if pick <= 5:
        return "Picks 1–5"
    if pick <= 14:
        return "Picks 6–14"
    return "Picks 15–30"


def build() -> dict:
    con = connect(read_only=True)
    tables = {r[0] for r in con.sql("SELECT table_schema || '.' || table_name FROM information_schema.tables").fetchall()}
    if not {"stg.draft", "stg.careers"} <= tables:
        print("  survival: draft/career tables not built yet; skipping")
        return {}
    draft = con.sql(f"SELECT * FROM stg.draft WHERE draft_year BETWEEN {FIRST_DRAFT} AND {LAST_DRAFT}").df()
    careers = con.sql("SELECT * FROM stg.careers").df()
    con.close()

    drafted = draft.merge(careers[["player_id", "first_season", "last_season"]], on="player_id", how="left")
    drafted["seasons"] = (drafted.last_season - drafted.first_season + 1).fillna(0)
    drafted["active"] = drafted.last_season >= CURRENT_SEASON
    drafted["group"] = [group(p, r) for p, r in zip(drafted.draft_pick, drafted.draft_round)]

    # Undrafted: debuted in the same window (draft year + 1) and not in any draft table we hold.
    all_drafted = set(draft.player_id)
    und = careers[(careers.first_season.between(FIRST_DRAFT + 1, LAST_DRAFT + 1)) & ~careers.player_id.isin(all_drafted)].copy()
    und["seasons"] = und.seasons_span
    und["active"] = und.last_season >= CURRENT_SEASON
    und["group"] = "Undrafted"

    df = pd.concat([drafted[["player_id", "seasons", "active", "group"]], und[["player_id", "seasons", "active", "group"]]])
    df["event"] = ~df.active
    out = {"first_draft": FIRST_DRAFT, "last_draft": LAST_DRAFT, "n_players": int(len(df)), "groups": []}
    kmf = KaplanMeierFitter()
    for g in GROUPS:
        d = df[df.group == g]
        if d.empty:
            continue
        kmf.fit(d.seasons, event_observed=d.event)
        sf = kmf.survival_function_.iloc[:, 0]
        # Share still in the league after t seasons, i.e. S(t) evaluated just after t.
        curve = [{"t": int(t), "s": round(float(kmf.predict(t - 1e-9) if t > 0 else 1.0), 4)} for t in range(1, 21)]
        median = kmf.median_survival_time_
        out["groups"].append({"name": g, "n": int(len(d)), "curve": curve,
                              "median": None if np.isinf(median) else int(median),
                              "pct_never_played": round(float((d.seasons == 0).mean()), 4)})
    lr = multivariate_logrank_test(df.seasons, df.group, df.event)
    out["logrank_p"] = float(lr.p_value)
    (PROCESSED / "survival.json").write_text(json.dumps(out, indent=1))
    for g in out["groups"]:
        print(f"  survival: {g['name']:<12} n={g['n']:<5} median={g['median']} seasons")
    return out


if __name__ == "__main__":
    build()
