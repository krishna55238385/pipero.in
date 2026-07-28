"""Agent 44 — Referral (PDF Phase 7 — RETAIN & GROW).

"Turns happy customers into a consistent source of warm new business."

Runs on won deals with a confirmed/delivered onboarding_handoffs row (Agent
39's own output), used as the "clear success milestone" gate. One
referral_requests row is created per deal, the first time it clears the gate.

PDF rules and how each is actually handled:
- "Referral ask must only happen after a clear success milestone is
  achieved" — BUILT: same onboarding_handoffs status gate as Agent 43
  (delivered/confirmed only).
- "Must ask for a specific referral — not a general 'anyone you know'" —
  enforced in the prompt (REFERRAL_ASK_SYSTEM): the LLM must name a
  concrete target profile (target_description), never a generic ask.
- "Referral ask must be made to the Champion, not to procurement or
  finance" — BUILT structurally: always addressed to deal.contact_id, the
  same contact who bought originally, same pattern as Agent 43.
- "Must make it easy — provide a suggested introduction message they can
  forward" — BUILT: the LLM drafts a SECOND, separate piece of content
  (forwardable_intro_text) — a ready-to-forward message distinct from the
  ask itself.
- "Must never make a customer feel obligated or pressured to refer" —
  enforced in the prompt tone instructions.
- "Must follow up on referral status within 2 weeks if no introduction
  received" — NOT BUILT, documented honestly: this needs a way to know
  whether the champion actually responded/forwarded anything, which means
  tracking outcomes on a message this system currently only drafts (never
  sends or monitors replies to on its own). Out of scope for v1.
- "Must send a thank-you and update on outcome of every referral — close
  the loop" — NOT BUILT for the same reason: closing the loop requires
  knowing whether the referred lead actually converted, which needs an
  explicit link between a referral_requests row and whatever lead/deal
  eventually comes from it — that link doesn't exist yet.

Known scope limitation: one-shot per deal, same as Agents 42/43 — any
existing referral_requests row permanently skips future runs for that deal.

Draft-only, same human-review-first pattern as every other messaging agent
this session — nothing is sent automatically.
"""
import json
from datetime import datetime, timedelta, timezone

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import REFERRAL_ASK_SYSTEM

_ONBOARDED_STATUSES = {"delivered", "confirmed"}
_COOLDOWN_DAYS = 60


def run_referral(limit: int | None = None) -> dict:
    """Identify referral opportunities for won, onboarded, past-milestone
    accounts that haven't been asked yet."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 44 — Referral (limit={limit or 'all'})")
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
        f"  ✓ Agent 44 complete: {drafted} drafted · {held} held (too early) · "
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

    history = supabase.get_referral_history(deal_id)
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
        "what_was_promised": handoff.get("what_was_promised"),
        "success_criteria": handoff.get("success_criteria"),
        "days_since_onboarded": days_since,
        "seller_product_description": supabase.get_org_product_description(deal.get("organization_id")),
    }

    try:
        raw = llm.chat_json(
            REFERRAL_ASK_SYSTEM,
            _stringify(payload),
            agent="agent_44_referral",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 44] deal {deal_id} ({company_name}) → generation failed: {exc}")
        return {"status": "failed", "error": str(exc)}

    held_flag = bool(raw.get("held"))
    content_text = str(raw.get("content_text") or "").strip()
    forwardable_intro_text = str(raw.get("forwardable_intro_text") or "").strip()
    target_description = str(raw.get("target_description") or "").strip() or None

    if held_flag or not content_text or not forwardable_intro_text:
        reason = str(raw.get("held_reason") or "success not yet proven enough for an ask").strip()
        supabase.create_referral_request(
            deal_id=deal_id,
            contact_id=deal.get("contact_id"),
            company_name=company_name,
            target_description=target_description,
            status="held",
            held_reason=reason,
        )
        print(f"  [Agent 44] deal {deal_id} ({company_name}) → held: {reason}")
        return {"status": "held"}

    supabase.create_referral_request(
        deal_id=deal_id,
        contact_id=deal.get("contact_id"),
        company_name=company_name,
        target_description=target_description,
        content_text=content_text,
        forwardable_intro_text=forwardable_intro_text,
        status="draft",
    )
    print(f"  [Agent 44] deal {deal_id} ({company_name}) → drafted (target: {target_description})")
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
