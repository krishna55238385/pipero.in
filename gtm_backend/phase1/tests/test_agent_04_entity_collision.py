"""Regression test for the bug found live (2026-09-03, ICP #62, Jobraux):
Agent 04 searched for buying signals by bare company NAME only, with no
domain/identity disambiguation. "Bloomberry" collided with an unrelated,
much more prominent Philippine casino conglomerate ("Bloomberry Resorts
Corporation") sharing that name — the real target was bloomberry.com, an
unrelated New York B2B SaaS company. Stored signals ended up being entirely
about the casino operator (funding, PAGCOR, a gaming platform launch) with
none of it actually about the real lead.

A second, distinct bug in the same incident: a signal about a THIRD PARTY
(a recruiting firm, "JK Consultants") that merely mentioned Bloomberry as
its client got misclassified as Bloomberry's own "hiring" signal — the
target was named in the text, but wasn't the one performing the action.

Fix: (1) the resolved domain is now appended to every search query
(_disambiguate_query), anchoring results to the real company instead of a
bare, ambiguous name. (2) The classification LLM now receives the resolved
company_domain explicitly, and the prompt's entity check has two parts —
same-entity (not a namesake) AND target-is-the-actor (not a bystander
merely mentioned in someone else's story).
"""
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_04_signals import (
    _classify_candidates,
    _disambiguate_query,
    detect_signals,
)


def test_disambiguate_query_appends_domain():
    assert _disambiguate_query("Bloomberry", "bloomberry.com") == 'Bloomberry "bloomberry.com"'


def test_disambiguate_query_noop_without_domain():
    assert _disambiguate_query("Bloomberry", None) == "Bloomberry"


def test_disambiguate_query_does_not_double_append():
    q = 'Bloomberry "bloomberry.com" funding'
    assert _disambiguate_query(q, "bloomberry.com") == q


def test_search_queries_carry_the_resolved_domain():
    """End-to-end repro of the exact live scenario: real query-generation
    output for an ambiguous name, confirming the domain reaches the actual
    search call regardless of what the query-generation LLM produced."""
    lead = {"id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com"}

    query_plan = {"queries": [
        {"engine": "google_news", "q": "Bloomberry", "signal_focus": "news", "num": 5},
        {"engine": "google", "q": "Bloomberry hiring careers", "signal_focus": "hiring", "num": 3},
    ]}
    seen_news_queries = []
    seen_web_queries = []

    def fake_search_news(query, days=90, num=10):
        seen_news_queries.append(query)
        return []

    def fake_search(query, num=10, days=None):
        seen_web_queries.append(query)
        return []

    def fake_llm(system, user, **_kwargs):
        return query_plan  # query-generation call only; no candidates survive to classify

    with patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_icp", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_leads_for_signals", return_value=[lead]), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search_news", side_effect=fake_search_news), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search", side_effect=fake_search), \
         patch("gtm_backend.phase1.agents.agent_04_signals.website.fetch_signal_pages", return_value=[]), \
         patch("gtm_backend.phase1.agents.agent_04_signals.llm.chat_json", side_effect=fake_llm), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.delete_signals_for_lead"), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.insert_signals", return_value=[]):
        detect_signals(icp_id=62)

    assert seen_news_queries == ['Bloomberry "bloomberry.com"']
    assert seen_web_queries == ['Bloomberry hiring careers "bloomberry.com"']


def test_two_same_named_companies_correctly_attributed_by_domain():
    """The core regression: candidates from BOTH the real target (bloomberry.com,
    NY SaaS) and an unrelated namesake (a Philippine casino operator) are
    presented to classification together. With company_domain now passed
    through and the entity check doing its job (simulated here via the
    classify response, since real judgment can't be unit-tested), only the
    genuinely-matching candidate survives — the namesake's content and the
    third-party "mentioned, not the actor" candidate are both discarded as
    "none"/"na", never silently attributed to the target."""
    lead = {"id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com"}
    candidates = [
        {  # Real target — genuinely about bloomberry.com.
            "signal_text": "Bloomberry raises $12M to expand its B2B technographic platform",
            "source": "https://techcrunch.com/2026/08/20/bloomberry-raises-12m",
            "date": None,
        },
        {  # Namesake collision — unrelated Philippine casino operator.
            "signal_text": "Bloomberry confirms launch of FUNaloMAX gaming platform, backed by PAGCOR",
            "source": "https://www.ggrasia.com/bloomberry-funalomax-pagcor",
            "date": None,
        },
        {  # Third party merely mentions the target — not the actor.
            "signal_text": "JK Consultants is currently recruiting a VP Sales for its client Bloomberry",
            "source": "https://jkconsultants.example/openings/vp-sales-bloomberry",
            "date": None,
        },
    ]
    classify_response = {"results": [
        {"id": 0, "signal_type": "funding", "buying_intent": "high"},
        {"id": 1, "signal_type": "none", "buying_intent": "na"},   # namesake — entity check (a) fails
        {"id": 2, "signal_type": "none", "buying_intent": "na"},   # third-party actor — entity check (b) fails
    ]}
    seen_payload = {}

    def fake_llm(system, user, **_kwargs):
        import json
        seen_payload["value"] = json.loads(user)
        return classify_response

    with patch("gtm_backend.phase1.agents.agent_04_signals.llm.chat_json", side_effect=fake_llm):
        signals, na_count = _classify_candidates(lead, candidates, icp_id=62)

    # The classification payload carried the real domain for the LLM to check against.
    assert seen_payload["value"]["company_domain"] == "bloomberry.com"

    # Only the genuinely-matching signal survives.
    assert len(signals) == 1
    assert signals[0].signal_type == "funding"
    assert "techcrunch.com" in signals[0].signal_source_url
    assert na_count == 2
