"""Agent 45 — Revenue Intelligence (PDF Phase 7 — RETAIN & GROW).

"Makes the entire GTM system smarter over time by learning from every deal."

Every run produces one append-only revenue_intelligence_snapshots row (same
pattern as Agent 34/35's forecast/board-report snapshots). Every number in
the snapshot — win rate, average deal size, average sales cycle, the
per-segment breakdown — is computed here in plain Python from real `deals`
rows, never by the LLM. The LLM is used for exactly one thing: turning the
pre-computed numbers into specific, actionable insight/recommendation text —
same "LLM never touches numbers" split as Agent 35's board report.

PDF rules and how each is actually handled:
- "Must analyse a minimum of 20 closed deals before generating pattern
  recommendations" — BUILT as a hard gate: below 20 closed (won+lost) deals,
  the snapshot still records closed_deal_count and min_sample_met=False, but
  the LLM is never called and key_insights/recommendations stay empty —
  the PDF says "must," not "should," so this isn't hedged, it's enforced.
- "Win/loss reasons must be captured for every deal before analysis can
  begin" — NOT SATISFIED, documented honestly: `deals` (the CRM's own table)
  has no loss_reason/win_reason column anywhere in this codebase. Rather than
  block on a schema change to the CRM app's own tables (out of scope for a
  gtm_backend agent), analysis works from what IS captured — deal value,
  sales cycle length (created_at → close_date), and company industry via the
  contact→company join — instead of structured win/loss reasons.
- "Insights must be specific and actionable — not just descriptive" —
  enforced in the prompt (REVENUE_INTELLIGENCE_SYSTEM).
- "Recommendations must feed back into ICP scoring, copywriting, and channel
  strategy" — recommendations are surfaced as TEXT for a human to read and
  act on, never written back into another agent's config automatically.
  This is deliberate, not a shortfall: the PDF's own very next rule says
  "human must review and approve intelligence recommendations before
  system-wide implementation" — an auto-apply loop would violate that rule,
  not satisfy this one.
- "Analysis must be refreshed monthly" — satisfied by run cadence (should be
  scheduled monthly), not by agent logic itself, same as Board Reporting.
- "Must separate insights by market segment" — APPROXIMATED using company
  industry (via each deal's contact → company join) as the segment
  dimension, since this codebase has no other segment/market concept at the
  CRM-deal level. If most deals have no linked company/industry, the
  breakdown will legitimately be thin — reported honestly, not padded.
"""
import json

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import REVENUE_INTELLIGENCE_SYSTEM

_CLOSED_WON = {"won", "closed_won"}
_CLOSED_LOST = {"lost", "closed_lost"}
_MIN_CLOSED_DEALS = 20


def generate_revenue_intelligence() -> dict:
    """Compute win/loss patterns from real closed-deal data, synthesize
    insights if the sample is large enough, and persist one snapshot."""
    bar = "═" * 72
    print(f"\n{bar}")
    print("  AGENT 45 — Revenue Intelligence")
    print(bar)

    all_deals = supabase.get_all_deals()
    won = [d for d in all_deals if (d.get("status") or "").lower() in _CLOSED_WON]
    lost = [d for d in all_deals if (d.get("status") or "").lower() in _CLOSED_LOST]
    closed_count = len(won) + len(lost)
    min_sample_met = closed_count >= _MIN_CLOSED_DEALS

    win_rate = round(len(won) / closed_count * 100, 1) if closed_count else None
    avg_deal_size_won = _avg([d.get("value") for d in won])
    avg_deal_size_lost = _avg([d.get("value") for d in lost])
    avg_cycle_days_won = _avg_cycle_days(won)
    segment_breakdown = _segment_breakdown(won, lost)

    print(
        f"  → {closed_count} closed deal(s) ({len(won)} won, {len(lost)} lost) — "
        f"minimum sample of {_MIN_CLOSED_DEALS} {'met' if min_sample_met else 'NOT met'}"
    )

    key_insights: list[str] = []
    recommendations: list[str] = []

    if min_sample_met:
        payload = {
            "closed_deal_count": closed_count,
            "won_count": len(won),
            "lost_count": len(lost),
            "win_rate": win_rate,
            "avg_deal_size_won": avg_deal_size_won,
            "avg_deal_size_lost": avg_deal_size_lost,
            "avg_sales_cycle_days_won": avg_cycle_days_won,
            "segment_breakdown": segment_breakdown,
        }
        try:
            raw = llm.chat_json(
                REVENUE_INTELLIGENCE_SYSTEM,
                _stringify(payload),
                agent="agent_45_revenue_intelligence",
                phase="phase4",
            )
            key_insights = raw.get("key_insights") if isinstance(raw.get("key_insights"), list) else []
            recommendations = raw.get("recommendations") if isinstance(raw.get("recommendations"), list) else []
        except Exception as exc:
            print(f"  [Agent 45] insight synthesis failed (snapshot still saved with raw numbers): {exc}")
    else:
        print(f"  ↷ SKIPPED insight synthesis — only {closed_count} closed deal(s), PDF requires {_MIN_CLOSED_DEALS} minimum")

    snapshot = supabase.create_revenue_intelligence_snapshot(
        closed_deal_count=closed_count,
        min_sample_met=min_sample_met,
        win_rate=win_rate,
        avg_deal_size_won=avg_deal_size_won,
        avg_deal_size_lost=avg_deal_size_lost,
        avg_sales_cycle_days_won=avg_cycle_days_won,
        segment_breakdown=segment_breakdown,
        key_insights=key_insights,
        recommendations=recommendations,
    )
    snapshot_id = snapshot.get("id") if snapshot else None

    print(
        f"  ✓ Agent 45 complete: snapshot {snapshot_id} — win_rate={win_rate}, "
        f"{len(key_insights)} insight(s), {len(recommendations)} recommendation(s)"
    )
    return {
        "snapshot_id": snapshot_id,
        "closed_deal_count": closed_count,
        "min_sample_met": min_sample_met,
        "win_rate": win_rate,
        "avg_deal_size_won": avg_deal_size_won,
        "avg_deal_size_lost": avg_deal_size_lost,
        "avg_sales_cycle_days_won": avg_cycle_days_won,
        "segment_breakdown": segment_breakdown,
        "key_insights": key_insights,
        "recommendations": recommendations,
    }


def _avg(values: list) -> float | None:
    nums = [float(v) for v in values if v is not None]
    if not nums:
        return None
    return round(sum(nums) / len(nums), 2)


def _avg_cycle_days(won_deals: list[dict]) -> float | None:
    from datetime import datetime, timezone

    def _parse(value):
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return None

    days = []
    for deal in won_deals:
        created = _parse(deal.get("created_at"))
        closed = _parse(deal.get("close_date"))
        if created and closed and closed >= created:
            days.append((closed - created).days)
    if not days:
        return None
    return round(sum(days) / len(days), 1)


def _segment_breakdown(won: list[dict], lost: list[dict]) -> dict:
    """Win rate per company industry, via each deal's contact → company
    join. Deals with no linked company/industry are grouped under
    'unknown' rather than silently dropped."""
    segments: dict[str, dict] = {}

    def _industry_for(deal: dict) -> str:
        contact = supabase.get_contact_by_id(deal.get("contact_id"))
        company = supabase.get_company_by_id((contact or {}).get("company_id"))
        return (company or {}).get("industry") or "unknown"

    for deal in won:
        seg = segments.setdefault(_industry_for(deal), {"won": 0, "lost": 0})
        seg["won"] += 1
    for deal in lost:
        seg = segments.setdefault(_industry_for(deal), {"won": 0, "lost": 0})
        seg["lost"] += 1

    breakdown = {}
    for industry, counts in segments.items():
        total = counts["won"] + counts["lost"]
        breakdown[industry] = {
            "won": counts["won"],
            "lost": counts["lost"],
            "win_rate": round(counts["won"] / total * 100, 1) if total else None,
        }
    return breakdown


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
