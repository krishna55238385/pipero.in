"""Phase 3 email-tracking server.

A tiny FastAPI app that replaces the two n8n webhooks ("open" + "unsubscribe")
from the original "Email Outreach" automation. Every email rendered by
phase3.core.email_render embeds:

  - a 1x1 pixel  ->  GET /open?id=<lead_id>&email=<addr>&campaign=<cid>
  - an unsub link -> GET /unsubscribe?id=<lead_id>&email=<addr>&campaign=<cid>

Run it on a publicly reachable host and point TRACKING_BASE_URL at it:

    uvicorn phase3.tracking_server:app --host 0.0.0.0 --port 8080
    # local testing:  ngrok http 8080   ->  set TRACKING_BASE_URL to the https URL

Opens are recorded (deduped) in outreach_opens; unsubscribes in
outreach_unsubscribes, which Agent 14's gmail sender reads to suppress
opt-outs on the next run.
"""
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse, Response

from gtm_backend.phase3.connectors import supabase


# 1x1 transparent GIF returned by the open pixel.
_PIXEL_GIF = bytes(
    [
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
        0x00, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x21, 0xF9, 0x04, 0x01, 0x00,
        0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B,
    ]
)

app = FastAPI(title="AI GTM Agency — Phase 3 Email Tracking", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/open")
def track_open(
    id: int = Query(..., description="lead_id"),
    email: str = Query(...),
    campaign: str = Query(default=""),
) -> Response:
    """Record an email open (deduped) and return a 1x1 transparent GIF."""
    try:
        supabase.record_open(lead_id=id, email=email, campaign_id=campaign or None)
    except Exception as exc:  # never break the pixel render for the recipient
        print(f"[tracking] open record failed lead={id} email={email}: {exc}")
    return Response(
        content=_PIXEL_GIF,
        media_type="image/gif",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, private"},
    )


@app.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(
    id: int = Query(..., description="lead_id"),
    email: str = Query(...),
    campaign: str = Query(default=""),
) -> HTMLResponse:
    """Record an unsubscribe and show a confirmation page."""
    try:
        supabase.record_unsubscribe(email=email, lead_id=id, campaign_id=campaign or None)
        ok = True
    except Exception as exc:
        print(f"[tracking] unsubscribe failed lead={id} email={email}: {exc}")
        ok = False

    message = (
        "You've been unsubscribed. You won't receive further emails from us."
        if ok
        else "We hit a snag recording your request — please reply to the email with 'unsubscribe'."
    )
    return HTMLResponse(
        f"""<!doctype html><html><head><meta charset="utf-8">
<title>Unsubscribe</title>
<style>body{{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7f9;
color:#1f1f1f;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}}
.card{{background:#fff;padding:40px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.06);max-width:420px;text-align:center}}</style>
</head><body><div class="card"><h2>Unsubscribe</h2><p>{message}</p></div></body></html>"""
    )
