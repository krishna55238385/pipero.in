"""Render a lead's outreach copy into a tracked HTML email.

Ported from the n8n "Email Outreach" automation's HTML node. Two things are
injected that the raw copy from Agent 12 does not contain:

1. An open-tracking pixel — a 1x1 image whose URL hits the phase3 tracking
   server's /open endpoint, so opens are recorded per (lead, campaign).
2. An unsubscribe link in the footer pointing at the /unsubscribe endpoint.
   (The original n8n template had a bug: its "unsubscribe" link pointed at
   /open. Fixed here.)

`tracking_base_url` is the public URL of phase3/tracking_server.py. When it is
None the email is still rendered, but without a pixel/links (useful for local
dry-runs where no public server exists).
"""
from urllib.parse import urlencode


_BRAND_PLACEHOLDER = "{{BRAND}}"


def _tracking_pixel(base_url: str, *, lead_id: int, email: str, campaign_id: str | None) -> str:
    qs = urlencode({"id": lead_id, "email": email, "campaign": campaign_id or ""})
    src = f"{base_url.rstrip('/')}/open?{qs}"
    return f'<img src="{src}" width="1" height="1" alt="" style="display:none" />'


def unsubscribe_url(base_url: str, *, lead_id: int, email: str, campaign_id: str | None = None) -> str:
    """Build the per-recipient unsubscribe URL hitting the tracking server."""
    qs = urlencode({"id": lead_id, "email": email, "campaign": campaign_id or ""})
    return f"{base_url.rstrip('/')}/unsubscribe?{qs}"


def render_email_html(
    content_html: str,
    *,
    lead_id: int,
    email: str,
    subject: str = "",
    campaign_id: str | None = None,
    tracking_base_url: str | None = None,
    brand_name: str = "AI GTM Agency",
) -> str:
    """Wrap raw body copy in the branded template + tracking pixel + unsubscribe.

    `content_html` is the inner body (Agent 12's message); newlines are turned
    into <br> if it looks like plain text.
    """
    body = content_html if "<" in content_html else content_html.replace("\n", "<br>\n")

    if tracking_base_url:
        pixel = _tracking_pixel(tracking_base_url, lead_id=lead_id, email=email, campaign_id=campaign_id)
        unsub = unsubscribe_url(tracking_base_url, lead_id=lead_id, email=email, campaign_id=campaign_id)
        unsub_html = (
            f'If you prefer not to receive further messages, you can '
            f'<a href="{unsub}">unsubscribe</a> here.'
        )
    else:
        pixel = ""
        unsub_html = "If you prefer not to receive further messages, just reply with \"unsubscribe\"."

    return _TEMPLATE.format(
        subject=_escape(subject),
        brand=_escape(brand_name),
        body=body,
        pixel=pixel,
        unsubscribe=unsub_html,
    )


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# Ported (and de-bugged) from the n8n HTML node — a responsive, table-based
# layout that renders consistently across email clients.
_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{subject}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {{ margin:0; padding:0; background-color:#f6f7f9; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; color:#1f1f1f; }}
    table {{ border-spacing:0; width:100%; }}
    td {{ padding:0; }}
    .wrapper {{ width:100%; background-color:#f6f7f9; padding:40px 0; }}
    .container {{ max-width:640px; margin:0 auto; background-color:#ffffff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.04); overflow:hidden; }}
    .content {{ padding:28px; }}
    p {{ margin:0 0 16px 0; line-height:1.5; color:#333; }}
    .footer {{ background-color:#fafbfc; color:#6b7280; font-size:12px; padding:20px 28px; text-align:left; border-top:1px solid #e5e7eb; }}
    .footer a {{ color:#0b74ff; text-decoration:none; font-weight:500; }}
    @media (max-width:600px) {{ .container {{ border-radius:0; }} .content,.footer {{ padding:20px; }} }}
  </style>
</head>
<body>
  <center class="wrapper">
    <table role="presentation" class="container">
      <tr>
        <td class="content">
          {body}
        </td>
      </tr>
      <tr>
        <td class="footer">
          <p>
            You are receiving this email from <strong>{brand}</strong> because we believe it could be relevant to you.<br>
            {unsubscribe}
          </p>
        </td>
      </tr>
    </table>
  </center>
  {pixel}
</body>
</html>"""
