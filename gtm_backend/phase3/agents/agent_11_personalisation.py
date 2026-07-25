"""Agent 11 — Personalisation.

For every qualified lead with phase 1+2 intel, generate 2–3 verifiable
personalisation angles a seller can open with. Upserts into the
outreach_personalisations table.

Business rules (from AI-GTM-Agency-Business-Architecture-A4.pdf):
- Angles must cite evidence pulled from the GTM insight or account brief —
  never fabricate.
- A lead with neither a gtm_insight nor an account_intel row AND no usable
  angles is held with reason="insufficient data".
- quality_score < 50 → status="low_quality" (still written, downstream
  agents can choose to skip).
- An LLM error degrades to status="held" with the error in held_reason so
  the lead is never silently dropped.
"""
import json

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.prompts import PERSONALISATION_SYSTEM
from gtm_backend.phase3.core.schemas import PersonalisationAngle, PersonalisationResult


_MIN_QUALITY_SCORE = 50


def run_personalisation(icp_id: int | None = None, limit: int | None = None) -> dict:
    """Generate personalisation angles for each qualified lead."""
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(f"  AGENT 11 — Personalisation (ICP #{icp_id}, limit={limit_label})")
    print(bar)

    leads = supabase.get_leads_for_personalisation(icp_id=icp_id, limit=limit)
    print(f"  → {len(leads)} candidate leads")

    written = 0
    held = 0
    low_quality = 0
    for lead in leads:
        result = _build_one(lead)
        if result is None:
            continue
        supabase.upsert_personalisation(result)
        written += 1
        if result.status == "held":
            held += 1
        elif result.status == "low_quality":
            low_quality += 1
        company = result.company_name or "?"
        print(
            f"  [Agent 11] {company:<28} → {len(result.angles)} angles, "
            f"quality={result.quality_score}/100, status={result.status}"
        )

    summary = {
        "icp_id": icp_id,
        "leads_examined": len(leads),
        "personalisations_written": written,
        "held": held,
        "low_quality": low_quality,
    }
    print(
        f"  ✓ Agent 11 complete: {written} written · "
        f"{held} held · {low_quality} low_quality"
    )
    return summary


def _build_one(lead: dict) -> PersonalisationResult | None:
    """Compose one PersonalisationResult for a lead, or None when unworkable."""
    company_name = lead.get("company_name") or ""
    domain = lead.get("company_domain")
    if not company_name or not domain:
        display = company_name or "?"
        print(f"  [Agent 11] {display:<28} → skipped (missing company_name or domain)")
        return None

    gtm_insight = lead.get("_gtm_insight")
    account_intel = lead.get("_account_intel")

    payload = json.dumps(
        {
            "company_name": company_name,
            "company_domain": domain,
            "contact_name": lead.get("contact_name"),
            "contact_title": lead.get("contact_title"),
            "gtm_insight": gtm_insight or {},
            "account_intel": account_intel or {},
            "buying_signals": [],
            "seller_product_description": supabase.get_current_org_product_description(),
        },
        default=str,
    )

    try:
        raw = llm.chat_json(
            PERSONALISATION_SYSTEM,
            payload,
            agent="agent_11_personalisation",
            icp_id=lead.get("icp_id"),
            phase="phase3",
        )
    except Exception as exc:
        return PersonalisationResult(
            lead_id=lead["id"],
            icp_id=lead.get("icp_id"),
            company_name=company_name,
            contact_name=lead.get("contact_name"),
            contact_title=lead.get("contact_title"),
            angles=[],
            quality_score=0,
            status="held",
            held_reason=f"llm_error: {exc}",
        )

    angles = _parse_angles(raw.get("angles"))
    quality_score = _coerce_int(raw.get("quality_score"), default=0)
    status = str(raw.get("status") or "ready").strip().lower() or "ready"
    held_reason = raw.get("held_reason") or None

    if not gtm_insight and not account_intel and not angles:
        status = "held"
        held_reason = "insufficient data"
    elif status != "held" and not angles:
        # A personalisation with zero angles is not actionable — never let it
        # pass as "ready" (Agent 12 would copywrite with nothing to lead with).
        status = "low_quality"
        held_reason = held_reason or "no usable angles produced"
    elif status != "held" and quality_score < _MIN_QUALITY_SCORE:
        status = "low_quality"

    return PersonalisationResult(
        lead_id=lead["id"],
        icp_id=lead.get("icp_id"),
        company_name=company_name,
        contact_name=lead.get("contact_name"),
        contact_title=lead.get("contact_title"),
        angles=angles,
        quality_score=quality_score,
        status=status,
        held_reason=held_reason,
    )


def _parse_angles(value: object) -> list[PersonalisationAngle]:
    """Validate each angle dict; drop entries that fail Pydantic."""
    if not isinstance(value, list):
        return []
    angles: list[PersonalisationAngle] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            angles.append(PersonalisationAngle.model_validate(item))
        except Exception:
            continue
    return angles


def _coerce_int(value: object, default: int) -> int:
    """Best-effort int coercion that tolerates LLM string outputs."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
