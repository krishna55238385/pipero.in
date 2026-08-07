"""Agent 06 — Account Intelligence.

For every qualified lead (verified domain, not an existing customer), build a
fresh company brief: what they do, recent strategic moves, likely pain
points, competitive position, and 3 outreach hooks. Brief is upserted into
the account_intelligence table.

Business rules implemented (from AI-GTM-Agency-Business-Architecture-A4.pdf):
- Distinguishes confirmed facts (with source URLs) from inferences.
- Flags instability (layoffs/lawsuit/restructuring) when evidence present.
- Writes a brief_quality_score; status='low_quality' when score < 60.
- Status='scrape_failed' if zero web and news content was gathered.
"""
import json

from gtm_backend.phase2.connectors import openai as llm
from gtm_backend.phase2.connectors import serpapi
from gtm_backend.phase2.connectors import supabase
from gtm_backend.phase2.connectors import website
from gtm_backend.phase2.core.prompts import (
    ACCOUNT_INTELLIGENCE_FALLBACK_SYSTEM,
    ACCOUNT_INTELLIGENCE_SYSTEM,
)
from gtm_backend.phase2.core.schemas import AccountBrief


_NEWS_LOOKBACK_DAYS = 90
_MAX_SNIPPETS = 8
_MAX_NEWS = 8
_MIN_QUALITY_SCORE = 60


def build_account_intelligence(icp_id: int | None = None, limit: int | None = None) -> dict:
    """Produce an account-intel brief for each candidate lead."""
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(f"  AGENT 06 — Account Intelligence (ICP #{icp_id}, limit={limit_label})")
    print(bar)

    leads = supabase.get_leads_for_account_intel(icp_id=icp_id, limit=limit)
    print(f"  → {len(leads)} candidate leads")
    briefs: list[AccountBrief] = []
    for lead in leads:
        brief = _build_one(lead)
        if brief is None:
            continue
        briefs.append(brief)
    # One bulk upsert for all briefs instead of one per lead in the loop —
    # same N+1-on-writes fix already applied to Agent 37.
    supabase.bulk_upsert_account_briefs(briefs)

    summary = {
        "icp_id": icp_id,
        "leads_examined": len(leads),
        "briefs_built": len(briefs),
        "low_quality": sum(1 for b in briefs if b.status == "low_quality"),
        "scrape_failed": sum(1 for b in briefs if b.status == "scrape_failed"),
    }
    print(
        f"  ✓ Agent 06 complete: {len(briefs)} briefs · "
        f"{summary['low_quality']} low_quality · {summary['scrape_failed']} scrape_failed"
    )
    return summary


def _build_one(lead: dict) -> AccountBrief | None:
    company_name = lead.get("company_name") or "?"
    domain = lead.get("company_domain")
    if not company_name or not domain:
        print(f"  [Agent 06] {company_name:<28} → skipped (no domain)")
        return None

    web_snippets = _gather_web_snippets(company_name, domain)
    news_items = _gather_news(company_name)

    # Free fallback #1: when search returns nothing (e.g. the SerpAPI quota is
    # exhausted and every query 429s), read the company's OWN website directly.
    # That content is real, current, and citable (source_url = the page itself).
    if not web_snippets:
        site_snippets = website.fetch_company_pages(domain)
        if site_snippets:
            web_snippets = site_snippets
            print(
                f"  [Agent 06] {company_name:<28} → search empty; "
                f"read {len(site_snippets)} page(s) from {domain} directly"
            )

    sources_scanned = _collect_source_urls(web_snippets, news_items)

    if not web_snippets and not news_items:
        # Free fallback #2 (last resort): no web data at all — build an
        # inference-only brief from the model's own knowledge, clearly flagged.
        return _build_from_knowledge(lead, company_name, domain)

    payload = json.dumps({
        "company_name": company_name,
        "company_domain": domain,
        "company_industry": lead.get("company_industry"),
        "web_snippets": web_snippets[:_MAX_SNIPPETS],
        "news_items": news_items[:_MAX_NEWS],
    })
    try:
        raw = llm.chat_json(
            ACCOUNT_INTELLIGENCE_SYSTEM,
            payload,
            agent="agent_06_account_intel",
            icp_id=lead.get("icp_id"),
            phase="phase2",
        )
    except Exception as exc:
        print(f"  [Agent 06] {company_name:<28} → LLM error: {exc}")
        return _empty_brief(lead, status="scrape_failed", sources=sources_scanned)

    brief = _from_llm(lead, raw, sources_scanned)
    quality = _score_brief_quality(raw)
    brief.brief_quality_score = quality
    brief.status = "low_quality" if quality < _MIN_QUALITY_SCORE else "fresh"
    print(
        f"  [Agent 06] {company_name:<28} → quality={quality}/100 "
        f"({brief.status}) · "
        f"{len(brief.recent_moves)} moves · "
        f"{len(brief.likely_pain_points)} pains · "
        f"{len(brief.confirmed_facts)} facts"
    )
    return brief


def _build_from_knowledge(lead: dict, company_name: str, domain: str) -> AccountBrief:
    """Last-resort brief built from the model's own knowledge (no web data).

    Used only when BOTH search and a direct website read return nothing. The
    brief is inference-only: confirmed_facts stays empty (nothing was verified),
    everything is marked low/medium confidence, and status='llm_fallback' so the
    provenance is explicit downstream.
    """
    payload = json.dumps({
        "company_name": company_name,
        "company_domain": domain,
        "company_industry": lead.get("company_industry"),
    })
    try:
        raw = llm.chat_json(
            ACCOUNT_INTELLIGENCE_FALLBACK_SYSTEM,
            payload,
            agent="agent_06_account_intel",
            icp_id=lead.get("icp_id"),
            phase="phase2",
        )
    except Exception as exc:
        print(f"  [Agent 06] {company_name:<28} → LLM error: {exc}")
        return _empty_brief(lead, status="scrape_failed", sources=[])

    brief = _from_llm(lead, raw, sources_scanned=["llm_internal_knowledge"])
    brief.confirmed_facts = []  # nothing was verified against a source
    quality = _score_brief_quality(raw)
    brief.brief_quality_score = quality
    brief.status = "llm_fallback"
    print(
        f"  [Agent 06] {company_name:<28} → no web/site content; "
        f"LLM-knowledge fallback (quality={quality}/100, "
        f"{len(brief.likely_pain_points)} pains, {len(brief.inferences)} inferences)"
    )
    return brief


def _gather_web_snippets(company_name: str, domain: str) -> list[dict]:
    """Use SerpAPI to fetch a few representative web hits for the company."""
    query = f'"{company_name}" {domain} about'
    try:
        results = serpapi.search(query, num=_MAX_SNIPPETS)
    except Exception as exc:
        print(f"  [Agent 06] web search failed for {company_name}: {exc}")
        return []
    snippets = []
    for res in results:
        snippet = (res.get("snippet") or "").strip()
        title = (res.get("title") or "").strip()
        link = (res.get("link") or "").strip()
        if not link:
            continue
        text = " — ".join(p for p in (title, snippet) if p)[:600]
        snippets.append({"text": text, "source_url": link})
    return snippets


def _gather_news(company_name: str) -> list[dict]:
    query = (
        f'"{company_name}" (funding OR raised OR hired OR layoffs OR '
        f'launched OR acquired OR partnership)'
    )
    try:
        articles = serpapi.search_news(query, days=_NEWS_LOOKBACK_DAYS, num=_MAX_NEWS)
    except Exception as exc:
        print(f"  [Agent 06] news search failed for {company_name}: {exc}")
        return []
    items = []
    for art in articles:
        title = (art.get("title") or "").strip()
        snippet = (art.get("snippet") or "").strip()
        link = (art.get("link") or "").strip()
        date = (art.get("date") or "").strip()
        if not link:
            continue
        items.append({
            "title": title,
            "snippet": snippet[:400],
            "link": link,
            "date": date,
        })
    return items


def _collect_source_urls(snippets: list[dict], news: list[dict]) -> list[str]:
    urls: list[str] = []
    for s in snippets:
        url = s.get("source_url")
        if url:
            urls.append(url)
    for n in news:
        url = n.get("link")
        if url:
            urls.append(url)
    return list(dict.fromkeys(urls))[:20]


def _from_llm(lead: dict, raw: dict, sources_scanned: list[str]) -> AccountBrief:
    return AccountBrief(
        lead_id=lead["id"],
        icp_id=lead.get("icp_id"),
        company_name=lead["company_name"],
        company_domain=lead.get("company_domain"),
        what_they_do=str(raw.get("what_they_do") or ""),
        business_model=str(raw.get("business_model") or "unknown"),
        company_size_estimate=str(raw.get("company_size_estimate") or "unknown"),
        growth_trajectory=str(raw.get("growth_trajectory") or ""),
        competitive_position=str(raw.get("competitive_position") or ""),
        recent_moves=_safe_list(raw.get("recent_moves"), _normalise_recent_move),
        likely_pain_points=_safe_list(raw.get("likely_pain_points"), _normalise_pain),
        instability_flags=_safe_list(raw.get("instability_flags"), _normalise_flag),
        confirmed_facts=_safe_list(raw.get("confirmed_facts"), _normalise_fact),
        inferences=_safe_list(raw.get("inferences"), _normalise_inference),
        key_signals_for_outreach=_safe_str_list(raw.get("key_signals_for_outreach")),
        sources_scanned=sources_scanned,
    )


def _empty_brief(lead: dict, status: str, sources: list[str]) -> AccountBrief:
    return AccountBrief(
        lead_id=lead["id"],
        icp_id=lead.get("icp_id"),
        company_name=lead["company_name"],
        company_domain=lead.get("company_domain"),
        brief_quality_score=0,
        status=status,
        sources_scanned=sources,
    )


def _normalise_recent_move(raw: dict) -> dict:
    return {
        "date": raw.get("date"),
        "move_type": str(raw.get("move_type") or "other"),
        "summary": str(raw.get("summary") or ""),
        "source_url": raw.get("source_url"),
    }


def _normalise_pain(raw: dict) -> dict:
    return {
        "pain": str(raw.get("pain") or ""),
        "evidence": raw.get("evidence"),
        "confidence": str(raw.get("confidence") or "low"),
    }


def _normalise_flag(raw: dict) -> dict:
    return {
        "flag": str(raw.get("flag") or ""),
        "severity": str(raw.get("severity") or "low"),
        "evidence": raw.get("evidence"),
    }


def _normalise_fact(raw: dict) -> dict:
    return {
        "fact": str(raw.get("fact") or ""),
        "source": str(raw.get("source") or "website"),
        "source_url": raw.get("source_url"),
    }


def _normalise_inference(raw: dict) -> dict:
    return {
        "inference": str(raw.get("inference") or ""),
        "confidence": str(raw.get("confidence") or "low"),
    }


def _safe_list(value: object, mapper) -> list:
    if not isinstance(value, list):
        return []
    return [mapper(item) for item in value if isinstance(item, dict)]


def _safe_str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item]


def _score_brief_quality(raw: dict) -> int:
    """Mirror the rubric documented in the n8n reference (capped at 100)."""
    score = 0
    if len(str(raw.get("what_they_do") or "")) > 20:
        score += 15
    if str(raw.get("business_model") or "").lower() not in {"", "unknown"}:
        score += 5
    if str(raw.get("company_size_estimate") or "").lower() not in {"", "unknown"}:
        score += 5
    if len(str(raw.get("growth_trajectory") or "")) > 20:
        score += 10
    if isinstance(raw.get("recent_moves"), list) and raw["recent_moves"]:
        score += 15
    if isinstance(raw.get("likely_pain_points"), list) and len(raw["likely_pain_points"]) >= 2:
        score += 15
    if len(str(raw.get("competitive_position") or "")) > 20:
        score += 5
    if isinstance(raw.get("confirmed_facts"), list) and len(raw["confirmed_facts"]) >= 3:
        score += 15
    if isinstance(raw.get("key_signals_for_outreach"), list) and len(raw["key_signals_for_outreach"]) >= 3:
        score += 15
    return min(100, score)
