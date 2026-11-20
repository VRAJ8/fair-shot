"""Shared configuration: seasons, team codes, paths."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PROCESSED = DATA / "processed"
WAREHOUSE = DATA / "warehouse.duckdb"
WEB_DATA = ROOT / "web" / "public" / "data"
PROCESSED.mkdir(parents=True, exist_ok=True)

# Basketball-Reference names seasons by the year they end: 2026 = 2025-26.
FIRST_SEASON = 2012          # 2011-12, the first season of the 2011 CBA
LAST_FULL_SEASON = 2026      # 2025-26, the most recent completed season
CURRENT_SEASON = 2027        # 2026-27, in progress (salaries + early stats)
SEASONS = list(range(FIRST_SEASON, CURRENT_SEASON + 1))
DRAFT_YEARS = list(range(1995, 2026))

BBREF = "https://www.basketball-reference.com"
ESPN_WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba"

_BASE_TEAMS = [
    "ATL", "BOS", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND",
    "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NYK", "OKC", "ORL", "PHI",
    "PHO", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
]


def teams_for(season: int) -> list[str]:
    """Basketball-Reference team codes that existed in a season."""
    nets = "NJN" if season <= 2012 else "BRK"
    hornets = "CHA" if season <= 2014 else "CHO"
    pelicans = "NOH" if season <= 2013 else "NOP"
    return sorted(_BASE_TEAMS + [nets, hornets, pelicans])


def season_label(season: int) -> str:
    return f"{season - 1}-{str(season)[-2:]}"
