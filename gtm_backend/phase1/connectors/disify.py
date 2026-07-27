import httpx

from gtm_backend.phase1.core.retries import retry_on_transient


_BASE_URL = "https://disify.com/api/email"
_client = httpx.Client(timeout=8.0)


_FALLBACK: dict = {
    "verified": False,
    "bounce_status": "unknown",
    "format": None,
    "dns": None,
    "disposable": None,
}


@retry_on_transient(max_attempts=2)
def _fetch(email: str) -> dict:
    response = _client.get(f"{_BASE_URL}/{email}")
    response.raise_for_status()
    return response.json()


def _interpret(data: dict) -> dict:
    fmt = data.get("format")
    dns = data.get("dns")
    disposable = data.get("disposable")

    if fmt is True and dns is True and disposable is False:
        verified, bounce_status = True, "valid"
    elif fmt is False:
        verified, bounce_status = False, "bad_format"
    elif dns is False:
        verified, bounce_status = False, "no_mx"
    elif disposable is True:
        verified, bounce_status = False, "disposable"
    else:
        verified, bounce_status = False, "unknown"

    return {
        "verified": verified,
        "bounce_status": bounce_status,
        "format": fmt,
        "dns": dns,
        "disposable": disposable,
    }


def verify_email(email: str) -> dict:
    try:
        data = _fetch(email)
    except Exception:
        return dict(_FALLBACK)
    return _interpret(data)
