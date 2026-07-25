"""Agent 12 — Outreach Copywriter.

For each `ready` personalisation row, draft a complete 5-step outreach
sequence (intro + 3 follow-ups + breakup) with 2 subject variants per step
for downstream A/B testing. Upserts into the outreach_sequences table.

Business rules (from AI-GTM-Agency-Business-Architecture-A4.pdf):
- Only `status="ready"` personalisations are turned into copy — held and
  low-quality rows are skipped to avoid burning LLM cost on thin data.
- Step order is fixed: intro → follow_up × 3 → breakup.
- Each step has exactly 2 distinct variants for A/B testing.
- A deterministic post-LLM rubric computes `sequence_quality_score` so
  Agent 14 (orchestrator) can refuse to send malformed copy.
"""
import json

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.prompts import COPYWRITER_SYSTEM
from gtm_backend.phase3.core.schemas import OutreachSequence, SequenceStep


_EXPECTED_STEP_TYPES = ["intro", "follow_up", "follow_up", "follow_up", "breakup"]
_REQUIRED_STEP_COUNT = 5
_REQUIRED_VARIANTS_PER_STEP = 2
_MAX_CTA_LENGTH = 300
_READY_STATUS = "ready"


def run_copywriting(icp_id: int | None = None, limit: int | None = None) -> dict:
    """Generate a 5-step outreach sequence for each ready personalisation."""
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(f"  AGENT 12 — Outreach Copywriter (ICP #{icp_id}, limit={limit_label})")
    print(bar)

    personalisations = supabase.get_personalisations(icp_id=icp_id, limit=limit)
    ready = [row for row in personalisations if row.get("status") == _READY_STATUS]
    skipped = len(personalisations) - len(ready)
    print(
        f"  → {len(ready)} ready personalisations "
        f"({skipped} skipped: held/low_quality/other)"
    )

    written = 0
    for row in ready:
        seq = _build_one(row)
        if seq is None:
            continue
        supabase.upsert_sequence(seq)
        written += 1
        company = seq.company_name or "?"
        print(
            f"  [Agent 12] {company:<28} → {len(seq.steps)} steps, "
            f"quality={seq.sequence_quality_score}/100"
        )

    summary = {
        "icp_id": icp_id,
        "personalisations_examined": len(personalisations),
        "ready_inputs": len(ready),
        "sequences_written": written,
    }
    print(f"  ✓ Agent 12 complete: {written} sequences written")
    return summary


def _build_one(row: dict) -> OutreachSequence | None:
    """Turn one personalisation row into a validated OutreachSequence."""
    company_name = row.get("company_name") or "?"
    contact_title = row.get("contact_title")
    persona_hint = _derive_persona(contact_title)

    payload = json.dumps(
        {
            "company_name": company_name,
            "contact_name": row.get("contact_name"),
            "contact_title": contact_title,
            "persona": persona_hint,
            "angles": row.get("angles") or [],
            "seller_product_description": supabase.get_current_org_product_description(),
            "instructions": (
                "Write the 5-step sequence in the FIXED order intro → follow_up × 3 "
                "→ breakup, with EXACTLY 2 distinct subject variants per step. "
                "Each variant is {subject, body}."
            ),
        },
        default=str,
    )

    try:
        raw = llm.chat_json(
            COPYWRITER_SYSTEM,
            payload,
            agent="agent_12_copywriter",
            icp_id=row.get("icp_id"),
            phase="phase3",
        )
    except Exception as exc:
        print(f"  [Agent 12] {company_name:<28} → LLM error: {exc}")
        return None

    steps = _parse_steps(raw.get("steps"))
    seq = OutreachSequence(
        lead_id=row["lead_id"],
        icp_id=row.get("icp_id"),
        company_name=company_name,
        contact_name=row.get("contact_name"),
        persona=str(raw.get("persona") or persona_hint or "unknown"),
        cta=str(raw.get("cta") or ""),
        steps=steps,
    )
    seq.sequence_quality_score = _score_sequence(seq)
    return seq


def _derive_persona(title: str | None) -> str:
    """Map a contact title to CEO|engineer|HR|sales|other (unknown if empty)."""
    if not title:
        return "unknown"
    lowered = title.lower()
    if "ceo" in lowered or "founder" in lowered:
        return "CEO"
    if "cto" in lowered or "engineer" in lowered:
        return "engineer"
    if "hr" in lowered or "people" in lowered:
        return "HR"
    if "sales" in lowered:
        return "sales"
    return "other"


def _parse_steps(value: object) -> list[SequenceStep]:
    """Validate each step dict; drop entries that fail Pydantic."""
    if not isinstance(value, list):
        return []
    steps: list[SequenceStep] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            steps.append(SequenceStep.model_validate(item))
        except Exception:
            continue
    return steps


def _score_sequence(seq: OutreachSequence) -> int:
    """Deterministic 0–100 rubric: shape, completeness, CTA cleanliness."""
    score = 0
    if len(seq.steps) == _REQUIRED_STEP_COUNT:
        score += 20
    actual_step_types = [step.step_type for step in seq.steps]
    if actual_step_types == _EXPECTED_STEP_TYPES:
        score += 20
    if seq.steps and all(len(step.variants) == _REQUIRED_VARIANTS_PER_STEP for step in seq.steps):
        score += 20
    if seq.steps and all(
        all((variant.subject or "").strip() and (variant.body or "").strip() for variant in step.variants)
        for step in seq.steps
    ):
        score += 20
    cta = (seq.cta or "").strip()
    if cta and len(cta) < _MAX_CTA_LENGTH:
        score += 20
    return score
