"""Tests for Task #5 (part 1) — honest email verification confidence tiers.

"domain_verified" (existing disify.com MX/domain check, unchanged) vs
"person_confirmed" (the contact's name was independently found on the
company's own team/about page, reusing the same team-page fetch Agent 07
uses for stakeholder mapping) — distinct from the plain `verified` boolean,
which only ever meant "the domain accepts mail," never "this specific
person still works there."
"""
from unittest.mock import patch

from gtm_backend.phase1.agents.lead_enrichment import (
    _email_verification_tier,
    _name_on_team_page,
)
from gtm_backend.phase1.core.schemas import Lead

_MOD = "gtm_backend.phase1.agents.lead_enrichment"


# -- _name_on_team_page --------------------------------------------------

def test_name_found_on_team_page():
    pages = [{"text": "Our leadership team includes Priya Iyer, CEO, and Raj Mehta, CTO.", "source_url": "https://acmehr.com/team"}]
    with patch(f"{_MOD}.website.fetch_team_pages", return_value=pages):
        assert _name_on_team_page("Priya Iyer", "acmehr.com") is True


def test_name_not_found_on_team_page():
    pages = [{"text": "Our leadership team includes Raj Mehta, CTO, and Sam Lee, CFO.", "source_url": "https://acmehr.com/team"}]
    with patch(f"{_MOD}.website.fetch_team_pages", return_value=pages):
        assert _name_on_team_page("Priya Iyer", "acmehr.com") is False


def test_partial_name_match_is_not_enough():
    """Only the first name appearing (e.g. a common word coincidence) must
    not count as a match — BOTH tokens are required."""
    pages = [{"text": "Priya's Bakery is a great place to eat lunch nearby.", "source_url": "https://acmehr.com/team"}]
    with patch(f"{_MOD}.website.fetch_team_pages", return_value=pages):
        assert _name_on_team_page("Priya Iyer", "acmehr.com") is False


def test_no_team_pages_found_returns_false():
    with patch(f"{_MOD}.website.fetch_team_pages", return_value=[]):
        assert _name_on_team_page("Priya Iyer", "acmehr.com") is False


def test_team_page_fetch_failure_returns_false_not_raise():
    with patch(f"{_MOD}.website.fetch_team_pages", side_effect=Exception("network error")):
        assert _name_on_team_page("Priya Iyer", "acmehr.com") is False


def test_single_token_name_never_matches():
    """A name with no discernible last name (e.g. a mononym or parsing
    artifact) is deliberately never checked — too weak a signal."""
    with patch(f"{_MOD}.website.fetch_team_pages") as fetch:
        assert _name_on_team_page("Cher", "acmehr.com") is False
        fetch.assert_not_called()


# -- _email_verification_tier ---------------------------------------------

def test_contact_found_on_team_page_gets_person_confirmed():
    pages = [{"text": "Meet our team: Priya Iyer, Founder & CEO.", "source_url": "https://acmehr.com/team"}]
    with patch(f"{_MOD}.website.fetch_team_pages", return_value=pages):
        tier = _email_verification_tier(verified=True, full_name="Priya Iyer", domain="acmehr.com")
    assert tier == "person_confirmed"


def test_contact_only_domain_checked_gets_domain_verified():
    with patch(f"{_MOD}.website.fetch_team_pages", return_value=[]):
        tier = _email_verification_tier(verified=True, full_name="Priya Iyer", domain="acmehr.com")
    assert tier == "domain_verified"


def test_unverified_email_gets_no_tier():
    """verified=False -> None, regardless of team-page match — no badge
    should show at all for an email that never even passed the domain
    check."""
    with patch(f"{_MOD}.website.fetch_team_pages") as fetch:
        tier = _email_verification_tier(verified=False, full_name="Priya Iyer", domain="acmehr.com")
    assert tier is None
    fetch.assert_not_called()


# -- backward compatibility -------------------------------------------------

def test_lead_schema_defaults_new_fields_when_absent():
    """A lead dict built before this feature existed — no
    email_verification_tier/needs_reverification keys at all — must still
    construct a valid Lead with sensible defaults, not crash."""
    lead = Lead(icp_id=1, company_name="Old Lead Co", contact_email="x@oldleadco.com", verified=True)
    assert lead.email_verification_tier is None
    assert lead.needs_reverification is False


def test_lead_schema_accepts_explicit_tier_and_reverification_flag():
    lead = Lead(
        icp_id=1, company_name="Acme HR", contact_email="priya@acmehr.com",
        verified=True, email_verification_tier="person_confirmed", needs_reverification=False,
    )
    assert lead.email_verification_tier == "person_confirmed"
    assert lead.needs_reverification is False
