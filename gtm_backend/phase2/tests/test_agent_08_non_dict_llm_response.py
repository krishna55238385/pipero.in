"""Regression test for a real production crash: Agent 08's knowledge-fallback
path called raw.get() assuming chat_json always returns a dict, but the LLM
occasionally returns a bare JSON array instead — this crashed the entire
`phase2 run-all` subprocess (AttributeError: 'list' object has no attribute
'get'), which killed the whole "prepare" pipeline mid-run rather than just
skipping that one competitor."""
from gtm_backend.phase2.agents.agent_08_competitive import _build_from_knowledge, _build_one

_ICP = {"id": 1, "industry": ["B2B SaaS"], "geography": ["India"], "buyer_titles": ["CEO"]}


def test_build_from_knowledge_skips_gracefully_on_list_response(mocker):
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value=["not", "a", "dict"],
    )
    card = _build_from_knowledge(_ICP, "SomeCompetitor")
    assert card is None  # skipped, not crashed


def test_build_one_skips_gracefully_on_list_response_with_snippets(mocker):
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive._gather_competitor_snippets",
        return_value=[{"title": "x", "source_url": "https://x.com", "snippet": "y"}],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive._gather_competitor_news",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value=["not", "a", "dict"],
    )
    card = _build_one(_ICP, "SomeCompetitor")
    assert card is None  # skipped, not crashed


def test_build_from_knowledge_still_works_normally_with_dict_response(mocker):
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value={
            "summary": "A fine competitor.",
            "biggest_weakness": "Slow support.",
            "who_loves_them": "Enterprise IT.",
            "who_hates_them": "Founders at SMBs.",
            "complaint_categories": [],
            "talk_tracks": [{"scenario": "differentiation", "message": "We're faster."}],
            "threat_level": "medium",
        },
    )
    card = _build_from_knowledge(_ICP, "SomeCompetitor")
    assert card is not None
    assert card.competitor_name == "SomeCompetitor"
    assert card.threat_level == "medium"
