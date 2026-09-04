"""SerpAPI wrapper for phase 2. Same shape as phase1 but specialised helpers
for news + LinkedIn people search used by Agents 06, 07, 08.
"""
import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from gtm_backend.phase2.core.config import REPO_ROOT, get_settings
from gtm_backend.phase2.core.retries import retry_on_transient
from gtm_backend.serpapi_fixtures import fixture_response, test_mode_enabled


_settings = get_settings()
_BASE_URL = "https://serpapi.com/search"
_client = httpx.Client(timeout=30.0)

# Disk-backed cache, ported from phase1/connectors/serpapi.py: phase2's
# Agents 06/07/08 were re-spending a live SerpAPI credit for the same
# company/ICP on every re-run within days, with no caching at all (phase1
# already had this). Same 4-day TTL and cache-key scheme as phase1 so repeat
# runs against the same company/ICP reuse results instead of paying again.
_CACHE_DIR = REPO_ROOT / ".cache" / "serpapi_phase2"
_CACHE_TTL_SECONDS = 4 * 24 * 60 * 60  # 4 days


def _cache_key(params: dict) -> str:
    normalized = json.dumps(params, sort_keys=True)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _cache_path(key: str) -> Path:
    return _CACHE_DIR / f"{key}.json"


def _cache_get(params: dict) -> dict | None:
    path = _cache_path(_cache_key(params))
    if not path.exists():
        return None
    try:
        if time.time() - path.stat().st_mtime > _CACHE_TTL_SECONDS:
            return None
        return json.loads(path.read_text())
    except Exception:
        return None  # corrupt/unreadable cache entry — fall through to a live call


def _cache_set(params: dict, data: dict) -> None:
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(_cache_key(params)).write_text(json.dumps(data))
    except Exception:
        pass  # caching is best-effort — never let a disk issue break a search

# Once SerpAPI returns 429 (free plan out of searches / rate-limited), there is
# no point retrying every subsequent query with exponential backoff for the rest
# of the run — that just adds minutes of latency to no effect. We trip this flag
# on the first 429 and short-circuit the rest, letting callers fall back to their
# free strategies (e.g. Agent 06's direct website read).
_quota_exhausted = False


class SerpQuotaError(RuntimeError):
    """Raised when SerpAPI has no searches left, so callers skip cleanly."""


_SERPER_SEARCH_URL = "https://google.serper.dev/search"
_SERPER_NEWS_URL = "https://google.serper.dev/news"


def _serper_available() -> bool:
    return bool(_settings.serper_api_key)


def _serper_request(params: dict) -> dict:
    """Call Serper.dev and translate its response into SerpAPI's shape.

    Mirrors phase1/connectors/serpapi.py's fallback — only used when SerpAPI
    returns 429 and SERPER_API_KEY is set. Callers (search/search_news/
    search_linkedin_people) need zero changes since the returned shape
    matches SerpAPI's organic_results/news_results keys.
    """
    is_news = params.get("engine") == "google_news"
    url = _SERPER_NEWS_URL if is_news else _SERPER_SEARCH_URL
    # Serper's free tier rejects num > 10 with a 400 ("Query pattern not
    # allowed for free accounts" — misleading wording, it's actually a num
    # cap). SerpAPI has no such limit, so callers can request more; clamp here
    # rather than trusting every caller to stay under it.
    body: dict = {"q": params["q"], "num": min(params.get("num", 10), 10)}
    if params.get("location"):
        body["location"] = params["location"]
    headers = {"X-API-KEY": _settings.serper_api_key, "Content-Type": "application/json"}
    response = _client.post(url, json=body, headers=headers)
    response.raise_for_status()
    data = response.json()

    if is_news:
        return {
            "news_results": [
                {
                    "title": item.get("title"),
                    "link": item.get("link"),
                    "snippet": item.get("snippet"),
                    "date": item.get("date"),
                }
                for item in data.get("news", [])
            ]
        }
    return {
        "organic_results": [
            {
                "title": item.get("title"),
                "link": item.get("link"),
                "snippet": item.get("snippet"),
            }
            for item in data.get("organic", [])
        ]
    }


@retry_on_transient()
def _request(params: dict) -> dict:
    global _quota_exhausted

    if test_mode_enabled():
        # GTM_TEST_MODE=1: canned fixture data, no network call, no cache
        # read/write — same opt-in test mode as phase1/connectors/serpapi.py.
        # Unset (the default) = zero change from live-API behavior below.
        return fixture_response(params)

    cached = _cache_get(params)
    if cached is not None:
        return cached

    if _quota_exhausted:
        if _serper_available():
            data = _serper_request(params)
            _cache_set(params, data)
            return data
        raise SerpQuotaError("SerpAPI quota exhausted earlier this run — skipping search")

    live_params = {**params, "api_key": _settings.serp_api_key}
    response = _client.get(_BASE_URL, params=live_params)
    if response.status_code == 429:
        _quota_exhausted = True
        print(
            "  [SerpAPI] ⚠ HTTP 429 — out of searches / rate-limited. "
            + ("Falling back to Serper.dev." if _serper_available()
               else "Disabling web search for the rest of this run; agents will use free "
                    "fallbacks (direct website reads / model knowledge).")
        )
        if _serper_available():
            data = _serper_request(params)
            _cache_set(params, data)
            return data
        raise SerpQuotaError("SerpAPI returned 429 (out of searches)")
    response.raise_for_status()
    data = response.json()
    _cache_set(params, data)
    return data


def _days_to_tbs(days: int) -> str:
    """Translate a lookback window into a Google date-range filter.

    Same fix as phase1/connectors/serpapi.py: Google's relative buckets
    (qdr:d/w/m/y) only cover day/week/month/year, so anything over 30 days
    used to collapse straight to "past year" — a 90-day Agent 06 news lookback
    could silently return results up to 365 days old. Build an exact custom
    date range for any window under a year instead.
    """
    if days <= 1:
        return "qdr:d"
    if days <= 7:
        return "qdr:w"
    if days <= 30:
        return "qdr:m"
    if days <= 365:
        today = datetime.now(timezone.utc).date()
        start = today - timedelta(days=days)
        fmt = lambda d: f"{d.month}/{d.day}/{d.year}"
        return f"cdr:1,cd_min:{fmt(start)},cd_max:{fmt(today)}"
    return "qdr:y"


def search(query: str, num: int = 10, location: str | None = None) -> list[dict]:
    """Plain Google web search via SerpAPI."""
    params: dict = {"engine": "google", "q": query, "num": num}
    if location:
        params["location"] = location
    data = _request(params)
    return data.get("organic_results", []) or []


def search_news(query: str, days: int = 90, num: int = 10) -> list[dict]:
    """Google News via SerpAPI with date-recency filter."""
    params = {
        "engine": "google_news",
        "q": query,
        "num": num,
        "tbs": _days_to_tbs(days),
    }
    data = _request(params)
    return data.get("news_results", []) or []


def search_linkedin_people(
    company_name: str,
    role_keywords: list[str] | None = None,
    num: int = 10,
    domain: str | None = None,
) -> list[dict]:
    """Find LinkedIn profile snippets at a company, biased toward decision-makers.

    ``domain`` (optional): same disambiguator already used elsewhere in this
    file (Agent 08's competitor search) — a bare company name can collide
    with an unrelated same-named company (confirmed live 2026-09-04, ICP #62:
    "Bloomberry" surfaced real people at three different unrelated companies
    also called Bloomberry). The domain rarely appears in a LinkedIn
    snippet's own text, so this alone doesn't fully solve the collision —
    the real gate is the identity-verification step in the caller
    (agent_07_stakeholders.py).
    """
    role_keywords = role_keywords or ["CEO", "Founder", "VP", "Director", "Head"]
    roles_clause = " OR ".join(f'"{role}"' for role in role_keywords)
    disambiguator = f' "{domain}"' if domain else ""
    query = f'site:linkedin.com/in "{company_name}"{disambiguator} ({roles_clause})'
    return search(query, num=num)
