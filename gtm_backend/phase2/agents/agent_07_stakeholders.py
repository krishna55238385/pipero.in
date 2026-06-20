"""Agent 07 — Stakeholder Mapping.

For each account that has an Account Intelligence brief (Agent 06 output),
identify every person involved in the buying decision and pick the best
entry-point contact. Persists:
    account_stakeholders   — one row per person
    stakeholder_maps       — one row per account (with entry point + status)

Business rules enforced (from architecture PDF):
- Must surface at least one of {Economic Buyer, Champion, Influencer}.
- Entry point recommendation is based on accessibility, not just seniority.
- A person who changed roles in the last 3 months is flagged as low confidence.
- Multi-threading status set to 'multi' when ≥3 stakeholders are present.
- Never selects the Blocker as the entry point.
"""
import json

from gtm_backend.phase2.connectors import openai as llm
from gtm_backend.phase2.connectors import serpapi
from gtm_backend.phase2.connectors import supabase
from gtm_backend.phase2.core.prompts import STAKEHOLDER_MAPPING_SYSTEM
from gtm_backend.phase2.core.schemas import Stakeholder, StakeholderMap


_MAX_LINKEDIN_SNIPPETS = 12


def map_stakeholders(icp_id: int | None = None, limit: int | None = None) -> dict:
    """Build stakeholder maps for accounts that already have a brief."""
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(f"  AGENT 07 — Stakeholder Mapping (ICP #{icp_id}, limit={limit_label})")
    print(bar)

    leads = supabase.get_leads_for_account_intel(icp_id=icp_id, limit=limit)
    print(f"  → {len(leads)} candidate accounts")

    icp_cache: dict[int, dict] = {}
    built = 0
    multi_threaded = 0
    coverage_incomplete = 0
    champion_budget_flags = 0
    for lead in leads:
        brief = supabase.get_account_brief(lead["id"])
        if not brief:
            print(f"  [Agent 07] {lead.get('company_name','?'):<28} → skipped (no brief)")
            continue
        icp = _get_icp(lead.get("icp_id"), icp_cache)
        smap = _build_one(lead, icp)
        if not smap:
            continue
        supabase.insert_stakeholders(smap.stakeholders)
        supabase.upsert_stakeholder_map(smap)
        built += 1
        if smap.multi_threading_status == "multi":
            multi_threaded += 1
        if smap.coverage_status == "incomplete":
            coverage_incomplete += 1
        if smap.champion_budget_flag:
            champion_budget_flags += 1
        if smap.coverage_status == "incomplete" or smap.champion_budget_flag:
            note = []
            if smap.missing_roles:
                note.append(f"missing={','.join(smap.missing_roles)}")
            if smap.champion_budget_flag:
                note.append("champion_no_budget")
            print(f"  [Agent 07] {smap.company_name:<28} → ⚠ {' · '.join(note)}")

    summary = {
        "icp_id": icp_id,
        "leads_examined": len(leads),
        "maps_built": built,
        "multi_threaded_accounts": multi_threaded,
        "coverage_incomplete": coverage_incomplete,
        "champion_budget_flags": champion_budget_flags,
    }
    print(
        f"  ✓ Agent 07 complete: {built} maps · "
        f"{multi_threaded} multi-threaded · {coverage_incomplete} incomplete coverage · "
        f"{champion_budget_flags} champion-budget flags"
    )
    return summary


def _build_one(lead: dict, icp: dict | None) -> StakeholderMap | None:
    company_name = lead.get("company_name") or "?"
    role_hints = _collect_role_hints(icp)
    try:
        snippets = serpapi.search_linkedin_people(
            company_name, role_keywords=role_hints, num=_MAX_LINKEDIN_SNIPPETS
        )
    except Exception as exc:
        print(f"  [Agent 07] linkedin search failed for {company_name}: {exc}")
        snippets = []

    if not snippets:
        print(f"  [Agent 07] {company_name:<28} → no linkedin snippets")
        return None

    compact = [{
        "title": s.get("title"),
        "link": s.get("link"),
        "snippet": s.get("snippet"),
    } for s in snippets[:_MAX_LINKEDIN_SNIPPETS]]
    payload = json.dumps({
        "company_name": company_name,
        "buyer_titles": (icp or {}).get("buyer_titles") or [],
        "user_titles": (icp or {}).get("user_titles") or [],
        "blocker_titles": (icp or {}).get("blocker_titles") or [],
        "linkedin_snippets": compact,
    })
    try:
        raw = llm.chat_json(
            STAKEHOLDER_MAPPING_SYSTEM,
            payload,
            agent="agent_07_stakeholders",
            icp_id=lead.get("icp_id"),
            phase="phase2",
        )
    except Exception as exc:
        print(f"  [Agent 07] {company_name:<28} → LLM error: {exc}")
        return None

    return _from_llm(lead, raw)


def _from_llm(lead: dict, raw: dict) -> StakeholderMap:
    raw_list = raw.get("stakeholders") if isinstance(raw.get("stakeholders"), list) else []
    stakeholders: list[Stakeholder] = []
    for idx, item in enumerate(raw_list):
        if not isinstance(item, dict):
            continue
        stakeholders.append(Stakeholder(
            lead_id=lead["id"],
            full_name=str(item.get("full_name") or "").strip() or f"Unknown {idx + 1}",
            job_title=item.get("job_title"),
            role_type=_normalise_role(item.get("role_type")),
            seniority=item.get("seniority"),
            function_area=item.get("function_area"),
            linkedin_url=item.get("linkedin_url") or None,
            email=None,
            email_confidence="unknown",
            confidence=str(item.get("confidence") or "low"),
            reports_to=(str(item.get("reports_to") or "").strip() or None),
            rank=int(item.get("rank") or (idx + 1)),
            risk_flags=_safe_str_list(item.get("risk_flags")),
        ))

    # Buying-committee coverage: the PDF requires at minimum an Economic Buyer,
    # a Champion, and one Influencer. Surface which of the three are missing.
    present_roles = {sh.role_type for sh in stakeholders}
    missing_roles = sorted(_REQUIRED_ROLES - present_roles)
    coverage_status = "complete" if not missing_roles else "incomplete"

    # Champion budget-authority check: if a Champion is present but none of the
    # champions has budget authority (C-suite/VP), flag it and annotate them.
    champion_budget_flag = _apply_champion_budget_flag(stakeholders)

    entry_full = (raw.get("entry_point_full_name") or "").strip() or None
    entry_role = _normalise_role(raw.get("entry_point_role_type"))
    if entry_role == "blocker":
        entry_full, entry_role = None, None

    status = "multi" if len(stakeholders) >= 3 else "single"

    return StakeholderMap(
        lead_id=lead["id"],
        icp_id=lead.get("icp_id"),
        company_name=lead["company_name"],
        company_domain=lead.get("company_domain"),
        stakeholders=stakeholders,
        entry_point_full_name=entry_full,
        entry_point_role_type=entry_role,
        multi_threading_status=status,
        coverage_status=coverage_status,
        missing_roles=missing_roles,
        champion_budget_flag=champion_budget_flag,
    )


# The three roles the PDF requires every buying-committee map to surface.
_REQUIRED_ROLES = {"economic_buyer", "champion", "influencer"}
# Seniorities that imply budget authority for the champion-budget check.
_BUDGET_AUTHORITY_SENIORITIES = {"c-suite", "vp"}


def _apply_champion_budget_flag(stakeholders: list[Stakeholder]) -> bool:
    """Flag (and annotate) when a Champion exists but lacks budget authority.

    Returns True when at least one champion is present and NONE of the champions
    has a budget-authority seniority (C-suite/VP). Each champion without budget
    authority gets a 'no_budget_authority' risk flag for the seller.
    """
    champions = [sh for sh in stakeholders if sh.role_type == "champion"]
    if not champions:
        return False
    any_has_authority = any(
        (sh.seniority or "").strip().lower() in _BUDGET_AUTHORITY_SENIORITIES
        for sh in champions
    )
    if any_has_authority:
        return False
    for sh in champions:
        if "no_budget_authority" not in sh.risk_flags:
            sh.risk_flags.append("no_budget_authority")
    return True


_VALID_ROLES = {"economic_buyer", "champion", "influencer", "blocker", "user", "unknown"}


def _normalise_role(value: object) -> str:
    raw = str(value or "").strip().lower().replace(" ", "_")
    return raw if raw in _VALID_ROLES else "unknown"


def _collect_role_hints(icp: dict | None) -> list[str]:
    if not icp:
        return ["CEO", "Founder", "Head", "VP", "Director"]
    hints: list[str] = []
    for key in ("buyer_titles", "user_titles", "blocker_titles"):
        hints.extend(icp.get(key) or [])
    return hints[:8] or ["CEO", "Founder", "Head", "VP", "Director"]


def _safe_str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v) for v in value if v]


def _get_icp(icp_id: int | None, cache: dict[int, dict]) -> dict | None:
    if icp_id is None:
        return None
    if icp_id in cache:
        return cache[icp_id]
    try:
        icp = supabase.get_icp(icp_id)
    except Exception:
        return None
    cache[icp_id] = icp
    return icp
