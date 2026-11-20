"""Match ESPN athletes to Basketball-Reference player IDs.

The two sources share no key. Names differ in accents ("Jokić" vs "Jokic"),
suffixes ("Jr."), punctuation ("P.J." vs "PJ") and nicknames. We match inside
each season (a small, well-defined candidate pool), score each candidate on
name similarity + team + games played, then resolve one BBRef ID per ESPN ID
by majority vote across seasons. Every match records how it was made.
"""
from __future__ import annotations

import re
import unicodedata

import pandas as pd
from rapidfuzz import fuzz

from .geo import ESPN_TO_BBREF, franchise

SUFFIXES = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")


def normalize(name: str) -> str:
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    s = re.sub(r"[.'\-]", "", s.lower())
    s = SUFFIXES.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def build(bbref: pd.DataFrame, espn: pd.DataFrame) -> pd.DataFrame:
    """bbref: season, player_id, player_name, teams, games.  espn: season, espn_id, name, team_abbr, gamesPlayed."""
    bbref = bbref.assign(norm=bbref.player_name.map(normalize),
                         teams_fr=bbref.teams.map(lambda ts: {franchise(t) for t in ts}))
    espn = espn.assign(norm=espn.name.map(normalize),
                       team_bb=espn.team_abbr.map(ESPN_TO_BBREF))
    rows = []
    for season, e_season in espn.groupby("season"):
        pool = bbref[bbref.season == season]
        by_norm = {k: g for k, g in pool.groupby("norm")}
        for e in e_season.itertuples():
            cands = by_norm.get(e.norm)
            method = "exact_name"
            if cands is None:
                scores = pool.norm.map(lambda n: fuzz.token_sort_ratio(n, e.norm))
                cands = pool[scores >= 85].assign(name_score=scores[scores >= 85])
                method = "fuzzy_name"
                if cands.empty:
                    # last resort: same last name + same team + same games played
                    last = e.norm.split(" ")[-1]
                    cands = pool[pool.norm.str.endswith(" " + last)
                                 & pool.teams_fr.map(lambda ts: e.team_bb in ts)
                                 & (pool.games == e.gamesPlayed)]
                    method = "lastname_team_games"
            if cands is None or len(cands) == 0:
                rows.append({"season": season, "espn_id": e.espn_id, "espn_name": e.name,
                             "player_id": None, "method": "unmatched", "score": 0.0})
                continue
            cands = cands.copy()
            name_score = cands["name_score"] if "name_score" in cands else 100.0
            team_ok = cands.teams_fr.map(lambda ts: e.team_bb in ts).astype(float)
            games_gap = (cands.games - e.gamesPlayed).abs().fillna(82)
            cands["score"] = (name_score * 0.6 + team_ok * 20 + (20 - games_gap.clip(upper=20)))
            best = cands.sort_values("score", ascending=False).iloc[0]
            rows.append({"season": season, "espn_id": e.espn_id, "espn_name": e.name,
                         "player_id": best.player_id, "bbref_name": best.player_name,
                         "method": method, "score": round(float(best.score), 1),
                         "n_candidates": len(cands)})
    by_season = pd.DataFrame(rows)

    matched = by_season.dropna(subset=["player_id"])
    votes = (matched.groupby(["espn_id", "player_id"]).size().rename("seasons").reset_index()
             .sort_values(["espn_id", "seasons"], ascending=[True, False]))
    resolved = votes.drop_duplicates("espn_id").copy()
    conflicts = votes.groupby("espn_id").player_id.nunique()
    resolved["had_conflict"] = resolved.espn_id.map(conflicts > 1)
    # One BBRef ID must not be claimed by two ESPN IDs; keep the stronger claim.
    resolved = resolved.sort_values("seasons", ascending=False).drop_duplicates("player_id")
    return by_season, resolved
