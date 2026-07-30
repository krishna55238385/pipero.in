"""Regression tests for the N+1 fix: Agent 07 and Agent 08 previously called
get_account_brief() once per lead in a loop. Both now use the batched
get_account_briefs(lead_ids), same pattern as get_signals_for_leads."""
from gtm_backend.phase2.agents.agent_07_stakeholders import map_stakeholders
from gtm_backend.phase2.agents.agent_08_competitive import _flag_competitor_usage


def test_agent_07_fetches_briefs_in_one_batched_call(mocker):
    leads = [
        {"id": 1, "company_name": "A", "icp_id": 1},
        {"id": 2, "company_name": "B", "icp_id": 1},
    ]
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_leads_for_account_intel",
        return_value=leads,
    )
    briefs_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_account_briefs",
        return_value={},
    )
    per_lead_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_account_brief",
    )

    map_stakeholders(icp_id=1)

    briefs_mock.assert_called_once_with([1, 2])
    per_lead_mock.assert_not_called()


def test_agent_08_flag_usage_fetches_briefs_in_one_batched_call(mocker):
    icp = {"id": 1}
    leads = [{"id": 10}, {"id": 20}]
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_leads_for_account_intel",
        return_value=leads,
    )
    briefs_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_account_briefs",
        return_value={10: {"what_they_do": "uses Acme HR daily"}},
    )
    per_lead_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_account_brief",
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.upsert_lead_competitor_usage",
        return_value=1,
    )

    written = _flag_competitor_usage(icp, ["Acme HR"])

    briefs_mock.assert_called_once_with([10, 20])
    per_lead_mock.assert_not_called()
    assert written == 1
