import httpx

from phase1.core.config import get_settings
from phase1.core.retries import retry_on_transient


_settings = get_settings()
_BASE_URL = "https://serpapi.com/search"
_client = httpx.Client(timeout=30.0)

# Trip on the first 429 (free plan out of searches) and short-circuit every
# later query for the rest of the run instead of retrying each with exponential
# backoff — which only adds latency once the quota is gone.
_quota_exhausted = False


class SerpQuotaError(RuntimeError):
    """Raised when SerpAPI has no searches left, so callers skip cleanly."""


@retry_on_transient()
def _request(params: dict) -> dict:
    global _quota_exhausted
    if _quota_exhausted:
        raise SerpQuotaError("SerpAPI quota exhausted earlier this run — skipping search")
    params = {**params, "api_key": _settings.serp_api_key}
    response = _client.get(_BASE_URL, params=params)
    if response.status_code == 429:
        _quota_exhausted = True
        print(
            "  [SerpAPI] ⚠ HTTP 429 — out of searches / rate-limited. "
            "Disabling web search for the rest of this run."
        )
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
