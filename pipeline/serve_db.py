"""Build the slim, read-only database the deployed AI agent queries.

    python -m pipeline.serve_db

The full warehouse (raw pages included) stays local. The agent only needs the
modeled and staged tables it documents, so those are copied into
agent/fairshot.duckdb, which ships with the deployment.
"""
from __future__ import annotations

import duckdb

from .config import ROOT, WAREHOUSE

SERVE_DB = ROOT / "agent" / "fairshot.duckdb"
TABLES = [
    "model.fair_value", "model.market", "model.projections", "model.comps",
    "stg.player_seasons", "stg.salaries", "stg.cap", "stg.rosters", "stg.games",
    "stg.team_games", "mart.player_availability",
]


def main() -> None:
    SERVE_DB.unlink(missing_ok=True)
    con = duckdb.connect(str(SERVE_DB))
    con.execute(f"ATTACH '{WAREHOUSE}' AS wh (READ_ONLY)")
    for table in TABLES:
        schema = table.split(".")[0]
        con.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
        con.execute(f"CREATE TABLE {table} AS SELECT * FROM wh.{table}")
    con.execute("DETACH wh")
    con.execute("CHECKPOINT")
    con.close()
    print(f"  serving db: {SERVE_DB.name} ({SERVE_DB.stat().st_size / 1e6:.1f} MB, {len(TABLES)} tables)")


if __name__ == "__main__":
    main()
