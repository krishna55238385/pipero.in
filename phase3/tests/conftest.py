"""Shared pytest fixtures + import-time env stub for the phase3 test suite.

phase3.connectors.* instantiate httpx clients and pydantic Settings at module
import time. To keep tests off the real network and out of the user's .env,
we set fake env vars BEFORE any phase3 module is imported.

Pydantic Settings precedence is: real env vars > .env file > defaults, so
setdefault ensures we never clobber a value the developer has already exported
while still guaranteeing the test process has the keys it needs.

INSTANTLY_API_KEY is explicitly popped so tests start with the orchestrator's
"not configured" branch active — individual tests that need the configured
branch can monkeypatch `instantly.is_configured` (or set the env var) on
their own.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("OPENAI_MODEL", "gpt-4o-mini")
os.environ.setdefault("SERP_API_KEY", "test")
os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")
os.environ.setdefault("HUNTER_API_KEY", "test")

# Sending credentials are FORCED empty (not setdefault) so the suite stays
# hermetic regardless of what's in phase1/.env or phase3/.env — filling a real
# GMAIL_APP_PASSWORD / INSTANTLY_API_KEY into phase3/.env must never make tests
# attempt a live send. Tests that need the "configured" branch monkeypatch the
# connector's _settings / is_configured directly.
for _k in (
    "INSTANTLY_API_KEY", "GMAIL_ADDRESS", "GMAIL_APP_PASSWORD", "TRACKING_BASE_URL",
):
    os.environ[_k] = ""


# -- Fixtures ---------------------------------------------------------------

@pytest.fixture
def sample_lead() -> dict:
    """Shape returned by supabase.get_leads_for_personalisation — one lead enriched
    with _gtm_insight and _account_intel sub-dicts.
    """
    return {
        "id": 1,
        "icp_id": 1,
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
        "company_website": "https://acmehr.com",
        "contact_name": "Priya Iyer",
        "contact_title": "CEO",
        "contact_email": "priya@acmehr.com",
        "bounce_status": "ok",
        "is_existing_customer": False,
        "_gtm_insight": {
            "executive_summary": "Account is in active funding cycle.",
            "what_to_say": {
                "core_message": "Help Acme scale hiring post-Series A.",
                "pain_points_to_address": ["hiring velocity", "manual compliance"],
            },
            "which_channel": {"primary_channel": "email"},
            "urgency_signal": "Funding just announced.",
        },
        "_account_intel": {
            "what_they_do": "HR platform for SMBs.",
            "company_size_estimate": "Mid-market",
            "growth_trajectory": "Growing — Series A closed.",
            "recent_moves": [
                {"date": "2026-05-01", "move_type": "funding", "summary": "Series A"},
            ],
            "likely_pain_points": [
                {"pain": "Hiring velocity", "evidence": "Open roles", "confidence": "medium"},
            ],
        },
    }


@pytest.fixture
def sample_personalisation_row() -> dict:
    """Shape returned by supabase.get_personalisations — flat dict from REST."""
    return {
        "id": 1,
        "lead_id": 1,
        "icp_id": 1,
        "company_name": "Acme HR",
        "contact_name": "Priya Iyer",
        "contact_title": "CEO",
        "angles": [
            {
                "angle_type": "trigger_event",
                "text": "Congrats on the Series A — hiring velocity becomes the #1 risk now.",
                "evidence": "Series A closed 2026-05-01",
                "confidence": "high",
            },
            {
                "angle_type": "pain_point",
                "text": "Manual compliance slows India-first onboarding.",
                "evidence": "Listed pain point in account brief.",
                "confidence": "medium",
            },
        ],
        "quality_score": 85,
        "status": "ready",
        "held_reason": None,
    }


@pytest.fixture
def sample_sequence_row() -> dict:
    """Shape returned by supabase.get_sequences — flat dict with 5 step dicts."""
    return {
        "id": 1,
        "lead_id": 1,
        "icp_id": 1,
        "company_name": "Acme HR",
        "contact_name": "Priya Iyer",
        "contact_title": "CEO",
        "persona": "CEO",
        "cta": "Open to a 15-minute chat next week?",
        "steps": [
            {
                "step_number": 1,
                "step_type": "intro",
                "delay_days": 0,
                "variants": [
                    {"subject": "Post-Series A hiring", "body": "Hi Priya, congrats on the round..."},
                    {"subject": "India-first onboarding", "body": "Hi Priya, India-first onboarding..."},
                ],
            },
            {
                "step_number": 2,
                "step_type": "follow_up",
                "delay_days": 3,
                "variants": [
                    {"subject": "Quick thought on velocity", "body": "Following up..."},
                    {"subject": "On compliance", "body": "Following up..."},
                ],
            },
            {
                "step_number": 3,
                "step_type": "follow_up",
                "delay_days": 4,
                "variants": [
                    {"subject": "One more angle", "body": "Wanted to share..."},
                    {"subject": "An alternative", "body": "Wanted to share..."},
                ],
            },
            {
                "step_number": 4,
                "step_type": "follow_up",
                "delay_days": 5,
                "variants": [
                    {"subject": "Three more questions", "body": "Worth a quick chat?"},
                    {"subject": "Anything blocking you?", "body": "Worth a quick chat?"},
                ],
            },
            {
                "step_number": 5,
                "step_type": "breakup",
                "delay_days": 6,
                "variants": [
                    {"subject": "Closing the loop", "body": "Sounds like timing isn't right..."},
                    {"subject": "Last note", "body": "Sounds like timing isn't right..."},
                ],
            },
        ],
        "sequence_quality_score": 100,
    }


@pytest.fixture
def sample_channel_plan_row() -> dict:
    """Shape returned by supabase.get_channel_plans — flat dict."""
    return {
        "id": 1,
        "lead_id": 1,
        "icp_id": 1,
        "company_name": "Acme HR",
        "primary_channel": "email",
        "secondary_channel": "linkedin",
        "channel_sequence": ["email", "linkedin", "email"],
        "send_window_start_hour": 9,
        "send_window_end_hour": 17,
        "timezone": "Asia/Kolkata",
        "touches_per_week": 2,
        "rationale": "Corporate domain + commercial role.",
    }


@pytest.fixture
def mock_llm_personalisation() -> dict:
    """Mirror PERSONALISATION_SYSTEM's expected JSON output."""
    return {
        "angles": [
            {
                "angle_type": "trigger_event",
                "text": "Congrats on the Series A — hiring velocity becomes the #1 risk now.",
                "evidence": "Series A closed 2026-05-01",
                "confidence": "high",
            },
            {
                "angle_type": "pain_point",
                "text": "Manual compliance slows India-first onboarding.",
                "evidence": "Listed pain point in account brief.",
                "confidence": "medium",
            },
        ],
        "quality_score": 85,
        "status": "ready",
        "held_reason": "",
    }


@pytest.fixture
def mock_llm_sequence() -> dict:
    """Mirror COPYWRITER_SYSTEM's expected JSON output — full 5-step, 2 variants each."""
    return {
        "persona": "CEO",
        "cta": "Open to a 15-minute chat next week?",
        "sequence_quality_score": 95,
        "steps": [
            {
                "step_number": 1,
                "step_type": "intro",
                "delay_days": 0,
                "variants": [
                    {"subject": "Post-Series A hiring", "body": "Hi Priya, congrats on the round..."},
                    {"subject": "India-first onboarding", "body": "Hi Priya, India-first onboarding..."},
                ],
            },
            {
                "step_number": 2,
                "step_type": "follow_up",
                "delay_days": 3,
                "variants": [
                    {"subject": "Quick thought on velocity", "body": "Following up on hiring velocity..."},
                    {"subject": "On compliance", "body": "Following up on compliance..."},
                ],
            },
            {
                "step_number": 3,
                "step_type": "follow_up",
                "delay_days": 4,
                "variants": [
                    {"subject": "One more angle", "body": "Wanted to share a thought on..."},
                    {"subject": "An alternative", "body": "Wanted to share an alternative angle..."},
                ],
            },
            {
                "step_number": 4,
                "step_type": "follow_up",
                "delay_days": 5,
                "variants": [
                    {"subject": "Three more questions", "body": "Worth a quick chat to compare notes?"},
                    {"subject": "Anything blocking you?", "body": "What's keeping this from being a priority?"},
                ],
            },
            {
                "step_number": 5,
                "step_type": "breakup",
                "delay_days": 6,
                "variants": [
                    {"subject": "Closing the loop", "body": "Sounds like timing isn't right — I'll bow out."},
                    {"subject": "Last note", "body": "I'll step back. Open the door whenever."},
                ],
            },
        ],
    }


@pytest.fixture
def mock_llm_channel() -> dict:
    """Mirror CHANNEL_STRATEGY_SYSTEM's expected JSON output."""
    return {
        "primary_channel": "email",
        "secondary_channel": "linkedin",
        "channel_sequence": ["email", "linkedin", "email"],
        "send_window_start_hour": 9,
        "send_window_end_hour": 17,
        "timezone": "Asia/Kolkata",
        "touches_per_week": 2,
        "rationale": "Corporate domain + commercial role; LinkedIn supplements email.",
    }


@pytest.fixture(autouse=True)
def _block_real_http(monkeypatch: pytest.MonkeyPatch) -> None:
    """Safety net: any test that forgets to mock will hard-fail rather than
    silently hit the real network. Individual tests can mock the relevant
    connector function (chat_json, instantly.*, etc.) which never reaches httpx.
    """
    def _refuse(*args: object, **kwargs: object) -> httpx.Response:
        raise RuntimeError(
            "Real HTTP call attempted during test — mock the connector function instead."
        )

    monkeypatch.setattr(httpx.Client, "get", _refuse)
    monkeypatch.setattr(httpx.Client, "post", _refuse)
    monkeypatch.setattr(httpx.Client, "patch", _refuse)
