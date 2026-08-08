"""Tests for the new supabase.py helpers backing Task #34/#35 (inbox
polling + multi-reply support): get_reply_by_message_id and
get_outreach_log_by_thread_id. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.connectors import supabase


def test_get_reply_by_message_id_returns_none_for_empty_input():
    assert supabase.get_reply_by_message_id("") is None
    assert supabase.get_reply_by_message_id(None) is None


def test_get_reply_by_message_id_queries_on_message_id():
    with patch.object(supabase, "_get", return_value=[{"id": 5, "message_id": "m1"}]) as get_mock:
        row = supabase.get_reply_by_message_id("m1")

    assert row == {"id": 5, "message_id": "m1"}
    args, kwargs = get_mock.call_args
    assert args[0] == "/outreach_replies"
    assert kwargs["params"]["message_id"] == "eq.m1"


def test_get_reply_by_message_id_returns_none_when_no_match():
    with patch.object(supabase, "_get", return_value=[]):
        assert supabase.get_reply_by_message_id("m-nope") is None


def test_get_reply_by_message_id_degrades_gracefully_when_table_missing():
    exc = supabase.SupabaseError("GET", "/outreach_replies", 404, "relation \"outreach_replies\" does not exist")
    with patch.object(supabase, "_get", side_effect=exc), \
         patch.object(supabase, "_missing_table", return_value=True):
        assert supabase.get_reply_by_message_id("m1") is None


def test_get_outreach_log_by_thread_id_returns_none_for_empty_input():
    assert supabase.get_outreach_log_by_thread_id("") is None
    assert supabase.get_outreach_log_by_thread_id(None) is None


def test_get_outreach_log_by_thread_id_queries_on_thread_id():
    with patch.object(supabase, "_get", return_value=[{"campaign_id": "camp-9"}]) as get_mock:
        row = supabase.get_outreach_log_by_thread_id("t1")

    assert row == {"campaign_id": "camp-9"}
    args, kwargs = get_mock.call_args
    assert args[0] == "/outreach_log"
    assert kwargs["params"]["thread_id"] == "eq.t1"


def test_get_outreach_log_by_thread_id_returns_none_when_no_match():
    with patch.object(supabase, "_get", return_value=[]):
        assert supabase.get_outreach_log_by_thread_id("t-unknown") is None
