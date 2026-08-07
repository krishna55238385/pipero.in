"""End-to-end pipeline test for phase3.

Drives Agents 11 → 12 → 13 → 14 through the `run-all` CLI with every external
call mocked. Each agent's supabase reads are stubbed with the canned fixtures
the previous agent would have written, so the chain runs cleanly without a
live database. Asserts each writeable agent persists its primary table at
least once and that `main(["run-all", ...])` returns exit code 0.

Agent 15 is intentionally not exercised here: it's not part of `run-all` and
its A/B analytics test is covered by test_agents.py.
"""
from __future__ import annotations

import contextlib
from unittest.mock import patch

import gtm_backend.phase3.main as phase3_main


def _explode_create_campaign(*_args, **_kwargs):
    """If Agent 14 calls create_campaign during dry-run / unconfigured, fail loudly."""
    raise AssertionError(
        "Agent 14 should NEVER call instantly.create_campaign in dry-run mode "
        "with INSTANTLY_API_KEY unset"
    )


def _make_llm_router(personalisation_payload, sequence_payload, channel_payload):
    """Return a side_effect function that picks the right canned payload based
    on the system prompt's distinguishing phrase.
    """
    def _route(system: str, _user: str, **_kwargs) -> dict:
        text = (system or "").lower()
        if "personalisation analyst" in text:
            return personalisation_payload
        if "outbound copywriter" in text:
            return sequence_payload
        if "channel strategist" in text:
            return channel_payload
        raise AssertionError(f"Unrouted phase3 system prompt: {system[:80]!r}")
    return _route


def test_phase3_pipeline_end_to_end(
    sample_lead,
    sample_personalisation_row,
    sample_sequence_row,
    sample_channel_plan_row,
    mock_llm_personalisation,
    mock_llm_sequence,
    mock_llm_channel,
):
    """Run `python -m phase3 run-all --icp 1 --dry-run` fully mocked.

    Each of agents 11→14 must persist at least one row, and the CLI must
    return exit code 0. Agent 15 is not part of run-all and is not exercised.
    """
    llm_route = _make_llm_router(
        mock_llm_personalisation, mock_llm_sequence, mock_llm_channel,
    )

    fake_icp = {
        "id": 1,
        "name": "Mid-market HR-tech in India",
        "industry": ["HR Tech", "SaaS"],
        "geography": ["Bangalore", "India"],
        "active": True,
    }
    fake_intel = {
        "company_size_estimate": "Mid-market",
        "what_they_do": "HR platform for SMBs.",
        "growth_trajectory": "Growing — Series A closed.",
    }

    def _p(target, **kw):
        return patch(target, **kw)

    with contextlib.ExitStack() as stack:
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_11_personalisation.llm.chat_json", side_effect=llm_route))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_12_copywriter.llm.chat_json", side_effect=llm_route))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_13_channel_strategy.llm.chat_json", side_effect=llm_route))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_11_personalisation.supabase.get_leads_for_personalisation",
            return_value=[sample_lead]))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_12_copywriter.supabase.get_personalisations",
            return_value=[sample_personalisation_row]))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.get_sequences",
            return_value=[sample_sequence_row]))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.get_icp", return_value=fake_icp))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.get_account_intel_for_lead",
            return_value=fake_intel))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sequences",
            return_value=[sample_sequence_row]))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_channel_plans",
            return_value=[sample_channel_plan_row]))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_personalisations",
            return_value=[sample_personalisation_row]))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_leads_for_personalisation",
            return_value=[sample_lead]))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sent_lead_ids", return_value=set()))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_replied_lead_ids", return_value=set()))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.is_configured", return_value=False))
        create_mock = stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.create_campaign",
            side_effect=_explode_create_campaign))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.add_leads_to_campaign",
            side_effect=_explode_create_campaign))
        stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.activate_campaign",
            side_effect=_explode_create_campaign))
        upsert_pers = stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_11_personalisation.supabase.bulk_upsert_personalisations",
            return_value=None))
        upsert_seq = stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_12_copywriter.supabase.upsert_sequence", return_value=None))
        upsert_chan = stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.upsert_channel_plan",
            return_value=None))
        insert_log = stack.enter_context(_p(
            "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log", return_value=None))

        exit_code = phase3_main.main(["run-all", "--icp", "1", "--dry-run"])

    assert exit_code == 0, "run-all must complete with exit code 0"

    assert upsert_pers.call_count >= 1, "Agent 11 must upsert at least one personalisation"
    assert upsert_seq.call_count >= 1, "Agent 12 must upsert at least one sequence"
    assert upsert_chan.call_count >= 1, "Agent 13 must upsert at least one channel plan"
    assert insert_log.call_count >= 1, "Agent 14 must insert at least one outreach_log row"

    create_mock.assert_not_called()

    log_entries = insert_log.call_args[0][0]
    assert log_entries, "Agent 14 should write at least one outreach_log entry"
    assert all(e.status == "dry_run" for e in log_entries), (
        "All Agent 14 entries must be dry_run when --dry-run is set"
    )
