"""Regression test for the bug found live (2026-09-03, ICP #62, Jobraux):
Agent 04 surfaced an 11-year-old PokerNews article about Bloomberry as a
buying_intent="high" signal despite a 90-day lookback window.

Root cause: the plain "google"-engine web search path (used for
hiring/reviews/expansion-type queries) had no date filtering at all — only
the "google_news"-engine path applied SerpAPI's tbs date-range filter. Worse,
the classification LLM was never given a real date field for ANY candidate
(news or web) — only signal_text and source URL — so whatever "is this old"
judgment it made was an unreliable guess from date-shaped text in the
title/URL, not a real check. Confirmed inconsistent live: a similarly-old
2022 article got correctly downgraded to "low" while the 2015 one didn't.

Fix: capture the provider's own per-result "date" field on both search()
and search_news() paths, apply the SAME tbs lookback filter to search() that
search_news() already had, hard-reject any candidate whose parsed date falls
outside lookback_days BEFORE it reaches the LLM, and pass the real date to
the classification LLM explicitly instead of leaving it to infer.
"""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_04_signals import (
    _filter_stale,
    _parse_candidate_date,
    detect_signals,
)


def test_parses_relative_dates():
    now = datetime.now(timezone.utc)
    parsed = _parse_candidate_date("5 days ago")
    assert abs((now - parsed).total_seconds() - 5 * 86400) < 5


def test_parses_absolute_dates():
    assert _parse_candidate_date("Jun 30, 2026") == datetime(2026, 6, 30, tzinfo=timezone.utc)
    assert _parse_candidate_date("2015-03-01") == datetime(2015, 3, 1, tzinfo=timezone.utc)


def test_parses_serpapi_full_timestamp_prefix():
    parsed = _parse_candidate_date("09/03/2026, 09:02 AM, +0000 UTC")
    assert parsed == datetime(2026, 9, 3, tzinfo=timezone.utc)


def test_unparseable_or_missing_date_returns_none():
    assert _parse_candidate_date(None) is None
    assert _parse_candidate_date("") is None
    assert _parse_candidate_date("recently") is None


def test_filter_stale_drops_old_dated_candidates_keeps_fresh_and_undated():
    now = datetime.now(timezone.utc)
    candidates = [
        {"source": "https://old.example/2015-article", "date": datetime(2015, 3, 1, tzinfo=timezone.utc)},
        {"source": "https://fresh.example/today", "date": now - timedelta(days=5)},
        {"source": "https://boundary.example/89d", "date": now - timedelta(days=89)},
        {"source": "https://boundary.example/91d", "date": now - timedelta(days=91)},
        {"source": "https://static.example/careers", "date": None},
    ]
    kept = _filter_stale(candidates, lookback_days=90)
    kept_sources = {c["source"] for c in kept}
    assert kept_sources == {
        "https://fresh.example/today",
        "https://boundary.example/89d",
        "https://static.example/careers",
    }


def test_bloomberry_style_stale_signal_rejected_before_reaching_llm():
    """End-to-end repro of the exact live bug: a search engine returns a mix
    of an 11-year-old article and a fresh one; the stale one must never reach
    the classification LLM at all, and the fresh one must carry its real date
    through to the stored BuyingSignal.signal_date."""
    lead = {"id": 42, "icp_id": 1, "company_name": "Bloomberry", "company_industry": "Gaming"}

    old_result = {
        "title": "Bloomberry Purchases an Island and a Casino Operator for Big Bet on South Korea",
        "snippet": "PokerNews",
        "link": "https://www.pokernews.com/news/2015/03/bloomberry-island-and-casino-operator-20975.htm",
        "date": "Mar 1, 2015",
    }
    fresh_result = {
        "title": "Bloomberry Resorts shares surge after gaming platform launch",
        "snippet": "bworldonline.com",
        "link": "https://bworldonline.com/corporate/2026/08/20/bloomberry-surge/",
        "date": "10 days ago",
    }

    def fake_web(query, num=10, days=None):
        return [old_result, fresh_result]

    query_plan = {"queries": [{"engine": "google", "q": "Bloomberry expansion", "signal_focus": "expansion", "num": 5}]}
    classify_seen = {}

    def fake_llm(system, user, **_kwargs):
        if "queries" in system.lower():
            return query_plan
        classify_seen["payload"] = json.loads(user)
        # Classify whatever candidates actually reached this call as high-intent expansion.
        n = len(classify_seen["payload"]["candidates"])
        return {"results": [{"id": i, "signal_type": "expansion", "buying_intent": "high"} for i in range(n)]}

    with patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_icp", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_leads_for_signals", return_value=[lead]), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search_news", return_value=[]), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search", side_effect=fake_web), \
         patch("gtm_backend.phase1.agents.agent_04_signals.llm.chat_json", side_effect=fake_llm), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.delete_signals_for_lead"), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.insert_signals", return_value=[1]) as inserter:
        summary = detect_signals(icp_id=1, lookback_days=90)

    # The 2015 article never reached the classification LLM at all.
    classified_sources = {c["source"] for c in classify_seen["payload"]["candidates"]}
    assert "pokernews.com" not in " ".join(classified_sources)
    assert any("bworldonline.com" in s for s in classified_sources)

    assert summary["signals_inserted"] == 1
    inserted = inserter.call_args[0][0]
    assert len(inserted) == 1
    assert "bworldonline.com" in inserted[0].signal_source_url
    assert inserted[0].signal_date is not None
