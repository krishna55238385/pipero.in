"""Shared pytest fixtures + import-time env stub for the phase1 test suite.

phase1.connectors.* instantiate httpx clients (and pydantic Settings) at module
import time. To keep tests off the real network and out of the user's .env,
we set fake env vars BEFORE any phase1 module is imported.

Pydantic Settings precedence is: real env vars > .env file > defaults, so
setting these here wins over the on-disk .env even if it has live keys.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os.environ["OPENAI_API_KEY"] = "test-openai"
os.environ["OPENAI_MODEL"] = "gpt-4o-mini"
os.environ["GROQ_API_KEY"] = "test-groq"  # phase1/connectors/openai.py routes through Groq
os.environ["SERP_API_KEY"] = "test-serp"
os.environ["DATABASE_URL"] = "postgresql://test:test@localhost/test"
os.environ["SUPABASE_URL"] = "https://fake.supabase.co"
os.environ["SUPABASE_KEY"] = "test-supabase"
os.environ.pop("HUNTER_API_KEY", None)


@pytest.fixture
def sample_icp() -> dict:
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
    }


@pytest.fixture
def full_lead() -> dict:
    """A lead with every field populated. Should hit the firmographic ceiling."""
    return {
        "id": 100,
        "icp_id": 1,
        "company_name": "Acme HR",
        "company_domain": "acmehr.com",
        "company_website": "https://acmehr.com",
        "company_phone": "+91-99999",
        "company_city": "Bangalore",
        "company_country": "India",
        "company_industry": "HR Tech",
        "contact_name": "Priya Iyer",
        "contact_email": "priya@acmehr.com",
        "contact_title": "CEO",
        "verified": True,
        "bounce_status": "valid",
        "google_rating": 4.5,
        "is_existing_customer": False,
    }


@pytest.fixture
def thin_lead() -> dict:
    """A lead with bare minimum data."""
    return {
        "id": 200,
        "icp_id": 1,
        "company_name": "Unknown Co",
        "is_existing_customer": False,
    }
