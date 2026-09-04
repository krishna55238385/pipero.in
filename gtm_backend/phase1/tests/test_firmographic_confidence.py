"""Tests for Task #4 — Industry/company-size accuracy from verified homepage.

Agent 02's first normalize pass derives company_industry/company_size from
the search snippet alone, with no way to tell a confident read from a
baseless guess off the company name — both look equally plausible. This
second pass (_apply_firmographic_confidence) fetches each domain's own meta
description + schema.org markup and asks the LLM to grade confidence per
field against that real evidence, storing the literal "Unknown" when neither
the homepage nor the original guess is actually backed by anything.
"""
import re

from gtm_backend.phase1.agents.agent_02_leads import (
    _apply_firmographic_confidence,
    _to_lead,
)
from gtm_backend.phase1.connectors.website import (
    _JSONLD_BLOCK_RE,
    _META_DESCRIPTION_RE,
    fetch_homepage_signals,
)
from gtm_backend.phase1.core.schemas import Lead


def _homepage_html(meta_description=None, schema_org=None, extra=""):
    parts = ["<html><head>"]
    if meta_description:
        parts.append(f'<meta name="description" content="{meta_description}">')
    if schema_org:
        parts.append(f'<script type="application/ld+json">{schema_org}</script>')
    parts.append("</head><body>" + extra + "</body></html>")
    return "".join(parts)


# -- website.fetch_homepage_signals ------------------------------------------

def test_fetch_homepage_signals_extracts_meta_description_and_schema_org(mocker):
    html = _homepage_html(
        meta_description="Leading HR payroll software for Indian startups",
        schema_org='{"@type": "Organization", "numberOfEmployees": "150"}',
    )
    resp = mocker.Mock(text=html)
    resp.raise_for_status = mocker.Mock()
    mocker.patch(
        "gtm_backend.phase1.connectors.website._client.get", return_value=resp
    )
    signals = fetch_homepage_signals("acmehr.com")
    assert signals["meta_description"] == "Leading HR payroll software for Indian startups"
    assert '"numberOfEmployees"' in signals["schema_org_text"]


def test_fetch_homepage_signals_returns_none_fields_when_absent(mocker):
    html = "<html><head><title>Acme HR</title></head><body>hello</body></html>"
    resp = mocker.Mock(text=html)
    resp.raise_for_status = mocker.Mock()
    mocker.patch(
        "gtm_backend.phase1.connectors.website._client.get", return_value=resp
    )
    signals = fetch_homepage_signals("acmehr.com")
    assert signals == {"meta_description": None, "schema_org_text": None}


def test_fetch_homepage_signals_returns_empty_on_fetch_failure(mocker):
    mocker.patch(
        "gtm_backend.phase1.connectors.website._client.get",
        side_effect=Exception("connection refused"),
    )
    signals = fetch_homepage_signals("dead-domain.example")
    assert signals == {"meta_description": None, "schema_org_text": None}


def test_fetch_homepage_signals_empty_domain_short_circuits(mocker):
    get = mocker.patch("gtm_backend.phase1.connectors.website._client.get")
    assert fetch_homepage_signals("") == {"meta_description": None, "schema_org_text": None}
    assert fetch_homepage_signals(None) == {"meta_description": None, "schema_org_text": None}
    get.assert_not_called()


def test_jsonld_and_meta_regexes_are_exported_and_match():
    """Sanity check the module-level regexes used above still exist with the
    expected names — guards against a silent rename breaking these tests
    without a clear failure message."""
    assert _META_DESCRIPTION_RE.search('<meta name="description" content="x">')
    assert _JSONLD_BLOCK_RE.search('<script type="application/ld+json">{}</script>')


# -- _apply_firmographic_confidence ------------------------------------------

def test_lead_with_clear_homepage_evidence_gets_confirmed_confidence(mocker):
    """A lead whose homepage's own meta description/schema.org markup
    directly evidences industry and size gets "confirmed" — the CRM should
    show the real value, not "Unknown"."""
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals",
        return_value={
            "meta_description": "Leading HR payroll software for Indian startups",
            "schema_org_text": '{"@type": "Organization", "numberOfEmployees": "150"}',
        },
    )
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.llm.chat_json",
        return_value={
            "results": [{
                "company_name": "Acme HR",
                "industry": "HR Tech",
                "industry_confidence": "confirmed",
                "company_size": "51-200 employees",
                "company_size_confidence": "confirmed",
            }]
        },
    )
    candidates = [{
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
        "company_industry": "Software",  # original snippet-only guess
        "company_size": None,
    }]
    out = _apply_firmographic_confidence(candidates, icp_id=1)
    assert out[0]["company_industry"] == "HR Tech"
    assert out[0]["company_size"] == "51-200 employees"
    assert out[0]["_industry_confidence"] == "confirmed"
    assert out[0]["_company_size_confidence"] == "confirmed"


def test_lead_with_only_generic_snippet_gets_unknown_not_a_guess(mocker):
    """No real homepage evidence -> "unknown" confidence -> the field is
    overwritten to the literal "Unknown" sentinel, not left holding
    whatever the earlier snippet-only guess was."""
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals",
        return_value={
            "meta_description": "Welcome to our website",  # generic, no signal
            "schema_org_text": None,
        },
    )
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.llm.chat_json",
        return_value={
            "results": [{
                "company_name": "Beta Co",
                "industry": None,
                "industry_confidence": "unknown",
                "company_size": None,
                "company_size_confidence": "unknown",
            }]
        },
    )
    candidates = [{
        "company_name": "Beta Co",
        "company_domain": "betaco.com",
        "company_industry": "SaaS",  # baseless guess from the search snippet
        "company_size": 50,
    }]
    out = _apply_firmographic_confidence(candidates, icp_id=1)
    assert out[0]["company_industry"] == "Unknown"
    assert out[0]["company_size"] == "Unknown"
    assert out[0]["_industry_confidence"] == "unknown"
    assert out[0]["_company_size_confidence"] == "unknown"


def test_candidate_with_no_domain_is_left_untouched(mocker):
    fetch = mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals"
    )
    llm_call = mocker.patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json")
    candidates = [{"company_name": "No Domain Co", "company_domain": None, "company_industry": "Retail"}]
    out = _apply_firmographic_confidence(candidates, icp_id=1)
    assert out[0]["company_industry"] == "Retail"  # unchanged
    fetch.assert_not_called()
    llm_call.assert_not_called()


def test_candidate_with_no_homepage_signal_at_all_skips_llm_call(mocker):
    """A domain resolves but its homepage has neither a meta description nor
    schema.org markup — nothing for the LLM to judge, so no call is made and
    the candidate's original fields are left as-is (not forced to Unknown)."""
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals",
        return_value={"meta_description": None, "schema_org_text": None},
    )
    llm_call = mocker.patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json")
    candidates = [{"company_name": "Gamma Co", "company_domain": "gammaco.com", "company_industry": "Fintech"}]
    out = _apply_firmographic_confidence(candidates, icp_id=1)
    assert out[0]["company_industry"] == "Fintech"
    llm_call.assert_not_called()


def test_llm_failure_leaves_candidates_unchanged(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals",
        return_value={"meta_description": "Real description here", "schema_org_text": None},
    )
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.llm.chat_json",
        side_effect=Exception("LLM timeout"),
    )
    candidates = [{"company_name": "Delta Co", "company_domain": "deltaco.com", "company_industry": "Retail"}]
    out = _apply_firmographic_confidence(candidates, icp_id=1)
    assert out[0]["company_industry"] == "Retail"  # unchanged, not forced to Unknown either


# -- schemas.Lead / _to_lead: "Unknown" sentinel + backward compatibility ----

def test_lead_company_size_accepts_literal_unknown_sentinel():
    lead = Lead(icp_id=1, company_name="Beta Co", company_size="Unknown")
    assert lead.company_size == "Unknown"


def test_lead_company_size_still_parses_normal_values_unchanged():
    """Regression guard: the new sentinel must not change existing digit
    extraction behavior for real size strings."""
    assert Lead(icp_id=1, company_name="X", company_size="51-200 employees").company_size == 200
    assert Lead(icp_id=1, company_name="X", company_size="~150").company_size == 150
    assert Lead(icp_id=1, company_name="X", company_size=75).company_size == 75
    assert Lead(icp_id=1, company_name="X", company_size=None).company_size is None
    # An unparseable string with no digits and no "unknown" sentinel stays
    # None (existing behavior) — distinct from the intentional "Unknown" signal.
    assert Lead(icp_id=1, company_name="X", company_size="no idea").company_size is None


def test_to_lead_carries_confidence_flags_into_raw_data():
    item = {
        "company_name": "Acme HR",
        "company_website": "https://acmehr.com",
        "company_industry": "HR Tech",
        "company_size": "51-200 employees",
        "_industry_confidence": "confirmed",
        "_company_size_confidence": "confirmed",
    }
    lead = _to_lead(item, icp_id=1)
    assert lead.raw_data["industry_confidence"] == "confirmed"
    assert lead.raw_data["company_size_confidence"] == "confirmed"


def test_to_lead_backward_compatible_with_candidates_missing_confidence_fields():
    """A candidate dict from BEFORE this feature existed (no
    _industry_confidence/_company_size_confidence keys at all) must not
    crash _to_lead/Lead construction — this is the migration/backward-
    compatibility case explicitly called out in the task."""
    item = {
        "company_name": "Old Lead Co",
        "company_website": "https://oldleadco.com",
        "company_industry": "Retail",
        "company_size": 100,
    }
    lead = _to_lead(item, icp_id=1)
    assert lead.company_name == "Old Lead Co"
    assert lead.company_industry == "Retail"
    assert lead.company_size == 100
    assert lead.raw_data["industry_confidence"] is None
    assert lead.raw_data["company_size_confidence"] is None
