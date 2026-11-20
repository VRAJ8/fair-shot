"""Parse every cached page into the `raw` schema of the DuckDB warehouse.

Raw tables keep source column names and only light typing. All cleaning,
deduplication and cross-source joins happen in SQL (pipeline/sql).
"""
from __future__ import annotations

import os
import time

os.environ.setdefault("FAIRSHOT_OFFLINE", "1")  # never fetch while parsing

import duckdb
import pandas as pd

from . import http
from .config import BBREF, DRAFT_YEARS, LAST_FULL_SEASON, SEASONS, WAREHOUSE, teams_for
from .sources import bbref, espn


def _concat(frames: list[pd.DataFrame]) -> pd.DataFrame:
    frames = [f for f in frames if f is not None and not f.empty]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def collect() -> dict[str, pd.DataFrame]:
    t = {}
    t["bbref_advanced"] = _concat([bbref.league_stats(s, "advanced") for s in SEASONS])
    t["bbref_totals"] = _concat([bbref.league_stats(s, "totals") for s in SEASONS])
    t["bbref_cap_history"] = bbref.salary_cap_history()
    t["bbref_contracts"] = bbref.current_contracts()

    rosters, salaries, missing = [], [], []
    for s in SEASONS:
        for team in teams_for(s):
            if not http.is_cached(f"{BBREF}/teams/{team}/{s}.html"):
                missing.append(f"{team}-{s}")
                continue
            page = bbref.team_page(team, s)
            rosters.append(page["roster"])
            salaries.append(page["salaries"])
    if missing:
        print(f"  (team pages not downloaded yet: {len(missing)})")
    t["bbref_rosters"] = _concat(rosters)
    t["bbref_salaries"] = _concat(salaries)
    t["bbref_schedule"] = _concat([bbref.schedule(s) for s in SEASONS])
    if all(http.is_cached(f"{BBREF}/players/{c}/") for c in "abcdefghijklmnopqrstuvwyz"):
        t["bbref_players"] = bbref.players_index()
    t["bbref_draft"] = _concat([bbref.draft(y) for y in DRAFT_YEARS
                                if http.is_cached(f"{BBREF}/draft/NBA_{y}.html")])

    t["espn_season_stats"] = _concat([espn.season_stats(s) for s in SEASONS])
    logs = []
    for season in (LAST_FULL_SEASON, LAST_FULL_SEASON + 1):
        ss = t["espn_season_stats"]
        for espn_id in ss.loc[ss.season == season, "espn_id"]:
            logs.append(espn.gamelog(espn_id, season))
    t["espn_gamelogs"] = _concat(logs)
    return t


def main() -> None:
    t0 = time.time()
    tables = collect()
    con = duckdb.connect(str(WAREHOUSE))
    con.execute("CREATE SCHEMA IF NOT EXISTS raw")
    for name, df in tables.items():
        if df.empty:
            print(f"  raw.{name}: EMPTY (skipped)")
            continue
        df = df.astype({c: "string" for c in df.columns if df[c].dtype == object})
        con.register("df_view", df)
        con.execute(f"CREATE OR REPLACE TABLE raw.{name} AS SELECT * FROM df_view")
        con.unregister("df_view")
        print(f"  raw.{name}: {len(df):,} rows x {df.shape[1]} cols")
    con.close()
    print(f"raw load finished in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
