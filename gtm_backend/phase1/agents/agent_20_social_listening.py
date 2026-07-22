"""Agent 20 — Social Listening (PDF Phase 4 — ENGAGE).

"Catches leads who are publicly signalling they need what you offer."

Unlike Agent 04 (which investigates already-known leads for buying signals),
this agent discovers NEW candidates: it searches public forums/news for
people or companies describing a live pain point that matches an ICP, then
asks the LLM to judge whether each result is a genuine signal.

Every result is written to social_listening_leads as a human-review
candidate (status='candidate') — NEVER auto-inserted into leads_raw. This
mirrors the "no blind automation on unverified data" lesson learned from
Agent 02's company-name bugs earlier: LLM-derived candidates need a person to
confirm before they enter the real pipeline, especially since a search
snippet is much noisier evidence than a company's own indexed listing.

LLM contract (two calls per ICP):
  1. query generation:  {"industry", "pain_points", "geography", "buyer_titles"}
                         -> {"queries": [{"q", "pain_point_focus"}, ...]}
  2. batch classification: {"icp_summary", "candidates": [{"id","text","source"}]}
                         -> {"results": [{"id","is_signal","candidate_company",
                                          "candidate_person","candidate_title",
                                          "matched_pain_point","confidence"}, ...]}
"""
import json

from gtm_backend.phase1.connectors import openai as llm
from gtm_backend.phase1.connectors import serpapi
from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.core.prompts import (
    SOCIAL_LISTENING_CLASSIFICATION_SYSTEM,
    SOCIAL_LISTENING_QUERY_GENERATION_SYSTEM,
)
from gtm_backend.phase1.core.schemas import SocialListeningLead

_MAX_QUERIES_PER_ICP = 7
_MAX_CANDIDATES_PER_ICP = 30
_RESULTS_PER_QUERY = 5
_MIN_CONFIDENCE_TO_KEEP = {"high", "medium", "low"}  # keep all; UI can filter by confidence


def run_social_listening(icp_id: int | None = None, limit: int | None = None) -> dict:
    """Discover and persist social-listening candidates.

    When icp_id is given, scans only that ICP. When None, scans every active
    ICP (up to `limit` of them, if given). Idempotent by (icp_id, source_url):
    a post already captured for this ICP is never re-fetched or duplicated.
    """
    icps = [supabase.get_icp(icp_id)] if icp_id is not None else supabase.get_active_icps()
    if limit is not None:
        icps = icps[:limit]

    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 20 — Social Listening ({len(icps)} ICP(s))")
    print(bar)

    total_candidates = 0
    total_signals = 0
    total_inserted = 0
    for icp in icps:
        candidates = _gather_candidates(icp)
        total_candidates += len(candidates)
        if not candidates:
            print(f"  [Agent 20] {icp.get('name', '?'):<28} → 0 candidates found")
            continue

        signals = _classify_candidates(icp, candidates)
        total_signals += len(signals)

        existing_urls = supabase.get_social_listening_source_urls(icp["id"])
        new_signals = [s for s in signals if s.source_url not in existing_urls]
        if new_signals:
            inserted_ids = supabase.insert_social_listening_leads(new_signals)
            total_inserted += len(inserted_ids)

        high_n = sum(1 for s in signals if s.confidence == "high")
        print(
            f"  [Agent 20] {icp.get('name', '?'):<28} → {len(candidates)} candidates · "
            f"{len(signals)} signals ({high_n} high) · {len(new_signals)} new"
        )

    summary = {
        "icps_scanned": len(icps),
        "candidates_gathered": total_candidates,
        "signals_detected": total_signals,
        "signals_inserted": total_inserted,
    }
    print(
        f"  ✓ Agent 20 complete: {len(icps)} ICP(s) · {total_candidates} candidates · "
        f"{total_inserted} new candidates inserted"
    )
    return summary


def _gather_candidates(icp: dict) -> list[dict]:
    """Run LLM-generated public-signal search queries and collect raw results."""
    query_specs = _generate_queries(icp)
    print(f"  [Agent 20] {icp.get('name', '?'):<28} → {len(query_specs)} search queries planned")

    candidates: list[dict] = []
    for spec in query_specs:
        query = (spec.get("q") or "").strip()
        if not query:
            continue
        candidates.extend(_web_candidates(query, limit=_RESULTS_PER_QUERY))

    return _dedupe(candidates)[:_MAX_CANDIDATES_PER_ICP]


def _generate_queries(icp: dict) -> list[dict]:
    profile = {
        "industry": icp.get("industry") or [],
        "pain_points": icp.get("pain_points") or "",
        "geography": icp.get("geography") or [],
        "buyer_titles": icp.get("buyer_titles") or [],
    }
    try:
        raw = llm.chat_json(
            SOCIAL_LISTENING_QUERY_GENERATION_SYSTEM,
            json.dumps(profile),
            agent="agent_20_social_listening",
            icp_id=icp.get("id"),
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Agent 20] query generation failed for ICP {icp.get('id')}: {exc}")
        return []

    queries = raw.get("queries") if isinstance(raw, dict) else None
    if not isinstance(queries, list):
        return []
    return queries[:_MAX_QUERIES_PER_ICP]


def _web_candidates(query: str, limit: int) -> list[dict]:
    try:
        results = serpapi.search(query, num=limit)
    except Exception as exc:
        print(f"  [Agent 20] search failed for '{query}': {exc}")
        return []
    out = []
    for result in results:
        title = (result.get("title") or "").strip()
        snippet = (result.get("snippet") or "").strip()
        text = " — ".join(p for p in (title, snippet) if p)[:600]
        link = result.get("link")
        if not text or not link:
            continue
        out.append({"text": text, "source": link})
    return out


def _dedupe(candidates: list[dict]) -> list[dict]:
    seen: set[str] = set()
    unique = []
    for candidate in candidates:
        url = (candidate.get("source") or "").strip().lower()
        if not url or url in seen:
            continue
        seen.add(url)
        unique.append(candidate)
    return unique


def _classify_candidates(icp: dict, candidates: list[dict]) -> list[SocialListeningLead]:
    """Single LLM call classifies all candidates for one ICP into real/fake signals."""
    indexed = [
        {"id": i, "text": c["text"], "source": c["source"]}
        for i, c in enumerate(candidates)
    ]
    icp_summary = (
        f"industry={icp.get('industry')}; pain_points={icp.get('pain_points')}; "
        f"buyer_titles={icp.get('buyer_titles')}"
    )
    payload = json.dumps({"icp_summary": icp_summary, "candidates": indexed})
    try:
        result = llm.chat_json(
            SOCIAL_LISTENING_CLASSIFICATION_SYSTEM,
            payload,
            agent="agent_20_social_listening",
            icp_id=icp.get("id"),
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Agent 20] LLM batch classify failed: {exc}")
        return []

    raw_results = result.get("results") if isinstance(result, dict) else None
    if not isinstance(raw_results, list):
        print("  [Agent 20] unexpected LLM response shape; skipping all candidates")
        return []

    signals: list[SocialListeningLead] = []
    for item in raw_results:
        idx = item.get("id")
        if not isinstance(idx, int) or idx < 0 or idx >= len(candidates):
            continue
        if not item.get("is_signal"):
            continue
        confidence = str(item.get("confidence") or "low").lower()
        if confidence not in _MIN_CONFIDENCE_TO_KEEP:
            confidence = "low"

        candidate = candidates[idx]
        signals.append(SocialListeningLead(
            icp_id=icp.get("id"),
            platform=_platform_from_url(candidate["source"]),
            signal_text=candidate["text"],
            source_url=candidate["source"],
            candidate_company=_clean(item.get("candidate_company")),
            candidate_person=_clean(item.get("candidate_person")),
            candidate_title=_clean(item.get("candidate_title")),
            matched_pain_point=_clean(item.get("matched_pain_point")),
            confidence=confidence,
            status="candidate",
        ))
    return signals


def _clean(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _platform_from_url(url: str) -> str:
    url = url.lower()
    if "reddit.com" in url:
        return "reddit"
    if "twitter.com" in url or "x.com" in url:
        return "twitter"
    if "news.ycombinator.com" in url:
        return "forum"
    return "web"
