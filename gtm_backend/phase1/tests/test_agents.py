"""Integration tests for the 5 agents — all external APIs mocked.

Each test asserts the agent's correct behavior end-to-end: it reads the right
data, calls the right connectors with the right args, and writes the right
result back.
"""
from unittest.mock import patch

import pytest

from gtm_backend.phase1.agents.agent_01_icp import define_icp
from gtm_backend.phase1.agents.agent_02_leads import generate_leads
from gtm_backend.phase1.agents.lead_enrichment import enrich_leads
from gtm_backend.phase1.agents.agent_04_signals import detect_signals
from gtm_backend.phase1.agents.agent_03_icp_scoring import score_leads


# Agent 01 ---------------------------------------------------------------

def test_agent_01_inserts_icp():
    icp_dict = {
        "name": "Test ICP",
        "product_line": "Core",
        "industry": ["SaaS"],
        "geography": ["India"],
        "buyer_titles": ["CEO"],
    }
    with patch("gtm_backend.phase1.agents.agent_01_icp.llm.chat_json", return_value=icp_dict), \
         patch("gtm_backend.phase1.agents.agent_01_icp.supabase.insert_icp", return_value=42) as inserter:
        icp_id = define_icp("HR-tech SaaS in India")
    assert icp_id == 42
    inserter.assert_called_once()


def test_agent_01_rejects_empty_prompt():
    with pytest.raises(ValueError):
        define_icp("")


def test_agent_01_backfills_null_product_line_from_org_product_description():
    """Found live 2026-08-22: the LLM sometimes returns an explicit
    "product_line": null instead of the string "Core" the prompt asks for
    when no product is mentioned — an explicit None bypasses the Pydantic
    field default entirely and used to crash model_validate. Must fall back
    to the org's own configured product description first."""
    icp_dict = {
        "name": "Test ICP", "product_line": None,
        "industry": ["SaaS"], "geography": ["India"], "buyer_titles": ["CEO"],
    }
    with patch("gtm_backend.phase1.agents.agent_01_icp.llm.chat_json", return_value=icp_dict), \
         patch("gtm_backend.phase1.agents.agent_01_icp.crm_supabase.get_current_org_product_description", return_value="AI GTM automation platform"), \
         patch("gtm_backend.phase1.agents.agent_01_icp.supabase.insert_icp", return_value=42) as inserter:
        icp_id = define_icp("Series A-C SaaS in India")

    assert icp_id == 42
    inserted_icp = inserter.call_args[0][0]
    assert inserted_icp.product_line == "AI GTM automation platform"


def test_agent_01_backfills_missing_product_line_key_too():
    """Same fallback must apply when the key is omitted entirely, not just
    when it's explicitly null."""
    icp_dict = {
        "name": "Test ICP",
        "industry": ["SaaS"], "geography": ["India"], "buyer_titles": ["CEO"],
    }
    with patch("gtm_backend.phase1.agents.agent_01_icp.llm.chat_json", return_value=icp_dict), \
         patch("gtm_backend.phase1.agents.agent_01_icp.crm_supabase.get_current_org_product_description", return_value="AI GTM automation platform"), \
         patch("gtm_backend.phase1.agents.agent_01_icp.supabase.insert_icp", return_value=42) as inserter:
        define_icp("Series A-C SaaS in India")

    assert inserter.call_args[0][0].product_line == "AI GTM automation platform"


def test_agent_01_falls_back_to_core_when_no_org_product_description_set():
    """When the org hasn't set a product description in Settings either,
    fall back to the schema's own generic "Core" default rather than
    crashing or inserting an empty string."""
    icp_dict = {
        "name": "Test ICP", "product_line": None,
        "industry": ["SaaS"], "geography": ["India"], "buyer_titles": ["CEO"],
    }
    with patch("gtm_backend.phase1.agents.agent_01_icp.llm.chat_json", return_value=icp_dict), \
         patch("gtm_backend.phase1.agents.agent_01_icp.crm_supabase.get_current_org_product_description", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_01_icp.supabase.insert_icp", return_value=42) as inserter:
        define_icp("Series A-C SaaS in India")

    assert inserter.call_args[0][0].product_line == "Core"


def test_agent_01_does_not_call_product_description_lookup_when_llm_provided_one():
    """The org-settings lookup is a fallback, not the primary source — must
    not fire (extra DB round trip) when the LLM already gave a real value."""
    icp_dict = {
        "name": "Test ICP", "product_line": "Billing software",
        "industry": ["SaaS"], "geography": ["India"], "buyer_titles": ["CEO"],
    }
    with patch("gtm_backend.phase1.agents.agent_01_icp.llm.chat_json", return_value=icp_dict), \
         patch("gtm_backend.phase1.agents.agent_01_icp.crm_supabase.get_current_org_product_description") as lookup_mock, \
         patch("gtm_backend.phase1.agents.agent_01_icp.supabase.insert_icp", return_value=42):
        define_icp("Series A-C SaaS in India")

    lookup_mock.assert_not_called()


# Agent 02 ---------------------------------------------------------------

def test_agent_02_dedups_and_inserts(sample_icp):
    search_results = [
        {"title": "Acme HR | Best HR Tech", "link": "https://acmehr.com", "snippet": "..."},
        {"title": "Beta HR Tools", "link": "https://betahr.io", "snippet": "..."},
    ]
    normalized = {
        "companies": [
            {"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com"},
            {"company_name": "Beta HR Tools", "company_website": "https://betahr.io", "source_url": "https://betahr.io"},
        ]
    }
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value={"acme hr"}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value={"acmehr.com"}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1]) as inserter:
        summary = generate_leads(icp_id=1, max_leads=20)
    assert summary["leads_inserted"] == 1
    inserter.assert_called_once()
    inserted_leads = inserter.call_args[0][0]
    assert inserted_leads[0].company_name == "Beta HR Tools"


def test_agent_02_rejects_known_wrong_country(sample_icp):
    """sample_icp geography includes 'India' — a candidate whose LLM-derived
    company_country is a KNOWN different country (not just unresolved/blank)
    must be dropped, since SerpAPI's gl= param is only a ranking bias and lets
    other-country results leak through organic search."""
    search_results = [
        {"title": "Acme HR | Best HR Tech", "link": "https://acmehr.com", "snippet": "..."},
        {"title": "Beta HR Tools", "link": "https://betahr.io", "snippet": "..."},
        {"title": "Gamma HR", "link": "https://gammahr.com", "snippet": "..."},
    ]
    normalized = {
        "companies": [
            {"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com", "company_country": "India"},
            {"company_name": "Beta HR Tools", "company_website": "https://betahr.io", "source_url": "https://betahr.io", "company_country": "United States"},
            {"company_name": "Gamma HR", "company_website": "https://gammahr.com", "source_url": "https://gammahr.com", "company_country": None},
        ]
    }
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1, 2]) as inserter:
        # min_leads=2 so the pagination loop stops after page 1 — otherwise it
        # keeps re-fetching (mocked to return the same 3 results every page)
        # trying to reach the default min_leads=8, inflating geo_rejected by
        # re-processing the same candidates on each page.
        summary = generate_leads(icp_id=1, max_leads=20, min_leads=2)

    # Beta (United States) rejected; Acme (India) and Gamma (unknown/blank) kept.
    assert summary["geo_rejected"] == 1
    assert summary["leads_inserted"] == 2
    inserted_leads = inserter.call_args[0][0]
    inserted_names = {lead.company_name for lead in inserted_leads}
    assert inserted_names == {"Acme HR", "Gamma HR"}
    assert "Beta HR Tools" not in inserted_names


def test_agent_02_region_geography_accepts_both_countries():
    """geography=['North America'] must accept BOTH US and Canada, not just US
    (the single-value SerpAPI gl='us' param is a separate, narrower concern)."""
    from gtm_backend.phase1.agents.agent_02_leads import _expected_country_codes, _country_mismatch

    codes = _expected_country_codes(["North America"])
    assert codes == {"us", "ca"}
    assert _country_mismatch("Canada", codes) is False
    assert _country_mismatch("United States", codes) is False
    assert _country_mismatch("Pakistan", codes) is True
    assert _country_mismatch(None, codes) is False  # unknown never rejected
    assert _country_mismatch("Freedonia", codes) is False  # unmapped never rejected


def test_agent_02_scrubs_internally_contradictory_location(sample_icp):
    """Root-caused bug: Agent 02's batched LLM call sometimes cross-attributes
    fields between different companies named in the same shared article (a
    multi-company roundup post), producing self-contradictory combos like
    company_state='California' + company_country='India'. That must be
    scrubbed (nulled) rather than trusted or dropped outright — the company
    name/domain are still likely fine, only the location fields are suspect."""
    search_results = [
        {"title": "Delight AI builds AI agents ... with Supabase, Vercel", "link": "https://supabase.com", "snippet": "..."},
        {"title": "Beta HR Tools", "link": "https://betahr.io", "snippet": "..."},
    ]
    normalized = {
        "companies": [
            # Cross-contaminated: Supabase's own record ends up tagged with
            # California (correct-ish, coincidentally) + India (wrong, bled in
            # from the ICP-matching company also named in the shared article).
            {
                "company_name": "Supabase", "company_website": "https://supabase.com",
                "source_url": "https://supabase.com",
                "company_city": "San Francisco", "company_state": "California",
                "company_country": "India",
            },
            {
                "company_name": "Beta HR Tools", "company_website": "https://betahr.io",
                "source_url": "https://betahr.io",
                "company_city": "Bangalore", "company_state": "Karnataka",
                "company_country": "India",
            },
        ]
    }
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1, 2]) as inserter:
        summary = generate_leads(icp_id=1, max_leads=20, min_leads=2)

    assert summary["location_scrubbed"] == 1
    assert summary["leads_inserted"] == 2  # both kept — only the bad fields are nulled, not the whole lead
    inserted_leads = {lead.company_name: lead for lead in inserter.call_args[0][0]}
    supabase_lead = inserted_leads["Supabase"]
    assert supabase_lead.company_city is None
    assert supabase_lead.company_state is None
    assert supabase_lead.company_country is None
    beta_lead = inserted_leads["Beta HR Tools"]
    assert beta_lead.company_city == "Bangalore"  # untouched — internally consistent


def test_location_internally_inconsistent_helper():
    from gtm_backend.phase1.agents.agent_02_leads import _location_internally_inconsistent

    assert _location_internally_inconsistent("San Francisco", "California", "India") is True
    assert _location_internally_inconsistent("Bangalore", "Karnataka", "United States") is True
    assert _location_internally_inconsistent("San Francisco", "California", "United States") is False
    assert _location_internally_inconsistent("Bangalore", "Karnataka", "India") is False
    assert _location_internally_inconsistent(None, None, None) is False
    assert _location_internally_inconsistent("Tallinn", None, "Estonia") is False  # unmapped state, never flagged
    assert _location_internally_inconsistent("Freedonia City", "Freedonia", "India") is False  # unknown state


# Agent 03 ---------------------------------------------------------------

def test_agent_03_finds_contact_and_verifies_email(sample_icp):
    pending = [{
        "id": 99,
        "icp_id": 1,
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
    }]
    contact = {
        "contact_name": "Priya Iyer",
        "contact_title": "CEO",
        "contact_linkedin_url": "https://linkedin.com/in/priya",
    }
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=pending), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[{"title": "Priya - CEO"}]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value=""), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=contact), \
         patch("gtm_backend.phase1.agents.lead_enrichment.disify.verify_email", return_value={"verified": True, "bounce_status": "valid"}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        summary = enrich_leads(icp_id=1)
    assert summary["leads_enriched"] == 1
    updater.assert_called_once()
    kwargs = updater.call_args.kwargs
    assert kwargs["contact_name"] == "Priya Iyer"
    assert kwargs["verified"] is True


def test_agent_03_fills_company_details_without_contact(sample_icp):
    """Company-level fields (location, phone, industry, size, LinkedIn) get
    written from website + Hunter metadata even when no contact is found."""
    pending = [{
        "id": 7,
        "icp_id": 1,
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
    }]
    company = {
        "company_city": "Bangalore",
        "company_state": "Karnataka",
        "company_country": "India",
        "company_address": "12 MG Road, Bangalore",
        "company_phone": "+91-80-555-1234",
        "company_industry": "HR Technology",
        "company_size": "51-200 employees",
        "company_linkedin_url": "https://linkedin.com/company/acmehr",
    }
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=pending), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value="Acme HR is headquartered in Bangalore."), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={"country": "India", "linkedin": "https://linkedin.com/company/acmehr"}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=company), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        summary = enrich_leads(icp_id=1)
    assert summary["leads_enriched"] == 1
    updater.assert_called_once()
    kwargs = updater.call_args.kwargs
    assert kwargs["company_city"] == "Bangalore"
    assert kwargs["company_country"] == "India"
    assert kwargs["company_phone"] == "+91-80-555-1234"
    assert kwargs["company_linkedin_url"].endswith("/acmehr")
    # No contact was found, so contact fields are absent.
    assert "contact_name" not in kwargs


def test_agent_03_drops_literal_null_strings(sample_icp):
    """LLMs sometimes return the string 'null'/'n/a' — these must not be stored."""
    pending = [{"id": 8, "icp_id": 1, "company_name": "Acme HR", "company_domain": "acmehr.com"}]
    company = {
        "company_city": "null",          # literal string, must be dropped
        "company_state": "N/A",          # must be dropped
        "company_country": "Ireland",    # real value, kept
        "company_address": "  ",         # blank, dropped
        "company_phone": "null",         # dropped
        "company_industry": "IT Services",
        "company_size": "null",          # dropped
        "company_linkedin_url": None,
    }
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=pending), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value="Acme HR, an IT services firm in Ireland."), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=company), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        enrich_leads(icp_id=1)
    kwargs = updater.call_args.kwargs
    assert kwargs == {"company_country": "Ireland", "company_industry": "IT Services"}


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("51-200 employees", "51-200"),
        ("approx 120", "51-200"),
        ("we are a team of 8", "1-10"),
        ("5,000 staff", "1000+"),
        ("201-500", "201-500"),
        ("1000+", "1000+"),
        ("about 1,000-5,000 people", "1000+"),
        ("750 employees", "501-1000"),
        ("", None),
        ("a small startup", None),  # no number -> can't normalize here (LLM should band it)
        ("11-50", "11-50"),
    ],
)
def test_size_band_normalization(raw, expected):
    """Any headcount expression maps to a canonical employee band."""
    from gtm_backend.phase1.agents.lead_enrichment import _normalize_size_band

    assert _normalize_size_band(raw) == expected


def test_agent_03_uses_location_and_size_search_and_bands_size(sample_icp):
    """When location/size are missing, the agent runs the HQ-location and
    employee-count web searches and feeds those snippets to the LLM; a free-text
    headcount from the LLM is normalized into a canonical band before storage."""
    pending = [{"id": 11, "icp_id": 1, "company_name": "Acme HR", "company_domain": "acmehr.com"}]
    llm_company = {
        "company_city": "Bengaluru",
        "company_state": "Karnataka",
        "company_country": "India",
        "company_size": "approx 300 employees",  # free text -> should become 201-500
    }
    loc_hits = [{"title": "Acme HR HQ", "link": "https://x", "snippet": "Headquarters: Bengaluru, India"}]
    size_hits = [{"title": "Acme HR | LinkedIn", "link": "https://l", "snippet": "Company size 201-500 employees"}]

    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=pending), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value=""), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_location", return_value=loc_hits) as loc_search, \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_size", return_value=size_hits) as size_search, \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=llm_company) as llm_mock, \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        enrich_leads(icp_id=1)

    loc_search.assert_called_once_with("Acme HR")
    size_search.assert_called_once_with("Acme HR")
    # The LLM payload carried the search snippets so it had evidence to work from.
    payload = llm_mock.call_args.args[1]
    assert "Bengaluru" in payload and "201-500" in payload
    kwargs = updater.call_args.kwargs
    assert kwargs["company_city"] == "Bengaluru"
    assert kwargs["company_country"] == "India"
    assert kwargs["company_size"] == "201-500"  # normalized from "approx 300 employees"


def test_agent_03_backfills_location_size_without_reclobbering(sample_icp):
    """A lead that already has an email but is missing location/size gets those
    backfilled on a re-run, while existing good fields are never overwritten and
    the (expensive) contact lookup is skipped."""
    pending = [{
        "id": 12,
        "icp_id": 1,
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
        "contact_email": "ceo@acmehr.com",   # already enriched contact
        "contact_name": "Priya Iyer",
        "verified": True,
        "company_industry": "HR Tech",       # already good — must NOT be clobbered
    }]
    llm_company = {
        "company_city": "Pune",
        "company_country": "India",
        "company_industry": "WRONG — should be ignored",  # lead already has industry
        "company_size": "11-50",
    }
    with patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.get_leads_for_enrichment", return_value=pending), \
         patch("gtm_backend.phase1.agents.lead_enrichment.website.fetch_text", return_value=""), \
         patch("gtm_backend.phase1.agents.lead_enrichment.hunter.domain_metadata", return_value={}), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_location", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_company_size", return_value=[]), \
         patch("gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin") as linkedin_search, \
         patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json", return_value=llm_company), \
         patch("gtm_backend.phase1.agents.lead_enrichment.supabase.update_lead") as updater:
        summary = enrich_leads(icp_id=1)

    assert summary["leads_enriched"] == 1
    # Contact already on file -> no LinkedIn people search, no re-verification.
    linkedin_search.assert_not_called()
    kwargs = updater.call_args.kwargs
    assert kwargs["company_city"] == "Pune"
    assert kwargs["company_size"] == "11-50"
    # Pre-existing good field preserved; no contact fields re-written.
    assert "company_industry" not in kwargs
    assert "contact_email" not in kwargs


def test_get_leads_for_enrichment_includes_missing_location_size():
    """The enrichment selector must pull leads that have an email but are still
    missing HQ city/country/size, so backfill re-runs find them."""
    from gtm_backend.phase1.connectors import supabase as sb

    with patch.object(sb, "_get", return_value=[]) as getter:
        sb.get_leads_for_enrichment(icp_id=1)
    params = getter.call_args.kwargs["params"]
    or_clause = params["or"]
    assert "contact_email.is.null" in or_clause
    assert "company_city.is.null" in or_clause
    assert "company_country.is.null" in or_clause
    assert "company_size.is.null" in or_clause


# Agent 04 ---------------------------------------------------------------

def test_agent_04_generates_queries_then_classifies_signals(sample_icp):
    """New contract:
       1) Agent loads the ICP and asks the LLM for tailored search queries.
       2) Each SerpAPI candidate goes through a per-candidate LLM classify call
          returning {signal_type, buying_intent}. intent=na is dropped.
    """
    leads = [{"id": 5, "icp_id": 1, "company_name": "Acme HR", "company_industry": "HR Tech", "company_country": "India"}]
    news_article = {
        "title": "Acme HR raises $5M Series A",
        "snippet": "led by Sequoia",
        "link": "https://news/funding",
    }
    web_result = {
        "title": "Acme HR Careers — We're hiring",
        "snippet": "Open roles for engineers",
        "link": "https://acmehr.com/careers",
    }

    def fake_news(query, days=90, num=10):
        return [news_article] if query else []

    def fake_web(query, num=10):
        return [web_result] if "hiring" in query else []

    query_plan = {
        "queries": [
            {"engine": "google_news", "q": "Acme HR funding", "signal_focus": "funding", "num": 3},
            {"engine": "google", "q": "Acme HR hiring careers", "signal_focus": "hiring", "num": 3},
        ]
    }
    batch_classify = {
        "results": [
            {"id": 0, "signal_type": "funding", "buying_intent": "high"},
            {"id": 1, "signal_type": "hiring", "buying_intent": "low"},
        ]
    }
    llm_responses = iter([query_plan, batch_classify])

    def fake_llm(system, user, **_kwargs):
        try:
            return next(llm_responses)
        except StopIteration:
            return {"results": []}

    with patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_leads_for_signals", return_value=leads), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search_news", side_effect=fake_news), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search", side_effect=fake_web), \
         patch("gtm_backend.phase1.agents.agent_04_signals.llm.chat_json", side_effect=fake_llm) as llm_mock, \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.delete_signals_for_lead") as deleter, \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.insert_signals", return_value=[1, 2]) as inserter:
        summary = detect_signals(icp_id=1)

    # Idempotent refresh: the examined lead's prior signals are cleared first.
    deleter.assert_called_once_with(5)

    first_call_user = llm_mock.call_args_list[0].args[1]
    assert "Acme HR" in first_call_user
    assert "HR Tech" in first_call_user

    assert summary["signals_detected"] >= 1
    inserter.assert_called_once()
    inserted = inserter.call_args[0][0]
    for signal in inserted:
        assert signal.buying_intent in {"high", "low"}
        assert signal.signal_type in {"funding", "leadership_change", "hiring", "expansion", "competitor_complaint"}
        assert 1 <= signal.weight <= 10
        assert signal.signal_text
        assert signal.signal_source_url
    funding_high = [s for s in inserted if s.signal_type == "funding" and s.buying_intent == "high"]
    assert funding_high and funding_high[0].weight == 10


def test_agent_04_falls_back_to_static_queries_on_llm_failure(sample_icp):
    """If query-generation LLM fails, agent must still run with a sensible fallback."""
    leads = [{"id": 9, "icp_id": 1, "company_name": "Beta HR"}]

    def fake_news(query, days=90, num=10):
        return [{"title": "Beta HR news", "snippet": "...", "link": f"https://n/{query}"}]

    def fake_llm(system, user, **_kwargs):
        if "search queries" in system or "queries" in system.split()[:5]:
            raise RuntimeError("LLM down")
        # Batch classify: tag the first candidate as a high-intent funding signal.
        return {"results": [{"id": 0, "signal_type": "funding", "buying_intent": "high"}]}

    with patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_icp", return_value=sample_icp), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_leads_for_signals", return_value=leads), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search_news", side_effect=fake_news), \
         patch("gtm_backend.phase1.agents.agent_04_signals.serpapi.search", return_value=[]), \
         patch("gtm_backend.phase1.agents.agent_04_signals.llm.chat_json", side_effect=fake_llm), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.delete_signals_for_lead"), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.insert_signals", return_value=[1]) as inserter:
        summary = detect_signals(icp_id=1)

    assert summary["signals_detected"] >= 1
    inserter.assert_called_once()


def test_agent_04_defaults_to_excluding_cold_leads_from_serpapi_scan():
    """SerpAPI usage reduction (2026-08-19): detect_signals must default to
    exclude_cold=True and pass it straight through to get_leads_for_signals,
    without needing the caller to opt in."""
    with patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_icp", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_leads_for_signals", return_value=[]) as leads_mock:
        detect_signals(icp_id=1)

    leads_mock.assert_called_once_with(limit=50, icp_id=1, exclude_cold=True)


def test_agent_04_exclude_cold_false_is_passed_through():
    with patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_icp", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_04_signals.supabase.get_leads_for_signals", return_value=[]) as leads_mock:
        detect_signals(icp_id=1, exclude_cold=False)

    leads_mock.assert_called_once_with(limit=50, icp_id=1, exclude_cold=False)


# Agent 05 ---------------------------------------------------------------

def test_agent_05_scores_and_updates(sample_icp, full_lead):
    with patch("gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_active_icps", return_value=[sample_icp]), \
         patch("gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_leads_for_scoring", return_value=[full_lead]), \
         patch("gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_signals_for_leads", return_value={full_lead["id"]: []}), \
         patch("gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.update_lead_score") as updater:
        summary = score_leads(mode="unscored")
    assert summary["total_scored"] == 1
    updater.assert_called_once()
    score_arg = updater.call_args[0][0]
    # v2.1 scoring: a complete, on-ICP, verified lead scores 78 (was 70) and is now hot.
    assert score_arg.icp_score == 78
    assert score_arg.score_tier == "hot"
