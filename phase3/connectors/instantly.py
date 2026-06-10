"""Phase 3 Instantly AI REST client (API v2).

Thin httpx wrapper around the Instantly AI v2 API at
https://api.instantly.ai/api/v2/. Uses a Bearer token sourced from
`settings.instantly_api_key` (set INSTANTLY_API_KEY in the root .env).

Public surface (each call wrapped in @retry_on_transient()):
    is_configured() -> bool                    — True iff API key is set
    create_campaign(...) -> str                — returns campaign_id
    add_leads_to_campaign(...) -> list[str]    — returns Instantly lead ids
    activate_campaign(campaign_id) -> None
    pause_campaign(campaign_id) -> None
    get_campaign_analytics(campaign_id) -> dict
    get_campaign_status(campaign_id) -> dict

Every sending function raises RuntimeError when the API key is not set so
the orchestrator can short-circuit cleanly in dry-run mode. Non-2xx
responses raise InstantlyError with the status code and body.
"""
import httpx

from phase3.core.config import get_settings
from phase3.core.retries import retry_on_transient


_BASE_URL = "https://api.instantly.ai/api/v2"
_NOT_CONFIGURED_MSG = "INSTANTLY_API_KEY not set in the root .env"

_settings = get_settings()
_client = httpx.Client(
    base_url=_BASE_URL,
    headers={
        "Authorization": f"Bearer {_settings.instantly_api_key or ''}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    },
    timeout=30.0,
)


class InstantlyError(httpx.HTTPError):
    """Raised when the Instantly API returns a non-2xx response."""

    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        self.method = method
        self.path = path
        self.status = status
        self.body = body
        super().__init__(f"Instantly {method} {path} -> {status}: {body}")


def is_configured() -> bool:
    """Return True iff INSTANTLY_API_KEY is present in settings."""
    return bool(_settings.instantly_api_key)


def _require_configured() -> None:
    if not is_configured():
        raise RuntimeError(_NOT_CONFIGURED_MSG)


def _raise_for_status(method: str, path: str, response: httpx.Response) -> None:
    if response.is_success:
        return
    raise InstantlyError(method, path, response.status_code, response.text)


@retry_on_transient()
def _post(path: str, json_body: dict | list | None = None) -> dict:
    response = _client.post(path, json=json_body if json_body is not None else {})
    _raise_for_status("POST", path, response)
    return response.json() if response.content else {}


@retry_on_transient()
def _get(path: str, params: dict | None = None) -> dict:
    response = _client.get(path, params=params)
    _raise_for_status("GET", path, response)
    return response.json() if response.content else {}


def create_campaign(
    name: str,
    sequence_steps: list[dict],
    daily_limit: int = 30,
    timezone: str = "Etc/GMT+12",
) -> str:
    """Create one Instantly campaign and return its campaign_id.

    sequence_steps must be a list of {"type": "email", "delay": <days>,
    "variants": [{"subject": "...", "body": "..."}, ...]} dicts.
    """
    _require_configured()
    body = {
        "name": name,
        "campaign_schedule": {
            "schedules": [
                {
                    "name": "Default",
                    "timing": {"from": "09:00", "to": "17:00"},
                    "days": {"0": True, "1": True, "2": True, "3": True, "4": True},
                    "timezone": timezone,
                }
            ]
        },
        "sequences": [{"steps": sequence_steps}],
        "daily_limit": daily_limit,
    }
    response = _post("/campaigns", body)
    campaign_id = response.get("id") or response.get("campaign_id")
    if not campaign_id:
        raise InstantlyError("POST", "/campaigns", 200, f"missing id in response: {response}")
    return str(campaign_id)


def add_leads_to_campaign(campaign_id: str, leads: list[dict]) -> list[str]:
    """Add each lead dict to the campaign and return their Instantly lead ids.

    Each lead dict should at minimum contain `email`; `first_name`,
    `last_name`, `company_name`, and custom variables are optional.
    """
    _require_configured()
    instantly_ids: list[str] = []
    for lead in leads:
        body = dict(lead)
        body["campaign"] = campaign_id
        response = _post("/leads", body)
        lead_id = response.get("id") or response.get("lead_id")
        if lead_id:
            instantly_ids.append(str(lead_id))
    return instantly_ids


def activate_campaign(campaign_id: str) -> None:
    """Activate (start sending) the given Instantly campaign."""
    _require_configured()
    _post(f"/campaigns/{campaign_id}/activate")


def pause_campaign(campaign_id: str) -> None:
    """Pause the given Instantly campaign."""
    _require_configured()
    _post(f"/campaigns/{campaign_id}/pause")


def get_campaign_analytics(campaign_id: str) -> dict:
    """Fetch per-variant analytics (opens, clicks, replies) for a campaign."""
    _require_configured()
    return _get("/campaigns/analytics", params={"id": campaign_id})


def get_campaign_status(campaign_id: str) -> dict:
    """Fetch the raw campaign resource (status, schedule, sequence)."""
    _require_configured()
    return _get(f"/campaigns/{campaign_id}")
