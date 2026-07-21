import hashlib
import json
import time
from pathlib import Path

import httpx

from gtm_backend.phase1.core.config import REPO_ROOT, get_settings
from gtm_backend.phase1.core.retries import retry_on_transient


_settings = get_settings()
_BASE_URL = "https://serpapi.com/search"
_client = httpx.Client(timeout=15.0)

# Trip on the first 429 (free plan out of searches) and short-circuit every
# later query for the rest of the run instead of retrying each with exponential
# backoff — which only adds latency once the quota is gone.
_quota_exhausted = False

# Disk-backed cache so a re-run against the same ICP/company within a few days
# (repeat testing, an accidental duplicate "Find Leads" click, a retried pipeline
# stage) reuses results instead of spending fresh SerpAPI credits. Query results
# for a given company/topic don't meaningfully change hour to hour, so a short
# TTL is safe and buys real quota headroom on the 250/month free tier.
_CACHE_DIR = REPO_ROOT / ".cache" / "serpapi"
_CACHE_TTL_SECONDS = 4 * 24 * 60 * 60  # 4 days


class SerpQuotaError(RuntimeError):
    """Raised when SerpAPI has no searches left, so callers skip cleanly."""


_SERPER_SEARCH_URL = "https://google.serper.dev/search"
_SERPER_NEWS_URL = "https://google.serper.dev/news"


def _serper_available() -> bool:
    return bool(_settings.serper_api_key)


def _serper_request(params: dict) -> dict:
    """Call Serper.dev and translate its response into SerpAPI's shape.

    Only invoked when SerpAPI itself returns 429 and SERPER_API_KEY is set.
    Translates SerpAPI-style params (engine, q, num, tbs, location) into
    Serper's request format, and translates the response back into
    {"organic_results": [...]} / {"news_results": [...]} so search()/
    search_news() and every caller need zero changes.
    """
    is_news = params.get("engine") == "google_news"
    url = _SERPER_NEWS_URL if is_news else _SERPER_SEARCH_URL
    body: dict = {"q": params["q"], "num": params.get("num", 10)}
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


def _cache_key(params: dict) -> str:
    # Stable key across dict ordering; excludes the api_key itself.
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


@retry_on_transient(max_attempts=2)
def _request(params: dict) -> dict:
    global _quota_exhausted

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
               else "Disabling web search for the rest of this run.")
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
    if days <= 1:
        return "qdr:d"
    if days <= 7:
        return "qdr:w"
    if days <= 30:
        return "qdr:m"
    return "qdr:y"


def search(
    query: str, num: int = 10, location: str | None = None, start: int = 0
) -> list[dict]:
    params: dict = {"engine": "google", "q": query, "num": num}
    if location:
        params["location"] = location
    if start:
        # Google result offset for pagination (0, num, 2*num, ...).
        params["start"] = start
    data = _request(params)
    return data.get("organic_results", []) or []


def search_news(query: str, days: int = 90, num: int = 10) -> list[dict]:
    params = {
        "engine": "google_news",
        "q": query,
        "num": num,
        "tbs": _days_to_tbs(days),
    }
    data = _request(params)
    return data.get("news_results", []) or []


def search_linkedin(company_name: str, role_keywords: list[str]) -> list[dict]:
    if role_keywords:
        roles_clause = " OR ".join(f'"{role}"' for role in role_keywords)
        query = f'site:linkedin.com/in "{company_name}" ({roles_clause})'
    else:
        query = f'site:linkedin.com/in "{company_name}"'
    return search(query)


def search_company_location(company_name: str, num: int = 5) -> list[dict]:
    """Web results aimed at the company's HQ city/state/country.

    Returns ``[]`` (never raises for quota) so the LLM just gets fewer hints
    when SerpAPI is exhausted — enrichment still proceeds on other sources.
    """
    query = f'"{company_name}" headquarters OR head office location'
    try:
        return search(query, num=num)
    except SerpQuotaError:
        return []


def search_company_size(company_name: str, num: int = 5) -> list[dict]:
    """LinkedIn company-page + web results that tend to state employee count."""
    query = f'"{company_name}" company size OR employees site:linkedin.com/company OR linkedin.com'
    try:
        return search(query, num=num)
    except SerpQuotaError:
        return []
