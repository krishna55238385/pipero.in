"""Tests for Agent 45 — Revenue Intelligence. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_45_revenue_intelligence import generate_revenue_intelligence

_MOD = "gtm_backend.phase4.agents.agent_45_revenue_intelligence"


def _deal(status, value=10000, created_at="2026-01-01T00:00:00+00:00", close_date="2026-02-01T00:00:00+00:00", contact_id=None):
    return {"status": status, "value": value, "created_at": created_at, "close_date": close_date, "contact_id": contact_id}


_LLM_RESULT = {
    "key_insights": ["Deals in the HR-tech segment close 15 days faster than average — worth prioritizing similar accounts."],
    "recommendations": ["Consider weighting HR-tech industry higher in ICP scoring, pending human review."],
}


def _run(deals, contact=None, company=None, llm_result=None, llm_side_effect=None):
    kwargs = {}
    if llm_side_effect is not None:
        kwargs["side_effect"] = llm_side_effect
    else:
        kwargs["return_value"] = llm_result if llm_result is not None else _LLM_RESULT
    contact_ids = {d["contact_id"] for d in deals if d.get("contact_id")}
    contacts_map = {cid: contact for cid in contact_ids} if contact is not None else {}
    company_id = (contact or {}).get("company_id")
    companies_map = {company_id: company} if company_id and company is not None else {}
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value=contacts_map), \
         patch(f"{_MOD}.supabase.get_companies_by_ids", return_value=companies_map), \
         patch(f"{_MOD}.supabase.create_revenue_intelligence_snapshot", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.llm.chat_json", **kwargs) as chat:
        result = generate_revenue_intelligence()
    return result, creator, chat


def test_below_minimum_sample_skips_llm_but_still_saves_snapshot():
    deals = [_deal("won") for _ in range(5)] + [_deal("lost") for _ in range(5)]
    result, creator, chat = _run(deals)
    assert result["closed_deal_count"] == 10
    assert result["min_sample_met"] is False
    chat.assert_not_called()
    assert creator.call_args.kwargs["key_insights"] == []
    assert creator.call_args.kwargs["recommendations"] == []


def test_at_or_above_minimum_sample_calls_llm_and_saves_insights():
    deals = [_deal("won") for _ in range(12)] + [_deal("lost") for _ in range(8)]
    result, creator, chat = _run(deals)
    assert result["closed_deal_count"] == 20
    assert result["min_sample_met"] is True
    chat.assert_called_once()
    assert result["key_insights"] == _LLM_RESULT["key_insights"]
    assert result["recommendations"] == _LLM_RESULT["recommendations"]


def test_win_rate_computed_correctly():
    deals = [_deal("won") for _ in range(15)] + [_deal("lost") for _ in range(5)]
    result, creator, chat = _run(deals)
    assert result["win_rate"] == 75.0


def test_avg_deal_size_computed_correctly():
    deals = [_deal("won", value=10000) for _ in range(10)] + [_deal("won", value=20000) for _ in range(10)]
    result, creator, chat = _run(deals)
    assert result["avg_deal_size_won"] == 15000.0


def test_no_closed_deals_produces_null_stats_without_crashing():
    open_deals = [{"status": "contacted", "value": 5000, "created_at": None, "close_date": None, "contact_id": None}]
    result, creator, chat = _run(open_deals)
    assert result["closed_deal_count"] == 0
    assert result["win_rate"] is None
    chat.assert_not_called()


def test_llm_failure_still_saves_snapshot_with_computed_numbers():
    deals = [_deal("won") for _ in range(12)] + [_deal("lost") for _ in range(8)]
    result, creator, chat = _run(deals, llm_side_effect=RuntimeError("groq down"))
    assert result["win_rate"] == 60.0
    assert result["key_insights"] == []
    creator.assert_called_once()


def test_segment_breakdown_groups_by_company_industry():
    deals = [_deal("won", contact_id="c1") for _ in range(12)] + [_deal("lost", contact_id="c1") for _ in range(8)]
    result, creator, chat = _run(deals, contact={"company_id": "co1"}, company={"industry": "HR Tech"})
    assert "HR Tech" in result["segment_breakdown"]
    assert result["segment_breakdown"]["HR Tech"]["won"] == 12
    assert result["segment_breakdown"]["HR Tech"]["lost"] == 8


def test_segment_breakdown_falls_back_to_unknown_without_company_link():
    deals = [_deal("won") for _ in range(12)] + [_deal("lost") for _ in range(8)]
    result, creator, chat = _run(deals, contact=None, company=None)
    assert "unknown" in result["segment_breakdown"]


def test_segment_breakdown_lookups_are_batched_into_one_call_each():
    deals = [_deal("won", contact_id="c1") for _ in range(12)] + [_deal("lost", contact_id="c2") for _ in range(8)]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value={"c1": {"company_id": "co1"}, "c2": {"company_id": "co2"}}) as contacts_batch, \
         patch(f"{_MOD}.supabase.get_companies_by_ids", return_value={"co1": {"industry": "HR Tech"}, "co2": {"industry": "Fintech"}}) as companies_batch, \
         patch(f"{_MOD}.supabase.create_revenue_intelligence_snapshot", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESULT):
        result = generate_revenue_intelligence()
    contacts_batch.assert_called_once()
    companies_batch.assert_called_once()
    assert result["segment_breakdown"]["HR Tech"]["won"] == 12
    assert result["segment_breakdown"]["Fintech"]["lost"] == 8
