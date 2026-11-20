"""Parsers for Basketball-Reference pages (served from the local cache).

BBRef tables carry a `data-stat` attribute on every cell, which makes them
stable to parse. Several tables are shipped inside HTML comments and only
un-commented by JavaScript, so we strip comment markers before parsing.
"""
from __future__ import annotations

import re

import pandas as pd
from bs4 import BeautifulSoup

from .. import http
from ..config import BBREF

_PLAYER_ID = re.compile(r"/players/[a-z]/([a-z0-9]+)\.html")
_TEAM_ID = re.compile(r"/teams/([A-Z]{3})/")


def _soup(url: str) -> BeautifulSoup | None:
    html = http.get(url)
    if html is None:
        return None
    html = html.replace("<!--", "").replace("-->", "")
    return BeautifulSoup(html, "lxml")


def parse_table(url: str, table_id: str, *, keep_links: bool = True) -> pd.DataFrame:
    """Return a table as a DataFrame keyed by `data-stat` names.

    Adds `player_id` / `team_id` columns pulled from the row's links, and skips
    the repeated header rows BBRef inserts every 20 lines.
    """
    soup = _soup(url)
    if soup is None:
        return pd.DataFrame()
    table = soup.find("table", id=table_id)
    if table is None:
        return pd.DataFrame()
    rows = []
    section = None  # e.g. the "Playoffs" divider row on schedule pages
    for tr in (table.tbody or table).find_all("tr"):
        classes = tr.get("class") or []
        if "thead" in classes or "over_header" in classes:
            heads = tr.find_all(["th", "td"])
            if len(heads) == 1 and heads[0].get_text(strip=True):
                section = heads[0].get_text(strip=True)
            continue
        cells = tr.find_all(["th", "td"])
        if not cells:
            continue
        row = {}
        for cell in cells:
            stat = cell.get("data-stat")
            if not stat:
                continue
            row[stat] = cell.get_text(strip=True)
            if keep_links:
                pid = cell.get("data-append-csv")
                if pid and "player_id" not in row:
                    row["player_id"] = pid
                a = cell.find("a")
                if a and a.get("href"):
                    m = _PLAYER_ID.search(a["href"])
                    if m and "player_id" not in row:
                        row["player_id"] = m.group(1)
                    m = _TEAM_ID.search(a["href"])
                    if m:
                        row[f"{stat}_code"] = m.group(1)
                        if stat.startswith("team") and "team_link" not in row:
                            row["team_link"] = m.group(1)
            if stat in ("date_game", "date") and cell.get("csk"):
                row["date_csk"] = cell["csk"]
        if section:
            row["section"] = section
        if any(v for k, v in row.items() if k not in ("ranker", "section")):
            rows.append(row)
    return pd.DataFrame(rows)


def _numeric(df: pd.DataFrame, exclude: set[str]) -> pd.DataFrame:
    for col in df.columns:
        if col in exclude:
            continue
        cleaned = df[col].astype(str).str.replace(",", "").str.replace("$", "").str.replace("%", "")
        conv = pd.to_numeric(cleaned.replace({"": None}), errors="coerce")
        if conv.notna().sum() >= max(1, 0.5 * df[col].astype(bool).sum()):
            df[col] = conv
    return df


TEXT_COLS = {"player_id", "name_display", "player", "team_name_abbr", "team_link", "pos", "awards",
             "team_id", "college_name", "birth_date", "colleges", "date_csk", "date_game",
             "visitor_team_name", "home_team_name", "game_remarks", "arena_name", "box_score_text",
             "overtimes", "game_start_time", "season", "height", "weight", "birth_country",
             "visitor_team_name_code", "home_team_name_code", "name_display_code", "team_name_abbr_code",
             "number", "note", "section", "experience", "college", "player_code", "team_id_code"}


def league_stats(season: int, kind: str) -> pd.DataFrame:
    """kind: 'advanced' or 'totals'. One row per player-team-season (plus multi-team totals)."""
    table_id = {"advanced": "advanced", "totals": "totals_stats"}[kind]
    df = parse_table(f"{BBREF}/leagues/NBA_{season}_{kind}.html", table_id)
    if df.empty:
        return df
    df = df[df.get("player_id").notna()].copy()
    df = df.drop(columns=[c for c in ("ranker",) if c in df.columns])
    df = _numeric(df, TEXT_COLS)
    df.insert(0, "season", season)
    return df


def salary_cap_history() -> pd.DataFrame:
    df = parse_table(f"{BBREF}/contracts/salary-cap-history.html", "salary_cap_history", keep_links=False)
    return df


def current_contracts() -> pd.DataFrame:
    df = parse_table(f"{BBREF}/contracts/players.html", "player-contracts")
    if df.empty:
        return df
    return _numeric(df[df["player_id"].notna()].copy(), TEXT_COLS)


def team_page(team: str, season: int) -> dict[str, pd.DataFrame]:
    url = f"{BBREF}/teams/{team}/{season}.html"
    out = {}
    for key, tid in {"roster": "roster", "salaries": "salaries2", "injuries": "injuries"}.items():
        df = parse_table(url, tid)
        if not df.empty:
            df.insert(0, "team_id", team)
            df.insert(0, "season", season)
        out[key] = df
    return out


def schedule(season: int) -> pd.DataFrame:
    html = http.get(f"{BBREF}/leagues/NBA_{season}_games.html") or ""
    months = list(dict.fromkeys(re.findall(rf'href="(/leagues/NBA_{season}_games-[a-z0-9-]+\.html)"', html)))
    frames = [parse_table(BBREF + m, "schedule") for m in months]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df.insert(0, "season", season)
    return df


def players_index() -> pd.DataFrame:
    frames = [parse_table(f"{BBREF}/players/{c}/", "players") for c in "abcdefghijklmnopqrstuvwyz"]
    return pd.concat([f for f in frames if not f.empty], ignore_index=True)


def draft(year: int) -> pd.DataFrame:
    df = parse_table(f"{BBREF}/draft/NBA_{year}.html", "stats")
    if df.empty:
        return df
    df = df[df.get("player_id").notna()].copy()
    df.insert(0, "draft_year", year)
    return df
