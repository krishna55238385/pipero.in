"""Regression test for the bug found live (2026-09-03, ICP #60/#61, Jobraux):
content-marketing/comparison-blog pages ("Workday vs Competitors", "8 Best
UKG Alternatives") get accepted as candidates because their link belongs to
a real company's own domain, but their snippet never states a location
(the page describes a market category, not the company) — so every such
candidate got geography_confidence="unclear" from the LLM and was silently
rejected for any country-scoped ICP, even when the underlying company was a
legitimate, on-ICP match.

Fix: before rejecting a candidate for unclear geography, fetch its domain
ROOT homepage (website.fetch_homepage_signals) for first-party geography
evidence the snippet never had — schema.org address, "headquartered in"
language, or a reliable ccTLD — and only reject if that also fails to
confirm. Separately, a lightweight URL-pattern check flags (but never
excludes) candidates whose source page looks like blog/comparison content,
so they still reach a human via needs_review even once inserted.
"""
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_02_leads import generate_leads

_ICP_US_TARGET = {
    "id": 60, "name": "Series B-D SaaS US", "organization_id": "org-1",
    "industry": ["HR tech"], "geography": ["United States"],
}


def _run(search_results, normalized_companies, homepage_signals_by_domain, domain_by_website):
    def fake_fetch_homepage_signals(domain):
        return homepage_signals_by_domain.get(
            domain, {"meta_description": None, "schema_org_text": None}
        )

    def fake_extract_domain(url):
        return domain_by_website.get(url)

    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=_ICP_US_TARGET), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value={"companies": normalized_companies}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=fake_extract_domain), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", side_effect=fake_fetch_homepage_signals), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", side_effect=lambda leads: list(range(len(leads)))) as inserter:
        summary = generate_leads(icp_id=60, max_leads=20, min_leads=1)
    return summary, inserter


def test_schema_org_address_rescues_unclear_geography_blog_candidate():
    """AirMason-shaped case: a blog post comparing OTHER vendors, hosted on
    AirMason's own domain, gives the LLM no location text at all — but
    AirMason's homepage schema.org markup confirms US, so it should survive."""
    search_results = [{
        "title": "Workday vs Competitors for Mid-Market HR (2026) - AirMason",
        "link": "https://www.airmason.com/blog/workday-vs-competitors-mid-market-hr/",
        "snippet": "BambooHR, Rippling, Paylocity, and Paycor are all credible choices.",
    }]
    normalized = [{
        "company_name": "AirMason", "company_website": "https://www.airmason.com/blog/workday-vs-competitors-mid-market-hr/",
        "source_url": "https://www.airmason.com/blog/workday-vs-competitors-mid-market-hr/",
        "company_country": None, "geography_confidence": "unclear",
    }]
    summary, inserter = _run(
        search_results, normalized,
        homepage_signals_by_domain={
            "airmason.com": {
                "meta_description": "AirMason helps HR teams build onboarding experiences.",
                "schema_org_text": '{"@type": "Organization", "address": {"@type": "PostalAddress", "addressCountry": "US"}}',
            },
        },
        domain_by_website={"https://www.airmason.com/blog/workday-vs-competitors-mid-market-hr/": "airmason.com"},
    )

    assert summary["leads_inserted"] == 1
    assert summary["rejected_unclear_geography"] == 0
    lead = inserter.call_args[0][0][0]
    assert lead.company_name == "AirMason"
    assert lead.raw_data["geography_confirmed_via"] == "homepage_check"
    # Rescued via homepage + came from a /blog/ URL — flagged for review either way.
    assert lead.raw_data["needs_review"] is True
    assert lead.raw_data["content_page_suspect"] is True


def test_hq_language_in_meta_description_rescues_candidate():
    search_results = [{
        "title": "8 Best UKG Alternatives", "link": "https://www.workstream.us/blog/ukg-alternatives",
        "snippet": "Compare 8 best UKG alternatives for HR, payroll, hiring.",
    }]
    normalized = [{
        "company_name": "Workstream", "company_website": "https://www.workstream.us/blog/ukg-alternatives",
        "source_url": "https://www.workstream.us/blog/ukg-alternatives",
        "company_country": None, "geography_confidence": "unclear",
    }]
    summary, inserter = _run(
        search_results, normalized,
        homepage_signals_by_domain={
            "workstream.us": {
                "meta_description": "Workstream is headquartered in San Francisco, California.",
                "schema_org_text": None,
            },
        },
        domain_by_website={"https://www.workstream.us/blog/ukg-alternatives": "workstream.us"},
    )
    assert summary["leads_inserted"] == 1
    assert summary["rejected_unclear_geography"] == 0
    lead = inserter.call_args[0][0][0]
    assert lead.raw_data["geography_confirmed_via"] == "homepage_check"


def test_reliable_cctld_rescues_candidate_for_matching_icp():
    icp_india = {
        "id": 61, "name": "SaaS India", "organization_id": "org-1",
        "industry": ["SaaS"], "geography": ["India"],
    }
    search_results = [{
        "title": "Best HR Tools Compared", "link": "https://www.acmehr.in/blog/best-hr-tools",
        "snippet": "A roundup of leading HR platforms.",
    }]
    normalized = [{
        "company_name": "AcmeHR", "company_website": "https://www.acmehr.in/blog/best-hr-tools",
        "source_url": "https://www.acmehr.in/blog/best-hr-tools",
        "company_country": None, "geography_confidence": "unclear",
    }]
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=icp_india), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value={"companies": normalized}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", return_value="acmehr.in"), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1]) as inserter:
        summary = generate_leads(icp_id=61, max_leads=20, min_leads=1)

    assert summary["leads_inserted"] == 1
    assert summary["rejected_unclear_geography"] == 0
    lead = inserter.call_args[0][0][0]
    assert lead.raw_data["geography_confirmed_via"] == "homepage_check"


def test_candidate_still_rejected_when_homepage_has_no_signal_either():
    """No schema.org address, no HQ language, no reliable ccTLD (.com) — the
    homepage check must not manufacture a confirmation out of nothing; the
    original rejection stands, exactly as before this fix."""
    search_results = [{
        "title": "How Much Does HR Software Cost Per Employee?", "link": "https://www.compono.com/articles/hr-software-cost",
        "snippet": "Midsize businesses typically pay $8-$20 PEPM.",
    }]
    normalized = [{
        "company_name": "Compono", "company_website": "https://www.compono.com/articles/hr-software-cost",
        "source_url": "https://www.compono.com/articles/hr-software-cost",
        "company_country": None, "geography_confidence": "unclear",
    }]
    summary, inserter = _run(
        search_results, normalized,
        homepage_signals_by_domain={
            "compono.com": {"meta_description": "HR software for growing teams.", "schema_org_text": None},
        },
        domain_by_website={"https://www.compono.com/articles/hr-software-cost": "compono.com"},
    )
    assert summary["leads_inserted"] == 0
    # Same never-confirmed candidate re-evaluated on all 3 pages (min_leads
    # is never met, so the loop paginates through _MAX_PAGES) — rejected
    # every time, hence the cumulative count of 3 rather than 1.
    assert summary["rejected_unclear_geography"] == 3
    inserter.assert_called_once_with([])


def test_content_page_flag_does_not_fire_on_ordinary_confirmed_candidate():
    """A normal product-page candidate the LLM already confirmed via its own
    snippet, with a URL that doesn't match the content-page pattern, must be
    unaffected by either new mechanism — no homepage fetch, no review flag."""
    search_results = [{
        "title": "Acme HR - HR Software for US Teams", "link": "https://www.acmehr.com/",
        "snippet": "Acme HR is based in Austin, Texas.",
    }]
    normalized = [{
        "company_name": "Acme HR", "company_website": "https://www.acmehr.com/",
        "source_url": "https://www.acmehr.com/",
        "company_country": "United States", "geography_confidence": "confirmed",
    }]
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=_ICP_US_TARGET), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value={"companies": normalized}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", return_value="acmehr.com"), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch(
             "gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals",
             return_value={"meta_description": "Acme HR homepage.", "schema_org_text": None},
         ) as fetch_mock, \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1]) as inserter:
        summary = generate_leads(icp_id=60, max_leads=20, min_leads=1)

    assert summary["leads_inserted"] == 1
    lead = inserter.call_args[0][0][0]
    assert lead.raw_data["needs_review"] is False
    assert lead.raw_data["content_page_suspect"] is False
    assert lead.raw_data["geography_confirmed_via"] is None
    # fetch_homepage_signals is still called once by the pre-existing
    # firmographic-confidence step, but never a SECOND time for a geography
    # rescue — that path is skipped entirely once the LLM already confirmed.
    assert fetch_mock.call_count == 1
