"""GA4 -> website_visitor_signals ingest.

Pulls a Google Analytics 4 report (via the Data API) for each org's connected
property and writes one website_visitor_signals row per dimension value. When a
row can be tied to a known company (by domain, or via an optional company custom
dimension) and the visit is strong, it also mirrors a buying_signals row of type
'website_visit'.

NOTE on company identity: standard GA4 does NOT reveal which company visited.
True B2B de-anonymization needs a reverse-IP provider (RB2B / Clearbit Reveal /
Vector) that writes a custom dimension (e.g. "company") into GA4 — set
GA4_COMPANY_DIMENSION to that dimension's API name to light up company matching
and the buying-signal mirror. Without it you still get rich aggregate intent
(top landing pages, channels, geography, engagement) on the Prospects -> Visitors
page.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone

from gtm_backend.gtm_service import db
from gtm_backend.gtm_service.config import config

# Optional company custom-dimension API name (from a reverse-IP integration).
COMPANY_DIMENSION = os.getenv("GA4_COMPANY_DIMENSION", "")


class GA4NotConfigured(RuntimeError):
    pass


def _credentials():
    try:
        from google.oauth2 import service_account  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise GA4NotConfigured(
            "google-auth / google-analytics-data not installed"
        ) from exc

    if config.GA4_SA_JSON:
        info = json.loads(config.GA4_SA_JSON)
        return service_account.Credentials.from_service_account_info(info)
    if config.GA4_SA_FILE and os.path.exists(config.GA4_SA_FILE):
        return service_account.Credentials.from_service_account_file(config.GA4_SA_FILE)
    raise GA4NotConfigured("Set GA4_SA_JSON or GA4_SA_FILE to enable GA4 ingest")


def _client():
    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise GA4NotConfigured("google-analytics-data not installed") from exc
    return BetaAnalyticsDataClient(credentials=_credentials())


def _domain_of(value: str) -> str:
    """Extract a bare domain from a company string or URL."""
    if not value:
        return ""
    value = value.strip().lower()
    m = re.search(r"([a-z0-9-]+\.[a-z0-9.-]+)", value)
    return m.group(1) if m else ""


def _score(engaged: int, page_views: int) -> tuple[int, str]:
    score = min(100, engaged * 12 + page_views * 2)
    if engaged >= 3 or score >= 60:
        strength = "high"
    elif engaged >= 1 or score >= 20:
        strength = "medium"
    else:
        strength = "low"
    return score, strength


def _run_report(client, property_id: str, lookback_days: int):
    from google.analytics.data_v1beta.types import (  # type: ignore
        DateRange,
        Dimension,
        Metric,
        RunReportRequest,
    )

    dims = ["landingPagePlusQueryString", "sessionDefaultChannelGroup", "country"]
    if COMPANY_DIMENSION:
        dims = [COMPANY_DIMENSION, *dims]

    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=f"{lookback_days}daysAgo", end_date="today")],
        dimensions=[Dimension(name=d) for d in dims],
        metrics=[
            Metric(name="sessions"),
            Metric(name="engagedSessions"),
            Metric(name="screenPageViews"),
            Metric(name="userEngagementDuration"),
        ],
        limit=250,
    )
    return client.run_report(request), dims


def sync_property(conn: dict) -> int:
    """Ingest one ga4_connections row. Returns number of signal rows written."""
    org = conn["organization_id"]
    property_id = conn["property_id"]
    lookback = int(conn.get("lookback_days") or 7)
    today = datetime.now(timezone.utc).date()

    client = _client()
    response, dims = _run_report(client, property_id, lookback)

    has_company_dim = bool(COMPANY_DIMENSION)
    rows: list[dict] = []
    strong_company_hits: list[tuple[str, int, str]] = []  # (domain, weight, label)

    # Resolve a company domain -> leads_raw id at most once per sync, so the
    # signal row's matched_lead_id and the buying-signal mirror below share a
    # single lookup instead of querying the same domain twice.
    lead_by_domain: dict[str, int | None] = {}

    def _lead_for_domain(domain: str) -> int | None:
        if not domain:
            return None
        if domain not in lead_by_domain:
            lead_by_domain[domain] = db.find_leads_raw_by_domain(org, domain)
        return lead_by_domain[domain]

    for r in response.rows:
        values = [d.value for d in r.dimension_values]
        metrics = [m.value for m in r.metric_values]
        if has_company_dim:
            company_val, landing, channel, country = (values + ["", "", "", ""])[:4]
        else:
            company_val = ""
            landing, channel, country = (values + ["", "", ""])[:3]

        sessions = int(float(metrics[0] or 0))
        engaged = int(float(metrics[1] or 0))
        page_views = int(float(metrics[2] or 0))
        eng_seconds = float(metrics[3] or 0)
        score, strength = _score(engaged, page_views)

        dimension_value = company_val or landing
        company_domain = _domain_of(company_val) if company_val else ""
        matched_lead_id = _lead_for_domain(company_domain)

        rows.append(
            {
                "organization_id": org,
                "source": "ga4",
                "company_name": company_val or None,
                "company_domain": company_domain or None,
                "matched_lead_id": matched_lead_id,
                "dimension": COMPANY_DIMENSION if company_val else "landingPage",
                "dimension_value": dimension_value,
                "region": None,
                "country": country or None,
                "channel": channel or None,
                "sessions": sessions,
                "engaged_sessions": engaged,
                "page_views": page_views,
                "avg_engagement_seconds": round(eng_seconds / engaged, 1) if engaged else 0,
                "top_pages": [landing] if landing else [],
                "visitor_score": score,
                "signal_strength": strength,
                "window_start": (today.replace(day=1) if False else None),
                "window_end": today.isoformat(),
                "raw": {"landing": landing, "channel": channel, "country": country},
                "last_seen_at": _now_iso(),
            }
        )

        if company_domain and strength == "high":
            strong_company_hits.append(
                (company_domain, min(10, max(4, score // 10)), f"{company_val} visited {landing or 'the site'}")
            )

    written = db.upsert_visitor_signals(rows)

    # Mirror strong, company-identified visits into buying_signals (reusing the
    # domain -> lead lookups already resolved while building the signal rows).
    for domain, weight, label in strong_company_hits:
        lead_id = _lead_for_domain(domain)
        if lead_id:
            try:
                db.insert_website_buying_signal(
                    org, lead_id, label, f"https://{domain}", weight
                )
            except Exception:  # noqa: BLE001 - signal mirror is best-effort
                pass

    db.update_ga4_connection(
        conn["id"], status="connected", last_error=None, last_synced_at=_now_iso()
    )
    return written


def sync_all(organization_id: str | None = None) -> dict:
    """Ingest every enabled GA4 connection (optionally scoped to one org)."""
    conns = db.get_ga4_connections(organization_id)
    total, errors = 0, []
    for conn in conns:
        try:
            total += sync_property(conn)
        except GA4NotConfigured:
            raise
        except Exception as exc:  # noqa: BLE001
            errors.append({"property_id": conn.get("property_id"), "error": str(exc)})
            try:
                db.update_ga4_connection(conn["id"], status="error", last_error=str(exc))
            except Exception:  # noqa: BLE001
                pass
    return {"connections": len(conns), "rows_written": total, "errors": errors}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
