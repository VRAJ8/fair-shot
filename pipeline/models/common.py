"""Shared helpers for the modeling layer."""
from __future__ import annotations

import duckdb
import pandas as pd

from ..config import CURRENT_SEASON, WAREHOUSE

# Games per team in shortened seasons (2011 lockout; 2020 bubble; 2021 COVID).
SEASON_GAMES = {2012: 66, 2020: 71, 2021: 72}


def season_games(season: int) -> int:
    return SEASON_GAMES.get(season, 82)


def connect(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(WAREHOUSE), read_only=read_only)


def write(con: duckdb.DuckDBPyConnection, name: str, df: pd.DataFrame) -> None:
    schema = name.split(".")[0]
    con.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
    con.register("df_view", df)
    con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM df_view")
    con.unregister("df_view")
    print(f"  wrote {name}: {len(df):,} rows")


def player_seasons(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Player-seasons with WAR scaled to an 82-game season."""
    df = con.sql("SELECT * FROM stg.player_seasons").df()
    df["season_games"] = df.season.map(season_games)
    # In-progress season: scale by games played so far, not 82.
    cur = df.season == CURRENT_SEASON
    df.loc[cur, "season_games"] = df.loc[cur, "games"].max()
    df["war82"] = df.war * 82 / df.season_games
    df["mpg"] = df.mp / df.games.clip(lower=1)
    return df
