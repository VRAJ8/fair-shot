"""Build the warehouse: seeds -> staging SQL -> crosswalk -> marts SQL.

    python -m pipeline.warehouse
"""
from __future__ import annotations

import os

os.environ.setdefault("FAIRSHOT_OFFLINE", "1")

import time
from pathlib import Path

import duckdb
import pandas as pd

from . import crosswalk
from .config import WAREHOUSE
from .geo import NEUTRAL_SITES, TEAM_COLORS, TEAM_GEO

SQL_DIR = Path(__file__).parent / "sql"


def load_seeds(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS seed")
    geo = pd.DataFrame([(t, *v) for t, v in TEAM_GEO.items()],
                       columns=["team", "city", "lat", "lon", "utc_offset"])
    neutral = pd.DataFrame([(k, *v) for k, v in NEUTRAL_SITES.items()],
                           columns=["match", "city", "lat", "lon", "utc_offset"])
    colors = pd.DataFrame([(t, *v) for t, v in TEAM_COLORS.items()],
                          columns=["team", "primary_color", "secondary_color"])
    for name, df in {"team_geo": geo, "neutral_sites": neutral, "team_colors": colors}.items():
        con.register("df_view", df)
        con.execute(f"CREATE OR REPLACE TABLE seed.{name} AS SELECT * FROM df_view")
        con.unregister("df_view")


def run_sql(con: duckdb.DuckDBPyConnection, path: Path) -> None:
    t0 = time.time()
    con.execute(path.read_text())
    print(f"  ran {path.name} ({time.time() - t0:.1f}s)")


def build_crosswalk(con: duckdb.DuckDBPyConnection) -> None:
    bb = con.sql("SELECT season, player_id, player_name, teams, games FROM stg.player_seasons").df()
    es = con.sql("SELECT season, espn_id, name, team_abbr, gamesPlayed FROM raw.espn_season_stats").df()
    by_season, resolved = crosswalk.build(bb, es)
    con.execute("CREATE SCHEMA IF NOT EXISTS xwalk")
    for name, df in {"espn_matches": by_season, "player_ids": resolved}.items():
        con.register("df_view", df)
        con.execute(f"CREATE OR REPLACE TABLE xwalk.{name} AS SELECT * FROM df_view")
        con.unregister("df_view")
    rate = by_season.player_id.notna().mean()
    print(f"  crosswalk: {len(resolved):,} ESPN athletes -> BBRef IDs; season match rate {rate:.1%}")


def main() -> None:
    con = duckdb.connect(str(WAREHOUSE))
    load_seeds(con)
    run_sql(con, SQL_DIR / "01_staging.sql")
    build_crosswalk(con)
    for path in sorted(SQL_DIR.glob("0[2-9]_*.sql")):
        try:
            run_sql(con, path)
        except duckdb.CatalogException as exc:  # a source not downloaded yet
            print(f"  skipped {path.name}: {str(exc).splitlines()[0]}")
    con.close()


if __name__ == "__main__":
    main()
