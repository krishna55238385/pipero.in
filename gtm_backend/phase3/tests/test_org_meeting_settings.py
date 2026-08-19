"""Tests for get_current_org_meeting_settings() — per-org business hours for
Agent 22 (2026-08-19). All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.connectors import supabase

_DEFAULTS = {
    "business_start_hour": 9,
    "business_end_hour": 17,
    "business_timezone": "UTC",
    "duration_minutes": 30,
}


def test_returns_defaults_when_org_id_unset():
    with patch.object(supabase, "_ORG_ID", None):
        settings = supabase.get_current_org_meeting_settings()
    assert settings == _DEFAULTS


def test_returns_defaults_when_org_row_missing():
    with patch.object(supabase, "_ORG_ID", "org-1"), \
         patch.object(supabase, "_get", return_value=[]):
        settings = supabase.get_current_org_meeting_settings()
    assert settings == _DEFAULTS


def test_returns_defaults_on_db_error():
    with patch.object(supabase, "_ORG_ID", "org-1"), \
         patch.object(supabase, "_get", side_effect=supabase.SupabaseError("GET", "/organizations", 404, "no table")):
        settings = supabase.get_current_org_meeting_settings()
    assert settings == _DEFAULTS


def test_uses_org_specific_overrides_when_present():
    row = {
        "meeting_business_start_hour": 8,
        "meeting_business_end_hour": 12,
        "meeting_business_timezone": "Asia/Kolkata",
        "meeting_duration_minutes": 45,
    }
    with patch.object(supabase, "_ORG_ID", "org-1"), \
         patch.object(supabase, "_get", return_value=[row]):
        settings = supabase.get_current_org_meeting_settings()

    assert settings == {
        "business_start_hour": 8,
        "business_end_hour": 12,
        "business_timezone": "Asia/Kolkata",
        "duration_minutes": 45,
    }


def test_partial_overrides_fall_back_to_defaults_per_field():
    row = {
        "meeting_business_start_hour": None,
        "meeting_business_end_hour": None,
        "meeting_business_timezone": None,
        "meeting_duration_minutes": 60,
    }
    with patch.object(supabase, "_ORG_ID", "org-1"), \
         patch.object(supabase, "_get", return_value=[row]):
        settings = supabase.get_current_org_meeting_settings()

    assert settings["business_start_hour"] == 9
    assert settings["business_end_hour"] == 17
    assert settings["business_timezone"] == "UTC"
    assert settings["duration_minutes"] == 60
