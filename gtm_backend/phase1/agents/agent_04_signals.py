"""Agent 04 — Buying Signal Detection.

For each lead, gather raw signal candidates from multiple SerpAPI sources,
dedupe by source URL, then ask the LLM to classify ALL candidates in a
single batch call into (signal_type, buying_intent).
Discard candidates the LLM marks as 'na'.
Persist the rest in the buying_signals table.

LLM contract (one call per lead, batch):
    input:  {"company_name", "company_domain", "candidates": [{"id", "signal_text", "source", "date"}, ...]}
    output: {"results": [{"id", "signal_type", "buying_intent"}, ...]}
"""
import json
import re
from datetime import datetime, timedelta, timezone

from gtm_backend.phase1.connectors import openai as llm
from gtm_backend.phase1.connectors import serpapi
from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.connectors import website
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


def _disambiguate_query(query: str, domain: str | None) -> str:
    """Anchor a name-based search query to the lead's resolved domain so
    results are about THAT company, not a same-named unrelated one.

    Found live 2026-09-03 (ICP #62, Jobraux): a bare "Bloomberry" news/web
    search returned almost exclusively content about an unrelated Philippine
    casino operator sharing that name — none of it about the real target
    (bloomberry.com, a New York SaaS company). Same fix already proven in
    lead_enrichment.py's search_company_location(): appending the domain as
    a disambiguator, applied unconditionally in code rather than left to the
    query-generation LLM's discretion, so it can't be silently skipped.
    """
    query = query.strip()
    if not query or not domain:
        return query
    if domain.lower() in query.lower():
        return query  # already disambiguated
    return f'{query} "{domain}"'


def _gather_candidates(lead: dict, icp: dict | None, lookback_days: int, icp_id: int | None = None) -> list[dict]:
    """Pull raw signal candidates for a lead by executing LLM-generated queries."""
    company_name = lead.get("company_name")
    domain = lead.get("company_domain")
    if not company_name:
        return []

    query_specs = _generate_queries(lead, icp, icp_id=icp_id)
    print(f"  [Agent 04] {company_name:<28} → {len(query_specs)} search queries planned")

    candidates: list[dict] = []
    for spec in query_specs:
        engine = spec.get("engine") or "google_news"
        query = _disambiguate_query(spec.get("q") or "", domain)
        num = _clamp(spec.get("num"), low=1, high=10, default=3)
        if not query or engine not in _VALID_ENGINES:
            continue
        if engine == "google_news":
            candidates.extend(_news_candidates(query=query, lookback_days=lookback_days, limit=num))
        else:
            candidates.extend(_web_candidates(query=query, lookback_days=lookback_days, limit=num))

    candidates = _dedupe(candidates)
    candidates = _filter_stale(candidates, lookback_days)
    if not candidates:
        # Free fallback: search unavailable (SerpAPI/Serper quota exhausted) —
        # read the company's own /careers, /news, /press, /blog pages instead.
        # Weaker signal (self-reported, no third-party corroboration) but beats
        # a hard 0; still runs through the same entity-check + classification LLM.
        domain = lead.get("company_domain")
        page_candidates = website.fetch_signal_pages(domain) if domain else []
        if page_candidates:
            print(
                f"  [Agent 04] {company_name:<28} → search unavailable; "
                f"read {len(page_candidates)} page(s) from {domain} directly"
            )
            candidates = _dedupe(page_candidates)

    return candidates[:_MAX_CANDIDATES_PER_LEAD]


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
        out.append({
            "signal_text": text,
            "source": link,
            # Provider-supplied per-article date ("Jun 30, 2026", "1 month
            # ago", etc.) — used below to reject stale candidates and to give
            # the classification LLM real data instead of making it infer
            # recency from whatever date-shaped text happens to appear in the
            # title/URL. None when the provider didn't return one (e.g. a
            # static page with no publish date) — never treated as "stale".
            "date_raw": article.get("date"),
            "date": _parse_candidate_date(article.get("date")),
        })
    return out


def _source_to_str(source: object) -> str:
    """SerpAPI google_news returns 'source' as either a string or a dict."""
    if isinstance(source, str):
        return source
    if isinstance(source, dict):
        return source.get("name") or ""
    return ""


def _web_candidates(query: str, lookback_days: int, limit: int) -> list[dict]:
    try:
        # Task (2026-09-03, ICP #62): plain web results used to carry no date
        # restriction at all — a "expansion"/"hiring" query tagged engine
        # "google" by the query-generation LLM could surface an article from
        # any point in the site's history. Same tbs mechanism search_news()
        # already used, now applied here too.
        results = serpapi.search(query, num=limit, days=lookback_days)
    except Exception as exc:
        print(f"  [Agent 04] web search failed for '{query}': {exc}")
        return []
    out = []
    for result in results:
        text = _compose_text(result.get("title"), result.get("snippet"))
        link = result.get("link")
        if not text or not link:
            continue
        out.append({
            "signal_text": text,
            "source": link,
            "date_raw": result.get("date"),
            "date": _parse_candidate_date(result.get("date")),
        })
    return out


def _compose_text(title: object, body: object) -> str:
    title_str = title.strip() if isinstance(title, str) else ""
    body_str = body.strip() if isinstance(body, str) else ""
    joined = " — ".join(p for p in (title_str, body_str) if p)
    return joined[:_MAX_TEXT_LEN]


_RELATIVE_DATE_RE = re.compile(r"^\s*(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago\s*$", re.IGNORECASE)
_ABSOLUTE_DATE_FORMATS = ("%b %d, %Y", "%B %d, %Y", "%m/%d/%Y", "%Y-%m-%d")
_LEADING_MDY_RE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{4})")


def _parse_candidate_date(raw: object) -> datetime | None:
    """Best-effort parse of a search provider's free-text date field
    ("Jun 30, 2026", "1 month ago", "09/03/2026, 09:02 AM, +0000 UTC") into
    an actual UTC datetime. Returns None on anything unparseable or absent —
    callers must treat that as "no date evidence" (keep the candidate), never
    as "confirmed stale"; plenty of legitimate signal sources (a company's
    own careers page, a static review listing) carry no date at all.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()

    rel = _RELATIVE_DATE_RE.match(text)
    if rel:
        n, unit = int(rel.group(1)), rel.group(2).lower()
        delta = {
            "minute": timedelta(minutes=n), "hour": timedelta(hours=n),
            "day": timedelta(days=n), "week": timedelta(weeks=n),
            "month": timedelta(days=n * 30), "year": timedelta(days=n * 365),
        }[unit]
        return datetime.now(timezone.utc) - delta

    for fmt in _ABSOLUTE_DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue

    # SerpAPI's fuller timestamp shape: "09/03/2026, 09:02 AM, +0000 UTC" —
    # pull just the leading MM/DD/YYYY rather than parsing the whole string.
    prefix = _LEADING_MDY_RE.match(text)
    if prefix:
        try:
            return datetime.strptime(prefix.group(1), "%m/%d/%Y").replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    return None


def _filter_stale(candidates: list[dict], lookback_days: int) -> list[dict]:
    """Reject any candidate whose provider-supplied date resolves to older
    than the lookback window BEFORE it ever reaches the classification LLM —
    the LLM is never asked to infer staleness from raw text/URL, which found
    live (2026-09-03, ICP #62) was inconsistent: an 11-year-old PokerNews
    article about Bloomberry was scored buying_intent="high" while similarly
    stale 2022 articles were correctly scored "low", because the model was
    guessing from context rather than checking a real date it never had.

    A candidate with no parseable date (date is None) is always kept — see
    _parse_candidate_date's docstring for why that must not be treated as
    stale.
    """
    if not candidates:
        return candidates
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    kept = []
    dropped = 0
    for c in candidates:
        date = c.get("date")
        if date is not None and date < cutoff:
            dropped += 1
            continue
        kept.append(c)
    if dropped:
        print(f"  [Agent 04] {dropped} candidate(s) dropped — older than {lookback_days}-day lookback")
    return kept


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
        {
            "id": i,
            "signal_text": c["signal_text"],
            "source": c["source"],
            # Real provider-supplied date (ISO, UTC) when known — gives the
            # "low: weak/old/peripheral" judgment in the prompt's rubric
            # actual data to check against, instead of inferring recency
            # from whatever date-shaped text happens to appear in the
            # title/URL. null when the provider gave no date at all.
            "date": c["date"].date().isoformat() if c.get("date") else None,
        }
        for i, c in enumerate(candidates)
    ]
    payload = json.dumps({
        "company_name": lead.get("company_name"),
        # Identity anchor for the entity check (see SIGNAL_CLASSIFICATION_SYSTEM
        # STEP 1) — lets the LLM check a candidate against the real resolved
        # company instead of judging on name alone.
        "company_domain": lead.get("company_domain"),
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
            signal_date=candidate.get("date"),
        ))

    company = lead.get("company_name") or "?"
    high_n = sum(1 for s in signals if s.buying_intent == "high")
    low_n = sum(1 for s in signals if s.buying_intent == "low")
    print(
        f"  [Agent 04] {company:<28} → {len(signals):>2} signals "
        f"({high_n} high, {low_n} low) · {na_count} skipped"
    )
    return signals, na_count
