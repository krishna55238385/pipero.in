"""Tests for connectors/dns.py — domain discovery + blocked URL filter.

Mocks the underlying _query_a so tests don't hit Cloudflare DoH.
"""
from unittest.mock import patch

from gtm_backend.phase1.connectors import dns


def test_extract_domain_strips_www_and_scheme():
    assert dns.extract_domain_from_url("https://www.acme.com/about") == "acme.com"


def test_extract_domain_rejects_blocked():
    assert dns.extract_domain_from_url("https://linkedin.com/company/foo") is None
    assert dns.extract_domain_from_url("https://crunchbase.com/x") is None


def test_extract_domain_handles_no_scheme():
    assert dns.extract_domain_from_url("acme.com") == "acme.com"


def test_extract_domain_empty_returns_none():
    assert dns.extract_domain_from_url("") is None
    assert dns.extract_domain_from_url("   ") is None


def test_discover_domain_tries_tlds_in_priority_order():
    calls = []

    def fake_resolve(host: str) -> bool:
        calls.append(host)
        return host == "acmecorp.io"

    with patch.object(dns, "resolve", side_effect=fake_resolve):
        result = dns.discover_domain("Acme Corp")
    assert result == "acmecorp.io"
    assert calls[0].endswith(".com")
    assert calls[1].endswith(".io")


def test_discover_domain_strips_corporate_suffix():
    with patch.object(dns, "resolve", side_effect=lambda host: host == "acme.com"):
        assert dns.discover_domain("Acme Limited") == "acme.com"


def test_discover_domain_returns_none_if_nothing_resolves():
    with patch.object(dns, "resolve", return_value=False):
        assert dns.discover_domain("Nonexistent Corp") is None


def test_discover_domain_empty_input():
    assert dns.discover_domain("") is None
    assert dns.discover_domain("   ") is None
