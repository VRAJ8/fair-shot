"""Export warehouse + model outputs as compact JSON for the web app.

    python -m pipeline.export
Writes web/public/data/{meta,board,players_index,stories,quality,teams}.json
and one web/public/data/players/<id>.json per player.
"""
from __future__ import annotations

import json
import math
import os

os.environ.setdefault("FAIRSHOT_OFFLINE", "1")

import numpy as np
import pandas as pd

from .config import CURRENT_SEASON, LAST_FULL_SEASON, PROCESSED, WEB_DATA, season_label
from .geo import TEAM_COLORS, TEAM_GEO, franchise
from .models.common import connect

TEAM_NAMES = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BRK": "Brooklyn Nets", "CHO": "Charlotte Hornets",
    "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers", "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets",
    "DET": "Detroit Pistons", "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
    "LAC": "LA Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies", "MIA": "Miami Heat",
    "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves", "NOP": "New Orleans Pelicans",
    "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder", "ORL": "Orlando Magic",
    "PHI": "Philadelphia 76ers", "PHO": "Phoenix Suns", "POR": "Portland Trail Blazers",
    "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs", "TOR": "Toronto Raptors", "UTA": "Utah Jazz",
    "WAS": "Washington Wizards",
}


def clean(obj):
    """Make pandas/numpy values JSON-safe and compact."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, np.ndarray)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return round(float(obj), 4)
    if isinstance(obj, (pd.Timestamp,)):
        return obj.strftime("%Y-%m-%d")
    if obj is pd.NA or obj is pd.NaT:
        return None
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


def dump(name: str, data) -> None:
    path = WEB_DATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(clean(data), separators=(",", ":"), ensure_ascii=False))


def table_exists(con, name: str) -> bool:
    schema, table = name.split(".")
    return bool(con.sql(f"SELECT 1 FROM information_schema.tables WHERE table_schema='{schema}' "
                        f"AND table_name='{table}'").fetchall())


def contract_type(row) -> str:
    pct = row.salary_pct_cap
    if pd.isna(pct):
        return "Unknown"
    if pct < 0.0062:
        return "Two-way"
    if row.get("rookie_scale"):
        return "Rookie scale"
    if pct <= 0.0205:
        return "Minimum"
    return row.tier


def main() -> None:
    con = connect(read_only=True)
    fv = con.sql("SELECT * FROM model.fair_value").df()
    market = con.sql("SELECT * FROM model.market").df()
    cap = con.sql("SELECT * FROM stg.cap WHERE season >= 2012").df()
    rosters = con.sql("""SELECT * FROM stg.rosters
                         QUALIFY row_number() OVER (PARTITION BY player_id ORDER BY season DESC) = 1""").df()
    draft = (con.sql("SELECT * FROM stg.draft").df() if table_exists(con, "stg.draft") else pd.DataFrame())
    proj = con.sql("SELECT * FROM model.projections").df()
    comps = con.sql("SELECT * FROM model.comps").df()
    contracts = con.sql("SELECT * FROM raw.bbref_contracts").df()
    avail = con.sql("SELECT * FROM mart.player_availability").df()

    if not draft.empty:
        fv = fv.merge(draft[["player_id", "draft_year", "draft_round", "draft_pick"]], on="player_id", how="left")
        fv["rookie_scale"] = (fv.draft_round == 1) & (fv.season - fv.draft_year <= 4)
    else:
        fv["rookie_scale"] = False
    fv["contract_type"] = fv.apply(contract_type, axis=1)

    # ---------------- board: every paid player-season for the scatter ----------------
    board_cols = ["player_id", "player_name", "team", "pos", "age", "games", "mpg", "war82", "bpm",
                  "salary", "fair_value", "surplus", "salary_pct_cap", "fair_pct_cap", "contract_type",
                  "pts", "trb", "ast"]
    board = {}
    for season in sorted(fv.season.unique()):
        b = fv[(fv.season == season) & fv.salary.notna()].copy()
        b["pts_pg"] = b.pts / b.games.clip(lower=1)
        board[int(season)] = b[board_cols].to_dict("records")
    # The story needs only the latest full season and the one in progress;
    # the league table loads every season.
    dump("board.json", {s: board[s] for s in (LAST_FULL_SEASON, CURRENT_SEASON) if s in board})
    dump("board_all.json", board)

    # ---------------- players: one file each ----------------
    latest_rows = fv.sort_values("season").groupby("player_id").tail(1)
    active = set(fv[fv.season >= LAST_FULL_SEASON].player_id)
    contracts_by = {r.player_id: r for r in contracts.itertuples()}
    index = []
    market_by = market.set_index("season")
    cur_cap = float(cap.set_index("season").salary_cap.get(CURRENT_SEASON, cap.salary_cap.max()))
    for pid in active:
        career = fv[fv.player_id == pid].sort_values("season")
        last = career.iloc[-1]
        last_full = career[career.season <= LAST_FULL_SEASON]
        ref = last_full.iloc[-1] if len(last_full) else last
        bio = rosters[rosters.player_id == pid]
        bio = bio.iloc[0].to_dict() if len(bio) else {}
        team = franchise(str(last.team))
        p = proj[proj.player_id == pid].sort_values("horizon")
        mk = market_by.loc[CURRENT_SEASON] if CURRENT_SEASON in market_by.index else market_by.iloc[-1]
        projection = []
        for r in p.itertuples():
            # Value each projected WAR at the current season's market rate.
            to_value = lambda w: mk.replacement_salary + max(w, 0) * mk.dollars_per_war
            projection.append({"season": int(r.target_season), "label": season_label(int(r.target_season)),
                               "war_p10": r.war_p10, "war_p50": r.war_p50, "war_p90": r.war_p90,
                               "value_p10": to_value(r.war_p10), "value_p50": to_value(r.war_p50),
                               "value_p90": to_value(r.war_p90)})
        c = contracts_by.get(pid)
        contract = []
        if c is not None:
            for i in range(1, 7):
                v = getattr(c, f"y{i}")
                if v is not None and not pd.isna(v):
                    contract.append({"season": CURRENT_SEASON + i - 1, "label": season_label(CURRENT_SEASON + i - 1),
                                     "salary": float(v)})
        cp = comps[comps.player_id == pid].sort_values("rank")
        comp_list = []
        for r in cp.itertuples():
            comp_list.append({"id": r.comp_player_id, "name": r.comp_name, "season": r.comp_season,
                              "label": season_label(r.comp_season), "age": r.comp_age, "war82": r.comp_war82,
                              "bpm": r.comp_bpm, "mpg": r.comp_mpg, "similarity": r.similarity,
                              "next_pct_cap": r.comp_next_pct_cap,
                              "in_todays_dollars": None if pd.isna(r.comp_next_pct_cap) else r.comp_next_pct_cap * cur_cap})
        games = {}
        for season in (LAST_FULL_SEASON, CURRENT_SEASON):
            a = avail[(avail.player_id == pid) & (avail.season == season)].sort_values("game_date")
            if len(a):
                games[season] = {
                    "games": a[["game_date", "team", "opp", "is_home", "is_b2b_second", "played", "minutes", "pts",
                                "reb", "ast", "result", "travel_miles"]].to_dict("records"),
                    "played": int(a.played.sum()), "team_games": int(len(a)),
                    "b2b_played": int((a.played & a.is_b2b_second).sum()),
                    "b2b_total": int(a.is_b2b_second.sum()),
                    "miles": float(a.travel_miles.sum()),
                }
        seasons = career[["season", "team", "age", "games", "mpg", "war82", "bpm", "salary", "fair_value",
                          "surplus", "salary_pct_cap", "fair_pct_cap", "contract_type", "ts_pct", "usg_pct",
                          "pts", "trb", "ast", "awards"]].to_dict("records")
        for s in seasons:
            s["label"] = season_label(int(s["season"])) + (" (so far)" if s["season"] == CURRENT_SEASON else "")
        primary, secondary = TEAM_COLORS.get(team, ("#444444", "#999999"))
        doc = {
            "id": pid, "name": last.player_name, "team": team, "team_name": TEAM_NAMES.get(team, team),
            "colors": [primary, secondary], "pos": last.pos, "age": int(last.age) if pd.notna(last.age) else None,
            "jersey": bio.get("jersey"), "height_in": bio.get("height_in"), "weight_lb": bio.get("weight_lb"),
            "birth_date": bio.get("birth_date"), "college": bio.get("college"), "country": bio.get("country"),
            "experience": bio.get("years_experience"),
            "draft": (draft[draft.player_id == pid][["draft_year", "draft_round", "draft_pick", "draft_team"]]
                      .to_dict("records") or [None])[0] if not draft.empty else None,
            "ref_season": int(ref.season), "seasons": seasons, "projection": projection,
            "contract": contract, "comps": comp_list, "availability": games,
        }
        dump(f"players/{pid}.json", doc)
        index.append({"id": pid, "name": last.player_name, "team": team, "pos": last.pos,
                      "jersey": bio.get("jersey"), "salary": ref.salary, "fair_value": ref.fair_value,
                      "surplus": ref.surplus, "war82": ref.war82, "season": int(ref.season)})
    dump("players_index.json", sorted(index, key=lambda r: -(r["war82"] or -99)))

    # ---------------- meta ----------------
    teams = [{"code": t, "name": TEAM_NAMES[t], "city": TEAM_GEO[t][0], "lat": TEAM_GEO[t][1],
              "lon": TEAM_GEO[t][2], "colors": TEAM_COLORS[t]} for t in TEAM_NAMES]
    dump("teams.json", teams)
    meta = {
        "last_full_season": LAST_FULL_SEASON, "current_season": CURRENT_SEASON,
        "labels": {int(s): season_label(int(s)) for s in cap.season},
        "cap": cap[["season", "salary_cap"]].to_dict("records"),
        "market": market.to_dict("records"),
        "projection_metrics": json.loads((PROCESSED / "projection_metrics.json").read_text()),
        "counts": {"player_seasons": int(len(fv)), "players": len(index),
                   "games": int(con.sql("SELECT count(*) FROM stg.games").fetchall()[0][0])},
    }
    dump("meta.json", meta)
    stories = json.loads((PROCESSED / "stories.json").read_text())
    stories.update(extra_stories(fv, market))
    dump("stories.json", stories)
    if (PROCESSED / "quality.json").exists():
        dump("quality.json", json.loads((PROCESSED / "quality.json").read_text()))
    if (PROCESSED / "survival.json").exists():
        stories["survival"] = json.loads((PROCESSED / "survival.json").read_text())
        dump("stories.json", stories)
    # travel paths for the map
    tg = con.sql(f"""SELECT team, game_date, opp, is_home, city, lat, lon, travel_miles, is_b2b_second
                    FROM stg.team_games WHERE season = {LAST_FULL_SEASON} ORDER BY team, game_date""").df()
    dump("travel.json", {t: g.drop(columns="team").to_dict("records") for t, g in tg.groupby("team")})
    con.close()
    print(f"  exported {len(index)} players, {sum(len(v) for v in board.values())} board rows")


def extra_stories(fv: pd.DataFrame, market: pd.DataFrame) -> dict:
    s = LAST_FULL_SEASON
    cur = fv[(fv.season == s) & fv.salary.notna()]
    if cur.empty:
        return {}
    top = cur.nlargest(12, "fair_value")
    by_type = (cur.groupby("contract_type")
                  .agg(players=("player_id", "size"), salary=("salary", "sum"), value=("fair_value", "sum"),
                       surplus=("surplus", "sum"))
                  .reset_index().sort_values("surplus", ascending=False))
    return {
        "max_ceiling": {
            "season": s,
            "max_salary": float(0.35 * cur.salary_cap.iloc[0]),
            "players_above_max": int((cur.value_above_max > 0).sum()),
            "value_above_max_total": float(cur.value_above_max.sum()),
            "top": top[["player_id", "player_name", "team", "salary", "fair_value", "value_above_max", "war82"]]
                     .to_dict("records"),
        },
        "contract_types": {"season": s, "rows": by_type.to_dict("records")},
        "headline": {
            "season": s,
            "players": int(len(cur)),
            "underpaid": int((cur.surplus > 0).sum()),
            "total_surplus_underpaid": float(cur.surplus.clip(lower=0).sum()),
            "dollars_per_war": float(market.set_index("season").dollars_per_war.get(s, float("nan"))),
            "payroll": float(cur.salary.sum()),
            "value": float(cur.fair_value.sum()),
        },
    }


if __name__ == "__main__":
    main()
