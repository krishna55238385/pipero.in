"""Phase 3 Gmail sender (Gmail API, OAuth).

Sends outreach through the SAME mailbox the CRM connected via OAuth
(the `engage_mailboxes` row), so every email uses the official Workspace
account and NO personal Gmail / app password is needed.

It reads the stored OAuth token, refreshes it against Google when expired
(writing the new token back), and sends via the Gmail API. A mailbox must be
connected first in the CRM (Engage → Settings → Connect Gmail).

Configure in the root .env (the single project-wide env file):
    GOOGLE_CLIENT_ID=...
    GOOGLE_CLIENT_SECRET=...
(SUPABASE_URL / SUPABASE_KEY are already there.)

Public surface mirrors gmail_smtp so Agent 14 can use it as a drop-in:
    is_configured() -> bool
    from_address() -> str | None
    send_html_email(...) -> dict
"""
import base64
import re
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

import httpx

from phase3.core.config import get_settings


_GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_NOT_CONFIGURED_MSG = (
    "Gmail OAuth not ready — set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in the "
    "root .env and connect a mailbox in the CRM (Engage → Settings → Connect Gmail)."
)

_settings = get_settings()


class GmailApiError(RuntimeError):
    """Raised when a Gmail API send fails for a concrete recipient."""

    def __init__(self, to: str, detail: str) -> None:
        self.to = to
        self.detail = detail
        super().__init__(f"gmail api send to {to} failed: {detail}")


def _sb_headers() -> dict:
    key = _settings.supabase_key or ""
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _get_mailbox() -> dict | None:
    """The most-recently connected Gmail mailbox (with OAuth tokens), or None."""
    try:
        r = httpx.get(
            f"{_settings.supabase_url}/rest/v1/engage_mailboxes",
            params={
                "select": "*",
                "provider": "eq.gmail",
                "order": "connected_at.desc",
                "limit": 1,
            },
            headers=_sb_headers(),
            timeout=20,
        )
        if r.status_code != 200:
            return None
        rows = r.json()
        return rows[0] if rows else None
    except Exception:
        return None


def _has_creds() -> bool:
    return bool(_settings.google_client_id and _settings.google_client_secret)


def is_configured() -> bool:
    """True iff Google OAuth creds are set AND a Gmail mailbox is connected."""
    if not _has_creds():
        return False
    mailbox = _get_mailbox()
    return bool(mailbox and mailbox.get("refresh_token"))


def from_address() -> str | None:
    """The connected sending address (None when no mailbox)."""
    mailbox = _get_mailbox()
    return mailbox.get("email") if mailbox else None


def _token_still_valid(mailbox: dict) -> bool:
    token = mailbox.get("access_token")
    if not token:
        return False
    raw = mailbox.get("expires_at")
    if not raw:
        return False
    try:
        exp = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    return exp.timestamp() > datetime.now(timezone.utc).timestamp() + 60


def _refresh_access_token(mailbox: dict) -> str:
    """Exchange the refresh token for a fresh access token; persist it."""
    resp = httpx.post(
        _GOOGLE_TOKEN_URL,
        data={
            "client_id": _settings.google_client_id,
            "client_secret": _settings.google_client_secret,
            "refresh_token": mailbox.get("refresh_token"),
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise GmailApiError(mailbox.get("email", "?"), f"token refresh failed: {resp.text[:200]}")
    tok = resp.json()
    access_token = tok.get("access_token")
    if not access_token:
        raise GmailApiError(mailbox.get("email", "?"), "token refresh returned no access_token")
    expires_at = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + float(tok.get("expires_in", 3600)),
        tz=timezone.utc,
    ).isoformat()
    try:
        httpx.patch(
            f"{_settings.supabase_url}/rest/v1/engage_mailboxes",
            params={"id": f"eq.{mailbox.get('id')}"},
            headers=_sb_headers(),
            json={
                "access_token": access_token,
                "expires_at": expires_at,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            timeout=20,
        )
    except Exception:
        # Persisting the refreshed token is best-effort; the send can still proceed.
        pass
    return access_token


def _access_token(mailbox: dict) -> str:
    if _token_still_valid(mailbox):
        return str(mailbox["access_token"])
    if not mailbox.get("refresh_token"):
        raise GmailApiError(mailbox.get("email", "?"), "no refresh_token on mailbox")
    return _refresh_access_token(mailbox)


def _html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() or "View this email in an HTML-capable client."


def send_html_email(
    to: str,
    subject: str,
    html_body: str,
    from_name: str | None = None,
    list_unsubscribe_url: str | None = None,
) -> dict:
    """Send one HTML email via the Gmail API.

    Returns {message_id, thread_id, status} — Gmail's message/thread ids so the
    orchestrator can persist them on outreach_log (reply threading needs them).

    Raises RuntimeError when not configured (so the orchestrator can dry-run),
    and GmailApiError when Google rejects the send.
    """
    if not _has_creds():
        raise RuntimeError(_NOT_CONFIGURED_MSG)
    mailbox = _get_mailbox()
    if not mailbox or not mailbox.get("refresh_token"):
        raise RuntimeError(_NOT_CONFIGURED_MSG)

    from_addr = str(mailbox.get("email") or "")
    token = _access_token(mailbox)

    msg = EmailMessage()
    msg["From"] = formataddr((from_name, from_addr)) if from_name else from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid()
    if list_unsubscribe_url:
        msg["List-Unsubscribe"] = f"<{list_unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content(_html_to_text(html_body))
    msg.add_alternative(html_body, subtype="html")

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        resp = httpx.post(
            _GMAIL_SEND_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"raw": raw},
            timeout=30,
        )
    except httpx.HTTPError as exc:
        raise GmailApiError(to, str(exc)) from exc
    if resp.status_code not in (200, 201):
        raise GmailApiError(to, f"{resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return {
        "message_id": data.get("id") or msg["Message-ID"],
        "thread_id": data.get("threadId"),
        "status": "sent",
    }
