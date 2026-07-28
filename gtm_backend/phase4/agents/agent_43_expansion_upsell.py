"""Agent 43 — Expansion & Upsell (PDF Phase 7 — RETAIN & GROW).

"Identifies and pursues growth opportunities within existing accounts."

Runs on won deals that have a confirmed/delivered onboarding_handoffs row
(Agent 39's own output) — the PDF's own gate that expansion conversations
must only begin after successful onboarding. One expansion_opportunities row
is created per deal, the first time it clears the gate.

PDF rules and how each is actually handled:
- "Expansion conversations must only begin after client is successfully
  onboarded" — BUILT: reuses Agent 39's own onboarding_handoffs row and its
  status field as the gate (delivered/confirmed only — draft/held handoffs
  don't count as onboarded yet).
- "Minimum 60-day post-close period before any upsell conversation" — BUILT:
  measured from the handoff's created_at (the actual onboarding moment),
  falling back to the deal's close_date if no handoff timestamp is usable.
- "Expansion must be positioned as a client benefit — not a revenue target"
  — enforced in the prompt (EXPANSION_UPSELL_SYSTEM).
- "Must always go through the existing Champion first — not direct to a new
  department" — BUILT structurally: the message is always addressed to
  deal.contact_id, the same contact who bought originally. This agent never
  looks up or contacts anyone else at the account.
- "Must have evidence of value delivered before requesting expansion" —
  PARTIALLY BUILT, documented honestly: this codebase has no product-usage
  or analytics integration to verify ACTUAL delivered value. The LLM works
  from what was promised/success_criteria at handoff time (Agent 39's own
  fields) rather than verified usage data — a real "evidence of value"
  signal would need a product-telemetry integration this system doesn't have.
- "Expansion pipeline must be tracked separately from new business pipeline"
  — BUILT: expansion_opportunities is its own table, entirely separate from
  `deals`/pipeline_status.
- "Must never jeopardise the existing relationship by pushing expansion too
  aggressively" — enforced in the prompt: explicit instruction against
  pushy framing, plus a held=true escape hatch when evidence is thin.

Known scope limitation: one-shot per deal, like Agent 42 — any existing
expansion_opportunities row (regardless of outcome) permanently skips future
runs for that deal. A real system would likely re-check periodically as
account usage evolves; kept out of v1 for the same reason as Agent 42
(avoid re-running LLM calls against already-resolved accounts every day).

Draft-only, same human-review-first pattern as every other messaging agent
this session — content_text is never sent automatically.
"""
import json
from datetime import datetime, timedelta, timezone

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import EXPANSION_UPSELL_SYSTEM

_ONBOARDED_STATUSES = {"delivered", "confirmed"}
_COOLDOWN_DAYS = 60


def run_expansion_upsell(limit: int | None = None) -> dict:
    """Identify expansion opportunities for won, onboarded, past-cooldown
    accounts that haven't been checked yet."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 43 — Expansion & Upsell (limit={limit or 'all'})")
    print(bar)

    deals = supabase.get_won_deals_with_contacts(limit=limit)
    print(f"  → {len(deals)} won deal(s) with a contact on file")

    drafted = 0
    held = 0
    not_onboarded_yet = 0
    not_yet_eligible = 0
    already_checked = 0
    failed = 0

    for deal in deals:
        result = _process_deal(deal)
        status = result["status"]
        if status == "drafted":
            drafted += 1
        elif status == "held":
            held += 1
        elif status == "not_onboarded_yet":
            not_onboarded_yet += 1
        elif status == "not_yet_eligible":
            not_yet_eligible += 1
        elif status == "already_checked":
            already_checked += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 43 complete: {drafted} drafted · {held} held (thin evidence) · "
        f"{not_onboarded_yet} not onboarded yet · {not_yet_eligible} not past cooldown · "
        f"{already_checked} already checked · {failed} failed"
    )
    return {
        "deals_examined": len(deals),
        "drafted": drafted,
        "held": held,
        "not_onboarded_yet": not_onboarded_yet,
        "not_yet_eligible": not_yet_eligible,
        "already_checked": already_checked,
        "failed": failed,
    }


def _process_deal(deal: dict) -> dict:
    deal_id = deal.get("id")
    if deal_id is None:
        return {"status": "failed", "reason": "deal has no id"}

    history = supabase.get_expansion_history(deal_id)
    if history:
        return {"status": "already_checked"}

    handoff = supabase.get_handoff_for_deal(deal_id)
    if not handoff or (handoff.get("status") or "").lower() not in _ONBOARDED_STATUSES:
        return {"status": "not_onboarded_yet"}

    reference_date = _parse_dt(handoff.get("created_at")) or _parse_dt(deal.get("close_date"))
    if reference_date is None:
        return {"status": "not_onboarded_yet"}

    days_since = (datetime.now(timezone.utc) - reference_date).days
    if days_since < _COOLDOWN_DAYS:
        return {"status": "not_yet_eligible"}

    company_name = handoff.get("company_name") or deal.get("title") or "?"
    payload = {
        "company_name": company_name,
        "deal_value": deal.get("value"),
        "what_was_promised": handoff.get("what_was_promised"),
        "success_criteria": handoff.get("success_criteria"),
        "days_since_onboarded": days_since,
        "seller_product_description": supabase.get_org_product_description(deal.get("organization_id")),
    }

    try:
        raw = llm.chat_json(
            EXPANSION_UPSELL_SYSTEM,
            _stringify(payload),
            agent="agent_43_expansion_upsell",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 43] deal {deal_id} ({company_name}) → generation failed: {exc}")
        return {"status": "failed", "error": str(exc)}

    held_flag = bool(raw.get("held"))
    content_text = str(raw.get("content_text") or "").strip()
    opportunity_type = str(raw.get("opportunity_type") or "unclear").strip() or "unclear"

    if held_flag or not content_text:
        reason = str(raw.get("held_reason") or "not enough evidence of delivered value yet").strip()
        supabase.create_expansion_opportunity(
            deal_id=deal_id,
            contact_id=deal.get("contact_id"),
            company_name=company_name,
            opportunity_type=opportunity_type,
            status="held",
            held_reason=reason,
        )
        print(f"  [Agent 43] deal {deal_id} ({company_name}) → held: {reason}")
        return {"status": "held"}

    supabase.create_expansion_opportunity(
        deal_id=deal_id,
        contact_id=deal.get("contact_id"),
        company_name=company_name,
        opportunity_type=opportunity_type,
        content_text=content_text,
        status="draft",
    )
    print(f"  [Agent 43] deal {deal_id} ({company_name}) → drafted ({opportunity_type})")
    return {"status": "drafted"}


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
