"""Tests for connectors/dns.py — domain discovery + blocked URL filter.

Mocks the underlying _query_a / _verify_domain so tests don't hit Cloudflare
DoH, a live homepage, or SerpAPI.
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

    with patch.object(dns, "resolve", side_effect=fake_resolve), \
         patch.object(dns, "_verify_domain", return_value=True):
        result = dns.discover_domain("Acme Corp")
    assert result == "acmecorp.io"
    assert calls[0].endswith(".com")
    assert calls[1].endswith(".io")


def test_discover_domain_strips_corporate_suffix():
    with patch.object(dns, "resolve", side_effect=lambda host: host == "acme.com"), \
         patch.object(dns, "_verify_domain", return_value=True):
        assert dns.discover_domain("Acme Limited") == "acme.com"


def test_discover_domain_returns_none_if_nothing_resolves():
    with patch.object(dns, "resolve", return_value=False), \
         patch.object(dns, "_search_official_site", return_value=None):
        assert dns.discover_domain("Nonexistent Corp") is None


def test_discover_domain_empty_input():
    assert dns.discover_domain("") is None
    assert dns.discover_domain("   ") is None


def test_discover_domain_rejects_unverified_guess_and_falls_back_to_search():
    # A candidate resolves in DNS (some server answers) but its homepage
    # content doesn't actually belong to the expected company — must not be
    # trusted, and must fall through to the search-based fallback instead.
    with patch.object(dns, "resolve", return_value=True), \
         patch.object(dns, "_verify_domain", return_value=False), \
         patch.object(dns, "_search_official_site", return_value="real-site.com") as fallback:
        assert dns.discover_domain("Acme Corp") == "real-site.com"
    fallback.assert_called_once_with("Acme Corp", None)


# --- Regression: "Apollo.io" (name already contains a dot) --------------
#
# Old behaviour: _normalize_name stripped the "." along with the space,
# turning "Apollo.io" into the wrong guess "apolloio.com". The name already
# names a real domain — it should be tried verbatim, verified, and returned
# without ever going through TLD-guessing.

def test_discover_domain_apollo_io_uses_embedded_domain_not_mangled_guess():
    with patch.object(dns, "resolve", side_effect=lambda h: h == "apollo.io") as resolve_mock, \
         patch.object(dns, "_verify_domain", side_effect=lambda h, n, c=None: h == "apollo.io"):
        result = dns.discover_domain("Apollo.io")
    assert result == "apollo.io"
    assert "apolloio.com" not in resolve_mock.call_args_list[0][0]


def test_discover_domain_apollo_io_never_tries_mangled_apolloio_com():
    seen_hosts = []

    def fake_resolve(host: str) -> bool:
        seen_hosts.append(host)
        return host == "apollo.io"

    with patch.object(dns, "resolve", side_effect=fake_resolve), \
         patch.object(dns, "_verify_domain", side_effect=lambda h, n, c=None: h == "apollo.io"):
        dns.discover_domain("Apollo.io")
    assert "apolloio.com" not in seen_hosts


# --- Regression: "XANT (InsideSales.com)" (parenthetical alt name) ------
#
# Old behaviour: the parenthesis characters were stripped by the same
# alnum-only filter as everything else, producing the single garbage
# candidate "xantinsidesalescom" which never resolved — discover_domain
# returned None. The parenthetical should be recognised both as an embedded
# domain ("insidesales.com") and as an independent guess base ("InsideSales").

def test_discover_domain_xant_parenthetical_resolves_embedded_domain():
    with patch.object(dns, "resolve", side_effect=lambda h: h == "insidesales.com"), \
         patch.object(dns, "_verify_domain", side_effect=lambda h, n, c=None: h == "insidesales.com"):
        result = dns.discover_domain("XANT (InsideSales.com)")
    assert result == "insidesales.com"


def test_discover_domain_xant_never_produces_mangled_concatenation():
    seen_hosts = []

    def fake_resolve(host: str) -> bool:
        seen_hosts.append(host)
        return False

    with patch.object(dns, "resolve", side_effect=fake_resolve), \
         patch.object(dns, "_search_official_site", return_value=None):
        dns.discover_domain("XANT (InsideSales.com)")
    assert not any("xantinsidesales" in h for h in seen_hosts)


# --- Regression: verification must reject a same-named wrong company ----
#
# outreach.com resolves in DNS but is an unrelated church-donation platform,
# not the sales-engagement company "Outreach". Verification must reject it
# on content grounds (or treat an inaccessible/blocked page as inconclusive)
# and move on to the next TLD guess.

def test_verify_domain_rejects_when_homepage_evidence_is_empty():
    with patch.object(dns.website_lookup, "fetch_site_name", return_value=None), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={"meta_description": None, "schema_org_text": None}):
        assert dns._verify_domain("outreach.com", "Outreach") is False


def test_verify_domain_accepts_matching_site_name():
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="Outreach"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={"meta_description": "Sales engagement platform", "schema_org_text": None}):
        assert dns._verify_domain("outreach.io", "Outreach") is True


def test_discover_domain_outreach_skips_dead_com_and_returns_verified_io():
    def fake_resolve(host: str) -> bool:
        return host in ("outreach.com", "outreach.io")

    def fake_verify(host: str, name: str, context: str | None = None) -> bool:
        # outreach.com is a different, unrelated company — fails verification.
        return host == "outreach.io"

    with patch.object(dns, "resolve", side_effect=fake_resolve), \
         patch.object(dns, "_verify_domain", side_effect=fake_verify):
        result = dns.discover_domain("Outreach")
    assert result == "outreach.io"


# --- _search_official_site fallback --------------------------------------

def test_search_official_site_returns_first_verified_result():
    fake_results = [
        {"link": "https://directory-listing.example.com/outreach"},
        {"link": "https://outreach.io/"},
    ]
    with patch.object(dns.serpapi_lookup, "search", return_value=fake_results), \
         patch.object(dns, "_verify_domain", side_effect=lambda h, n, c=None: h == "outreach.io"):
        assert dns._search_official_site("Outreach") == "outreach.io"


def test_search_official_site_falls_back_to_top_result_if_none_verify():
    fake_results = [{"link": "https://top-result.example.com/"}]
    with patch.object(dns.serpapi_lookup, "search", return_value=fake_results), \
         patch.object(dns, "_verify_domain", return_value=False):
        assert dns._search_official_site("Some Company") == "top-result.example.com"


def test_search_official_site_returns_none_on_search_failure():
    with patch.object(dns.serpapi_lookup, "search", side_effect=RuntimeError("quota")):
        assert dns._search_official_site("Some Company") is None


# --- Regression: name-only match on a one-word collision -----------------
#
# "XANT" alone (before considering the parenthetical) resolves to xant.com,
# a real but unrelated Polish company that also happens to brand itself
# "XANT". A single shared token is not enough evidence — this is exactly why
# a 2-token expected name (from the parenthetical) requires BOTH tokens.

def test_verify_domain_rejects_single_token_overlap_on_two_word_name():
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="XANT - Strona Glowna"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={
                           "meta_description": "XANT develops industry platforms: Pub, Vet, Beauty, Construction, Software, Supply.",
                           "schema_org_text": None,
                       }):
        assert dns._verify_domain("xant.com", "XANT (InsideSales.com)") is False


# --- Regression: `context` must NOT gate the pass/fail decision ----------
#
# A category-sanity gate was tried (reject a name match when none of an
# optional industry `context` hint's words appear in the homepage evidence)
# to catch exact-name collisions like two unrelated real companies both
# branding themselves "Groove". A live run against ICP #62 (2026-09-04)
# showed it backfiring: it rejected the REAL salesloft.com — whose own
# marketing copy is "AI Predictive Revenue System" with no literal
# "sales"/"engagement"/"software" token — and fell through to the wrong,
# thin salesloft.net instead, while still failing to catch the Groove
# collision it was meant to prevent. `context` is accepted for API
# stability but must have zero effect on the verdict.

def test_verify_domain_context_does_not_reject_a_real_match_with_off_category_copy():
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="The Leading Predictive Revenue System"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={
                           "meta_description": "Turn buyer signals into action with Salesloft's AI Predictive Revenue System.",
                           "schema_org_text": '{"@type":"Organization","name":"Salesloft"}',
                       }):
        assert dns._verify_domain("salesloft.com", "SalesLoft", context="sales engagement software") is True


def test_verify_domain_context_has_no_effect_either_way():
    signals = {"meta_description": "Groove is a sales engagement platform for revenue teams.", "schema_org_text": None}
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="Groove"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals", return_value=signals):
        with_context = dns._verify_domain("groove.co", "Groove", context="sales engagement software")
        without_context = dns._verify_domain("groove.co", "Groove", context=None)
    assert with_context == without_context == True
