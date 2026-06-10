import re
from urllib.parse import urlparse

import httpx

from phase1.core.retries import retry_on_transient


_client = httpx.Client(
    base_url="https://cloudflare-dns.com",
    headers={"Accept": "application/dns-json"},
    timeout=10.0,
)

_TLDS = (".com", ".io", ".co", ".net", ".ai", ".org", ".us")
_CORPORATE_SUFFIXES = ("ltd", "inc", "corp", "limited", "llc", "plc", "co")
_NON_ALNUM = re.compile(r"[^a-z0-9-]")

BLOCKED = {
    "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
    "yelp.com", "indeed.com", "glassdoor.com", "bbb.org", "google.com",
    "maps.google.com", "youtube.com", "wikipedia.org", "crunchbase.com",
    "bloomberg.com", "zoominfo.com", "apollo.io", "rocketreach.co",
    "tiktok.com", "pinterest.com", "reddit.com",
}


@retry_on_transient()
def _query_a(hostname: str) -> dict:
    response = _client.get("/dns-query", params={"name": hostname, "type": "A"})
    response.raise_for_status()
    return response.json()


def resolve(hostname: str) -> bool:
    try:
        data = _query_a(hostname)
    except Exception:
        return False
    answers = data.get("Answer") or []
    return any(answer.get("type") == 1 for answer in answers)


def _normalize_name(company_name: str) -> str:
    lowered = company_name.lower().replace(" ", "")
    return _NON_ALNUM.sub("", lowered)


def _strip_suffix(name: str) -> str:
    for suffix in _CORPORATE_SUFFIXES:
        if name.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)]
    return name


def discover_domain(company_name: str) -> str | None:
    if not company_name or not company_name.strip():
        return None
    primary = _normalize_name(company_name)
    if not primary:
        return None
    secondary = _strip_suffix(primary)
    candidates = [primary]
    if secondary and secondary != primary:
        candidates.append(secondary)

    tried = 0
    for name in candidates:
        for tld in _TLDS:
            if tried >= 14:
                return None
            hostname = f"{name}{tld}"
            tried += 1
            if resolve(hostname):
                return hostname
    return None


def extract_domain_from_url(url: str) -> str | None:
    if not url or not url.strip():
        return None
    raw = url.strip()
    if "://" not in raw:
        raw = f"http://{raw}"
    parsed = urlparse(raw)
    host = (parsed.netloc or parsed.path).lower().strip()
    if host.startswith("www."):
        host = host[4:]
    host = host.split("/")[0].split(":")[0]
    if not host or host in BLOCKED:
        return None
    return host
