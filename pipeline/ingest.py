"""Download every raw page the pipeline needs into the on-disk cache.

    python -m pipeline.ingest bbref   # ~45 min the first time (rate limited)
    python -m pipeline.ingest espn    # ~5 min

Re-runs are instant: everything is served from data/raw/http.
"""
from __future__ import annotations

import json
import re
import sys
import time

from . import http
from .config import BBREF, DRAFT_YEARS, ESPN_WEB, LAST_FULL_SEASON, SEASONS, teams_for


def bbref_urls_stage1() -> list[str]:
    urls = [f"{BBREF}/contracts/salary-cap-history.html", f"{BBREF}/contracts/players.html"]
    for s in SEASONS:
        urls += [f"{BBREF}/leagues/NBA_{s}_advanced.html", f"{BBREF}/leagues/NBA_{s}_totals.html",
                 f"{BBREF}/leagues/NBA_{s}_games.html"]
    return urls


def schedule_month_urls(season: int) -> list[str]:
    html = http.get(f"{BBREF}/leagues/NBA_{season}_games.html") or ""
    months = re.findall(rf'href="(/leagues/NBA_{season}_games-[a-z0-9-]+\.html)"', html)
    return [BBREF + m for m in dict.fromkeys(months)]


def bbref_urls_stage2() -> list[str]:
    # Newest seasons first: the app's current-season views need these soonest.
    urls = []
    for s in sorted(SEASONS, reverse=True)[:2]:
        urls += schedule_month_urls(s)
        urls += [f"{BBREF}/teams/{t}/{s}.html" for t in teams_for(s)]
    urls += [f"{BBREF}/players/{c}/" for c in "abcdefghijklmnopqrstuvwyz"]
    urls += [f"{BBREF}/draft/NBA_{y}.html" for y in DRAFT_YEARS]
    for s in sorted(SEASONS, reverse=True)[2:]:
        urls += schedule_month_urls(s)
        urls += [f"{BBREF}/teams/{t}/{s}.html" for t in teams_for(s)]
    return urls


def run(urls: list[str], label: str) -> None:
    todo = [u for u in urls if not http.is_cached(u)]
    print(f"[{label}] {len(urls)} pages, {len(todo)} to download", flush=True)
    t0 = time.time()
    for i, url in enumerate(todo, 1):
        body = http.get(url)
        status = "404" if body is None else f"{len(body) // 1024}KB"
        if i % 10 == 0 or i == len(todo):
            print(f"[{label}] {i}/{len(todo)} {time.time() - t0:.0f}s  {url.split('.com')[-1]} {status}", flush=True)


def espn_season_stats_url(season: int) -> str:
    return (f"{ESPN_WEB}/statistics/byathlete?region=us&lang=en&contentorigin=espn"
            f"&isqualified=false&page=1&limit=1000&sort=general.avgMinutes%3Adesc"
            f"&season={season}&seasontype=2")


def espn_gamelog_url(athlete_id: str, season: int) -> str:
    return f"{ESPN_WEB}/athletes/{athlete_id}/gamelog?season={season}"


def espn() -> None:
    run([espn_season_stats_url(s) for s in SEASONS], "espn-stats")
    for season in (LAST_FULL_SEASON, LAST_FULL_SEASON + 1):
        data = json.loads(http.get(espn_season_stats_url(season)) or "{}")
        ids = [a["athlete"]["id"] for a in data.get("athletes", [])]
        run([espn_gamelog_url(i, season) for i in ids], f"espn-gamelogs-{season}")


def bbref() -> None:
    run(bbref_urls_stage1(), "bbref-1")
    run(bbref_urls_stage2(), "bbref-2")


if __name__ == "__main__":
    {"bbref": bbref, "espn": espn}[sys.argv[1]]()
    print("DONE", flush=True)
