"""Regression test for the bug found running the full pipeline live
(2026-09-02, ICP #57, Jobraux): Task #3's strict unclear-geography rejection
combined with an LLM normalization failure to produce ZERO leads for any
country-scoped ICP.

Root cause: when the LLM normalize call fails, agent_02_leads falls back to
_fallback_normalize (regex-only) — candidates from that path never carry a
geography_confidence field (it only exists in the LLM's structured output).
Task #3's check treated missing confidence as "not confirmed" and rejected
every such candidate whenever the ICP had a target country, so a single LLM
failure zeroed out results entirely — worse than the old permissive
behavior this was meant to improve on.

Fix: the strict unclear-geography check is skipped entirely for candidates
tagged _normalization_method == "regex_fallback" — they still carry
needs_review=True (unchanged, existing signal for "unverified"), they're
just no longer silently deleted before a human ever sees them.
"""
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_02_leads import generate_leads

_ICP_INDIA_TARGET = {
    "id": 57, "name": "B2B SaaS in India", "organization_id": "org-1",
    "industry": ["SaaS"], "geography": ["India"],
}


def test_llm_failure_regex_fallback_candidates_survive_country_scoped_icp():
    """The exact broken scenario: LLM normalize call raises on every page,
    forcing the regex-only fallback. With a target-country ICP, these
    candidates must NOT be auto-rejected for missing geography_confidence —
    they should reach insertion (flagged needs_review), not be silently
    dropped to zero."""
    search_results = [
        {"title": "Acme HR - HR Software for India", "link": "https://acmehr.com", "snippet": "..."},
        {"title": "Beta SaaS Tools", "link": "https://betasaas.io", "snippet": "..."},
    ]
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=_ICP_INDIA_TARGET), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", side_effect=ValueError("invalid JSON from LLM")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1, 2]) as inserter:
        summary = generate_leads(icp_id=57, max_leads=20, min_leads=2)

    # The core regression assertion: candidates actually got inserted, not
    # zeroed out by the geography check.
    assert summary["leads_inserted"] == 2
    assert summary["rejected_unclear_geography"] == 0

    inserted_leads = inserter.call_args[0][0]
    assert {lead.company_name for lead in inserted_leads} == {"Acme HR", "Beta SaaS Tools"}
    # Still flagged for human review — the appropriate signal for
    # unverified geography, not silent deletion.
    for lead in inserted_leads:
        assert lead.raw_data["needs_review"] is True
        assert lead.raw_data["normalization_method"] == "regex_fallback"


def test_llm_success_still_enforces_strict_geography_unchanged():
    """Regression guard in the other direction: when the LLM path DOES
    succeed and explicitly reports unclear geography, the strict rejection
    from Task #3 must still fire exactly as before — the exemption is
    scoped to the regex-fallback path only."""
    search_results = [{"title": "Acme HR", "link": "https://acmehr.com", "snippet": "..."}]
    normalized = {"companies": [{
        "company_name": "Acme HR", "company_website": "https://acmehr.com",
        "source_url": "https://acmehr.com", "geography_confidence": "unclear",
    }]}
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=_ICP_INDIA_TARGET), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[]) as inserter:
        summary = generate_leads(icp_id=57, max_leads=20, min_leads=1)

    assert summary["leads_inserted"] == 0
    assert summary["rejected_unclear_geography"] >= 1
    inserter.assert_called_once_with([])


def test_icp_without_target_country_unaffected_by_this_fix():
    """No target country set -> the geography check never fires for either
    path anyway; confirms the fix doesn't change behavior when there's
    nothing to exempt in the first place."""
    icp_no_country = {"id": 58, "name": "Global SaaS", "organization_id": "org-1", "industry": ["SaaS"], "geography": []}
    search_results = [{"title": "Acme HR", "link": "https://acmehr.com", "snippet": "..."}]
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=icp_no_country), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", side_effect=ValueError("invalid JSON from LLM")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1]) as inserter:
        summary = generate_leads(icp_id=58, max_leads=20, min_leads=1)

    assert summary["leads_inserted"] == 1
    assert summary["rejected_unclear_geography"] == 0
