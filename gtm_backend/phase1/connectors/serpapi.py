import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from gtm_backend.phase1.core.config import REPO_ROOT, get_settings
from gtm_backend.phase1.core.retries import retry_on_transient
from gtm_backend.serpapi_fixtures import fixture_response, test_mode_enabled


_settings = get_settings()
_BASE_URL = "https://serpapi.com/search"
_client = httpx.Client(timeout=15.0)

# Trip on the first 429 (free plan out of searches) and short-circuit every
# later query for the rest of the run instead of retrying each with exponential
# backoff — which only adds latency once the quota is gone.
_quota_exhausted = False
# Task #7 — same short-circuit behavior for Serper.dev, the second rung in
# the chain. Found live: SerpAPI and Serper hit zero credits SIMULTANEOUSLY
# during a demo, stalling lead generation entirely with nothing behind
# either — this flag (plus Tavily below) is what gives the chain a third
# rung instead of just failing once both of these trip.
_serper_exhausted = False


class _QuotaExceeded(Exception):
    """Internal signal within the provider chain: this provider is out of
    quota for the rest of the run — try the next one. Never escapes
    _try_provider_chain(); SerpQuotaError is what callers actually see."""


# --------------------------------------------------------------------------- #
# Quota monitoring (Task #7) — this codebase has no Slack/email/webhook
# alerting mechanism (checked: none exists anywhere in gtm_backend or
# magnivo.ai), so per the task's own fallback instruction, warnings are made
# highly visible in logs and surfaced through each agent's returned summary
# dict (which is what actually shows up in phase_runs / the CRM's pipeline-
# runs view) instead of building a new notification channel from scratch.
# --------------------------------------------------------------------------- #
_LOW_QUOTA_THRESHOLD_PCT = 20.0
# Serper's /account endpoint reports a raw credit balance, not a plan total —
# there's no percentage to compute, so an absolute low-balance threshold is
# used instead for that provider specifically.
_LOW_SERPER_BALANCE_THRESHOLD = 50

_quota_warnings: list[str] = []
# Each proactive quota check hits a real (if free/non-search-consuming)
# network endpoint — checked at most once per process/run, not once per
# search call, so "after each search call" is honored in spirit (the
# warning reflects the current run's quota state) without hammering the
# account endpoint on every single query.
_serpapi_quota_checked = False
_serper_quota_checked = False


def _log_quota_warning(provider: str, message: str) -> None:
    print(f"  ⚠⚠⚠ [QUOTA WARNING] {provider}: {message}")
    _quota_warnings.append(f"{provider}: {message}")


def get_and_clear_quota_warnings() -> list[str]:
    """Pop every quota warning recorded since the last call. Agent 02/04 fold
    this into their own returned summary dict at the end of a run — that
    summary is what phase_runs/the CRM actually display, so this is how a
    warning logged deep in a search call becomes visible there without this
    module needing to know anything about phase_runs itself."""
    global _quota_warnings
    warnings = _quota_warnings
    _quota_warnings = []
    return warnings


def check_serpapi_quota() -> None:
    """Best-effort, at most once per run: SerpAPI's account.json is a free
    metadata endpoint (does NOT consume a search credit, unlike the actual
    /search endpoint), so checking it once per run to warn below 20%
    remaining is cheap. Never raises — a failed check just means no warning
    this run, not a broken pipeline."""
    global _serpapi_quota_checked
    if _serpapi_quota_checked or test_mode_enabled() or not _settings.serp_api_key:
        return
    _serpapi_quota_checked = True
    try:
        response = _client.get(
            "https://serpapi.com/account.json",
            params={"api_key": _settings.serp_api_key},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        total = data.get("searches_per_month") or 0
        left = data.get("total_searches_left")
        if not total or left is None:
            return
        pct = (left / total) * 100
        if pct < _LOW_QUOTA_THRESHOLD_PCT:
            _log_quota_warning("SerpAPI", f"only {left}/{total} searches left ({pct:.1f}%)")
    except Exception:
        return  # best-effort only, same reasoning as every other "never raise" helper here


def check_serper_quota() -> None:
    """Best-effort, at most once per run — see check_serpapi_quota()."""
    global _serper_quota_checked
    if _serper_quota_checked or test_mode_enabled() or not _serper_available():
        return
    _serper_quota_checked = True
    try:
        response = _client.get(
            "https://google.serper.dev/account",
            headers={"X-API-KEY": _settings.serper_api_key},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        balance = data.get("balance")
        if balance is not None and balance < _LOW_SERPER_BALANCE_THRESHOLD:
            _log_quota_warning("Serper.dev", f"only {balance} credits remaining")
    except Exception:
        return

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
    # Serper's free tier rejects num > 10 with a 400 ("Query pattern not
    # allowed for free accounts" — misleading wording, it's actually a num
    # cap). SerpAPI has no such limit, so callers can request more; clamp here
    # rather than trusting every caller to stay under it.
    body: dict = {"q": params["q"], "num": min(params.get("num", 10), 10)}
    if params.get("location"):
        body["location"] = params["location"]
    if params.get("gl"):
        body["gl"] = params["gl"]
    if params.get("tbs"):
        # Serper accepts the same tbs syntax as SerpAPI/Google (qdr:* and
        # cdr:1,cd_min:...,cd_max:...) — pass it through so the fallback path
        # respects the same lookback window as the primary SerpAPI path.
        body["tbs"] = params["tbs"]
    headers = {"X-API-KEY": _settings.serper_api_key, "Content-Type": "application/json"}
    response = _client.post(url, json=body, headers=headers)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Found live 2026-08-22: every Serper.dev call failed with a bare
        # "400 Bad Request" and no other detail — raise_for_status()'s
        # default message doesn't include the response body, which is
        # exactly where Serper puts the actual reason (bad param, plan
        # limit, invalid key, etc.). Surfacing it here turns "it's broken,
        # no idea why" into an actionable error the next time this fires,
        # instead of guessing at a fix with no evidence of the real cause.
        print(f"  [Serper] {response.status_code} on {url}: {response.text[:300]}")
        raise
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
                # Serper's organic results carry a "date" field on the same
                # subset of pages Google itself shows a date for (news-shaped
                # articles, blog posts with visible publish dates) — absent
                # for plain evergreen pages, same as SerpAPI's own organic
                # results. Passed through raw; parsing happens in the caller.
                "date": item.get("date"),
            }
            for item in data.get("organic", [])
        ]
    }


_TAVILY_SEARCH_URL = "https://api.tavily.com/search"


def _tavily_available() -> bool:
    return bool(_settings.tavily_api_key)


def _tavily_request(params: dict) -> dict:
    """Call Tavily and translate its response into SerpAPI's shape.

    Task #7's third rung — tried only when BOTH SerpAPI and Serper.dev are
    exhausted/unavailable/unset, so a single simultaneous quota exhaustion
    across the first two providers (the exact failure mode that stalled a
    live demo) no longer stalls lead generation entirely.

    Chosen for its free tier and REST-simplicity (built for this exact
    AI-agent search use case), and because its response shape maps onto the
    existing organic_results/news_results contract as cleanly as Serper's
    does — search()/search_news() and every caller need zero changes.
    Tavily doesn't distinguish a "news" engine the way SerpAPI/Serper do;
    both route through the same /search endpoint here, with results shaped
    for whichever the caller expects. No API key configured = this function
    is simply never reached (_tavily_available() gates it in the chain
    below), matching the same graceful-degradation Serper already has.
    """
    is_news = params.get("engine") == "google_news"
    body = {
        "api_key": _settings.tavily_api_key,
        "query": params["q"],
        "max_results": min(params.get("num", 10), 20),
        "search_depth": "basic",
    }
    response = _client.post(_TAVILY_SEARCH_URL, json=body, timeout=20)
    if response.status_code == 429:
        raise _QuotaExceeded("Tavily 429")
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Same reasoning as Serper's error-body logging above — surface the
        # actual reason (bad key, plan limit, etc.) instead of a bare status.
        print(f"  [Tavily] {response.status_code} on {_TAVILY_SEARCH_URL}: {response.text[:300]}")
        raise
    data = response.json()
    results = data.get("results") or []
    if is_news:
        return {
            "news_results": [
                {"title": r.get("title"), "link": r.get("url"), "snippet": r.get("content"), "date": None}
                for r in results
            ]
        }
    return {
        "organic_results": [
            {"title": r.get("title"), "link": r.get("url"), "snippet": r.get("content"), "date": None}
            for r in results
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


def _serpapi_request(params: dict) -> dict:
    live_params = {**params, "api_key": _settings.serp_api_key}
    response = _client.get(_BASE_URL, params=live_params)
    if response.status_code == 429:
        raise _QuotaExceeded("SerpAPI 429 — out of searches / rate-limited")
    response.raise_for_status()
    return response.json()


def _try_provider_chain(params: dict) -> dict:
    """SerpAPI -> Serper.dev -> Tavily (Task #7). Each provider is tried at
    most once per call; a provider that trips _QuotaExceeded is short-
    circuited for the REST of the run (matching the pre-existing SerpAPI
    behavior), not retried query by query. A provider with no key configured
    is simply skipped — same graceful-degradation pattern Serper already
    had, now shared by Tavily too.
    """
    global _quota_exhausted, _serper_exhausted

    if not _quota_exhausted:
        try:
            data = _serpapi_request(params)
            check_serpapi_quota()
            return data
        except _QuotaExceeded as exc:
            _quota_exhausted = True
            _log_quota_warning("SerpAPI", str(exc))
            print(
                "  [SerpAPI] ⚠ HTTP 429 — out of searches / rate-limited. "
                + ("Falling back to Serper.dev." if _serper_available()
                   else "Falling back to Tavily." if _tavily_available()
                   else "Disabling web search for the rest of this run.")
            )

    if not _serper_exhausted and _serper_available():
        try:
            data = _serper_request(params)
            check_serper_quota()
            return data
        except Exception as exc:
            _serper_exhausted = True
            _log_quota_warning("Serper.dev", f"request failed, disabling for rest of run: {exc}")

    if _tavily_available():
        try:
            return _tavily_request(params)
        except Exception as exc:
            _log_quota_warning("Tavily", f"request failed: {exc}")
            raise SerpQuotaError(
                f"All available search providers exhausted/failed (last: Tavily: {exc})"
            ) from exc

    raise SerpQuotaError(
        "All available search providers exhausted for the rest of this run "
        "(SerpAPI + Serper.dev + Tavily, whichever were configured)"
    )


@retry_on_transient(max_attempts=2)
def _request(params: dict) -> dict:
    if test_mode_enabled():
        # GTM_TEST_MODE=1: canned fixture data, no network call, no cache
        # read/write — lets the full pipeline run repeatedly for free to
        # verify mechanics without spending real SerpAPI/Serper/Tavily credits.
        # Unset (the default) = zero change from live-API behavior below.
        return fixture_response(params)

    cached = _cache_get(params)
    if cached is not None:
        return cached

    data = _try_provider_chain(params)
    _cache_set(params, data)
    return data


def _days_to_tbs(days: int) -> str:
    """Translate a lookback window into a Google date-range filter.

    Google's relative buckets (qdr:d/w/m/y) only cover day/week/month/year —
    anything over 30 days used to collapse straight to "past year" (qdr:y),
    so a 90-day request could silently return results up to 365 days old.
    For any window that doesn't map cleanly onto a qdr bucket, build an exact
    custom date range (cdr:1,cd_min:M/D/YYYY,cd_max:M/D/YYYY) anchored on
    today, so "90 days" actually means the last 90 days, not the last year.
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


def search(
    query: str, num: int = 10, location: str | None = None, start: int = 0,
    country: str | None = None, days: int | None = None,
) -> list[dict]:
    """``days`` (optional): same lookback-window filter as search_news() below,
    via the identical tbs=cdr:1,cd_min/cd_max mechanism. Default None = no date
    filtering, i.e. today's exact prior behavior — Agent 02's company-discovery
    use of this function has no business asking for date-recent results (a
    company's own homepage/about page has no "publish date" at all), so it
    must never be forced on every caller. Callers that DO care about freshness
    (Agent 04's buying-signal candidates) pass lookback_days explicitly.
    """
    params: dict = {"engine": "google", "q": query, "num": num}
    if location:
        params["location"] = location
    if country:
        # Hard country restriction (SerpAPI's `gl` param). `location` alone is
        # only a soft ranking hint — Google organic search still surfaces
        # globally-ranking content for broad terms even with a location set.
        # This is what let US/global results leak into geography-scoped ICPs
        # (e.g. "software companies in India" still returning mostly US pages).
        params["gl"] = country
    if start:
        # Google result offset for pagination (0, num, 2*num, ...).
        params["start"] = start
    if days is not None:
        params["tbs"] = _days_to_tbs(days)
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


def search_company_location(company_name: str, domain: str | None = None, num: int = 5) -> list[dict]:
    """Web results aimed at the company's HQ city/state/country.

    ``domain`` (optional): included in the query as a disambiguator when the
    company name alone is ambiguous — found live 2026-09-03 (ICP #62,
    Jobraux) that a bare-name search for "Bloomberry" surfaced an unrelated,
    much more prominent Philippine casino operator sharing that name instead
    of the actual bloomberry.com (a New York SaaS company), and lead
    enrichment silently wrote that wrong company's location onto the lead
    already correctly resolved to the SaaS company's domain. Including the
    domain string in the query nudges results toward pages actually about
    THAT company, without narrowing to a site: restriction (most
    location-mentioning pages are third-party, not the domain's own site).

    Returns ``[]`` (never raises for quota) so the LLM just gets fewer hints
    when SerpAPI is exhausted — enrichment still proceeds on other sources.
    """
    disambiguator = f' "{domain}"' if domain else ""
    query = f'"{company_name}"{disambiguator} headquarters OR head office location'
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
