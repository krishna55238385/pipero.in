"""Integration tests for the phase3 agents — all external APIs mocked.

Each test asserts the agent's correct behaviour end-to-end: it reads the right
data, calls the right connectors with the right args, and writes the right
result back. Mirrors phase2/tests/test_agents.py.
"""
from __future__ import annotations

from unittest.mock import patch

from gtm_backend.phase3.agents.agent_11_personalisation import run_personalisation
from gtm_backend.phase3.agents.agent_12_copywriter import run_copywriting
from gtm_backend.phase3.agents.agent_13_channel_strategy import run_channel_strategy
from gtm_backend.phase3.agents.agent_14_orchestrator import run_orchestration
from gtm_backend.phase3.agents.agent_15_ab_testing import run_ab_testing


# -- Agent 11 — Personalisation --------------------------------------------

def test_agent_11_writes_personalisation(sample_lead, mock_llm_personalisation):
    """Happy path: 1 lead with intel → LLM angles → 1 ready personalisation upserted."""
    with patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.get_leads_for_personalisation",
        return_value=[sample_lead],
    ), patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.llm.chat_json",
        return_value=mock_llm_personalisation,
    ) as llm_mock, patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.bulk_upsert_personalisations",
        return_value=None,
    ) as upsert_mock:
        summary = run_personalisation(icp_id=1)

    assert summary["leads_examined"] == 1
    assert summary["personalisations_written"] == 1
    assert summary["held"] == 0
    llm_mock.assert_called_once()
    upsert_mock.assert_called_once()
    result = upsert_mock.call_args[0][0][0]
    assert result.lead_id == sample_lead["id"]
    assert result.status == "ready"
    assert len(result.angles) == 2
    assert result.quality_score == 85


def test_agent_11_holds_when_no_intel(sample_lead):
    """No gtm_insight, no account_intel, LLM returns empty angles → held with reason."""
    bare_lead = dict(sample_lead)
    bare_lead["_gtm_insight"] = None
    bare_lead["_account_intel"] = None
    empty_llm = {"angles": [], "quality_score": 0, "status": "ready", "held_reason": ""}

    with patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.get_leads_for_personalisation",
        return_value=[bare_lead],
    ), patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.llm.chat_json",
        return_value=empty_llm,
    ), patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.bulk_upsert_personalisations",
        return_value=None,
    ) as upsert_mock:
        summary = run_personalisation(icp_id=1)

    assert summary["personalisations_written"] == 1
    assert summary["held"] == 1
    upsert_mock.assert_called_once()
    result = upsert_mock.call_args[0][0][0]
    assert result.status == "held"
    assert result.held_reason  # non-empty string
    assert "insufficient" in result.held_reason.lower()


def test_agent_11_results_are_batched_into_a_single_bulk_call(sample_lead, mock_llm_personalisation):
    """N+1-on-writes fix: 2 leads must produce exactly one
    bulk_upsert_personalisations call carrying both results, not one call
    per lead (same class of fix already applied to Agent 06/Agent 37)."""
    lead_2 = dict(sample_lead, id=sample_lead["id"] + 1)
    with patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.get_leads_for_personalisation",
        return_value=[sample_lead, lead_2],
    ), patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.llm.chat_json",
        return_value=mock_llm_personalisation,
    ), patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.bulk_upsert_personalisations",
        return_value=None,
    ) as upsert_mock:
        summary = run_personalisation(icp_id=1)

    assert summary["personalisations_written"] == 2
    upsert_mock.assert_called_once()
    results = upsert_mock.call_args[0][0]
    assert len(results) == 2


def test_agent_11_never_ready_with_zero_angles(sample_lead):
    """Regression: when intel IS present (a truthy brief dict) but the LLM still
    returns zero angles, the result must NOT pass as 'ready' — it is downgraded
    to low_quality so Agent 12 never copywrites with nothing to lead with.

    This is the gap that let the personalisation-empty bug slip through: a
    present-but-thin brief makes ``not account_intel`` False, so the
    'insufficient data' branch never fires, yet the angles are empty.
    """
    lead = dict(sample_lead)
    lead["_gtm_insight"] = None
    lead["_account_intel"] = {"company_name": lead.get("company_name"), "what_they_do": ""}
    bad_llm = {"angles": [], "quality_score": 90, "status": "ready", "held_reason": ""}

    with patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.get_leads_for_personalisation",
        return_value=[lead],
    ), patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.llm.chat_json",
        return_value=bad_llm,
    ), patch(
        "gtm_backend.phase3.agents.agent_11_personalisation.supabase.bulk_upsert_personalisations",
        return_value=None,
    ) as upsert_mock:
        run_personalisation(icp_id=1)

    result = upsert_mock.call_args[0][0][0]
    assert result.angles == []
    assert result.status == "low_quality"   # NOT "ready"
    assert result.held_reason


# -- Agent 12 — Outreach Copywriter ----------------------------------------

def test_agent_12_writes_sequence(sample_personalisation_row, mock_llm_sequence):
    """Ready personalisation + valid LLM output → 1 sequence written, quality=100."""
    with patch(
        "gtm_backend.phase3.agents.agent_12_copywriter.supabase.get_personalisations",
        return_value=[sample_personalisation_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_12_copywriter.llm.chat_json",
        return_value=mock_llm_sequence,
    ) as llm_mock, patch(
        "gtm_backend.phase3.agents.agent_12_copywriter.supabase.upsert_sequence",
        return_value=None,
    ) as upsert_mock:
        summary = run_copywriting(icp_id=1)

    assert summary["personalisations_examined"] == 1
    assert summary["ready_inputs"] == 1
    assert summary["sequences_written"] == 1
    llm_mock.assert_called_once()
    upsert_mock.assert_called_once()
    seq = upsert_mock.call_args[0][0]
    assert seq.lead_id == sample_personalisation_row["lead_id"]
    assert len(seq.steps) == 5
    assert seq.sequence_quality_score == 100


def test_agent_12_skips_held_personalisation(sample_personalisation_row, mock_llm_sequence):
    """A held personalisation must not be turned into copy."""
    held_row = dict(sample_personalisation_row)
    held_row["status"] = "held"

    with patch(
        "gtm_backend.phase3.agents.agent_12_copywriter.supabase.get_personalisations",
        return_value=[held_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_12_copywriter.llm.chat_json",
        return_value=mock_llm_sequence,
    ) as llm_mock, patch(
        "gtm_backend.phase3.agents.agent_12_copywriter.supabase.upsert_sequence",
        return_value=None,
    ) as upsert_mock:
        summary = run_copywriting(icp_id=1)

    assert summary["ready_inputs"] == 0
    assert summary["sequences_written"] == 0
    llm_mock.assert_not_called()
    upsert_mock.assert_not_called()


# -- Agent 13 — Channel Strategy -------------------------------------------

def test_agent_13_writes_channel_plan_and_clamps_window(sample_sequence_row):
    """LLM returns out-of-bounds hours/touches and phone as primary; guardrails
    must clamp window to 08:00–18:00, touches ≤ 2, and force email-first sequence
    with secondary_channel='email' when primary='phone'.
    """
    bad_llm = {
        "primary_channel": "phone",
        "secondary_channel": "linkedin",
        "channel_sequence": ["phone", "linkedin"],
        "send_window_start_hour": 5,
        "send_window_end_hour": 22,
        "timezone": "Asia/Kolkata",
        "touches_per_week": 10,
        "rationale": "Out-of-bounds test",
    }

    with patch(
        "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.get_sequences",
        return_value=[sample_sequence_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.get_icp",
        return_value={"id": 1, "name": "Test ICP", "industry": ["HR Tech"], "geography": ["India"]},
    ), patch(
        "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.get_account_intel_for_lead",
        return_value={"company_size_estimate": "Mid-market", "what_they_do": "HR"},
    ), patch(
        "gtm_backend.phase3.agents.agent_13_channel_strategy.llm.chat_json",
        return_value=bad_llm,
    ), patch(
        "gtm_backend.phase3.agents.agent_13_channel_strategy.supabase.upsert_channel_plan",
        return_value=None,
    ) as upsert_mock:
        summary = run_channel_strategy(icp_id=1)

    assert summary["channel_plans_written"] == 1
    upsert_mock.assert_called_once()
    plan = upsert_mock.call_args[0][0]
    assert plan.send_window_start_hour >= 8, "start hour clamped to >=8"
    assert plan.send_window_end_hour <= 18, "end hour clamped to <=18"
    assert plan.send_window_start_hour < plan.send_window_end_hour, "valid window"
    assert plan.touches_per_week <= 2, "touches clamped to <=2"
    # Email-only policy (_FORCE_EMAIL_ONLY): every plan is forced to email
    # regardless of what the LLM suggested (here it suggested phone).
    assert plan.primary_channel == "email", "email-only policy forces email primary"
    assert plan.secondary_channel is None, "email-only has no secondary channel"
    assert all(ch == "email" for ch in plan.channel_sequence), "every touch is email"


# -- Agent 14 — Omnichannel Orchestrator ------------------------------------

def _exploding_create_campaign(*_args, **_kwargs):
    """Make a noisy failure if Agent 14 ever calls create_campaign in dry-run."""
    raise AssertionError(
        "Agent 14 should NOT call instantly.create_campaign in dry-run mode"
    )


def test_agent_14_dry_run_writes_log_entries(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """dry_run=True must produce dry_run log entries and never touch Instantly."""
    with patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sequences",
        return_value=[sample_sequence_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_channel_plans",
        return_value=[sample_channel_plan_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_personalisations",
        return_value=[],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_leads_for_personalisation",
        return_value=[sample_lead],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sent_lead_ids",
        return_value=set(),
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_replied_lead_ids",
        return_value=set(),
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.is_configured",
        return_value=True,
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.create_campaign",
        side_effect=_exploding_create_campaign,
    ) as create_mock, patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.add_leads_to_campaign",
        side_effect=_exploding_create_campaign,
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.activate_campaign",
        side_effect=_exploding_create_campaign,
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
        return_value=None,
    ) as log_mock:
        summary = run_orchestration(icp_id=1, dry_run=True)

    create_mock.assert_not_called()
    log_mock.assert_called_once()
    entries = log_mock.call_args[0][0]
    assert len(entries) == 1
    assert entries[0].status == "dry_run"
    assert summary["leads_dry_run"] == 1
    assert summary["campaigns_created"] == 0


def test_agent_14_skips_when_instantly_not_configured(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """dry_run=False + INSTANTLY_API_KEY missing → log entries are 'skipped'
    with an error referencing the missing key.
    """
    with patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sequences",
        return_value=[sample_sequence_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_channel_plans",
        return_value=[sample_channel_plan_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_personalisations",
        return_value=[],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_leads_for_personalisation",
        return_value=[sample_lead],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sent_lead_ids",
        return_value=set(),
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_replied_lead_ids",
        return_value=set(),
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.is_configured",
        return_value=False,
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.create_campaign",
        side_effect=_exploding_create_campaign,
    ) as create_mock, patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
        return_value=None,
    ) as log_mock:
        summary = run_orchestration(icp_id=1, dry_run=False)

    create_mock.assert_not_called()
    log_mock.assert_called_once()
    entries = log_mock.call_args[0][0]
    assert len(entries) == 1
    entry = entries[0]
    assert entry.status == "skipped"
    assert entry.error and "INSTANTLY_API_KEY" in entry.error
    assert summary["leads_dry_run"] == 0


def test_agent_14_instantly_campaign_id_override(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """A CRM-supplied campaign_id is stamped on the Instantly-path log rows
    instead of the (None / 'phase3-icp-...') default. Verified in dry-run so no
    Instantly call is made.
    """
    with patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sequences",
        return_value=[sample_sequence_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_channel_plans",
        return_value=[sample_channel_plan_row],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_personalisations",
        return_value=[],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_leads_for_personalisation",
        return_value=[sample_lead],
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_sent_lead_ids",
        return_value=set(),
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.get_replied_lead_ids",
        return_value=set(),
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.is_configured",
        return_value=True,
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.instantly.create_campaign",
        side_effect=_exploding_create_campaign,
    ), patch(
        "gtm_backend.phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
        return_value=None,
    ) as log_mock:
        run_orchestration(icp_id=1, dry_run=True, campaign_id="crm-camp-99")

    entries = log_mock.call_args[0][0]
    assert entries and all(e.campaign_id == "crm-camp-99" for e in entries)


# -- Agent 15 — A/B Testing -------------------------------------------------

def test_agent_15_no_campaigns_returns_clean_summary():
    """Empty outreach_log → clean ok summary, no upserts, no analytics calls."""
    with patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.get_outreach_log",
        return_value=[],
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.is_configured",
        return_value=True,
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.get_campaign_analytics",
    ) as analytics_mock, patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.upsert_ab_test_results",
    ) as upsert_mock:
        summary = run_ab_testing()

    assert summary["campaigns_analysed"] == 0
    assert summary["variants_scored"] == 0
    assert summary["winners_declared"] == 0
    assert summary["status"] == "ok"
    analytics_mock.assert_not_called()
    upsert_mock.assert_not_called()


def test_agent_15_skips_when_instantly_not_configured():
    """Campaigns exist in outreach_log but INSTANTLY_API_KEY missing → status='skipped'."""
    with patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.get_outreach_log",
        return_value=[{"campaign_id": "camp-abc-123"}],
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.is_configured",
        return_value=False,
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.get_campaign_analytics",
    ) as analytics_mock, patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.upsert_ab_test_results",
    ) as upsert_mock:
        summary = run_ab_testing()

    assert summary["status"] == "skipped"
    assert summary["campaigns_analysed"] == 0
    analytics_mock.assert_not_called()
    upsert_mock.assert_not_called()


def test_agent_15_declares_winner_after_sample_threshold():
    """Two same-step variants, both with sent_count=100 (> threshold 50), one
    with double the reply count: winner is the higher reply_rate variant; both
    have sample_size_met=True.
    """
    analytics_payload = {
        "by_variant": [
            {
                "step": 1, "subject": "Variant A",
                "sent": 100, "opens": 30, "replies": 10,
            },
            {
                "step": 1, "subject": "Variant B",
                "sent": 100, "opens": 30, "replies": 5,
            },
        ],
    }

    with patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.get_outreach_log",
        return_value=[{"campaign_id": "camp-abc-123"}],
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.is_configured",
        return_value=True,
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.get_campaign_analytics",
        return_value=analytics_payload,
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.upsert_ab_test_results",
        return_value=None,
    ) as upsert_mock:
        summary = run_ab_testing()

    assert summary["status"] == "ok"
    assert summary["campaigns_analysed"] == 1
    assert summary["variants_scored"] == 2
    assert summary["winners_declared"] == 1
    upsert_mock.assert_called_once()

    rows = upsert_mock.call_args[0][0]
    assert len(rows) == 2
    by_subject = {r.variant_subject: r for r in rows}
    a = by_subject["Variant A"]
    b = by_subject["Variant B"]
    assert a.sample_size_met is True
    assert b.sample_size_met is True
    assert a.is_winner is True
    assert b.is_winner is False
    assert a.reply_rate > b.reply_rate
    # The winner stays active; the loser is auto-retired once a winner exists.
    assert a.is_retired is False
    assert b.is_retired is True


def test_agent_15_below_threshold_retires_nothing():
    """When no variant in a step meets the 50-send threshold, no winner is
    declared and NOTHING is retired — both variants stay active.
    """
    analytics_payload = {
        "by_variant": [
            {"step": 1, "subject": "Variant A", "sent": 10, "opens": 4, "replies": 2},
            {"step": 1, "subject": "Variant B", "sent": 12, "opens": 3, "replies": 1},
        ],
    }

    with patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.get_outreach_log",
        return_value=[{"campaign_id": "camp-xyz-1"}],
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.is_configured",
        return_value=True,
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.instantly.get_campaign_analytics",
        return_value=analytics_payload,
    ), patch(
        "gtm_backend.phase3.agents.agent_15_ab_testing.supabase.upsert_ab_test_results",
        return_value=None,
    ) as upsert_mock:
        summary = run_ab_testing()

    assert summary["winners_declared"] == 0
    rows = upsert_mock.call_args[0][0]
    assert all(r.is_winner is False for r in rows)
    assert all(r.is_retired is False for r in rows), "no winner → nothing retired"
