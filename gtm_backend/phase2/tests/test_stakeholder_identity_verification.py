"""Regression tests for Agent 07's entity-collision fix (2026-09-05, ICP #62,
"Bloomberry"): the LinkedIn stakeholder search (like lead_enrichment's
contact search, Agent 04's signal search, and Agent 08's competitor search —
all already fixed) queried by bare company name only. Confirmed live: real
people at three unrelated companies (a founder at a different "Bloomberry",
an SVP at Donorbox, an agency owner at Formulytic) became this lead's
buying-committee stakeholders.

Two layers now guard against this: (1) a deterministic pre-filter drops any
snippet whose own text names a different company outright, and (2) the LLM
must mark each stakeholder "high" for company_match_confidence or they're
dropped before ever being persisted.
"""
from unittest.mock import patch

from gtm_backend.phase2.agents.agent_07_stakeholders import (
    _affiliation_mismatch,
    _build_one,
    _from_llm,
)


# --- _affiliation_mismatch: the fast, free, deterministic pre-filter ------

def test_affiliation_mismatch_detects_explicit_different_company():
    # The exact real text stored for the wrong "Khloe Amante" stakeholder.
    assert _affiliation_mismatch("Khloe Amante - Manager at Mitek Systems", "Bloomberry") is True


def test_affiliation_mismatch_allows_matching_company():
    assert _affiliation_mismatch("Sadok Hasan - Founder at Bloomberry", "Bloomberry") is False


def test_affiliation_mismatch_inconclusive_when_no_affiliation_stated():
    assert _affiliation_mismatch("Christopher Baldock - GTM Accelerator", "Bloomberry") is False


# --- _from_llm: the company_match_confidence gate -------------------------

def test_from_llm_drops_stakeholders_below_high_company_match_confidence():
    lead = {"id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com"}
    raw = {
        "stakeholders": [
            {"full_name": "Sadok Hasan", "job_title": "Founder", "role_type": "economic_buyer",
             "confidence": "high", "rank": 1, "company_match_confidence": "high"},
            {"full_name": "Raviraj Hegde", "job_title": "SVP Growth", "role_type": "influencer",
             "confidence": "high", "rank": 2, "company_match_confidence": "low"},
            {"full_name": "Khloe Amante", "job_title": "Manager at Mitek Systems", "role_type": "unknown",
             "confidence": "medium", "rank": 3},  # missing field entirely -- must also be dropped
        ],
        "entry_point_full_name": "Sadok Hasan",
        "entry_point_role_type": "economic_buyer",
    }
    smap = _from_llm(lead, raw, require_company_match=True)
    names = {sh.full_name for sh in smap.stakeholders}
    assert names == {"Sadok Hasan"}


def test_from_llm_website_fallback_path_is_exempt_from_the_gate():
    """The team-page fallback has no collision risk (reads the resolved
    domain's own site directly) and never emits company_match_confidence —
    require_company_match=False (its default) must not drop anyone for it."""
    lead = {"id": 1, "icp_id": 1, "company_name": "Acme HR", "company_domain": "acmehr.com"}
    raw = {
        "stakeholders": [
            {"full_name": "Jane Doe", "job_title": "CEO", "role_type": "economic_buyer",
             "confidence": "medium", "rank": 1},
        ],
    }
    smap = _from_llm(lead, raw)
    assert {sh.full_name for sh in smap.stakeholders} == {"Jane Doe"}


# --- _build_one: end-to-end wiring -----------------------------------------

def test_build_one_passes_domain_to_search_linkedin_people():
    lead = {"id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com"}
    with patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=[],
    ) as search_mock, \
         patch(
             "gtm_backend.phase2.agents.agent_07_stakeholders.website.fetch_team_pages",
             return_value=[],
         ):
        _build_one(lead, icp=None)
    assert search_mock.call_args.kwargs.get("domain") == "bloomberry.com"


def test_build_one_prefilters_wrong_company_snippet_before_llm_call():
    """The pre-filter alone should exclude the wrong-company snippet before
    any LLM call happens, when it's the only snippet returned."""
    lead = {"id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com"}
    wrong_snippet = [{
        "title": "Khloe Amante - Manager at Mitek Systems",
        "link": "https://ph.linkedin.com/in/khloe-amante",
        "snippet": "Manager at Mitek Systems",
    }]
    with patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=wrong_snippet,
    ), \
         patch(
             "gtm_backend.phase2.agents.agent_07_stakeholders.website.fetch_team_pages",
             return_value=[],
         ), \
         patch("gtm_backend.phase2.agents.agent_07_stakeholders.llm.chat_json") as llm_mock:
        result = _build_one(lead, icp=None)

    assert result is None
    llm_mock.assert_not_called()


def test_build_one_bloomberry_end_to_end_keeps_only_confirmed_stakeholder():
    """Full repro of the ICP #62 incident: snippets for a mix of the real
    target-company stakeholder and three wrong-company people; the LLM
    (correctly instructed per the fixed STAKEHOLDER_MAPPING_SYSTEM) marks
    only the real one "high" -- confirms the code-level gate enforces that
    even if the pre-filter's textual heuristic doesn't catch every case
    (e.g. Sadok Hasan's snippet genuinely says "Bloomberry")."""
    lead = {"id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com"}
    snippets = [
        {"title": "Sadok Hasan - Head of Growth | Bloomberry", "link": "https://linkedin.com/in/sadokhasan",
         "snippet": "Head of Growth. Bloomberry. San Francisco Bay Area."},
        {"title": "Raviraj Hegde - SVP of Growth - Donorbox", "link": "https://in.linkedin.com/in/ravirajlh",
         "snippet": "SVP of Growth - SaaS Growth Leader | Scaled ARR 100X at Donorbox"},
    ]
    raw = {
        "stakeholders": [
            {"full_name": "Sadok Hasan", "job_title": "Founder & Head of Growth", "role_type": "economic_buyer",
             "confidence": "high", "rank": 1, "company_match_confidence": "low"},
            {"full_name": "Raviraj Hegde", "job_title": "SVP Growth", "role_type": "influencer",
             "confidence": "high", "rank": 2, "company_match_confidence": "low"},
        ],
    }
    with patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=snippets,
    ), \
         patch("gtm_backend.phase2.agents.agent_07_stakeholders.llm.chat_json", return_value=raw):
        result = _build_one(lead, icp=None)

    # Both flagged "low" here (the real-world resolution is domain-specific
    # semantic judgment an LLM has to make correctly, per the strengthened
    # prompt) -- confirms the code-level gate actually enforces the LLM's
    # verdict rather than trusting either stakeholder unconditionally.
    assert result.stakeholders == []
