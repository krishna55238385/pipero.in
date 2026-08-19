"""Agent 04 — Buying Signal Detection.

For each lead, gather raw signal candidates from multiple SerpAPI sources,
dedupe by source URL, then ask the LLM to classify ALL candidates in a
single batch call into (signal_type, buying_intent).
Discard candidates the LLM marks as 'na'.
Persist the rest in the buying_signals table.

LLM contract (one call per lead, batch):
    input:  {"company_name", "candidates": [{"id", "signal_text", "source"}, ...]}
    output: {"results": [{"id", "signal_type", "buying_intent"}, ...]}
"""
import json

from gtm_backend.phase1.connectors import openai as llm
from gtm_backend.phase1.connectors import serpapi
from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.core.prompts import SIGNAL_CLASSIFICATION_SYSTEM, SIGNAL_QUERY_GENERATION_SYSTEM
from gtm_backend.phase1.core.schemas import BuyingSignal
from gtm_backend.phase1.core.scoring import SIGNAL_TYPE_WEIGHTS

_VALID_TYPES = set(SIGNAL_TYPE_WEIGHTS.keys())
_VALID_INTENTS = {"high", "low", "na"}
_INTENT_WEIGHT_SCALE = {"high": 1.0, "low": 0.5}
_VALID_ENGINES = {"google_news", "google"}
_MAX_TEXT_LEN = 600
_MAX_CANDIDATES_PER_LEAD = 12
_MAX_QUERIES_PER_LEAD = 5  # was 8 — each query is a SerpAPI credit; blueprint only asks for 5-7


def detect_signals(
    icp_id: int | None = None,
    lookback_days: int = 90,
    limit: int = 50,
    exclude_cold: bool = True,
) -> dict:
    """Detect and (re)persist buying signals for leads.

    When ``icp_id`` is given, only that ICP's leads are scanned. When it is
    ``None`` the run is org-wide: every lead with a company_domain in the org is
    scanned (the GTM_ORG_ID-scoped Supabase view already restricts this to the
    caller's org). Re-running is idempotent — a lead's existing buying_signals
    are cleared before its freshly detected signals are reinserted, so signals
    are refreshed in place rather than duplicated.

    exclude_cold (default True): skips leads already scored 'cold' — see
    supabase.get_leads_for_signals()'s docstring for the full reasoning
    (SerpAPI-usage cost reduction, safe no-op on unscored/new leads). Pass
    False for a full rescan.
    """
    scope = f"ICP #{icp_id}" if icp_id else "ALL leads (org-wide)"
    cold_note = " (excluding cold-tier)" if exclude_cold else ""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 04 — Buying Signal Detection ({scope}, lookback={lookback_days}d{cold_note})")
    print(bar)

    icp = supabase.get_icp(icp_id) if icp_id else None
    leads = supabase.get_leads_for_signals(limit=limit, icp_id=icp_id, exclude_cold=exclude_cold)
    print(f"  → {len(leads)} leads to scan for signals")

    signals_detected = 0
    signals_inserted = 0
    candidates_total = 0
    skipped_na = 0
    leads_refreshed = 0
    for lead in leads:
        candidates = _gather_candidates(lead, icp, lookback_days, icp_id=icp_id)
        candidates_total += len(candidates)
        signals: list[BuyingSignal] = []
        if candidates:
            signals, na_count = _classify_candidates(lead, candidates, icp_id=icp_id)
            skipped_na += na_count
            signals_detected += len(signals)

        # Idempotent refresh: clear this lead's prior signals, then reinsert the
        # newly detected set. Done per-lead so a partial/failed run still leaves
        # each processed lead consistent (no stale + new mix, no duplicates).
        supabase.delete_signals_for_lead(lead["id"])
        leads_refreshed += 1
        if signals:
            inserted_ids = supabase.insert_signals(signals)
            signals_inserted += len(inserted_ids)

    summary = {
        "icp_id": icp_id,
        "leads_examined": len(leads),
        "leads_refreshed": leads_refreshed,
        "candidates_gathered": candidates_total,
        "candidates_skipped_na": skipped_na,
        "signals_detected": signals_detected,
        "signals_inserted": signals_inserted,
    }
    print(
        f"  ✓ Agent 04 complete: {len(leads)} leads · {candidates_total} candidates · "
        f"{signals_inserted} signals inserted ({skipped_na} skipped)"
    )
    return summary


def _gather_candidates(lead: dict, icp: dict | None, lookback_days: int, icp_id: int | None = None) -> list[dict]:
    """Pull raw signal candidates for a lead by executing LLM-generated queries."""
    company_name = lead.get("company_name")
    if not company_name:
        return []

    query_specs = _generate_queries(lead, icp, icp_id=icp_id)
    print(f"  [Agent 04] {company_name:<28} → {len(query_specs)} search queries planned")

    candidates: list[dict] = []
    for spec in query_specs:
        engine = spec.get("engine") or "google_news"
        query = (spec.get("q") or "").strip()
        num = _clamp(spec.get("num"), low=1, high=10, default=3)
        if not query or engine not in _VALID_ENGINES:
            continue
        if engine == "google_news":
            candidates.extend(_news_candidates(query=query, lookback_days=lookback_days, limit=num))
        else:
            candidates.extend(_web_candidates(query=query, limit=num))

    return _dedupe(candidates)[:_MAX_CANDIDATES_PER_LEAD]


def _generate_queries(lead: dict, icp: dict | None, icp_id: int | None = None) -> list[dict]:
    """Ask the LLM for tailored search queries. Falls back to a static template on error."""
    profile = {
        "company_name": lead.get("company_name"),
        "company_industry": lead.get("company_industry"),
        "company_country": lead.get("company_country") or lead.get("company_state"),
        "buyer_titles": (icp or {}).get("buyer_titles") or [],
    }
    try:
        raw = llm.chat_json(
            SIGNAL_QUERY_GENERATION_SYSTEM,
            json.dumps(profile),
            agent="agent_04_signals",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Agent 04] query generation failed; using fallback. ({exc})")
        return _fallback_queries(lead)

    queries = raw.get("queries") if isinstance(raw, dict) else None
    if not isinstance(queries, list) or not queries:
        return _fallback_queries(lead)
    return queries[:_MAX_QUERIES_PER_LEAD]


def _fallback_queries(lead: dict) -> list[dict]:
    name = lead.get("company_name") or ""
    return [
        {"engine": "google_news", "q": name, "signal_focus": "news", "num": 5},
        {"engine": "google_news", "q": f"{name} funding", "signal_focus": "funding", "num": 3},
        {"engine": "google_news", "q": f"{name} new CEO OR appointed OR joined", "signal_focus": "leadership_change", "num": 3},
        {"engine": "google", "q": f"{name} hiring careers jobs", "signal_focus": "hiring", "num": 3},
    ]


def _clamp(value: object, low: int, high: int, default: int) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(low, min(high, n))


def _news_candidates(query: str, lookback_days: int, limit: int) -> list[dict]:
    try:
        articles = serpapi.search_news(query, days=lookback_days, num=limit)
    except Exception as exc:
        print(f"  [Agent 04] news search failed for '{query}': {exc}")
        return []
    out = []
    for article in articles:
        body = article.get("snippet") or _source_to_str(article.get("source"))
        text = _compose_text(article.get("title"), body)
        link = article.get("link")
        if not text or not link:
            continue
        out.append({"signal_text": text, "source": link})
    return out


def _source_to_str(source: object) -> str:
    """SerpAPI google_news returns 'source' as either a string or a dict."""
    if isinstance(source, str):
        return source
    if isinstance(source, dict):
        return source.get("name") or ""
    return ""


def _web_candidates(query: str, limit: int) -> list[dict]:
    try:
        results = serpapi.search(query, num=limit)
    except Exception as exc:
        print(f"  [Agent 04] web search failed for '{query}': {exc}")
        return []
    out = []
    for result in results:
        text = _compose_text(result.get("title"), result.get("snippet"))
        link = result.get("link")
        if not text or not link:
            continue
        out.append({"signal_text": text, "source": link})
    return out


def _compose_text(title: object, body: object) -> str:
    title_str = title.strip() if isinstance(title, str) else ""
    body_str = body.strip() if isinstance(body, str) else ""
    joined = " — ".join(p for p in (title_str, body_str) if p)
    return joined[:_MAX_TEXT_LEN]


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


def _classify_candidates(
    lead: dict,
    candidates: list[dict],
    icp_id: int | None = None,
) -> tuple[list[BuyingSignal], int]:
    """Single LLM call classifies all candidates for a lead.

    Returns (list_of_signals, na_count).
    """
    indexed = [
        {"id": i, "signal_text": c["signal_text"], "source": c["source"]}
        for i, c in enumerate(candidates)
    ]
    payload = json.dumps({
        "company_name": lead.get("company_name"),
        "candidates": indexed,
    })
    try:
        result = llm.chat_json(
            SIGNAL_CLASSIFICATION_SYSTEM,
            payload,
            agent="agent_04_signals",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Agent 04] LLM batch classify failed: {exc}")
        return [], len(candidates)

    raw_results = result.get("results") if isinstance(result, dict) else None
    if not isinstance(raw_results, list):
        print(f"  [Agent 04] unexpected LLM response shape; skipping all candidates")
        return [], len(candidates)

    signals: list[BuyingSignal] = []
    na_count = 0
    for item in raw_results:
        idx = item.get("id")
        signal_type = item.get("signal_type")
        intent = (item.get("buying_intent") or "").lower()

        if not isinstance(idx, int) or idx < 0 or idx >= len(candidates):
            continue
        if signal_type not in _VALID_TYPES:
            na_count += 1
            continue
        if intent not in _VALID_INTENTS or intent == "na":
            na_count += 1
            continue

        candidate = candidates[idx]
        base_weight = SIGNAL_TYPE_WEIGHTS[signal_type]
        weight = max(1, min(10, int(round(base_weight * _INTENT_WEIGHT_SCALE[intent]))))
        score = weight * 10 if intent == "high" else weight * 5

        signals.append(BuyingSignal(
            lead_id=lead["id"],
            signal_type=signal_type,
            weight=weight,
            score=score,
            signal_text=candidate["signal_text"],
            signal_summary=candidate["signal_text"][:300],
            signal_source_url=candidate["source"],
            buying_intent=intent,
        ))

    company = lead.get("company_name") or "?"
    high_n = sum(1 for s in signals if s.buying_intent == "high")
    low_n = sum(1 for s in signals if s.buying_intent == "low")
    print(
        f"  [Agent 04] {company:<28} → {len(signals):>2} signals "
        f"({high_n} high, {low_n} low) · {na_count} skipped"
    )
    return signals, na_count
