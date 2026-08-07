"""Tests for Agent 42 — Champion Tracker. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_42_champion_tracker import run_champion_tracker

_MOD = "gtm_backend.phase4.agents.agent_42_champion_tracker"

_DEAL = {
    "id": "deal-1",
    "title": "Acme HR — annual contract",
    "contact_id": "contact-1",
    "company_id": "company-1",
    "organization_id": "org-1",
    "status": "won",
}

_CONTACT = {"id": "contact-1", "name": "Priya Iyer", "email": "priya@acmehr.com", "company_id": "company-1"}
_COMPANY = {"id": "company-1", "name": "Acme HR"}

_SNIPPETS = [{"title": "Priya Iyer - VP Sales at Beta People | LinkedIn", "snippet": "Priya Iyer, VP Sales, Beta People", "link": "https://linkedin.com/in/priya"}]

_LLM_MOVED = {
    "moved": True,
    "new_company_name": "Beta People",
    "new_title": "VP Sales",
    "is_competitor": False,
    "content_text": "Great to see you landed at Beta People — congrats! Would love to catch up when you have a moment.",
    "held": False,
    "held_reason": None,
}


def _run(deals=None, history=None, contact=None, company=None, search_results=None, llm_result=None, llm_side_effect=None):
    kwargs = {}
    if llm_side_effect is not None:
        kwargs["side_effect"] = llm_side_effect
    else:
        kwargs["return_value"] = llm_result if llm_result is not None else _LLM_MOVED
    resolved_deals = deals if deals is not None else [_DEAL]
    resolved_contact = contact if contact is not None else _CONTACT
    resolved_company = company if company is not None else _COMPANY
    contact_id = resolved_deals[0]["contact_id"] if resolved_deals else None
    history_map = {contact_id: (history or [])} if contact_id else {}
    contacts_map = {contact_id: resolved_contact} if contact_id and resolved_contact else {}
    company_id = (resolved_contact or {}).get("company_id")
    companies_map = {company_id: resolved_company} if company_id and resolved_company else {}
    with patch(f"{_MOD}.supabase.get_won_deals_with_contacts", return_value=resolved_deals), \
         patch(f"{_MOD}.supabase.get_champion_move_history_batch", return_value=history_map), \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value=contacts_map), \
         patch(f"{_MOD}.supabase.get_companies_by_ids", return_value=companies_map), \
         patch(f"{_MOD}.supabase.get_org_product_description", return_value="AI GTM automation"), \
         patch(f"{_MOD}.serpapi.search", return_value=search_results if search_results is not None else _SNIPPETS), \
         patch(f"{_MOD}.supabase.create_champion_move", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.llm.chat_json", **kwargs) as chat:
        result = run_champion_tracker()
    return result, creator, chat


def test_already_checked_contact_is_skipped_entirely():
    result, creator, chat = _run(history=[{"status": "held"}])
    assert result["already_checked"] == 1
    creator.assert_not_called()
    chat.assert_not_called()


def test_no_linkedin_results_logs_held_without_calling_llm():
    result, creator, chat = _run(search_results=[])
    assert result["held"] == 1
    chat.assert_not_called()
    assert creator.call_args.kwargs["status"] == "held"


def test_moved_and_not_competitor_drafts_reconnect():
    result, creator, chat = _run()
    assert result["drafted"] == 1
    kwargs = creator.call_args.kwargs
    assert kwargs["status"] == "drafted"
    assert kwargs["new_company_name"] == "Beta People"
    assert kwargs["is_competitor"] is False
    assert "Beta People" in kwargs["content_text"]


def test_moved_to_competitor_never_drafts_outreach():
    competitor_result = dict(_LLM_MOVED, is_competitor=True, content_text="")
    result, creator, chat = _run(llm_result=competitor_result)
    assert result["competitor_skip"] == 1
    kwargs = creator.call_args.kwargs
    assert kwargs["status"] == "competitor_skip"
    assert "content_text" not in kwargs or not kwargs.get("content_text")


def test_no_move_detected_logs_held():
    not_moved = {"moved": False, "new_company_name": None, "new_title": None, "is_competitor": False, "content_text": "", "held": False, "held_reason": None}
    result, creator, chat = _run(llm_result=not_moved)
    assert result["held"] == 1
    assert creator.call_args.kwargs["status"] == "held"


def test_moved_but_llm_holds_for_thin_evidence():
    thin = dict(_LLM_MOVED, held=True, content_text="", held_reason="not enough to say anything credible")
    result, creator, chat = _run(llm_result=thin)
    assert result["held"] == 1
    assert creator.call_args.kwargs["held_reason"] == "not enough to say anything credible"


def test_contact_without_name_fails_gracefully():
    result, creator, chat = _run(contact={"id": "contact-1", "name": "", "email": "x@y.com"})
    assert result["failed"] == 1
    creator.assert_not_called()
    chat.assert_not_called()


def test_llm_failure_does_not_create_a_row():
    result, creator, chat = _run(llm_side_effect=RuntimeError("groq down"))
    assert result["failed"] == 1
    creator.assert_not_called()


def test_lookups_are_batched_into_one_call_each_regardless_of_deal_count():
    """The N+1 fix: history/contacts/companies must each be fetched once
    for all deals, not once per deal."""
    deal_2 = dict(_DEAL, id="deal-2", contact_id="contact-2", company_id="company-2")
    contact_2 = {"id": "contact-2", "name": "Rahul Nair", "email": "rahul@acmehr.com", "company_id": "company-2"}
    company_2 = {"id": "company-2", "name": "Widget Co"}

    with patch(f"{_MOD}.supabase.get_won_deals_with_contacts", return_value=[_DEAL, deal_2]), \
         patch(f"{_MOD}.supabase.get_champion_move_history_batch", return_value={"contact-1": [], "contact-2": []}) as history_batch, \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value={"contact-1": _CONTACT, "contact-2": contact_2}) as contacts_batch, \
         patch(f"{_MOD}.supabase.get_companies_by_ids", return_value={"company-1": _COMPANY, "company-2": company_2}) as companies_batch, \
         patch(f"{_MOD}.supabase.get_org_product_description", return_value="AI GTM automation"), \
         patch(f"{_MOD}.serpapi.search", return_value=_SNIPPETS), \
         patch(f"{_MOD}.supabase.create_champion_move", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_MOVED):
        result = run_champion_tracker()

    history_batch.assert_called_once()
    contacts_batch.assert_called_once()
    companies_batch.assert_called_once()
    assert result["drafted"] == 2


def test_search_failure_does_not_create_a_row():
    with patch(f"{_MOD}.supabase.get_won_deals_with_contacts", return_value=[_DEAL]), \
         patch(f"{_MOD}.supabase.get_champion_move_history_batch", return_value={"contact-1": []}), \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value={"contact-1": _CONTACT}), \
         patch(f"{_MOD}.supabase.get_companies_by_ids", return_value={"company-1": _COMPANY}), \
         patch(f"{_MOD}.supabase.create_champion_move", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.serpapi.search", side_effect=RuntimeError("serpapi down")), \
         patch(f"{_MOD}.llm.chat_json") as chat:
        result = run_champion_tracker()
    assert result["failed"] == 1
    chat.assert_not_called()
    creator.assert_not_called()
