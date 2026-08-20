"""Tests for Task #50 — multi-org reply/meeting pipeline scheduling. Replaces
the old EC2 crontab entries (hardcoded to a single org) with a scheduler tick
that runs the reply-pipeline and meeting-pipeline for every org that has a
connected Gmail mailbox. All external IO (DB, subprocess) mocked."""
from unittest.mock import MagicMock, patch

from gtm_backend.gtm_service import db, scheduler
from gtm_backend.gtm_service.runner import (
    build_meeting_pipeline_commands,
    build_reply_pipeline_commands,
)

_DB_MOD = "gtm_backend.gtm_service.db"
_SCHED_MOD = "gtm_backend.gtm_service.scheduler"


# -- runner.build_*_pipeline_commands ------------------------------------

def test_reply_pipeline_commands_order_matters():
    """Objections must be detected before drafting (agent_18's own rule) —
    poll-inbox must come first since nothing else has anything to work with
    until the inbox has actually been read."""
    commands = build_reply_pipeline_commands()
    steps = [c[2] for c in commands]
    assert steps == ["poll-inbox", "detect-objections", "draft-replies"]
    assert commands[0][1] == "gtm_backend.phase3"


def test_meeting_pipeline_commands_order_matters():
    """propose -> sync -> brief -> no-show, each step depends on the
    previous one's output."""
    commands = build_meeting_pipeline_commands()
    steps = [c[2] for c in commands]
    assert steps == [
        "propose-meetings",
        "sync-meeting-confirmations",
        "generate-meeting-briefs",
        "detect-no-shows",
    ]
    assert all(c[1] == "gtm_backend.phase4" for c in commands)


# -- db.get_orgs_with_connected_mailbox ----------------------------------

def test_get_orgs_with_connected_mailbox_queries_gmail_provider():
    mock_cursor = MagicMock()
    mock_cursor.__enter__.return_value = mock_cursor
    mock_cursor.fetchall.return_value = [{"organization_id": "org-1"}, {"organization_id": "org-2"}]
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor

    with patch(f"{_DB_MOD}._get_db_connection", return_value=mock_conn):
        result = db.get_orgs_with_connected_mailbox()

    assert result == ["org-1", "org-2"]
    query = mock_cursor.execute.call_args[0][0]
    assert "engage_mailboxes" in query
    assert "gmail" in query


# -- scheduler.tick_reply_and_meeting_pipelines --------------------------

def test_tick_skips_before_interval_elapsed():
    """Must not run again inside the 10-minute window even though the outer
    loop ticks every 60s — this is what actually replicates the crontab's
    */10 cadence instead of firing on every 60s tick."""
    with patch.object(scheduler, "_reply_meeting_last_run_at", scheduler.datetime.now(scheduler.ZoneInfo("UTC")).timestamp()), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_connected_mailbox") as orgs_mock:
        scheduler.tick_reply_and_meeting_pipelines()

    orgs_mock.assert_not_called()


def test_tick_runs_for_every_org_with_a_mailbox():
    with patch.object(scheduler, "_reply_meeting_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_connected_mailbox", return_value=["org-1", "org-2"]), \
         patch(f"{_SCHED_MOD}.threading.Thread") as thread_mock:
        scheduler.tick_reply_and_meeting_pipelines()

    assert thread_mock.call_count == 2
    called_org_ids = {call.kwargs["args"][0] for call in thread_mock.call_args_list}
    assert called_org_ids == {"org-1", "org-2"}
    for call in thread_mock.call_args_list:
        thread_mock.return_value.start.assert_called()


def test_tick_no_op_when_no_orgs_have_a_mailbox():
    with patch.object(scheduler, "_reply_meeting_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_connected_mailbox", return_value=[]), \
         patch(f"{_SCHED_MOD}.threading.Thread") as thread_mock:
        scheduler.tick_reply_and_meeting_pipelines()

    thread_mock.assert_not_called()


def test_tick_db_error_does_not_raise():
    with patch.object(scheduler, "_reply_meeting_last_run_at", 0.0), \
         patch(f"{_SCHED_MOD}.db.get_orgs_with_connected_mailbox", side_effect=RuntimeError("db down")):
        scheduler.tick_reply_and_meeting_pipelines()  # must not raise


def test_run_pipelines_for_org_runs_both_phases_and_records_phase_runs():
    with patch(f"{_SCHED_MOD}.db.create_phase_run", side_effect=["run-1", "run-2"]) as create_mock, \
         patch(f"{_SCHED_MOD}.runner.run_commands", return_value=("succeeded", "logs")) as run_mock:
        scheduler._run_reply_and_meeting_pipelines_for_org("org-1")

    assert create_mock.call_count == 2
    assert run_mock.call_count == 2
    orgs_passed = [call.args[2] for call in run_mock.call_args_list]
    assert orgs_passed == ["org-1", "org-1"]


def test_one_orgs_failure_does_not_block_the_next_phase_or_org():
    """A crashed reply-pipeline for one org must not prevent its own
    meeting-pipeline, or any other org, from running."""
    with patch(f"{_SCHED_MOD}.db.create_phase_run", return_value="run-1"), \
         patch(f"{_SCHED_MOD}.runner.run_commands", side_effect=RuntimeError("boom")) as run_mock:
        scheduler._run_reply_and_meeting_pipelines_for_org("org-1")  # must not raise

    assert run_mock.call_count == 2  # both phases still attempted
