"""Shared pytest fixtures + import-time env stub for the phase2 test suite.

phase2.connectors.* instantiate httpx clients and pydantic Settings at module
import time. To keep tests off the real network and out of the user's .env,
we set fake env vars BEFORE any phase2 module is imported.

Pydantic Settings precedence is: real env vars > .env file > defaults, so
setdefault ensures we never clobber a value the developer has already exported
while still guaranteeing the test process has the keys it needs.
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
os.environ.pop("HUNTER_API_KEY", None)


@pytest.fixture
def fake_icp() -> dict:
    return {
        "id": 1,
        "name": "Mid-market HR-tech in India",
        "industry": ["HR Tech", "SaaS"],
        "geography": ["Bangalore", "Mumbai", "India"],
        "company_size_min": 50,
        "company_size_max": 200,
        "buyer_titles": ["CEO", "Founder", "Head of HR"],
        "user_titles": ["HR Manager", "Recruiter"],
        "blocker_titles": ["CFO", "Procurement"],
        "active": True,
    }


@pytest.fixture
def fake_lead() -> dict:
    return {
        "id": 100,
        "icp_id": 1,
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
        "company_website": "https://acmehr.com",
        "company_industry": "HR Tech",
        "company_country": "India",
        "is_existing_customer": False,
    }


@pytest.fixture
def fake_brief_row() -> dict:
    """Shape returned by supabase.get_account_brief — flat dict."""
    return {
        "id": 9001,
        "lead_id": 100,
        "icp_id": 1,
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
        "what_they_do": "HR platform for SMB.",
        "business_model": "B2B",
        "company_size_estimate": "Mid-market",
        "growth_trajectory": "Growing — recently raised Series A.",
        "competitive_position": "Differentiated by India-first onboarding.",
        "recent_moves": [
            {"date": "2026-05-01", "move_type": "funding", "summary": "Series A", "source_url": "https://news/series-a"},
        ],
        "likely_pain_points": [
            {"pain": "Hiring velocity", "evidence": "Open roles posted", "confidence": "medium"},
            {"pain": "Manual compliance", "evidence": None, "confidence": "low"},
        ],
        "instability_flags": [],
        "confirmed_facts": [
            {"fact": "Bangalore HQ", "source": "website", "source_url": "https://acmehr.com/about"},
        ],
        "key_signals_for_outreach": ["recent funding", "hiring spike"],
        "brief_quality_score": 80,
        "status": "fresh",
        "sources_scanned": ["https://acmehr.com"],
    }


@pytest.fixture
def fake_serp_organic_results() -> list[dict]:
    return [
        {
            "title": "Acme HR | Best HR Tech",
            "link": "https://acmehr.com",
            "snippet": "Acme HR is a Bangalore-based HR platform.",
        },
        {
            "title": "Acme HR Careers — We're hiring",
            "link": "https://acmehr.com/careers",
            "snippet": "Open roles for engineers.",
        },
    ]


@pytest.fixture
def fake_serp_news_results() -> list[dict]:
    return [
        {
            "title": "Acme HR raises $10M Series A",
            "link": "https://news.example.com/acme-series-a",
            "snippet": "Bangalore-based Acme HR closes Series A round.",
            "date": "2026-05-01",
        },
    ]


@pytest.fixture
def fake_linkedin_snippets() -> list[dict]:
    return [
        {
            "title": "Priya Iyer - CEO at Acme HR | LinkedIn",
            "link": "https://linkedin.com/in/priya-iyer",
            "snippet": "Priya Iyer — Chief Executive Officer at Acme HR",
        },
        {
            "title": "Rahul Mehta - Head of HR at Acme HR",
            "link": "https://linkedin.com/in/rahul-mehta",
            "snippet": "Head of HR at Acme HR, ex-Flipkart.",
        },
        {
            "title": "Sara Khan - VP Engineering at Acme HR",
            "link": "https://linkedin.com/in/sara-khan",
            "snippet": "Leads engineering at Acme HR.",
        },
    ]


@pytest.fixture(autouse=True)
def _block_real_http(monkeypatch: pytest.MonkeyPatch) -> None:
    """Safety net: any test that forgets to mock will hard-fail rather than
    silently hit the real network. Individual tests can mock the relevant
    connector function (chat_json/search/etc.) which never reaches httpx.
    """
    def _refuse(*args: object, **kwargs: object) -> httpx.Response:
        raise RuntimeError(
            "Real HTTP call attempted during test — mock the connector function instead."
        )

    monkeypatch.setattr(httpx.Client, "get", _refuse)
    monkeypatch.setattr(httpx.Client, "post", _refuse)
    monkeypatch.setattr(httpx.Client, "patch", _refuse)
