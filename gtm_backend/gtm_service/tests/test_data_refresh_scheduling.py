"""Tests for Task #6 — wiring Agent 37 (Data Refresh) into the scheduler for
automatic, per-org, once-daily re-verification. Mirrors the reply/meeting
pipeline scheduling tests (Task #50) — same interval-tracking pattern, same
per-org threading, same phase_runs logging. All external IO mocked."""
from unittest.mock import MagicMock, patch

from gtm_backend.gtm_service import db, scheduler
from gtm_backend.gtm_service.runner import build_data_refresh_commands

_DB_MOD = "gtm_backend.gtm_service.db"
_SCHED_MOD = "gtm_backend.gtm_service.scheduler"


# -- runner.build_data_refresh_commands -------------------------------------

def test_data_refresh_command_targets_agent_37():
    commands = build_data_refresh_commands()
    assert commands == [["-m", "gtm_backend.phase4", "refresh-data"]]


# -- db.get_orgs_with_leads --------------------------------------------------

def test_get_orgs_with_leads_queries_leads_raw_with_contact_email():
    mock_cursor = MagicMock()
    mock_cursor.__enter__.return_value = mock_cursor
    mock_cursor.fetchall.return_value = [{"organization_id": "org-1"}, {"organization_id": "org-2"}]
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor

    with patch(f"{_DB_MOD}._get_db_connection", return_value=mock_conn):
        result = db.get_orgs_with_leads()

    assert result == ["org-1", "org-2"]
    query = mock_cursor.execute.call_args[0][0]
    assert "leads_raw" in query
    assert "contact_email" in query


# -- scheduler.tick_data_refresh — cadence -----------------------------------

def test_tick_skips_before_24h_interval_elapsed():
    """Must not run again inside the 24-hour window even though the outer
    loop ticks every 60s — this is the actual mechanism that turns 60s ticks
    into a once-daily cadence, per Task #6 item 1."""
    with patch.object(scheduler, "_data_refresh_last_run_at", scheduler.datetime.now(scheduler.ZoneInfo("UTC")).timestamp()), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_leads") as orgs_mock:
        scheduler.tick_data_refresh()

    orgs_mock.assert_not_called()


def test_tick_runs_once_interval_has_elapsed():
    """The core cadence assertion: simulate the 24h interval having elapsed
    (last run timestamped far in the past, no real waiting) and confirm the
    tick actually invokes the per-org data-refresh path this time."""
    with patch.object(scheduler, "_data_refresh_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_leads", return_value=["org-1"]), \
         patch(f"{_SCHED_MOD}.threading.Thread") as thread_mock:
        scheduler.tick_data_refresh()

    thread_mock.assert_called_once()
    assert thread_mock.call_args.kwargs["target"] == scheduler._run_data_refresh_for_org
    assert thread_mock.call_args.kwargs["args"] == ("org-1",)
    thread_mock.return_value.start.assert_called_once()


def test_tick_updates_last_run_timestamp_so_it_does_not_fire_twice():
    """After firing once, the tracked timestamp must have moved forward —
    otherwise the very next 60s tick would fire again immediately instead of
    waiting the full 24h."""
    with patch.object(scheduler, "_data_refresh_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_leads", return_value=["org-1"]), \
         patch(f"{_SCHED_MOD}.threading.Thread"):
        scheduler.tick_data_refresh()
        assert scheduler._data_refresh_last_run_at > 0.0


# -- scheduler.tick_data_refresh — per-org scoping ---------------------------

def test_tick_runs_for_every_org_with_leads():
    with patch.object(scheduler, "_data_refresh_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_leads", return_value=["org-1", "org-2", "org-3"]), \
         patch(f"{_SCHED_MOD}.threading.Thread") as thread_mock:
        scheduler.tick_data_refresh()

    assert thread_mock.call_count == 3
    called_org_ids = {call.kwargs["args"][0] for call in thread_mock.call_args_list}
    assert called_org_ids == {"org-1", "org-2", "org-3"}


def test_tick_no_op_when_no_orgs_have_leads():
    with patch.object(scheduler, "_data_refresh_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_leads", return_value=[]), \
         patch(f"{_SCHED_MOD}.threading.Thread") as thread_mock:
        scheduler.tick_data_refresh()

    thread_mock.assert_not_called()


def test_tick_db_error_does_not_raise():
    with patch.object(scheduler, "_data_refresh_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_leads", side_effect=RuntimeError("db down")):
        scheduler.tick_data_refresh()  # must not raise


# -- scheduler._run_data_refresh_for_org — org scoping + logging ------------

def test_run_data_refresh_for_org_passes_org_id_to_runner():
    """This is what actually makes the run per-org rather than a global
    unscoped pass: organization_id flows into both create_phase_run (so it
    shows up filtered in the CRM's pipeline-runs view) and run_commands
    (which sets GTM_ORG_ID in the subprocess env — the same mechanism
    get_leads_for_data_refresh now reads via _scope_to_org)."""
    with patch(f"{_SCHED_MOD}.db.create_phase_run", return_value="run-1") as create_mock, \
         patch(f"{_SCHED_MOD}.runner.run_commands", return_value=("succeeded", "logs")) as run_mock:
        scheduler._run_data_refresh_for_org("org-1")

    create_mock.assert_called_once()
    assert create_mock.call_args.kwargs["organization_id"] == "org-1"
    assert create_mock.call_args.kwargs["phase"] == "data-refresh"
    run_mock.assert_called_once()
    assert run_mock.call_args.args[2] == "org-1"


def test_one_orgs_failure_does_not_raise_or_block():
    with patch(f"{_SCHED_MOD}.db.create_phase_run", return_value="run-1"), \
         patch(f"{_SCHED_MOD}.runner.run_commands", side_effect=RuntimeError("boom")):
        scheduler._run_data_refresh_for_org("org-1")  # must not raise
