"""Tests for the Agent 03 scoring-persistence fix: the LLM re-score step
(meant to catch nuance the deterministic rules miss, e.g. a geography or
industry mismatch) used to be computed and printed to the console, then
silently discarded — update_lead_score() was only ever called with the raw
rule-based ScoreResult, so leads_raw.icp_score/score_tier (what the CRM
actually reads) had never reflected the LLM's judgment for any lead.

Root cause found live: a German company scored 69/HOT by the deterministic
rules (buyer title matched) but 42/COLD by the LLM (correctly flagging the
geography and industry mismatch against an India-focused SaaS ICP) — the CRM
showed HOT regardless, because the LLM output was thrown away.
"""
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_03_icp_scoring import score_leads
from gtm_backend.phase1.core.schemas import ScoreResult


def test_final_persisted_score_is_the_llm_result_not_the_rule_result(sample_icp, full_lead):
    """The core fix: update_lead_score must be called with the LLM's
    icp_score/tier as the FINAL values, not the deterministic rule score."""
    llm_payload = {
        "llm_icp_score": 42,
        "llm_score_tier": "cold",
        "llm_reasoning": "Geography and industry mismatch against the ICP.",
        "buying_intent_summary": "No signals.",
    }
    with patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_active_icps",
        return_value=[sample_icp],
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_leads_for_scoring",
        return_value=[full_lead],
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_signals_for_leads",
        return_value={full_lead["id"]: []},
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.llm.chat_json",
        return_value=llm_payload,
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.update_lead_score"
    ) as updater:
        summary = score_leads(mode="unscored")

    updater.assert_called_once()
    args, kwargs = updater.call_args
    rule_result, llm_result = args[0], args[1]
    # The rule-based ScoreResult passed through unchanged (v2.1 scoring: a
    # complete, on-ICP, verified lead scores 78/hot deterministically).
    assert rule_result.icp_score == 78
    assert rule_result.score_tier == "hot"
    # But the LLM's result is what's actually passed alongside it, carrying
    # the corrected score/tier that must end up persisted.
    assert llm_result["llm_icp_score"] == 42
    assert llm_result["llm_score_tier"] == "cold"
    # The run's own summary counts must reflect the FINAL (LLM) tier, not
    # the rule tier — otherwise the console output lies about what got saved.
    assert summary["cold"] == 1
    assert summary["hot"] == 0


def test_llm_failure_falls_back_to_rule_score_with_no_change_in_behavior(sample_icp, full_lead):
    """When the LLM call itself fails, _llm_score's except-branch already
    mirrors the deterministic score/tier — so the final persisted tier must
    equal the rule tier, same as before this fix (no regression for the
    already-handled LLM-unavailable case)."""
    with patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_active_icps",
        return_value=[sample_icp],
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_leads_for_scoring",
        return_value=[full_lead],
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_signals_for_leads",
        return_value={full_lead["id"]: []},
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.llm.chat_json",
        side_effect=RuntimeError("groq down"),
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.update_lead_score"
    ) as updater:
        summary = score_leads(mode="unscored")

    args, _ = updater.call_args
    llm_result = args[1]
    assert llm_result["llm_icp_score"] == 78
    assert llm_result["llm_score_tier"] == "hot"
    assert summary["hot"] == 1


def test_malformed_llm_tier_falls_back_to_rule_tier_for_summary_counts(sample_icp, full_lead):
    """A freeform LLM JSON response returning an unexpected tier string must
    not crash the run (KeyError) or silently vanish from the summary — it
    falls back to the rule tier for counting purposes."""
    llm_payload = {
        "llm_icp_score": 50,
        "llm_score_tier": "lukewarm",  # not one of hot/warm/cold/disqualified
        "llm_reasoning": "unclear",
        "buying_intent_summary": "",
    }
    with patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_active_icps",
        return_value=[sample_icp],
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_leads_for_scoring",
        return_value=[full_lead],
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.get_signals_for_leads",
        return_value={full_lead["id"]: []},
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.llm.chat_json",
        return_value=llm_payload,
    ), patch(
        "gtm_backend.phase1.agents.agent_03_icp_scoring.supabase.update_lead_score"
    ):
        summary = score_leads(mode="unscored")

    # Falls back to the rule tier ("hot" for full_lead) rather than raising.
    assert summary["hot"] == 1


# -- update_lead_score's actual persisted payload shape ----------------------

def test_update_lead_score_writes_llm_fields_and_preserves_rule_score(mocker):
    from gtm_backend.phase1.connectors import supabase as supabase_mod

    patch_mock = mocker.patch.object(supabase_mod, "_patch")
    mocker.patch.object(supabase_mod, "_now_iso", return_value="2026-08-04T00:00:00Z")

    rule_result = ScoreResult(
        lead_id=100, icp_score=69, score_tier="hot",
        score_breakdown={"firmographic": 50, "signals": 19},
        score_reasoning="Rule-based reasoning.",
    )
    llm_result = {
        "llm_icp_score": 42,
        "llm_score_tier": "cold",
        "llm_reasoning": "Geography mismatch.",
        "buying_intent_summary": "No signals.",
    }
    supabase_mod.update_lead_score(rule_result, llm_result)

    patch_mock.assert_called_once()
    _, kwargs = patch_mock.call_args
    payload = kwargs["json_body"]
    assert payload["icp_score"] == 42
    assert payload["score_tier"] == "cold"
    assert payload["rule_icp_score"] == 69
    assert payload["rule_score_tier"] == "hot"
    assert payload["llm_reasoning"] == "Geography mismatch."
    assert payload["buying_intent_summary"] == "No signals."


def test_update_lead_score_without_llm_result_is_unchanged_from_before(mocker):
    """Backward compat: calling update_lead_score with no llm_result (e.g.
    any future caller that doesn't have one) must behave exactly as it did
    before this fix — no rule_icp_score/llm_reasoning keys at all."""
    from gtm_backend.phase1.connectors import supabase as supabase_mod

    patch_mock = mocker.patch.object(supabase_mod, "_patch")
    mocker.patch.object(supabase_mod, "_now_iso", return_value="2026-08-04T00:00:00Z")

    rule_result = ScoreResult(
        lead_id=100, icp_score=69, score_tier="hot",
        score_breakdown={"firmographic": 50, "signals": 19},
        score_reasoning="Rule-based reasoning.",
    )
    supabase_mod.update_lead_score(rule_result)

    _, kwargs = patch_mock.call_args
    payload = kwargs["json_body"]
    assert payload["icp_score"] == 69
    assert payload["score_tier"] == "hot"
    assert "rule_icp_score" not in payload
    assert "llm_reasoning" not in payload
