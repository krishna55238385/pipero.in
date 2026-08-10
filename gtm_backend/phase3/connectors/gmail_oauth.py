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
import os
import re
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

import httpx

from gtm_backend.phase3.connectors import supabase as _sb
from gtm_backend.phase3.core.config import get_settings


_GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
_GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
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


def _get_mailbox() -> dict | None:
    """The most-recently connected Gmail mailbox for the CURRENT org (with
    OAuth tokens), or None.

    Goes through phase3/connectors/supabase.py's direct-RDS _get() helper
    (same one every other phase3 table read uses) instead of a raw httpx call
    against Supabase's hosted REST API. This file used to hit
    {SUPABASE_URL}/rest/v1/engage_mailboxes directly, which broke silently
    once SUPABASE_URL was repointed at the local PostgREST instance during
    the Supabase->RDS migration (that instance serves tables at the root
    path, not under /rest/v1/) — is_configured() always returned False as a
    result, so Agent 14 never actually sent a real email, only dry-ran.

    organization_id filter (found live 2026-08-08 auditing multi-org demo
    readiness): this used to grab whichever mailbox was most recently
    connected ACROSS EVERY ORG, with no tenant filter at all. Once a second
    org connects its own Gmail, that would silently steal sending/polling
    for every other org too — outreach_log rows still get tagged with the
    correct organization_id (via supabase._inject_org), so the CRM looks
    right, but the actual email a prospect receives would come from the
    wrong company's address entirely. Reads GTM_ORG_ID live from the
    environment (not the module-level _settings singleton captured at
    import time) so this works correctly both for a fresh subprocess per
    org (CLI/cron) and for gtm_service's in-process request handling, which
    mutates os.environ per-request via _org_context. When GTM_ORG_ID is
    unset (no tenancy context — e.g. a bare local run), falls back to the
    old global-most-recent behavior rather than returning nothing.
    """
    org_id = os.getenv("GTM_ORG_ID") or None
    params: dict = {
        "select": "*",
        "provider": "eq.gmail",
        "order": "connected_at.desc",
        "limit": 1,
    }
    if org_id:
        params["organization_id"] = f"eq.{org_id}"
    try:
        rows = _sb._get("engage_mailboxes", params=params)
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
        _sb._patch(
            "engage_mailboxes",
            params={"id": f"eq.{mailbox.get('id')}"},
            json_body={
                "access_token": access_token,
                "expires_at": expires_at,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
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


# ---------------------------------------------------------------------------
# Inbox reading (Task #35 — real inbox-polling reply ingestion, replacing the
# manual-only `classify-reply` CLI path). Deliberately stateless: every call
# re-lists the last `days_back` days of inbox mail rather than tracking a
# historyId/cursor. That's a few wasted Gmail API calls per poll, traded for
# never needing a cursor-persistence table or worrying about a missed poll
# permanently losing a message — real dedup happens one layer up, in
# agent_16_inbox.classify_reply, keyed on message_id (see schema.sql's
# uniq_outreach_replies_message_id).
# ---------------------------------------------------------------------------

def list_inbox_replies(days_back: int = 3, max_results: int = 25) -> list[dict]:
    """Recent inbox messages, excluding ones sent from the connected mailbox
    itself. Returns a list of:
        {message_id, thread_id, from_email, subject, body_text, received_at}
    Returns [] (never raises) when Gmail isn't configured/connected, or on
    any API failure — this is a polling loop, not a user-facing action, so a
    transient failure should just mean "nothing new this cycle," not a crash.
    """
    if not _has_creds():
        return []
    mailbox = _get_mailbox()
    if not mailbox or not mailbox.get("refresh_token"):
        return []
    try:
        token = _access_token(mailbox)
    except GmailApiError as exc:
        print(f"  [gmail_oauth] inbox poll: token refresh failed: {exc}")
        return []
    own_address = str(mailbox.get("email") or "").strip().lower()

    try:
        resp = httpx.get(
            _GMAIL_MESSAGES_URL,
            headers={"Authorization": f"Bearer {token}"},
            params={"q": f"in:inbox newer_than:{max(1, int(days_back))}d", "maxResults": max_results},
            timeout=30,
        )
    except httpx.HTTPError as exc:
        print(f"  [gmail_oauth] inbox list failed: {exc}")
        return []
    if resp.status_code != 200:
        print(f"  [gmail_oauth] inbox list failed: {resp.status_code} {resp.text[:200]}")
        return []

    ids = [m["id"] for m in (resp.json().get("messages") or []) if m.get("id")]
    out: list[dict] = []
    for message_id in ids:
        parsed = _fetch_message(message_id, token)
        if parsed and parsed["from_email"] and parsed["from_email"] != own_address:
            out.append(parsed)
    return out


def _fetch_message(message_id: str, token: str) -> dict | None:
    try:
        resp = httpx.get(
            f"{_GMAIL_MESSAGES_URL}/{message_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"format": "full"},
            timeout=30,
        )
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    data = resp.json()
    payload = data.get("payload") or {}
    headers = {
        str(h.get("name", "")).lower(): h.get("value", "")
        for h in payload.get("headers", [])
    }
    return {
        "message_id": data.get("id") or message_id,
        "thread_id": data.get("threadId"),
        "from_email": _extract_email(headers.get("from", "")),
        "subject": headers.get("subject", ""),
        "body_text": _extract_body_text(payload),
        "received_at": _internal_date_to_iso(data.get("internalDate")),
    }


def _extract_email(header_value: str) -> str:
    match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", header_value or "")
    return match.group(0).lower() if match else ""


def _extract_body_text(payload: dict) -> str:
    """Walk Gmail's MIME part tree; prefer text/plain, fall back to a
    stripped text/html part, else empty string (never raises — a message
    Gmail can't be parsed cleanly is skipped by the caller, not fatal)."""

    def decode(data: str) -> str:
        padded = data + "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")

    def walk(part: dict, want_mime: str) -> str | None:
        if part.get("mimeType") == want_mime:
            data = (part.get("body") or {}).get("data")
            if data:
                return decode(data)
        for sub in part.get("parts") or []:
            found = walk(sub, want_mime)
            if found:
                return found
        return None

    plain = walk(payload, "text/plain")
    if plain:
        return plain.strip()
    html = walk(payload, "text/html")
    if html:
        return _html_to_text(html).strip()
    return ""


def _internal_date_to_iso(internal_date: str | None) -> str | None:
    if not internal_date:
        return None
    try:
        return datetime.fromtimestamp(int(internal_date) / 1000, tz=timezone.utc).isoformat()
    except (ValueError, TypeError):
        return None
