"""Agent 35 — Board Reporting (PDF Phase 6 — MANAGE & REPORT).

"Compiles pipeline data, conversion metrics, channel performance, revenue
against target, and GTM efficiency into clean, visually clear reports for
leadership reviews and board meetings."

Deliberately splits the work so the LLM never touches a number: every figure
in the report (pipeline-by-stage counts, conversion rate, forecast totals and
their period-over-period delta, the at-risk deal list) is computed here in
plain Python from real rows in `deals`/`revenue_forecasts`/`pipeline_status`
— the SAME PDF rule this whole session has been built around ("data must be
sourced from the CRM — no manual data entry") extends naturally to "no
LLM-invented data" too. The LLM is used for exactly one thing: synthesizing
the pre-computed numbers into the "3 things going well / 3 things needing
attention" narrative the PDF asks for — see BOARD_REPORT_SYNTHESIS_SYSTEM in
phase4/core/prompts.py for the grounding rules enforced there.

Known gaps, documented rather than hidden:
- "Revenue vs target" — no quarter-end target exists anywhere in this system
  (same gap noted in Agent 34). Omitted rather than invented.
- Conversion rate is computed from ALL-TIME won/lost deals, which right now
  is a tiny sample (1 won deal in testing). The report says so plainly
  rather than presenting a 100%/0% rate as if it were meaningful.
- "Channel performance" and "GTM efficiency" sections from the PDF aren't
  included yet — that data (A/B test results, channel plan performance)
  lives in phase3's ab_test_results/outreach_channel_plans tables and could
  be added in a future pass; scoped out of v1 to keep this shippable today.
- "Distribution list ... auto-sent at the right cadence" is a
  scheduling/email-delivery concern, not agent logic — pairs with the
  `schedule` tooling once someone wants this running weekly automatically.

Append-only (see schema.sql): every run is a new board_reports row, which is
what makes THIS report's period-over-period comparison possible against the
NEXT one.
"""
from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import BOARD_REPORT_SYNTHESIS_SYSTEM

_CLOSED_WON = {"won", "closed_won"}
_CLOSED_LOST = {"lost", "closed_lost"}


def generate_board_report() -> dict:
    """Compile real pipeline/forecast/risk data, synthesize the narrative,
    and persist one board_reports snapshot."""
    bar = "═" * 72
    print(f"\n{bar}")
    print("  AGENT 35 — Board Reporting")
    print(bar)

    all_deals = supabase.get_all_deals()
    active_deals = [d for d in all_deals if (d.get("status") or "").lower() not in _CLOSED_WON | _CLOSED_LOST]
    pipeline_by_stage = _pipeline_by_stage(active_deals)
    conversion_rate, conversion_note = _conversion_rate(all_deals)

    forecasts = supabase.get_recent_revenue_forecasts(limit=2)
    current_forecast = forecasts[0] if forecasts else None
    previous_forecast = forecasts[1] if len(forecasts) > 1 else None
    forecast_base = float(current_forecast.get("base_total")) if current_forecast else None
    forecast_delta = None
    if current_forecast and previous_forecast:
        forecast_delta = round(
            float(current_forecast.get("base_total") or 0) - float(previous_forecast.get("base_total") or 0), 2
        )

    risky = supabase.get_at_risk_pipeline_status(limit=10)
    top_risks = [
        {
            "deal_id": r.get("deal_id"),
            "company_name": r.get("company_name"),
            "risk_level": r.get("risk_level"),
            "days_since_activity": r.get("days_since_activity"),
            "next_best_action": r.get("next_best_action"),
        }
        for r in risky
    ]

    payload = {
        "pipeline_by_stage": pipeline_by_stage,
        "conversion_rate": conversion_rate,
        "conversion_rate_note": conversion_note,
        "forecast_base_total": forecast_base,
        "forecast_delta_from_previous": forecast_delta,
        "top_risks": top_risks,
    }

    try:
        raw = llm.chat_json(
            BOARD_REPORT_SYNTHESIS_SYSTEM,
            _stringify(payload),
            agent="agent_35_board_reporting",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 35] report synthesis failed: {exc}")
        return {"status": "failed", "error": str(exc)}

    going_well = raw.get("going_well") if isinstance(raw.get("going_well"), list) else []
    needs_attention = raw.get("needs_attention") if isinstance(raw.get("needs_attention"), list) else []
    executive_summary = str(raw.get("executive_summary") or "").strip() or None

    report_text = _render_report_text(payload, going_well, needs_attention, executive_summary)

    report = supabase.create_board_report(
        pipeline_by_stage=pipeline_by_stage,
        conversion_rate=conversion_rate,
        conversion_rate_note=conversion_note,
        forecast_base_total=forecast_base,
        forecast_delta_from_previous=forecast_delta,
        top_risks=top_risks,
        going_well=going_well,
        needs_attention=needs_attention,
        executive_summary=executive_summary,
        report_text=report_text,
    )
    report_id = report.get("id") if report else None

    print(f"  ✓ Agent 35 complete: report {report_id} generated ({len(going_well)} going well, {len(needs_attention)} need attention, {len(top_risks)} at-risk deal(s))")
    return {
        "status": "generated",
        "report_id": report_id,
        "pipeline_by_stage": pipeline_by_stage,
        "conversion_rate": conversion_rate,
        "forecast_base_total": forecast_base,
        "forecast_delta_from_previous": forecast_delta,
        "going_well": going_well,
        "needs_attention": needs_attention,
    }


def _pipeline_by_stage(active_deals: list[dict]) -> dict:
    by_stage: dict[str, dict] = {}
    for deal in active_deals:
        stage = deal.get("status") or "unknown"
        entry = by_stage.setdefault(stage, {"count": 0, "total_value": 0.0})
        entry["count"] += 1
        entry["total_value"] += float(deal.get("value") or 0)
    return by_stage


def _conversion_rate(all_deals: list[dict]) -> tuple[float | None, str]:
    won = [d for d in all_deals if (d.get("status") or "").lower() in _CLOSED_WON]
    lost = [d for d in all_deals if (d.get("status") or "").lower() in _CLOSED_LOST]
    closed = len(won) + len(lost)
    if closed == 0:
        return None, "No closed deals yet — conversion rate not yet meaningful."
    rate = round(len(won) / closed * 100, 1)
    if closed < 10:
        return rate, f"Based on only {closed} closed deal(s) — small sample, not yet statistically reliable."
    return rate, f"Based on {closed} closed deals ({len(won)} won, {len(lost)} lost)."


def _render_report_text(payload: dict, going_well: list, needs_attention: list, executive_summary: str | None) -> str:
    lines = ["BOARD / LEADERSHIP GTM REPORT", "=" * 40, ""]
    if executive_summary:
        lines += ["EXECUTIVE SUMMARY", executive_summary, ""]

    lines.append("PIPELINE BY STAGE")
    stages = payload["pipeline_by_stage"]
    if stages:
        for stage, info in stages.items():
            lines.append(f"  {stage}: {info['count']} deal(s), ${info['total_value']:,.2f} total value")
    else:
        lines.append("  No active deals in the pipeline.")
    lines.append("")

    lines.append("CONVERSION RATE")
    if payload["conversion_rate"] is not None:
        lines.append(f"  {payload['conversion_rate']}% — {payload['conversion_rate_note']}")
    else:
        lines.append(f"  N/A — {payload['conversion_rate_note']}")
    lines.append("")

    lines.append("REVENUE FORECAST")
    if payload["forecast_base_total"] is not None:
        lines.append(f"  Base case: ${payload['forecast_base_total']:,.2f}")
        if payload["forecast_delta_from_previous"] is not None:
            delta = payload["forecast_delta_from_previous"]
            direction = "up" if delta >= 0 else "down"
            lines.append(f"  Change since last report: {direction} ${abs(delta):,.2f}")
        else:
            lines.append("  No previous forecast to compare against yet.")
    else:
        lines.append("  No forecast generated yet — run Agent 34 first.")
    lines.append("")

    lines.append("TOP RISKS")
    if payload["top_risks"]:
        for r in payload["top_risks"]:
            lines.append(f"  - {r['company_name']} ({r['risk_level']}, {r['days_since_activity']}d): {r['next_best_action']}")
    else:
        lines.append("  No at-risk or stuck deals right now.")
    lines.append("")

    lines.append("GOING WELL")
    lines += [f"  + {item}" for item in going_well] if going_well else ["  (nothing to report yet)"]
    lines.append("")

    lines.append("NEEDS ATTENTION")
    lines += [f"  ! {item}" for item in needs_attention] if needs_attention else ["  (nothing flagged)"]

    return "\n".join(lines)


def _stringify(payload: dict) -> str:
    import json
    return json.dumps(payload, default=str)
