"""Phase 3 Gmail sender (SMTP, app-password auth).

A self-hosted alternative to the Instantly connector. Ported from the n8n
"Email Outreach" automation, whose Gmail node sends one HTML email per lead
with an open-tracking pixel. Here we send directly over Gmail SMTP using a
16-character app password (https://myaccount.google.com/apppasswords).

Configure in the root .env (the single project-wide env file):
    GMAIL_ADDRESS=you@gmail.com
    GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx   # 16 chars, no spaces

Public surface:
    is_configured() -> bool                       — True iff both env vars set
    send_html_email(...) -> dict                   — sends one HTML email

`send_html_email` raises RuntimeError when not configured so the orchestrator
can short-circuit cleanly in dry-run mode, and SmtpSendError on a send failure
so each attempt is logged with a concrete reason.
"""
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from phase3.core.config import get_settings


_SMTP_HOST = "smtp.gmail.com"
_SMTP_PORT = 465  # implicit TLS (SMTP_SSL)
_NOT_CONFIGURED_MSG = (
    "GMAIL_ADDRESS / GMAIL_APP_PASSWORD not set in the root .env — "
    "create an app password at https://myaccount.google.com/apppasswords"
)

_settings = get_settings()


class SmtpSendError(RuntimeError):
    """Raised when an SMTP send fails for a concrete recipient."""

    def __init__(self, to: str, detail: str) -> None:
        self.to = to
        self.detail = detail
        super().__init__(f"gmail send to {to} failed: {detail}")


def is_configured() -> bool:
    """Return True iff both GMAIL_ADDRESS and GMAIL_APP_PASSWORD are present."""
    return bool(_settings.gmail_address) and bool(_settings.gmail_app_password)


def from_address() -> str | None:
    """The configured sending address (None when unconfigured)."""
    return _settings.gmail_address


def _require_configured() -> None:
    if not is_configured():
        raise RuntimeError(_NOT_CONFIGURED_MSG)


def _build_message(
    *,
    to: str,
    subject: str,
    html_body: str,
    from_addr: str,
    from_name: str | None,
    list_unsubscribe_url: str | None,
) -> EmailMessage:
    """Assemble a multipart/alternative message (plain-text + HTML)."""
    msg = EmailMessage()
    msg["From"] = formataddr((from_name, from_addr)) if from_name else from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid()
    # One-click unsubscribe header — respected by Gmail/Outlook and keeps the
    # sender out of spam folders (RFC 8058 / 2369).
    if list_unsubscribe_url:
        msg["List-Unsubscribe"] = f"<{list_unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    # Plain-text fallback first, then the HTML body Gmail prefers.
    msg.set_content(_html_to_text(html_body))
    msg.add_alternative(html_body, subtype="html")
    return msg


def _html_to_text(html: str) -> str:
    """Very small HTML→text fallback for the multipart plain part."""
    import re

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
    """Send one HTML email over Gmail SMTP. Returns {message_id, status}.

    Raises RuntimeError when the gmail sender is not configured, and
    SmtpSendError when the SMTP server rejects or the connection fails.
    """
    _require_configured()
    from_addr = _settings.gmail_address or ""
    message = _build_message(
        to=to,
        subject=subject,
        html_body=html_body,
        from_addr=from_addr,
        from_name=from_name,
        list_unsubscribe_url=list_unsubscribe_url,
    )
    context = ssl.create_default_context()
    try:
        with smtplib.SMTP_SSL(_SMTP_HOST, _SMTP_PORT, context=context, timeout=30) as server:
            server.login(from_addr, _settings.gmail_app_password or "")
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        raise SmtpSendError(to, str(exc)) from exc
    return {"message_id": message["Message-ID"], "status": "sent"}
