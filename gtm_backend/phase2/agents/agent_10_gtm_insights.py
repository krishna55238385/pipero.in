"""Agent 10 — GTM Insight Generator.

Cross-agent synthesizer. For each lead that has an account_intelligence
brief (Agent 06) and a stakeholder map (Agent 07), gather competitor cards
(Agent 08) and market segment info (Agent 09), then produce a single
actionable GTM brief per account.

Business rules enforced (from architecture PDF):
- Runs after intelligence agents have completed.
- Recommendations must be account-specific and actionable.
- Contradictions across inputs land in flags_and_contradictions.
- Plain business language, no jargon.
- Output is the strategic north star for outreach agents (phase 3).
"""
import json
import re
from datetime import date

from gtm_backend.phase2.connectors import openai as llm
from gtm_backend.phase2.connectors import supabase
from gtm_backend.phase2.core.prompts import GTM_INSIGHT_SYSTEM
from gtm_backend.phase2.core.schemas import (
    GTMChannelPlan,
    GTMInsight,
    GTMMessage,
    GTMTargeting,
)


def generate_insights(icp_id: int | None = None, limit: int | None = None) -> dict:
    """Synthesise per-lead GTM briefs."""
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(f"  AGENT 10 — GTM Insight Generator (ICP #{icp_id}, limit={limit_label})")
    print(bar)

    leads = supabase.get_leads_for_account_intel(icp_id=icp_id, limit=limit)
    print(f"  → {len(leads)} candidate accounts")

    insights_written = 0
    contradictions_flagged = 0
    today = date.today().isoformat()
    week_of = _week_of_monday()

    for lead in leads:
        brief = supabase.get_account_brief(lead["id"])
        if not brief:
            print(
                f"  [Agent 10] {lead.get('company_name','?'):<28} → skipped (no account brief)"
            )
            continue
        stakeholders = supabase.get_stakeholders_for_lead(lead["id"])
        stakeholder_map = supabase.get_stakeholder_map_for_lead(lead["id"])
        competitors = supabase.get_competitors_for_icp(lead.get("icp_id") or 0) if lead.get("icp_id") else []
        market_rows = supabase.get_market_segments(week_of=week_of, icp_id=lead.get("icp_id"))
        market_row = market_rows[0] if market_rows else None

        insight = _build_one(
            lead=lead,
            brief=brief,
            stakeholders=stakeholders,
            stakeholder_map=stakeholder_map,
            competitors=competitors,
            market_row=market_row,
            brief_date=today,
        )
        if not insight:
            continue
        supabase.upsert_gtm_insight(insight)
        insights_written += 1
        if insight.flags_and_contradictions:
            contradictions_flagged += 1

    summary = {
        "icp_id": icp_id,
        "leads_examined": len(leads),
        "insights_written": insights_written,
        "contradictions_flagged": contradictions_flagged,
        # Every new brief lands as pending_review — none is active until a human
        # approves it (run `python -m phase2 approve-insights`).
        "pending_review": insights_written,
    }
    print(
        f"  ✓ Agent 10 complete: {insights_written} GTM briefs (pending human review) · "
        f"{contradictions_flagged} flagged contradictions"
    )
    if insights_written:
        print(
            "  ⓘ Briefs are pending_review — approve before outreach: "
            "python -m phase2 approve-insights --lead <id>  (or --all)"
        )
    return summary


def _build_one(
    lead: dict,
    brief: dict,
    stakeholders: list[dict],
    stakeholder_map: dict | None,
    competitors: list[dict],
    market_row: dict | None,
    brief_date: str,
) -> GTMInsight | None:
    company_name = lead.get("company_name") or brief.get("company_name") or "?"
    payload = json.dumps({
        "company_name": company_name,
        "company_domain": lead.get("company_domain") or brief.get("company_domain"),
        "account_intelligence": _trim_brief(brief),
        "stakeholder_map": _trim_stakeholder_map(stakeholder_map, stakeholders),
        "competitive_intel": _trim_competitors(competitors),
        "market_sizing": _trim_market_row(market_row),
    }, default=str)

    try:
        raw = llm.chat_json(
            GTM_INSIGHT_SYSTEM,
            payload,
            agent="agent_10_gtm_insights",
            icp_id=lead.get("icp_id"),
            phase="phase2",
        )
    except Exception as exc:
        print(f"  [Agent 10] {company_name:<28} → LLM error: {exc}")
        return None

    # Guard against the LLM emitting a non-dict (e.g. a string or null) for any
    # of these nested objects — `.get()` on a str would crash. `or {}` alone is
    # not enough because a truthy non-dict (e.g. "N/A") slips through.
    targeting = raw.get("who_to_target") if isinstance(raw.get("who_to_target"), dict) else {}
    message = raw.get("what_to_say") if isinstance(raw.get("what_to_say"), dict) else {}
    channel = raw.get("which_channel") if isinstance(raw.get("which_channel"), dict) else {}

    # Defense in depth against the LLM inventing a plausible-sounding name
    # despite the prompt's explicit rule against it (found live 2026-08-22:
    # "Ankita Sharma, Chief Compliance Officer" appeared as a next-action
    # target for a lead whose stakeholder phase had never even run — no such
    # name existed anywhere in the input data). A prompt instruction alone
    # isn't reliable enough for something this consequential (a fabricated
    # name presented as a real researched contact), so it's re-validated
    # here against the actual verified stakeholder names this call was given
    # — the one source of truth, not the LLM's own output.
    known_names = _known_stakeholder_names(stakeholder_map, stakeholders)
    entry_point_name = _verified_name_or_blank(targeting.get("entry_point_name"), known_names)
    secondary_contacts = _drop_unverified_names(
        _safe_str_list(targeting.get("secondary_contacts")), known_names
    )
    next_actions = _drop_unverified_names(_safe_str_list(raw.get("next_actions")), known_names)

    insight = GTMInsight(
        lead_id=lead["id"],
        icp_id=lead.get("icp_id"),
        company_name=company_name,
        brief_date=brief_date,
        executive_summary=str(raw.get("executive_summary") or ""),
        who_to_target=GTMTargeting(
            segment=targeting.get("segment"),
            priority_rank=_clamp_rank(targeting.get("priority_rank")),
            entry_point_name=entry_point_name,
            entry_point_role=targeting.get("entry_point_role"),
            secondary_contacts=secondary_contacts,
        ),
        what_to_say=GTMMessage(
            core_message=str(message.get("core_message") or ""),
            unique_value_proposition=str(message.get("unique_value_proposition") or ""),
            pain_points_to_address=_safe_str_list(message.get("pain_points_to_address")),
            competitive_angle=str(message.get("competitive_angle") or ""),
        ),
        which_channel=GTMChannelPlan(
            primary_channel=_normalise_channel(channel.get("primary_channel")),
            sequence=_safe_str_list(channel.get("sequence")),
            cadence=str(channel.get("cadence") or ""),
        ),
        why_market_rationale=str(raw.get("why_market_rationale") or ""),
        why_account_rationale=str(raw.get("why_account_rationale") or ""),
        urgency_signal=str(raw.get("urgency_signal") or ""),
        flags_and_contradictions=_safe_str_list(raw.get("flags_and_contradictions")),
        next_actions=next_actions,
    )

    print(
        f"  [Agent 10] {company_name:<28} → "
        f"channel={insight.which_channel.primary_channel} · "
        f"actions={len(insight.next_actions)} · "
        f"flags={len(insight.flags_and_contradictions)}"
    )
    return insight


def _trim_brief(brief: dict) -> dict:
    keys = (
        "what_they_do", "business_model", "company_size_estimate",
        "growth_trajectory", "competitive_position", "recent_moves",
        "likely_pain_points", "instability_flags", "confirmed_facts",
        "key_signals_for_outreach", "brief_quality_score",
    )
    return {k: brief.get(k) for k in keys}


def _trim_stakeholder_map(
    smap: dict | None, stakeholders: list[dict],
) -> dict:
    return {
        "entry_point_full_name": (smap or {}).get("entry_point_full_name"),
        "entry_point_role_type": (smap or {}).get("entry_point_role_type"),
        "multi_threading_status": (smap or {}).get("multi_threading_status"),
        "stakeholders": [
            {
                "full_name": s.get("full_name"),
                "job_title": s.get("job_title"),
                "role_type": s.get("role_type"),
                "seniority": s.get("seniority"),
                "confidence": s.get("confidence"),
            }
            for s in stakeholders[:8]
        ],
    }


def _trim_competitors(competitors: list[dict]) -> list[dict]:
    return [
        {
            "competitor_name": c.get("competitor_name"),
            "summary": c.get("summary"),
            "biggest_weakness": c.get("biggest_weakness"),
            "talk_tracks": c.get("talk_tracks"),
            "threat_level": c.get("threat_level"),
        }
        for c in competitors[:5]
    ]


def _trim_market_row(row: dict | None) -> dict:
    if not row:
        return {}
    return {
        "segment_name": row.get("segment_name"),
        "tam_estimate": row.get("tam_estimate"),
        "sam_estimate": row.get("sam_estimate"),
        "som_this_month": row.get("som_this_month"),
        "competition_density": row.get("competition_density"),
        "seasonal_fit": row.get("seasonal_fit"),
        "priority_rank": row.get("priority_rank"),
        "priority_rationale": row.get("priority_rationale"),
    }


def _known_stakeholder_names(stakeholder_map: dict | None, stakeholders: list[dict]) -> set[str]:
    """Every real, verified name available to this call — the entry-point
    name on the stakeholder map (if set) plus every stakeholder's full_name.
    Lowercased/stripped for case-insensitive comparison. Empty set means
    genuinely no verified names exist (Agent 07 hasn't run for this lead, or
    ran and found nobody) — the caller's job is to make sure nothing gets
    attributed to a person in that case."""
    names: set[str] = set()
    if stakeholder_map:
        name = stakeholder_map.get("entry_point_full_name")
        if name:
            names.add(str(name).strip().lower())
    for s in stakeholders:
        name = s.get("full_name") if isinstance(s, dict) else None
        if name:
            names.add(str(name).strip().lower())
    return names


def _verified_name_or_blank(name: object, known_names: set[str]) -> str | None:
    """The LLM's claimed entry_point_name, kept only if it matches a real
    verified stakeholder name — otherwise blanked rather than trusted, since
    an unverifiable name is indistinguishable from a fabricated one and
    presenting it as a real contact is the actual harm (see this function's
    caller docstring for the live incident that prompted this check)."""
    if not name:
        return None
    if str(name).strip().lower() in known_names:
        return str(name)
    return ""


def _drop_unverified_names(items: list[str], known_names: set[str]) -> list[str]:
    """Drop any string that names a specific person not in known_names.

    Deliberately narrow: only filters an item when it contains one of the
    KNOWN-to-be-wrong signals (a capitalized two-or-three-word sequence that
    looks like a person's name) AND that name isn't verified — a generic
    action like "Research and confirm the decision maker's email" is left
    untouched, since it doesn't claim a specific unverified person exists.
    Not a perfect NLP name-detector (that's real scope creep for what's
    meant to be a safety net, not the primary defense — the prompt rule is
    the primary defense), but catches the exact failure shape seen live:
    a specific "First Last" name attached to a next action/contact list
    when no such name was ever actually verified.
    """
    if not items:
        return items
    out: list[str] = []
    for item in items:
        candidate_names = [
            n for n in re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+\b", item)
            # Exclude common job-title words so a title-only phrase like
            # "Chief Compliance Officer" or "Head of Product" isn't
            # mistaken for a person's name — this heuristic is only meant
            # to catch a "First Last" shaped name, not every two-capitalized-
            # words phrase (titles are exactly the kind of legitimate,
            # non-person phrase that would otherwise false-positive here).
            if not _TITLE_WORDS & set(n.lower().split())
        ]
        if any(name.strip().lower() not in known_names for name in candidate_names):
            continue
        out.append(item)
    return out


_TITLE_WORDS = {
    "chief", "head", "director", "manager", "officer", "senior", "executive",
    "vice", "president", "founder", "co-founder", "lead", "global", "regional",
    "compliance", "product", "engineering", "operations", "sales", "marketing",
    "finance", "hr", "technology", "growth", "revenue", "partnerships",
}


def _safe_str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item]


def _clamp_rank(value: object) -> int:
    try:
        rank = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 3
    return max(1, min(3, rank))


_VALID_CHANNELS = {"email", "linkedin", "phone", "event"}


def _normalise_channel(value: object) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in _VALID_CHANNELS else "email"


def approve_insights(
    lead_id: int | None = None,
    icp_id: int | None = None,
    reviewed_by: str = "human",
) -> dict:
    """Human-review gate: approve GTM briefs so they become the active strategy.

    - lead_id set → approve that lead's brief(s).
    - lead_id None → approve every brief still pending_review (optionally scoped
      to one ICP).
    """
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 10 — Approve GTM briefs (lead={lead_id}, icp={icp_id}, by={reviewed_by})")
    print(bar)

    if lead_id is not None:
        updated = supabase.approve_gtm_insight(lead_id, reviewed_by=reviewed_by)
        print(f"  ✓ Approved {updated} brief(s) for lead {lead_id}")
        return {"approved": updated, "lead_id": lead_id}

    pending = supabase.get_pending_gtm_insights(icp_id=icp_id)
    approved = 0
    for row in pending:
        lid = row.get("lead_id")
        if lid is None:
            continue
        approved += supabase.approve_gtm_insight(
            lid, brief_date=row.get("brief_date"), reviewed_by=reviewed_by,
        )
        print(f"  ✓ Approved {row.get('company_name','?')} (lead {lid})")
    print(f"  ✓ Agent 10 review complete: {approved} brief(s) approved")
    return {"approved": approved, "pending_examined": len(pending)}


def _week_of_monday() -> str:
    from datetime import timedelta
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat()
