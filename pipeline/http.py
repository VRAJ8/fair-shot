"""Polite, cached HTTP client.

Every response is cached on disk, so re-running the pipeline never re-hits a
source. Basketball-Reference allows ~20 requests/minute, so requests to it are
spaced 3.5s apart. Pages that fail are retried with backoff.
"""
from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "http"
CACHE.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
MIN_INTERVAL = {"www.basketball-reference.com": 4.0}
# Set FAIRSHOT_OFFLINE=1 to read only from cache (used by every step after ingest,
# so parsing can never add traffic on top of a running download).
OFFLINE = os.environ.get("FAIRSHOT_OFFLINE") == "1"
DEFAULT_INTERVAL = 0.25
_last_hit: dict[str, float] = {}
_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})


def cache_path(url: str) -> Path:
    host = urlparse(url).netloc.replace(":", "_")
    digest = hashlib.sha1(url.encode()).hexdigest()[:20]
    return CACHE / host / f"{digest}.txt"


def is_cached(url: str) -> bool:
    return cache_path(url).exists()


def _repair(text: str) -> str:
    """Undo mojibake from pages cached when UTF-8 was mis-decoded as Latin-1."""
    if "\u00c3" in text or "\u00c4" in text or "\u00c5" in text:
        try:
            return text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return text
    return text


def get(url: str, *, retries: int = 4, refresh: bool = False) -> str | None:
    """Return the body of `url`, from cache when available. None on 404."""
    path = cache_path(url)
    if path.exists() and not refresh:
        return _repair(path.read_text(encoding="utf-8"))
    if OFFLINE:
        return None
    host = urlparse(url).netloc
    interval = MIN_INTERVAL.get(host, DEFAULT_INTERVAL)
    attempt = 0
    while attempt < retries:
        wait = interval - (time.time() - _last_hit.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last_hit[host] = time.time()
        try:
            resp = _session.get(url, timeout=40)
        except requests.RequestException as exc:  # network blip
            print(f"  ! {exc.__class__.__name__} on {url} (attempt {attempt + 1})")
            attempt += 1
            time.sleep(5 * attempt)
            continue
        if resp.status_code == 404:
            return None
        if resp.status_code == 429:
            # Sports Reference "jails" clients for up to an hour; wait it out.
            # Probing while jailed may extend the ban, so back off hard.
            print(f"  ! rate limited by {host}; waiting 15 min", flush=True)
            time.sleep(900)
            continue
        if resp.status_code != 200:
            print(f"  ! HTTP {resp.status_code} on {url}")
            attempt += 1
            time.sleep(5 * attempt)
            continue
        resp.encoding = "utf-8"  # every source we use serves UTF-8
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(resp.text, encoding="utf-8")
        return resp.text
    raise RuntimeError(f"failed to fetch {url}")
