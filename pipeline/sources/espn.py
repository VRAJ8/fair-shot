"""Parsers for ESPN's public JSON API (the second, independent source)."""
from __future__ import annotations

import json

import pandas as pd

from .. import http
from ..ingest import espn_gamelog_url, espn_season_stats_url


def season_stats(season: int) -> pd.DataFrame:
    data = json.loads(http.get(espn_season_stats_url(season)) or "{}")
    if not data.get("athletes"):
        return pd.DataFrame()
    names = {c["name"]: c["names"] for c in data["categories"]}
    rows = []
    for entry in data["athletes"]:
        a = entry["athlete"]
        team = (a.get("teams") or [{}])[0]
        row = {
            "season": season,
            "espn_id": a["id"],
            "name": a.get("displayName"),
            "first_name": a.get("firstName"),
            "last_name": a.get("lastName"),
            "age": a.get("age"),
            "debut_year": a.get("debutYear"),
            "position": (a.get("position") or {}).get("abbreviation"),
            "team_abbr": a.get("teamShortName") or team.get("abbreviation"),
            "team_color": team.get("color"),
            "team_alt_color": team.get("alternateColor"),
        }
        for cat in entry["categories"]:
            for stat, value in zip(names.get(cat["name"], []), cat.get("totals", [])):
                row[stat] = pd.to_numeric(str(value).replace(",", ""), errors="coerce")
        rows.append(row)
    return pd.DataFrame(rows)


def gamelog(espn_id: str, season: int) -> pd.DataFrame:
    """Regular-season games a player appeared in, with box-score line."""
    body = http.get(espn_gamelog_url(espn_id, season))
    if not body:
        return pd.DataFrame()
    data = json.loads(body)
    labels = data.get("names") or []
    events = data.get("events", {})
    rows = []
    for st in data.get("seasonTypes", []):
        if "Regular Season" not in st.get("displayName", ""):
            continue
        for cat in st.get("categories", []):
            for ev in cat.get("events", []):
                meta = events.get(ev["eventId"], {})
                row = {
                    "season": season,
                    "espn_id": espn_id,
                    "event_id": ev["eventId"],
                    "game_date_utc": meta.get("gameDate"),
                    "home": meta.get("atVs") == "vs",
                    "team_abbr": (meta.get("team") or {}).get("abbreviation"),
                    "opp_abbr": (meta.get("opponent") or {}).get("abbreviation"),
                    "result": meta.get("gameResult"),
                }
                for name, value in zip(labels, ev.get("stats", [])):
                    row[name] = value
                rows.append(row)
    return pd.DataFrame(rows)
