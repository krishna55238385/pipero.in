"""Tests for Agent 05 — Lookalike Finder. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_05_lookalike import find_lookalikes

_MOD = "gtm_backend.phase1.agents.agent_05_lookalike"

_WON_DEAL = lambda i: {"id": f"deal-{i}", "title": f"Deal {i}", "contact_id": f"contact-{i}", "organization_id": "org-1"}

_PROFILE_RESULT = {
    "profile_summary": "Mid-market HR-tech companies with distributed teams.",
    "search_queries": ["HR tech startups distributed teams", "mid-market people ops software companies"],
}

_SEARCH_RESULTS = [
    {"title": "Beta People | HR Platform", "link": "https://betapeople.io", "snippet": "Beta People helps HR teams hire faster."},
]

_EXTRACTION_RESULT = {
    "candidates": [
        {
            "company_name": "Beta People",
            "company_website": "https://betapeople.io",
            "company_industry": "HR Tech",
            "lookalike_score": 84,
            "lookalike_reference_company": "Acme HR",
            "is_competitor": False,
            "source_url": "https://betapeople.io",
        },
        {
            "company_name": "Rival HR Corp",
            "company_website": "https://rivalhr.com",
            "company_industry": "HR Tech",
            "lookalike_score": 70,
            "lookalike_reference_company": "Acme HR",
            "is_competitor": True,
            "source_url": "https://rivalhr.com",
        },
    ]
}


def _run(won_deals=None, contact=None, company=None, product_desc="AI GTM automation",
         existing_domains=None, existing_names=None, profile_result=None, extraction_result=None,
         search_results=None, insert_result=None):
    won = won_deals if won_deals is not None else [_WON_DEAL(i) for i in range(1, 6)]
    with patch(f"{_MOD}.crm_supabase.get_won_deals_with_contacts", return_value=won), \
         patch(f"{_MOD}.crm_supabase.get_contact_by_id", return_value=contact if contact is not None else {"company_id": "co-1"}), \
         patch(f"{_MOD}.crm_supabase.get_company_by_id", return_value=company if company is not None else {"name": "Acme HR", "industry": "HR Tech"}), \
         patch(f"{_MOD}.crm_supabase.get_org_product_description", return_value=product_desc), \
         patch(f"{_MOD}.supabase.get_existing_company_domains", return_value=existing_domains or set()), \
         patch(f"{_MOD}.supabase.get_existing_company_names", return_value=existing_names or set()), \
         patch(f"{_MOD}.supabase.insert_leads", return_value=insert_result if insert_result is not None else [101]) as inserter, \
         patch(f"{_MOD}.serpapi.search", return_value=search_results if search_results is not None else _SEARCH_RESULTS), \
         patch(f"{_MOD}.llm.chat_json", side_effect=[
             profile_result if profile_result is not None else _PROFILE_RESULT,
             extraction_result if extraction_result is not None else _EXTRACTION_RESULT,
         ]) as chat:
        result = find_lookalikes(icp_id=1, limit=20)
    return result, inserter, chat


def test_below_minimum_reference_customers_skips_entirely():
    result, inserter, chat = _run(won_deals=[_WON_DEAL(i) for i in range(1, 4)])  # only 3
    assert result["status"] == "insufficient_reference_customers"
    assert result["leads_inserted"] == 0
    chat.assert_not_called()
    inserter.assert_not_called()


def test_at_minimum_reference_customers_runs_full_flow():
    result, inserter, chat = _run()
    assert result["status"] == "ok"
    assert result["reference_customer_count"] == 5
    assert result["leads_inserted"] == 1
    assert chat.call_count == 2


def test_competitor_candidate_is_excluded():
    result, inserter, chat = _run()
    assert result["skipped_competitor"] == 1
    inserted_leads = inserter.call_args[0][0]
    assert all(lead.company_name != "Rival HR Corp" for lead in inserted_leads)


def test_duplicate_candidate_is_excluded():
    result, inserter, chat = _run(existing_domains={"betapeople.io"})
    assert result["skipped_duplicate"] == 1
    assert result["leads_inserted"] == 0


def test_no_search_results_short_circuits_before_extraction():
    result, inserter, chat = _run(search_results=[])
    assert result["status"] == "no_search_results"
    assert chat.call_count == 1  # only the profile call, extraction never reached
    inserter.assert_not_called()


def test_deal_with_no_company_falls_back_to_deal_title_as_reference():
    won = [_WON_DEAL(i) for i in range(1, 6)]
    result, inserter, chat = _run(won_deals=won, company=None)
    # get_company_by_id -> None means _build_reference_list falls back to
    # deal["title"], which IS resolvable, so the gate still passes.
    assert result["status"] == "ok"
    assert result["reference_customer_count"] == 5


def test_inserted_lead_carries_lookalike_metadata():
    result, inserter, chat = _run()
    inserted_leads = inserter.call_args[0][0]
    assert len(inserted_leads) == 1
    lead = inserted_leads[0]
    assert lead.source == "lookalike"
    assert lead.raw_data["lookalike_score"] == 84
    assert lead.raw_data["lookalike_reference_company"] == "Acme HR"


def test_extraction_failure_after_successful_profile_returns_failed_status():
    won = [_WON_DEAL(i) for i in range(1, 6)]
    with patch(f"{_MOD}.crm_supabase.get_won_deals_with_contacts", return_value=won), \
         patch(f"{_MOD}.crm_supabase.get_contact_by_id", return_value={"company_id": "co-1"}), \
         patch(f"{_MOD}.crm_supabase.get_company_by_id", return_value={"name": "Acme HR", "industry": "HR Tech"}), \
         patch(f"{_MOD}.crm_supabase.get_org_product_description", return_value="AI GTM automation"), \
         patch(f"{_MOD}.serpapi.search", return_value=_SEARCH_RESULTS), \
         patch(f"{_MOD}.supabase.insert_leads") as inserter, \
         patch(f"{_MOD}.llm.chat_json", side_effect=[_PROFILE_RESULT, RuntimeError("groq down")]):
        result = find_lookalikes(icp_id=1, limit=20)
    assert result["status"] == "failed"
    inserter.assert_not_called()


def test_llm_failure_on_profile_call_does_not_crash():
    won = [_WON_DEAL(i) for i in range(1, 6)]
    with patch(f"{_MOD}.crm_supabase.get_won_deals_with_contacts", return_value=won), \
         patch(f"{_MOD}.crm_supabase.get_contact_by_id", return_value={"company_id": "co-1"}), \
         patch(f"{_MOD}.crm_supabase.get_company_by_id", return_value={"name": "Acme HR", "industry": "HR Tech"}), \
         patch(f"{_MOD}.crm_supabase.get_org_product_description", return_value="AI GTM automation"), \
         patch(f"{_MOD}.supabase.insert_leads") as inserter, \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")):
        result = find_lookalikes(icp_id=1, limit=20)
    assert result["status"] == "failed"
    inserter.assert_not_called()
