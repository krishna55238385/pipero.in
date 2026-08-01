"""Tests for the "prepare" cost-efficiency fix: the CRM's "Find leads" button
used to re-run Agent 02 (lead search) on every single click, even when the
ICP already had leads from a prior run — real SerpAPI + LLM spend paid again
only to be discarded by dedup. Now the leads step is skipped when the ICP
already has leads, unless force_leads=True (the explicit "search for more
leads" action)."""
from unittest.mock import patch

from gtm_backend.gtm_service.runner import build_commands

_MOD = "gtm_backend.gtm_service.runner"


def test_prepare_skips_leads_step_when_icp_already_has_leads():
    with patch(f"{_MOD}.db.has_existing_leads", return_value=True):
        commands = build_commands("prepare", {"icp_id": 1})

    phase1_leads_steps = [c for c in commands if len(c) > 2 and c[2] == "leads"]
    assert phase1_leads_steps == []
    # enrich/signals/score must still run.
    step_names = [c[2] for c in commands if c[1] == "gtm_backend.phase1"]
    assert step_names == ["enrich", "signals", "score"]


def test_prepare_runs_leads_step_when_icp_has_no_leads_yet():
    with patch(f"{_MOD}.db.has_existing_leads", return_value=False):
        commands = build_commands("prepare", {"icp_id": 1})

    step_names = [c[2] for c in commands if c[1] == "gtm_backend.phase1"]
    assert step_names == ["leads", "enrich", "signals", "score"]


def test_prepare_force_leads_always_runs_leads_step_even_if_icp_has_leads():
    with patch(f"{_MOD}.db.has_existing_leads", return_value=True) as has_leads:
        commands = build_commands("prepare", {"icp_id": 1, "force_leads": True})

    step_names = [c[2] for c in commands if c[1] == "gtm_backend.phase1"]
    assert step_names == ["leads", "enrich", "signals", "score"]
    # force_leads short-circuits the check entirely — no DB round trip needed.
    has_leads.assert_not_called()


def test_prepare_still_runs_phase2_and_phase3_regardless_of_skip():
    with patch(f"{_MOD}.db.has_existing_leads", return_value=True):
        commands = build_commands("prepare", {"icp_id": 1})

    assert any(c[1] == "gtm_backend.phase2" for c in commands)
    assert any(c[1] == "gtm_backend.phase3" for c in commands)


def test_plain_phase1_call_unaffected_by_skip_leads_default():
    """Direct phase1 calls (not via "prepare") must still include the leads
    step by default — skip_leads is opt-in, not a global behavior change."""
    commands = build_commands("phase1", {"icp_id": 1})
    step_names = [c[2] for c in commands]
    assert step_names == ["leads", "enrich", "signals", "score"]
