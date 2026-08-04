"""Agent 03 — ICP Scoring.

Combines firmographic fit (max 70) and aggregate buying-signal score (max 30,
with freshness decay) into a final 0-100 score and a tier.
Also calls an LLM to produce a rich ICP fit score alongside the deterministic one.

Renamed from agent_05_scoring.py -> agent_03_icp_scoring.py: the PDF
architecture spec defines Agent 03 as ICP Scoring and Agent 05 as the
Lookalike Finder Agent (not yet built) — this file had drifted to the wrong
number. No functional change, filename/number only. See
lead_enrichment.py's docstring for the other half of this fix.
"""
import json

from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.connectors import openai as llm
from gtm_backend.phase1.core.prompts import ICP_SCORING_SYSTEM
from gtm_backend.phase1.core.scoring import score_lead, tier_for


def _llm_score(
    lead: dict,
    icp: dict,
    signals: list[dict],
    deterministic_score: int,
) -> dict:
    """Call the LLM to produce a rich ICP fit score. Falls back gracefully on any error."""
    try:
        # Keep only key lead fields — skip raw_data, sources, etc.
        LEAD_KEEP = {
            "company_name", "company_country", "company_city", "company_state",
            "company_industry", "company_size", "contact_title", "icp_id",
        }
        lead_payload = {k: v for k, v in lead.items() if k in LEAD_KEEP and v is not None}

        # Compact signal summary — drop full signal_text to save tokens
        high = [s.get("signal_type") for s in signals if s.get("buying_intent") == "high"]
        low  = [s.get("signal_type") for s in signals if s.get("buying_intent") == "low"]
        signal_payload = {
            "total": len(signals),
            "high_intent": high,
            "low_intent": low,
        }
        payload = {
            "icp": {k: icp.get(k) for k in (
                "name", "industry", "geography", "company_size_min", "company_size_max",
                "business_stage", "buyer_titles"
            )},
            "lead": lead_payload,
            "signals": signal_payload,
            "deterministic_score": deterministic_score,
        }
        return llm.chat_json(
            ICP_SCORING_SYSTEM,
            json.dumps(payload),
            agent="agent_03_icp_scoring",
            icp_id=lead.get("icp_id"),
            phase="phase1",
        )
    except Exception:
        return {
            "llm_icp_score": deterministic_score,
            "llm_score_tier": tier_for(deterministic_score),
            "llm_reasoning": "LLM scoring unavailable",
            "buying_intent_summary": "",
        }


def score_leads(
    mode: str = "unscored",
    lead_id: int | None = None,
    icp_id: int | None = None,
    limit: int = 500,
) -> dict:
    """Score leads in batches. Reads signals from buying_signals table."""
    bar = "\u2550" * 72
    print(f"\n{bar}")
    print(f"  AGENT 03 \u2014 ICP Scoring (mode={mode}, icp_id={icp_id})")
    print(bar)

    icps = supabase.get_active_icps()
    if not icps:
        raise RuntimeError("No active ICPs found. Run Agent 01 first.")
    icp_by_id = {icp["id"]: icp for icp in icps}

    leads = supabase.get_leads_for_scoring(mode=mode, lead_id=lead_id, icp_id=icp_id, limit=limit)
    if not leads:
        print("  [Agent 03] no leads to score")
        return {"total_scored": 0, "hot": 0, "warm": 0, "cold": 0, "disqualified": 0}

    print(f"  \u2192 {len(leads)} leads to score")
    signals_by_lead = supabase.get_signals_for_leads([lead["id"] for lead in leads])

    counts = {"hot": 0, "warm": 0, "cold": 0, "disqualified": 0}
    llm_results = []
    for lead in leads:
        icp = icp_by_id.get(lead.get("icp_id"))
        signals = signals_by_lead.get(lead["id"], [])
        result = score_lead(lead, icp, signals)
        # Compute the LLM re-score BEFORE persisting so the lead's final,
        # stored icp_score/score_tier reflect the LLM's judgment (which can
        # correctly downgrade a lead the deterministic rules alone would
        # over-score — e.g. a geography/industry mismatch) rather than the
        # raw rule score. See update_lead_score's docstring for why this
        # previously never made it to the database at all.
        llm_result = _llm_score(lead, icp or {}, signals, result.icp_score)
        supabase.update_lead_score(result, llm_result)
        final_tier = llm_result.get("llm_score_tier") or result.score_tier
        if final_tier not in counts:
            # Freeform LLM JSON occasionally returns an unexpected tier
            # string — fall back to the rule tier rather than raising or
            # silently dropping this lead from the summary counts.
            final_tier = result.score_tier
        counts[final_tier] = counts.get(final_tier, 0) + 1

        llm_results.append((lead, result, llm_result))

    divider = "\u2500" * 72
    print(f"\n  \u2500\u2500 FINAL SCORES " + "\u2500" * 56)
    for lead, result, llm_result in llm_results:
        company = lead.get("company_name", "unknown")
        print(f"  Company     : {company}")
        print(f"  Rule score  : {result.icp_score}/100 ({result.score_tier.upper()})")
        print(f"  LLM score   : {llm_result['llm_icp_score']}/100 ({llm_result['llm_score_tier'].upper()})")
        print(f"  LLM reasoning: {llm_result['llm_reasoning']}")
        print(f"  Buying intent: {llm_result['buying_intent_summary']}")
        print(f"  {divider}")

    summary = {"total_scored": len(leads), **counts}
    print(
        f"  \u2713 Agent 03 complete: {len(leads)} scored \u00b7 "
        f"{counts['hot']} hot \u00b7 {counts['warm']} warm \u00b7 "
        f"{counts['cold']} cold \u00b7 {counts['disqualified']} disqualified"
    )
    return summary
