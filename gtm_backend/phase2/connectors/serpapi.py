"""SerpAPI wrapper for phase 2. Same shape as phase1 but specialised helpers
for news + LinkedIn people search used by Agents 06, 07, 08.
"""
import httpx

from gtm_backend.phase2.core.config import get_settings
from gtm_backend.phase2.core.retries import retry_on_transient


_settings = get_settings()
_BASE_URL = "https://serpapi.com/search"
_client = httpx.Client(timeout=30.0)

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
    if _quota_exhausted:
        if _serper_available():
            return _serper_request(params)
        raise SerpQuotaError("SerpAPI quota exhausted earlier this run — skipping search")
    params = {**params, "api_key": _settings.serp_api_key}
    response = _client.get(_BASE_URL, params=params)
    if response.status_code == 429:
        _quota_exhausted = True
        print(
            "  [SerpAPI] ⚠ HTTP 429 — out of searches / rate-limited. "
            + ("Falling back to Serper.dev." if _serper_available()
               else "Disabling web search for the rest of this run; agents will use free "
                    "fallbacks (direct website reads / model knowledge).")
        )
        if _serper_available():
            return _serper_request(params)
        raise SerpQuotaError("SerpAPI returned 429 (out of searches)")
    response.raise_for_status()
    return response.json()


def _days_to_tbs(days: int) -> str:
    if days <= 1:
        return "qdr:d"
    if days <= 7:
        return "qdr:w"
    if days <= 30:
        return "qdr:m"
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
) -> list[dict]:
    """Find LinkedIn profile snippets at a company, biased toward decision-makers."""
    role_keywords = role_keywords or ["CEO", "Founder", "VP", "Director", "Head"]
    roles_clause = " OR ".join(f'"{role}"' for role in role_keywords)
    query = f'site:linkedin.com/in "{company_name}" ({roles_clause})'
    return search(query, num=num)
