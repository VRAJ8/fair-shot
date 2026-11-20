"""Team geography, time zones and cross-source team-code crosswalk."""
from __future__ import annotations

import math

# Franchise -> (city, lat, lon, UTC offset in standard time). City-level
# precision is plenty for travel miles (arena moves inside a metro area are
# a few miles at most).
TEAM_GEO = {
    "ATL": ("Atlanta", 33.757, -84.396, -5), "BOS": ("Boston", 42.366, -71.062, -5),
    "BRK": ("Brooklyn", 40.683, -73.976, -5), "NJN": ("Newark", 40.734, -74.171, -5),
    "CHO": ("Charlotte", 35.225, -80.839, -5), "CHA": ("Charlotte", 35.225, -80.839, -5),
    "CHI": ("Chicago", 41.881, -87.674, -6), "CLE": ("Cleveland", 41.496, -81.688, -5),
    "DAL": ("Dallas", 32.790, -96.810, -6), "DEN": ("Denver", 39.749, -105.008, -7),
    "DET": ("Detroit", 42.341, -83.055, -5), "GSW": ("San Francisco", 37.768, -122.388, -8),
    "HOU": ("Houston", 29.751, -95.362, -6), "IND": ("Indianapolis", 39.764, -86.156, -5),
    "LAC": ("Los Angeles", 33.945, -118.343, -8), "LAL": ("Los Angeles", 34.043, -118.267, -8),
    "MEM": ("Memphis", 35.138, -90.051, -6), "MIA": ("Miami", 25.781, -80.188, -5),
    "MIL": ("Milwaukee", 43.045, -87.917, -6), "MIN": ("Minneapolis", 44.979, -93.276, -6),
    "NOP": ("New Orleans", 29.949, -90.082, -6), "NOH": ("New Orleans", 29.949, -90.082, -6),
    "NYK": ("New York", 40.751, -73.993, -5), "OKC": ("Oklahoma City", 35.463, -97.515, -6),
    "ORL": ("Orlando", 28.539, -81.384, -5), "PHI": ("Philadelphia", 39.901, -75.172, -5),
    "PHO": ("Phoenix", 33.446, -112.071, -7), "POR": ("Portland", 45.532, -122.667, -8),
    "SAC": ("Sacramento", 38.580, -121.500, -8), "SAS": ("San Antonio", 29.427, -98.438, -6),
    "TOR": ("Toronto", 43.643, -79.379, -5), "UTA": ("Salt Lake City", 40.768, -111.901, -7),
    "WAS": ("Washington", 38.898, -77.021, -5),
}

# Neutral sites, matched on a substring of BBRef's arena name.
NEUTRAL_SITES = {
    "T-Mobile Arena": ("Las Vegas", 36.103, -115.178, -8),        # NBA Cup semifinals
    "HP Field House": ("Orlando bubble", 28.337, -81.556, -5),    # 2020 restart
    "Visa Athletic Center": ("Orlando bubble", 28.337, -81.556, -5),
    "The Arena": ("Orlando bubble", 28.337, -81.556, -5),
    "Arena Ciudad de Mexico": ("Mexico City", 19.405, -99.096, -6),
    "Arena CDMX": ("Mexico City", 19.405, -99.096, -6),
    "Mexico City Arena": ("Mexico City", 19.405, -99.096, -6),
    "The O2 Arena": ("London", 51.503, 0.003, 0), "O2 Arena": ("London", 51.503, 0.003, 0),
    "AccorHotels Arena": ("Paris", 48.839, 2.379, 1), "Accor Arena": ("Paris", 48.839, 2.379, 1),
    "Uber Arena": ("Berlin", 52.505, 13.443, 1),
}

# ESPN abbreviation -> Basketball-Reference franchise code (current season).
ESPN_TO_BBREF = {
    "ATL": "ATL", "BOS": "BOS", "BKN": "BRK", "CHA": "CHO", "CHI": "CHI", "CLE": "CLE",
    "DAL": "DAL", "DEN": "DEN", "DET": "DET", "GS": "GSW", "HOU": "HOU", "IND": "IND",
    "LAC": "LAC", "LAL": "LAL", "MEM": "MEM", "MIA": "MIA", "MIL": "MIL", "MIN": "MIN",
    "NO": "NOP", "NY": "NYK", "OKC": "OKC", "ORL": "ORL", "PHI": "PHI", "PHX": "PHO",
    "POR": "POR", "SAC": "SAC", "SA": "SAS", "TOR": "TOR", "UTAH": "UTA", "WSH": "WAS",
}

# Team colors (primary, secondary) for the UI's jersey avatars.
TEAM_COLORS = {
    "ATL": ("#C8102E", "#FDB927"), "BOS": ("#007A33", "#BA9653"), "BRK": ("#111111", "#FFFFFF"),
    "CHO": ("#1D1160", "#00788C"), "CHI": ("#CE1141", "#111111"), "CLE": ("#860038", "#FDBB30"),
    "DAL": ("#00538C", "#B8C4CA"), "DEN": ("#0E2240", "#FEC524"), "DET": ("#C8102E", "#1D42BA"),
    "GSW": ("#1D428A", "#FFC72C"), "HOU": ("#CE1141", "#C4CED4"), "IND": ("#002D62", "#FDBB30"),
    "LAC": ("#C8102E", "#1D428A"), "LAL": ("#552583", "#FDB927"), "MEM": ("#5D76A9", "#12173F"),
    "MIA": ("#98002E", "#F9A01B"), "MIL": ("#00471B", "#EEE1C6"), "MIN": ("#0C2340", "#78BE20"),
    "NOP": ("#0C2340", "#C8102E"), "NYK": ("#006BB6", "#F58426"), "OKC": ("#007AC1", "#EF3B24"),
    "ORL": ("#0077C0", "#C4CED4"), "PHI": ("#006BB6", "#ED174C"), "PHO": ("#1D1160", "#E56020"),
    "POR": ("#E03A3E", "#111111"), "SAC": ("#5A2D81", "#63727A"), "SAS": ("#C4CED4", "#111111"),
    "TOR": ("#CE1141", "#111111"), "UTA": ("#002B5C", "#F9A01B"), "WAS": ("#002B5C", "#E31837"),
}
FRANCHISE = {"NJN": "BRK", "CHA": "CHO", "NOH": "NOP"}  # historical code -> current franchise


def franchise(code: str) -> str:
    return FRANCHISE.get(code, code)


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def game_site(home_code: str, arena: str | None):
    for key, site in NEUTRAL_SITES.items():
        if arena and key.lower() in arena.lower():
            return site
    return TEAM_GEO[home_code]
