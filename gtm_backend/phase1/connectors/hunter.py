from functools import lru_cache

import httpx

from gtm_backend.phase1.core.config import get_settings
from gtm_backend.phase1.core.retries import retry_on_transient


_settings = get_settings()
_BASE_URL = "https://api.hunter.io/v2/domain-search"
_client = httpx.Client(timeout=12.0)


@retry_on_transient(max_attempts=2)
def _fetch(domain: str, api_key: str) -> dict:
    response = _client.get(
        _BASE_URL,
        params={"domain": domain, "api_key": api_key, "limit": 10},
    )
    response.raise_for_status()
    return response.json()


@lru_cache(maxsize=512)
def _domain_search(domain: str) -> dict:
    """Hunter domain-search, called at most once per domain per process.

    Both :func:`find_emails` and :func:`domain_metadata` read from this single
    response so a lead costs one Hunter search, not two. Returns the ``data``
    block (``{}`` when the key is unset or the call fails).
    """
    api_key = _settings.hunter_api_key
    if not api_key or not domain or not domain.strip():
        return {}
    try:
        data = _fetch(domain.strip(), api_key)
    except Exception:
        return {}
    return data.get("data") or {}


def find_emails(domain: str) -> list[dict]:
    data = _domain_search(domain)
    raw_emails = data.get("emails") or []
    results = []
    for entry in raw_emails:
        results.append(
            {
                "email": entry.get("value", ""),
                "first_name": entry.get("first_name") or "",
                "last_name": entry.get("last_name") or "",
                "position": entry.get("position") or "",
                "confidence": entry.get("confidence") or 0,
            }
        )
    return results


def domain_metadata(domain: str) -> dict:
    """Org-level firmographics from Hunter domain-search.

    Returns location, industry, headcount, and the company LinkedIn URL when
    Hunter knows them — ``{}`` otherwise. Null individual fields are dropped so
    callers can treat presence as "known".
    """
    data = _domain_search(domain)
    if not data:
        return {}
    fields = {
        "organization": data.get("organization"),
        "description": data.get("description"),
        "industry": data.get("industry"),
        "country": data.get("country"),
        "state": data.get("state"),
        "city": data.get("city"),
        "postal_code": data.get("postal_code"),
        "street": data.get("street"),
        "headcount": data.get("headcount"),
        "company_type": data.get("company_type"),
        "linkedin": data.get("linkedin"),
    }
    return {k: v for k, v in fields.items() if v}
