"""Regression test for the bug found live (2026-09-03, ICP #62, Jobraux):
Lead Enrichment's location fill searched by bare company NAME ("Bloomberry"),
which collided with an unrelated, more prominent same-named company (a
Philippine casino operator) and silently overwrote a lead already correctly
resolved to a different company's domain (bloomberry.com, a New York SaaS
company) — producing a lead with a US-domain but a Philippines address, with
no way to tell from the stored data that anything had gone wrong.

Fix: search_company_location() takes the resolved domain as a disambiguator
in the query. Separately, as a backstop for when disambiguation still isn't
enough: any freshly-enriched company_country that conflicts with the ICP's
target geography (the same check Agent 02 already enforced at generation
time) is discarded rather than silently written, and the lead is flagged
needs_review with the conflicting values preserved in raw_data for a human
to resolve.
"""
from unittest.mock import patch

from gtm_backend.phase1.agents.lead_enrichment import enrich_leads

_ICP_US_TARGET = {
    "id": 62, "name": "Series B-D SaaS US", "organization_id": "org-1",
    "industry": ["SaaS"], "geography": ["United States"], "buyer_titles": ["CEO"],
}


def test_location_search_includes_domain_disambiguator():
    lead = {"id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com"}
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=_ICP_US_TARGET), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=[lead]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value=""), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_location", return_value=[]) as loc_search, \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead"):
        enrich_leads(icp_id=62)

    loc_search.assert_called_once_with("Bloomberry", domain="bloomberry.com")


def test_conflicting_country_discarded_and_flagged_not_silently_written():
    """Exact repro: enrichment's own search still finds the wrong company's
    (Philippines) address despite the domain disambiguator — this is the
    backstop that must catch it."""
    lead = {
        "id": 10554, "icp_id": 62, "company_name": "Bloomberry", "company_domain": "bloomberry.com",
        "raw_data": {"needs_review": False, "geography_confirmed_via": "homepage_check"},
    }
    company_from_llm = {
        "company_city": "Parañaque City", "company_state": "Metro Manila", "company_country": "Philippines",
        "company_industry": "Gaming",
    }
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=_ICP_US_TARGET), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=[lead]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value=""), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_location", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=company_from_llm), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        enrich_leads(icp_id=62)

    kwargs = updater.call_args.kwargs
    # The conflicting location fields must never reach the write.
    assert "company_city" not in kwargs
    assert "company_state" not in kwargs
    assert "company_country" not in kwargs
    # A non-conflicting field found in the same pass still gets written.
    assert kwargs.get("company_industry") == "Gaming"
    # Flagged for a human, with the conflicting values preserved for review.
    assert kwargs["raw_data"]["needs_review"] is True
    assert kwargs["raw_data"]["geography_conflict_at_enrichment"] == {
        "company_city": "Parañaque City", "company_state": "Metro Manila", "company_country": "Philippines",
    }
    # Earlier raw_data content (from Agent 02) is preserved, not clobbered.
    assert kwargs["raw_data"]["geography_confirmed_via"] == "homepage_check"


def test_matching_country_written_through_normally():
    """No conflict — enrichment's country matches the ICP's target geography,
    so it's written exactly as before this fix."""
    lead = {"id": 20, "icp_id": 62, "company_name": "Acme SaaS", "company_domain": "acmesaas.com"}
    company_from_llm = {"company_city": "Austin", "company_state": "TX", "company_country": "United States"}
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=_ICP_US_TARGET), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=[lead]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value=""), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_location", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=company_from_llm), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        enrich_leads(icp_id=62)

    kwargs = updater.call_args.kwargs
    assert kwargs["company_country"] == "United States"
    assert kwargs["company_city"] == "Austin"
    assert "raw_data" not in kwargs


def test_no_icp_geography_means_no_conflict_check_unaffected():
    """org-wide/no-icp enrichment (icp_id=None) has no target geography to
    check against — behavior must be completely unchanged from before this
    fix, matching Agent 02's own same conservative default."""
    lead = {"id": 30, "icp_id": None, "company_name": "Whatever Co", "company_domain": "whatever.io"}
    company_from_llm = {"company_country": "Philippines"}
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=None), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=[lead]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value=""), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_location", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=company_from_llm), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        enrich_leads()

    kwargs = updater.call_args.kwargs
    assert kwargs["company_country"] == "Philippines"
    assert "raw_data" not in kwargs
