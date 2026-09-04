"""Regression tests for the systemic entity-collision fix (2026-09-03, ICP
#62, Jobraux — see phase1/tests/test_agent_04_entity_collision.py for the
originating incident). Same root cause found in phase2's Agent 06 (account
intelligence) and Agent 08 (competitive intel): searching for a company by
bare name, with no domain/identity disambiguator, lets an unrelated
same-named company's content get mixed in.

Fix, applied identically to Agent 04's: append the resolved domain to the
search query, and pass the domain through to the extraction/classification
LLM so its entity check has real identity evidence to check against instead
of judging on name alone.
"""
from unittest.mock import patch

from gtm_backend.phase2.agents.agent_06_account_intel import _gather_news
from gtm_backend.phase2.agents.agent_08_competitive import (
    _gather_competitor_news,
    _gather_competitor_snippets,
)


def test_agent_06_news_search_includes_domain_disambiguator():
    seen = {}

    def fake_search_news(query, days=90, num=10):
        seen["query"] = query
        return []

    with patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news", side_effect=fake_search_news):
        _gather_news("Bloomberry", "bloomberry.com")

    assert '"bloomberry.com"' in seen["query"]


def test_agent_06_news_search_degrades_gracefully_without_domain():
    """No domain resolved yet — must not crash, just search by name alone
    (same as before this fix), since a lead with no domain never reaches
    this call in practice (Agent 06 skips leads with no domain outright)."""
    seen = {}

    def fake_search_news(query, days=90, num=10):
        seen["query"] = query
        return []

    with patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news", side_effect=fake_search_news):
        _gather_news("Bloomberry", None)

    assert seen["query"] == (
        '"Bloomberry" (funding OR raised OR hired OR layoffs OR launched OR acquired OR partnership)'
    )


def test_agent_08_competitor_search_includes_domain_disambiguator():
    seen_snippets = {}
    seen_news = {}

    def fake_search(query, num=10):
        seen_snippets["query"] = query
        return []

    def fake_search_news(query, days=90, num=10):
        seen_news["query"] = query
        return []

    with patch("gtm_backend.phase2.agents.agent_08_competitive.serpapi.search", side_effect=fake_search), \
         patch("gtm_backend.phase2.agents.agent_08_competitive.serpapi.search_news", side_effect=fake_search_news):
        _gather_competitor_snippets("Bloomberry", "bloomberry.com")
        _gather_competitor_news("Bloomberry", "bloomberry.com")

    assert '"bloomberry.com"' in seen_snippets["query"]
    assert '"bloomberry.com"' in seen_news["query"]


def test_agent_08_resolves_and_stores_competitor_domain(mocker):
    """competitor_domain used to be hardcoded None (see _card_from_raw) —
    confirm a resolved domain is now both used for search disambiguation
    AND actually persisted on the stored Competitor card."""
    from gtm_backend.phase2.agents.agent_08_competitive import _build_one

    icp = {"id": 5, "industry": ["SaaS"], "geography": ["US"], "buyer_titles": ["CEO"]}
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.dns_lookup.discover_domain",
        return_value="bloomberry.com",
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.serpapi.search",
        return_value=[{"title": "Bloomberry pricing", "snippet": "...", "link": "https://bloomberry.com/pricing"}],
    )
    mocker.patch("gtm_backend.phase2.agents.agent_08_competitive.serpapi.search_news", return_value=[])
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value={
            "summary": "...", "biggest_weakness": "...", "who_loves_them": "...", "who_hates_them": "...",
            "complaint_categories": [], "talk_tracks": [], "threat_level": "medium",
        },
    )
    card = _build_one(icp, "Bloomberry")

    assert card is not None
    assert card.competitor_domain == "bloomberry.com"
