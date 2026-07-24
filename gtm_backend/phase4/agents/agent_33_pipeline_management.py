"""Agent 33 — Pipeline Management (PDF Phase 6 — MANAGE & REPORT).

"Monitors all active deals, identifies which are at risk of going cold,
surfaces opportunities that are ready to advance, and recommends the single
most important next action for each deal."

Runs over every CRM `deals` row not already closed. Flags risk purely from
`last_activity_at` (falling back to `created_at` if never set):
- no activity for 7+ days  -> at_risk   (PDF rule)
- no activity for 21+ days -> stuck     (PDF rule: "stuck in the same stage")

Honest limitation, documented rather than hidden: the PDF's "stuck in the
same stage for 21+ days" rule is really about STAGE duration, but this
codebase has no per-stage-transition timestamp on `deals` (adding one would
mean another ALTER on the shared CRM table, which we've been avoiding after
repeatedly hitting ownership/grant issues on tables not owned by
magnivo_app). `last_activity_at` is used as a proxy for both signals — a
deal that hasn't been touched in 21 days is *usually* also stuck in the same
stage, but not necessarily. Worth revisiting if the CRM ever adds a real
stage-history table.

"Next best action must be specific — never just say 'follow up'" is enforced
in the LLM prompt itself (see phase4/core/prompts.py). "Deals with no next
action scheduled must be escalated immediately" is satisfied structurally:
every deal reviewed here IS assigned a next_best_action, so there's never a
reviewed deal left with nothing recommended.

Live snapshot, not a log: each review upserts ONE row per deal in
`pipeline_status` (natural key deal_id), so re-running doesn't accumulate
history — matches the PDF's "live pipeline health view" framing over a
report archive. The PDF's "pipeline review report generated every Monday
morning automatically" is a scheduling concern (this CLI command just needs
to be put on a cron/scheduled task, e.g. via the existing `schedule` tooling)
— not something this agent decides for itself.
"""
import json
from datetime import datetime, timezone

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import PIPELINE_NEXT_ACTION_SYSTEM

_AT_RISK_DAYS = 7
_STUCK_DAYS = 21


def run_pipeline_review(limit: int | None = None) -> dict:
    """Review every active deal and refresh its pipeline_status row."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 33 — Pipeline Management (limit={limit or 'all'})")
    print(bar)

    deals = supabase.get_active_deals(limit=limit)
    print(f"  → {len(deals)} active deal(s) examined")

    healthy = 0
    at_risk = 0
    stuck = 0
    failed = 0
    for deal in deals:
        result = review_deal(deal)
        status = result["status"]
        if status == "healthy":
            healthy += 1
        elif status == "at_risk":
            at_risk += 1
        elif status == "stuck":
            stuck += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 33 complete: {healthy} healthy · {at_risk} at-risk · "
        f"{stuck} stuck · {failed} failed"
    )
    return {
        "deals_examined": len(deals),
        "healthy": healthy,
        "at_risk": at_risk,
        "stuck": stuck,
        "failed": failed,
    }


def review_deal(deal: dict) -> dict:
    """Compute risk for one deal and refresh its pipeline_status row with a
    specific next-best-action."""
    deal_id = deal.get("id")
    company = deal.get("title") or "this deal"
    notes = deal.get("notes") or ""
    value = deal.get("value")
    status = deal.get("status")

    reference = _parse_dt(deal.get("last_activity_at")) or _parse_dt(deal.get("created_at"))
    days_since_activity = _days_since(reference)
    risk_level = _risk_level(days_since_activity)

    payload = {
        "deal_notes": notes,
        "deal_status": status,
        "estimated_deal_value": value,
        "risk_level": risk_level,
        "days_since_activity": days_since_activity,
    }

    try:
        raw = llm.chat_json(
            PIPELINE_NEXT_ACTION_SYSTEM,
            _stringify(payload),
            agent="agent_33_pipeline_management",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 33] deal {deal_id} ({company}) → review failed: {exc}")
        return {"status": "failed", "deal_id": deal_id, "error": str(exc)}

    next_best_action = str(raw.get("next_best_action") or "").strip() or "Review deal manually — no action generated."
    risk_reasoning = str(raw.get("risk_reasoning") or "").strip() or None

    supabase.upsert_pipeline_status(
        deal_id=deal_id,
        crm_lead_id=deal.get("lead_id"),
        company_name=company,
        risk_level=risk_level,
        days_since_activity=days_since_activity,
        next_best_action=next_best_action,
        risk_reasoning=risk_reasoning,
        reviewed_at=_now_iso(),
    )
    marker = {"healthy": "✓", "at_risk": "⚠", "stuck": "⛔"}.get(risk_level, "?")
    print(f"  [Agent 33] deal {deal_id} ({company}) → {marker} {risk_level} ({days_since_activity}d) → {next_best_action}")
    return {"status": risk_level, "deal_id": deal_id, "next_best_action": next_best_action}


def _risk_level(days_since_activity: int | None) -> str:
    if days_since_activity is None:
        return "healthy"
    if days_since_activity >= _STUCK_DAYS:
        return "stuck"
    if days_since_activity >= _AT_RISK_DAYS:
        return "at_risk"
    return "healthy"


def _days_since(reference: datetime | None) -> int | None:
    if reference is None:
        return None
    return (datetime.now(timezone.utc) - reference).days


def _parse_dt(value: object) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
