"""Agent 36 — ROI Attribution (PDF Phase 6 — MANAGE & REPORT).

"Tracks every touchpoint in the buyer journey and attributes pipeline and
revenue to the specific messages, channels, sequences, and agent actions
that influenced each deal."

Pure Python arithmetic, no LLM call — same "the LLM never touches a number"
principle as Agent 34 (Revenue Forecasting) and Agent 35 (Board Reporting).
Every figure here is computed directly from real rows in llm_usage,
leads_raw, and the CRM's `deals` table.

Honest scope, documented rather than hidden (see schema.sql comment above
roi_attribution_snapshots for the full reasoning):
- The PDF asks for multi-CHANNEL attribution and cost-per-meeting. This
  system currently has exactly ONE outbound channel (email — phase3's
  CHANNEL_STRATEGY_SYSTEM is a hard "email-only" rule) and no Meeting
  Booking agent (22/23 blocked on a calendar vendor decision). So:
    - channel_breakdown has exactly one real row (email) today. Reported as
      what it is, not padded with invented "linkedin"/"phone" rows.
    - cost_per_meeting is omitted entirely (None) rather than invented.
- "Sourced vs influenced pipeline" (a PDF rule): every deal in this system
  today originates from an outbound sequence Agent 14 sent (no inbound/
  marketing-attributed agents exist yet — PDF's Agent 38 Inbound Signal
  Capture isn't built). So influenced_pipeline_value is honestly 0/None
  today; sourced_pipeline_value is the real number. limitations_note says
  this plainly so a reader doesn't mistake "0 influenced" for "influence
  channels exist and are underperforming."
- "Flag if a channel is consistently showing negative ROI" — with a single
  channel, this collapses to "is overall ROI negative, and was it also
  negative last time." Reads the previous snapshot (if any) to answer that
  honestly rather than guessing "consistently" off one data point.
"""
from gtm_backend.phase3.connectors import supabase

_CLOSED_WON = {"won", "closed_won"}


def generate_roi_attribution() -> dict:
    """Compute real cost/pipeline numbers from llm_usage + CRM deals and
    persist one roi_attribution_snapshots row."""
    bar = "═" * 72
    print(f"\n{bar}")
    print("  AGENT 36 — ROI Attribution")
    print(bar)

    cost_by_phase = supabase.get_llm_cost_by_phase()
    total_cost = round(sum(cost_by_phase.values()), 6) if cost_by_phase else 0.0

    lead_count = supabase.get_lead_count()
    qualified_deals = supabase.get_qualified_deals()
    qualified_count = len(qualified_deals)

    all_deals = supabase.get_all_deals()
    closed_won = [d for d in all_deals if (d.get("status") or "").lower() in _CLOSED_WON]
    closed_won_count = len(closed_won)
    closed_won_revenue = round(sum(float(d.get("value") or 0) for d in closed_won), 2)

    cost_per_lead = _safe_divide(total_cost, lead_count)
    cost_per_qualified_deal = _safe_divide(total_cost, qualified_count)
    cost_per_closed_deal = _safe_divide(total_cost, closed_won_count)

    # Single-channel reality, reported honestly (see module docstring).
    channel_breakdown = [
        {
            "channel": "email",
            "cost_usd": total_cost,
            "leads": lead_count,
            "qualified_deals": qualified_count,
            "closed_won_deals": closed_won_count,
            "closed_won_revenue": closed_won_revenue,
        }
    ]

    # Every deal today is outbound-sourced (no inbound/marketing agents
    # exist yet) — see module docstring.
    sourced_pipeline_value = closed_won_revenue
    influenced_pipeline_value = None

    roi_ratio = None
    if total_cost > 0:
        roi_ratio = round((closed_won_revenue - total_cost) / total_cost, 4)

    previous = supabase.get_recent_roi_attribution_snapshots(limit=1)
    previous_flagged = bool(previous and previous[0].get("flagged_negative_roi"))
    flagged_negative_roi = roi_ratio is not None and roi_ratio < 0
    consistency_note = None
    if flagged_negative_roi and previous_flagged:
        consistency_note = "Negative ROI in this snapshot AND the previous one — consistent, not a one-off."
    elif flagged_negative_roi:
        consistency_note = "Negative ROI this snapshot — first time seen (no prior snapshot was also negative)."

    limitations_note = _build_limitations_note(qualified_count, closed_won_count, consistency_note)

    snapshot = supabase.create_roi_attribution_snapshot(
        total_llm_cost_usd=total_cost,
        cost_by_phase=cost_by_phase,
        lead_count=lead_count,
        qualified_deal_count=qualified_count,
        closed_won_count=closed_won_count,
        closed_won_revenue=closed_won_revenue,
        cost_per_lead=cost_per_lead,
        cost_per_qualified_deal=cost_per_qualified_deal,
        cost_per_closed_deal=cost_per_closed_deal,
        channel_breakdown=channel_breakdown,
        sourced_pipeline_value=sourced_pipeline_value,
        influenced_pipeline_value=influenced_pipeline_value,
        roi_ratio=roi_ratio,
        flagged_negative_roi=flagged_negative_roi,
        limitations_note=limitations_note,
    )
    snapshot_id = snapshot.get("id") if snapshot else None

    flag_label = "⚠ NEGATIVE ROI" if flagged_negative_roi else "ok"
    print(
        f"  ✓ Agent 36 complete: snapshot {snapshot_id} — "
        f"${total_cost:,.2f} spent, {lead_count} leads, {qualified_count} qualified, "
        f"{closed_won_count} closed-won (${closed_won_revenue:,.2f}) — {flag_label}"
    )
    return {
        "status": "generated",
        "snapshot_id": snapshot_id,
        "total_llm_cost_usd": total_cost,
        "cost_per_lead": cost_per_lead,
        "cost_per_qualified_deal": cost_per_qualified_deal,
        "cost_per_closed_deal": cost_per_closed_deal,
        "roi_ratio": roi_ratio,
        "flagged_negative_roi": flagged_negative_roi,
    }


def _safe_divide(numerator: float, denominator: int) -> float | None:
    if not denominator:
        return None
    return round(numerator / denominator, 4)


def _build_limitations_note(qualified_count: int, closed_won_count: int, consistency_note: str | None) -> str:
    parts = [
        "Single-channel system (email-only by design) — channel_breakdown has one "
        "real row, not a multi-channel comparison.",
        "cost_per_meeting omitted — no Meeting Booking agent exists yet.",
        "influenced_pipeline_value is None — every deal today is outbound-sourced; "
        "there is no inbound/marketing-attributed pipeline yet to distinguish it from.",
    ]
    if closed_won_count == 0:
        parts.append(
            f"No closed-won deals yet ({qualified_count} qualified deal(s) in pipeline) — "
            "cost_per_closed_deal and roi_ratio are not yet meaningful."
        )
    if consistency_note:
        parts.append(consistency_note)
    return " ".join(parts)
