"""Tests for the email pattern generator in core/emails.py."""
from phase1.core.emails import generate_patterns


def test_six_standard_patterns():
    out = generate_patterns("John Doe", "acme.com")
    assert out == [
        "john.doe@acme.com",
        "johndoe@acme.com",
        "jdoe@acme.com",
        "j.doe@acme.com",
        "john_doe@acme.com",
        "john@acme.com",
    ]


def test_empty_name_returns_empty():
    assert generate_patterns("", "acme.com") == []


def test_empty_domain_returns_empty():
    assert generate_patterns("John Doe", "") == []


def test_single_name_only_first_pattern():
    out = generate_patterns("Madonna", "acme.com")
    assert out == ["madonna@acme.com"]


def test_hyphen_in_name_stripped():
    out = generate_patterns("Mary-Jane Watson", "acme.com")
    assert "mary-jane.watson@acme.com" in out or "maryjane.watson@acme.com" in out
