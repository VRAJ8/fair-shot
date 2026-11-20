"""Data-quality checks and cross-source reconciliation.

    python -m pipeline.validate      # exits 1 if any error-level check fails

Each check is a SQL query that returns the *failing* rows (zero rows = pass).
Results, plus a BBRef-vs-ESPN reconciliation report, go to
data/processed/quality.json, which the site's Methods page renders.
"""
from __future__ import annotations

import json
import os
import sys

os.environ.setdefault("FAIRSHOT_OFFLINE", "1")

from .config import CURRENT_SEASON, LAST_FULL_SEASON, PROCESSED
from .models.common import connect

CHECKS = [
    # (name, table, severity, SQL returning failing rows)
    ("One row per player-season", "stg.player_seasons", "error",
     "SELECT season, player_id FROM stg.player_seasons GROUP BY ALL HAVING count(*) > 1"),
    ("One salary per player-season", "stg.salaries", "error",
     "SELECT season, player_id FROM stg.salaries GROUP BY ALL HAVING count(*) > 1"),
    ("One row per game", "stg.games", "error",
     "SELECT game_id FROM stg.games GROUP BY ALL HAVING count(*) > 1"),
    ("Every regular-season team plays a full schedule (82; 66/72 in shortened seasons; 2020 bubble varies)", "stg.team_games", "error",
     # Known exception: BOS-IND on 2013-04-16 was cancelled after the Boston Marathon bombing.
     f"""SELECT season, team, count(*) n FROM stg.team_games WHERE season < {CURRENT_SEASON} AND season <> 2020
         GROUP BY ALL HAVING n <> CASE WHEN season = 2012 THEN 66 WHEN season = 2021 THEN 72
                                       WHEN season = 2013 AND team IN ('BOS', 'IND') THEN 81 ELSE 82 END"""),
    ("Every game has two teams and a final score", "stg.games", "error",
     f"SELECT game_id FROM stg.games WHERE season < {CURRENT_SEASON} AND (home IS NULL OR away IS NULL OR home_pts IS NULL OR away_pts IS NULL)"),
    # A max deal starts at <=35% of the cap (or 105% of the player's prior
    # salary, under older CBAs) and then carries raises of up to 8-12.5%, so a
    # salary above 45% of the cap is only valid if a capped raise explains it
    # (e.g. Kobe Bryant: 48-52% of the cap in 2012-14).
    ("Salaries within CBA bounds (> $0; above 45% of cap only via capped raises)", "stg.salaries", "error",
     """SELECT s.season, s.player_id, s.salary FROM stg.salaries s JOIN stg.cap c USING (season)
        LEFT JOIN stg.salaries p ON p.player_id = s.player_id AND p.season = s.season - 1
        WHERE s.salary <= 0
           OR (s.largest_contract > 0.45 * c.salary_cap
               AND (p.salary IS NULL OR s.largest_contract > 1.125 * p.largest_contract))"""),
    ("Team payrolls plausible (40%–200% of the cap)", "stg.salaries", "warn",
     """WITH t AS (SELECT season, unnest(paid_by) AS team, salary FROM stg.salaries)
        SELECT t.season, team, sum(salary) / any_value(c.salary_cap) AS pct FROM t JOIN stg.cap c USING (season)
        GROUP BY t.season, team HAVING pct NOT BETWEEN 0.4 AND 2.0"""),
    ("Advanced stats present for every stat line", "stg.player_seasons", "error",
     "SELECT season, player_id FROM stg.player_seasons WHERE mp > 0 AND (bpm IS NULL OR vorp IS NULL)"),
    ("WAR within plausible range (−6 to 35 per 82 games)", "model.fair_value", "error",
     f"SELECT season, player_id, war82 FROM model.fair_value WHERE season < {CURRENT_SEASON} AND war82 NOT BETWEEN -6 AND 35"),
    ("Every paid player in the latest season has a fair value", "model.fair_value", "error",
     f"SELECT player_id FROM model.fair_value WHERE season = {LAST_FULL_SEASON} AND salary IS NOT NULL AND fair_value IS NULL"),
    ("ESPN→BBRef crosswalk is one-to-one", "xwalk.player_ids", "error",
     "SELECT player_id FROM xwalk.player_ids GROUP BY ALL HAVING count(*) > 1"),
    ("Games played never exceed team games", "mart.player_availability", "error",
     """SELECT season, player_id FROM mart.player_availability GROUP BY ALL
        HAVING sum(played::INT) > count(*)"""),
    ("Projection intervals ordered (p10 ≤ p50 ≤ p90)", "model.projections", "error",
     "SELECT player_id, horizon FROM model.projections WHERE NOT (war_p10 <= war_p50 AND war_p50 <= war_p90)"),
    ("Cap history covers every season", "stg.cap", "error",
     f"SELECT s FROM range(2012, {CURRENT_SEASON + 1}) t(s) WHERE s NOT IN (SELECT season FROM stg.cap)"),
]


def reconciliation(con) -> tuple[dict, list[dict]]:
    """Compare games played between Basketball-Reference and ESPN for matched player-seasons."""
    df = con.sql(f"""
        SELECT m.season, m.player_id, m.espn_name, ps.player_name, ps.games AS bbref_games,
               e.gamesPlayed AS espn_games, ps.n_teams, m.method
        FROM xwalk.espn_matches m
        JOIN raw.espn_season_stats e ON e.espn_id = m.espn_id AND e.season = m.season
        JOIN stg.player_seasons ps ON ps.player_id = m.player_id AND ps.season = m.season
        WHERE m.season < {CURRENT_SEASON} AND e.gamesPlayed IS NOT NULL AND ps.games IS NOT NULL
    """).df()
    df["diff"] = df.espn_games - df.bbref_games
    agree = float((df["diff"] == 0).mean()) if len(df) else 0.0
    total = con.sql("SELECT count(*) FROM xwalk.espn_matches").fetchall()[0][0]
    matched = con.sql("SELECT count(*) FROM xwalk.espn_matches WHERE player_id IS NOT NULL").fetchall()[0][0]
    raw_rows = con.sql("SELECT count(*) FROM raw.bbref_salaries WHERE player_id IS NOT NULL").fetchall()[0][0]
    clean_rows = con.sql("SELECT count(*) FROM stg.salaries").fetchall()[0][0]
    methods = dict(con.sql("SELECT method, count(*) FROM xwalk.espn_matches GROUP BY 1").fetchall())

    def resolution(r) -> str:
        if r.n_teams > 1:
            return "Traded mid-season: the sources split stints differently. Kept BBRef's combined total."
        if r.season >= 2024 and 0 < r["diff"] <= 2:
            return "ESPN counts NBA Cup final / play-in games, which are not regular season. Kept BBRef."
        if r.season in (2020, 2021):
            return "COVID-era season (bubble seeding games / postponements). Kept BBRef."
        return "Unexplained; BBRef kept as system of record and flagged for review."

    worst = (df[df["diff"] != 0].assign(absdiff=lambda d: d["diff"].abs())
             .sort_values("absdiff", ascending=False).head(12))
    disc = [{"player_name": r.player_name, "season": int(r.season), "bbref_games": int(r.bbref_games),
             "espn_games": int(r.espn_games), "resolution": resolution(r)} for _, r in worst.iterrows()]
    by_reason: dict[str, int] = {}
    for _, r in df[df["diff"] != 0].iterrows():
        k = resolution(r).split(":")[0].split(".")[0]
        by_reason[k] = by_reason.get(k, 0) + 1
    # ESPN game logs vs the official regular-season schedule.
    try:
        gl = con.sql("""
            WITH logs AS (
                SELECT l.season, l.espn_id, l.event_id,
                       CAST((CAST(l.game_date_utc AS TIMESTAMPTZ) AT TIME ZONE 'America/New_York') AS DATE) AS d,
                       l.team_abbr
                FROM raw.espn_gamelogs l
            ), typed AS (
                SELECT l.*, (SELECT any_value(g.game_type) FROM stg.games g
                             WHERE g.game_date = l.d AND g.season = l.season) AS day_type,
                       EXISTS (SELECT 1 FROM stg.player_games p JOIN xwalk.player_ids x ON x.player_id = p.player_id
                               WHERE x.espn_id = l.espn_id AND p.season = l.season AND p.game_date = l.d) AS kept
                FROM logs l
            )
            SELECT season, kept,
                   CASE WHEN team_abbr IN ('STARS', 'STRIPES', 'WORLD') OR team_abbr ILIKE 'TEAM%' THEN 'all-star game'
                        ELSE coalesce(day_type, 'no schedule data') END AS day_type, count(*) AS n
            FROM typed GROUP BY ALL ORDER BY ALL""").df()
        gamelogs = {"rows": int(gl.n.sum()), "kept": int(gl[gl.kept].n.sum()),
                    "dropped_by_type": {f"{r.season}:{r.day_type}": int(r.n) for r in gl[~gl.kept].itertuples()}}
    except Exception as exc:
        gamelogs = {"error": str(exc).splitlines()[0]}
    return ({"match_rate": matched / total if total else 0, "games_agree": agree, "gamelogs": gamelogs,
             "player_seasons_compared": int(len(df)), "disagreements": int((df["diff"] != 0).sum()),
             "disagreements_by_reason": by_reason, "match_methods": methods,
             "salary_rows_raw": int(raw_rows), "salary_rows_clean": int(clean_rows),
             "salary_rows_resolved": int(raw_rows - clean_rows)}, disc)


def main() -> int:
    con = connect(read_only=True)
    results = []
    for name, table, severity, sql in CHECKS:
        try:
            failing = con.sql(sql).fetchall()
            n = len(failing)
            sample = [list(map(str, r)) for r in failing[:5]]
        except Exception as exc:  # table missing etc. counts as a failure
            n, sample = -1, [str(exc).splitlines()[0]]
        results.append({"name": name, "table": table, "severity": severity, "passed": n == 0,
                        "failing": max(n, 0), "sample": sample})
        mark = "PASS" if n == 0 else ("WARN" if severity == "warn" else "FAIL")
        print(f"  [{mark}] {name} ({n if n >= 0 else 'error'})" + ("" if n == 0 else f"  e.g. {sample[:2]}"))
    recon, disc = reconciliation(con)
    con.close()
    passed = sum(r["passed"] for r in results)
    report = {"summary": {"passed": passed, "total": len(results)}, "checks": results,
              "reconciliation": recon, "discrepancies": disc}
    (PROCESSED / "quality.json").write_text(json.dumps(report, indent=1, default=str))
    print(f"  reconciliation: {recon['match_rate']:.2%} matched; games agree on {recon['games_agree']:.1%} of "
          f"{recon['player_seasons_compared']} player-seasons; by reason {recon['disagreements_by_reason']}")
    errors = [r for r in results if not r["passed"] and r["severity"] == "error"]
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
