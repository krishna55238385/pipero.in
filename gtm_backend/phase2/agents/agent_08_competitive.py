"""Agent 08 — Competitive Intelligence.

For each active ICP, identify at least 3 direct competitors and build a
positioning card per competitor. Persists one row per (icp_id,
competitor_name) in the competitor_intel table.

Business rules enforced (from architecture PDF):
- Tracks at minimum 3 direct competitors per ICP.
- Categorises complaints into the 4 buckets: price, support, features, reliability.
- Never disparages competitors; only highlights our differentiation in talk tracks.
- Threat level reflects ICP overlap.
"""
import json

from gtm_backend.phase2.connectors import openai as llm
from gtm_backend.phase2.connectors import serpapi
from gtm_backend.phase2.connectors import supabase
from gtm_backend.phase2.core.prompts import (
    COMPETITIVE_INTELLIGENCE_FALLBACK_SYSTEM,
    COMPETITIVE_INTELLIGENCE_SYSTEM,
    COMPETITOR_DISCOVERY_SYSTEM,
)
from gtm_backend.phase2.core.schemas import Competitor, LeadCompetitorUsage


_COMPETITOR_QUERY_NUM = 8
_NEWS_LOOKBACK_DAYS = 180
_MIN_COMPETITORS = 3  # PDF: track at minimum 3 direct competitors per ICP
# Brief fields scanned for competitor mentions (lead-already-uses-competitor).
_USAGE_SCAN_FIELDS = ("what_they_do", "competitive_position", "growth_trajectory")


def gather_competitive_intel(icp_id: int | None = None, max_competitors: int = 5) -> dict:
    """Discover and analyse competitors for each active ICP."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(
        f"  AGENT 08 — Competitive Intelligence "
        f"(ICP #{icp_id}, max_competitors={max_competitors})"
    )
    print(bar)

    if icp_id is not None:
        try:
            icps = [supabase.get_icp(icp_id)]
        except RuntimeError:
            # Unknown ICP: nothing to analyse. No-op like agents 06/07 rather
            # than crashing the whole run-all pipeline.
            print(f"  → ICP #{icp_id} not found — skipping")
            icps = []
    else:
        icps = supabase.get_active_icps()
    print(f"  → analysing {len(icps)} ICP(s)")

    cards_written = 0
    icps_below_min = 0
    usage_flags_written = 0
    for icp in icps:
        names = _discover_competitor_names(icp)
        names = names[:max_competitors]
        if len(names) < _MIN_COMPETITORS:
            icps_below_min += 1
            print(
                f"  [Agent 08] ICP #{icp['id']} → ⚠ only {len(names)} competitor(s) "
                f"(below the {_MIN_COMPETITORS}-competitor floor)"
            )
        for name in names:
            card = _build_one(icp, name)
            if card is None:
                continue
            supabase.upsert_competitor(card)
            cards_written += 1
        # Flag any of this ICP's leads whose account brief already mentions one
        # of the tracked competitors (PDF: "flag when a target lead is already
        # using a competitor").
        usage_flags_written += _flag_competitor_usage(icp, names)

    summary = {
        "icp_id": icp_id,
        "icps_processed": len(icps),
        "cards_written": cards_written,
        "icps_below_min_competitors": icps_below_min,
        "usage_flags_written": usage_flags_written,
    }
    print(
        f"  ✓ Agent 08 complete: {len(icps)} ICP(s) · "
        f"{cards_written} competitor cards · {usage_flags_written} lead-usage flags · "
        f"{icps_below_min} ICP(s) below competitor floor"
    )
    return summary


def _flag_competitor_usage(icp: dict, competitor_names: list[str]) -> int:
    """Record any lead in this ICP whose account brief mentions a competitor.

    Scans each lead's account_intelligence brief text for each tracked
    competitor name and upserts a lead_competitor_usage row per match. Returns
    the number of flags written.
    """
    names = [n for n in competitor_names if n and len(n) >= 3]
    if not names:
        return 0
    leads = supabase.get_leads_for_account_intel(icp_id=icp.get("id"))
    written = 0
    for lead in leads:
        brief = supabase.get_account_brief(lead["id"])
        if not brief:
            continue
        blob = " ".join(str(brief.get(f) or "") for f in _USAGE_SCAN_FIELDS).lower()
        if not blob.strip():
            continue
        for name in names:
            if name.lower() in blob:
                supabase.upsert_lead_competitor_usage(LeadCompetitorUsage(
                    lead_id=lead["id"],
                    icp_id=icp.get("id"),
                    competitor_name=name,
                    evidence=f"brief mentions '{name}'",
                ))
                written += 1
                print(
                    f"  [Agent 08] ⚑ {lead.get('company_name','?')} already uses {name}"
                )
    return written


def _discover_competitor_names(icp: dict) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def _add(candidates) -> None:
        for raw_name in candidates:
            name = (raw_name or "").strip()
            key = name.lower()
            if name and key not in seen:
                seen.add(key)
                names.append(name)

    # Primary source: the model names *real, well-known companies* (e.g. "HubSpot",
    # "Apollo") for this category. A web "top X companies" search instead returns
    # listicle/directory page titles ("Major Indian Software Companies List",
    # "Software Companies") — which is exactly why competitor cards showed junk
    # names. So we discover from model knowledge first.
    _add(_discover_competitor_names_llm(icp))

    # Supplement from web titles only if the model gave us too few — and with a
    # strict filter that rejects generic/listicle titles.
    if len(names) < _MIN_COMPETITORS:
        industries = icp.get("industry") or []
        geographies = icp.get("geography") or []
        industry = industries[0] if industries else "B2B SaaS"
        geo = geographies[0] if geographies else ""
        query = f"top {industry} companies in {geo}" if geo else f"top {industry} companies"
        try:
            results = serpapi.search(query, num=_COMPETITOR_QUERY_NUM)
        except Exception as exc:
            print(f"  [Agent 08] discovery search failed: {exc}")
            results = []
        _add(
            _extract_company_name((r.get("title") or "").strip())
            for r in results
            if (r.get("title") or "").strip()
        )
    return names


def _discover_competitor_names_llm(icp: dict) -> list[str]:
    payload = json.dumps({
        "industry": icp.get("industry") or [],
        "geography": icp.get("geography") or [],
        "buyer_titles": icp.get("buyer_titles") or [],
    })
    try:
        raw = llm.chat_json(
            COMPETITOR_DISCOVERY_SYSTEM,
            payload,
            agent="agent_08_competitive",
            icp_id=icp.get("id"),
            phase="phase2",
        )
    except Exception as exc:
        print(f"  [Agent 08] LLM competitor discovery failed: {exc}")
        return []
    comps = raw.get("competitors")
    if not isinstance(comps, list):
        return []
    return [str(c).strip() for c in comps if str(c).strip()]


_TITLE_DELIMS = (" - ", " | ", " — ", " · ")


def _extract_company_name(title: str) -> str:
    """Pull the first plausible company name from a SerpAPI title."""
    head = title
    for delim in _TITLE_DELIMS:
        if delim in head:
            head = head.split(delim)[0].strip()
            break
    lowered = head.lower()
    for noise in ("top ", "best ", "list of "):
        if lowered.startswith(noise):
            return ""
    # Reject generic listicle/directory titles — these aren't real company names.
    if any(word in lowered for word in ("companies", "directory", "blog", "vendors", " list", "list ")):
        return ""
    if len(head) < 2 or len(head) > 60:
        return ""
    if any(ch.isdigit() for ch in head[:3]):
        return ""
    return head


def _build_one(icp: dict, competitor_name: str) -> Competitor | None:
    snippets = _gather_competitor_snippets(competitor_name)
    news = _gather_competitor_news(competitor_name)
    if not snippets and not news:
        # Free fallback: no web/news for this competitor — analyse from model
        # knowledge instead of dropping the card entirely.
        return _build_from_knowledge(icp, competitor_name)

    payload = json.dumps({
        "competitor_name": competitor_name,
        "icp_industry": icp.get("industry"),
        "icp_geography": icp.get("geography"),
        "buyer_titles": icp.get("buyer_titles") or [],
        "web_snippets": snippets,
        "news_items": news,
    })
    try:
        raw = llm.chat_json(
            COMPETITIVE_INTELLIGENCE_SYSTEM,
            payload,
            agent="agent_08_competitive",
            icp_id=icp.get("id"),
            phase="phase2",
        )
    except Exception as exc:
        print(f"  [Agent 08] {competitor_name:<28} → LLM error: {exc}")
        return None

    sources = [s.get("source_url") for s in snippets if s.get("source_url")]
    sources += [n.get("link") for n in news if n.get("link")]
    card = _card_from_raw(icp, competitor_name, raw, sources)
    print(
        f"  [Agent 08] {competitor_name:<28} → "
        f"{len(card.complaint_categories)} complaint buckets · "
        f"{len(card.talk_tracks)} talk tracks · threat={card.threat_level}"
    )
    return card


def _build_from_knowledge(icp: dict, competitor_name: str) -> Competitor | None:
    """Build a competitor card from model knowledge when no web/news is found."""
    payload = json.dumps({
        "competitor_name": competitor_name,
        "icp_industry": icp.get("industry"),
        "icp_geography": icp.get("geography"),
        "buyer_titles": icp.get("buyer_titles") or [],
    })
    try:
        raw = llm.chat_json(
            COMPETITIVE_INTELLIGENCE_FALLBACK_SYSTEM,
            payload,
            agent="agent_08_competitive",
            icp_id=icp.get("id"),
            phase="phase2",
        )
    except Exception as exc:
        print(f"  [Agent 08] {competitor_name:<28} → LLM error (knowledge fallback): {exc}")
        return None

    card = _card_from_raw(icp, competitor_name, raw, sources=["llm_internal_knowledge"])
    print(
        f"  [Agent 08] {competitor_name:<28} → LLM-knowledge card · "
        f"{len(card.talk_tracks)} talk tracks · threat={card.threat_level}"
    )
    return card


def _card_from_raw(
    icp: dict, competitor_name: str, raw: dict, sources: list[str]
) -> Competitor:
    return Competitor(
        icp_id=icp["id"],
        competitor_name=competitor_name,
        competitor_domain=None,
        summary=str(raw.get("summary") or ""),
        biggest_weakness=raw.get("biggest_weakness"),
        who_loves_them=raw.get("who_loves_them"),
        who_hates_them=raw.get("who_hates_them"),
        complaint_categories=_safe_list_of_dicts(raw.get("complaint_categories")),
        talk_tracks=_safe_list_of_dicts(raw.get("talk_tracks")),
        threat_level=str(raw.get("threat_level") or "medium"),
        sources=sources,
    )


def _gather_competitor_snippets(competitor_name: str) -> list[dict]:
    query = f'"{competitor_name}" pricing OR features OR review OR alternatives'
    try:
        results = serpapi.search(query, num=8)
    except Exception:
        return []
    return [
        {
            "text": " — ".join(
                p for p in (r.get("title"), r.get("snippet")) if isinstance(p, str)
            )[:600],
            "source_url": r.get("link"),
        }
        for r in results if r.get("link")
    ]


def _gather_competitor_news(competitor_name: str) -> list[dict]:
    query = (
        f'"{competitor_name}" (problems OR complaints OR negative OR layoffs OR pricing)'
    )
    try:
        articles = serpapi.search_news(query, days=_NEWS_LOOKBACK_DAYS, num=6)
    except Exception:
        return []
    return [{
        "title": a.get("title"),
        "snippet": (a.get("snippet") or "")[:400],
        "link": a.get("link"),
        "date": a.get("date"),
    } for a in articles if a.get("link")]


def _safe_list_of_dicts(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]
