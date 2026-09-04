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
    # "Outreach" is a single-token name, so the LLM entity check is the final
    # gate (see below) — mocked here to confirm, since real Groq isn't
    # reachable in tests.
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="Outreach"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={"meta_description": "Sales engagement platform", "schema_org_text": None}), \
         patch.object(dns, "_llm_confirms_entity", return_value=True):
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


def test_search_official_site_llm_confirms_an_unverified_top_result():
    # Nothing passed the name-overlap check, but the LLM read of the top
    # candidate's real content confirms it's actually the right company.
    fake_results = [{"link": "https://top-result.example.com/"}]
    with patch.object(dns.serpapi_lookup, "search", return_value=fake_results), \
         patch.object(dns, "_verify_domain", return_value=False), \
         patch.object(dns.website_lookup, "fetch_site_name", return_value="Some Company"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={"meta_description": "The real Some Company site.", "schema_org_text": None}), \
         patch.object(dns, "_llm_confirms_entity", return_value=True):
        assert dns._search_official_site("Some Company") == "top-result.example.com"


def test_search_official_site_no_longer_blindly_trusts_top_result():
    # Regression: live-tested 2026-09-04 against "XANT" and "Groove" and
    # confirmed wrong both times (forgeglobal.com, groovelife.com — neither
    # is the searched-for company). When nothing verifies AND the LLM can't
    # confirm the top candidates either, return None rather than guessing.
    fake_results = [{"link": "https://wrong-company.example.com/"}]
    with patch.object(dns.serpapi_lookup, "search", return_value=fake_results), \
         patch.object(dns, "_verify_domain", return_value=False), \
         patch.object(dns.website_lookup, "fetch_site_name", return_value="Wrong Company"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={"meta_description": "An unrelated business.", "schema_org_text": None}), \
         patch.object(dns, "_llm_confirms_entity", return_value=False):
        assert dns._search_official_site("Some Company") is None


def test_search_official_site_returns_none_when_top_candidates_have_no_evidence():
    fake_results = [{"link": "https://dead-site.example.com/"}]
    with patch.object(dns.serpapi_lookup, "search", return_value=fake_results), \
         patch.object(dns, "_verify_domain", return_value=False), \
         patch.object(dns.website_lookup, "fetch_site_name", return_value=None), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={"meta_description": None, "schema_org_text": None}):
        assert dns._search_official_site("Some Company") is None


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


# --- Regression: `context` must not be used as a keyword-overlap gate ----
#
# A category-sanity gate was tried (reject a name match when none of an
# optional industry `context` hint's words appear in the homepage evidence)
# to catch exact-name collisions like two unrelated real companies both
# branding themselves "Groove". A live run against ICP #62 (2026-09-04)
# showed it backfiring: it rejected the REAL salesloft.com — whose own
# marketing copy is "AI Predictive Revenue System" with no literal
# "sales"/"engagement"/"software" token — and fell through to the wrong,
# thin salesloft.net instead, while still failing to catch the Groove
# collision it was meant to prevent. That keyword-overlap gate was removed;
# `context` is now only ever forwarded to the LLM entity check (mocked in
# these two tests) as a semantic hint, never checked textually itself.

def test_verify_domain_context_does_not_reject_a_real_match_with_off_category_copy():
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="The Leading Predictive Revenue System"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={
                           "meta_description": "Turn buyer signals into action with Salesloft's AI Predictive Revenue System.",
                           "schema_org_text": '{"@type":"Organization","name":"Salesloft"}',
                       }), \
         patch.object(dns, "_llm_confirms_entity", return_value=True):
        assert dns._verify_domain("salesloft.com", "SalesLoft", context="sales engagement software") is True


def test_verify_domain_context_forwarded_to_llm_not_checked_textually():
    signals = {"meta_description": "Groove is a sales engagement platform for revenue teams.", "schema_org_text": None}
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="Groove"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals", return_value=signals), \
         patch.object(dns, "_llm_confirms_entity", return_value=True) as llm_mock:
        with_context = dns._verify_domain("groove.co", "Groove", context="sales engagement software")
        without_context = dns._verify_domain("groove.co", "Groove", context=None)
    assert with_context == without_context == True
    # Both calls reached the LLM gate (mocked to always confirm here) — the
    # context string itself was passed through, not evaluated as a filter.
    assert llm_mock.call_args_list[0].args[2] == "sales engagement software"
    assert llm_mock.call_args_list[1].args[2] is None


# --- _llm_confirms_entity: the final semantic disambiguation step --------
#
# Keyword overlap alone can't tell two real, unrelated companies apart when
# they share an exact one-word brand (confirmed live: "XANT" also names an
# unrelated Polish company; "Groove" names at least two other unrelated
# products). For a name that reduces to a single distinctive token,
# _verify_domain defers to an LLM read of the actual homepage content
# instead of trusting the keyword match.

def test_llm_confirms_entity_returns_true_on_matching_verdict():
    with patch.object(dns.llm_lookup, "chat_json", return_value={"same_entity": True, "reasoning": "matches"}):
        assert dns._llm_confirms_entity("apollo.io", "Apollo", "sales engagement software", "AI sales platform") is True


def test_llm_confirms_entity_returns_false_on_negative_verdict():
    with patch.object(dns.llm_lookup, "chat_json", return_value={"same_entity": False, "reasoning": "different industry"}):
        assert dns._llm_confirms_entity("xant.com", "XANT", "sales engagement software", "industry platforms") is False


def test_llm_confirms_entity_inconclusive_on_call_failure():
    with patch.object(dns.llm_lookup, "chat_json", side_effect=RuntimeError("quota exhausted")):
        assert dns._llm_confirms_entity("xant.com", "XANT", None, "some evidence") is None


def test_llm_confirms_entity_inconclusive_on_malformed_response():
    with patch.object(dns.llm_lookup, "chat_json", return_value={"unexpected": "shape"}):
        assert dns._llm_confirms_entity("xant.com", "XANT", None, "some evidence") is None
    with patch.object(dns.llm_lookup, "chat_json", return_value=["not", "a", "dict"]):
        assert dns._llm_confirms_entity("xant.com", "XANT", None, "some evidence") is None


# --- Regression: single-token names are gated by the LLM check -----------

def test_verify_domain_single_token_name_rejected_when_llm_says_different_company():
    # xant.com resolves and its title literally contains "XANT" (name-match
    # passes) but its actual content is an unrelated Polish company — the
    # LLM check, given that real evidence, correctly says "different company".
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="XANT - Strona Glowna"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={
                           "meta_description": "XANT develops industry platforms: Pub, Vet, Beauty, Construction, Software, Supply.",
                           "schema_org_text": None,
                       }), \
         patch.object(dns, "_llm_confirms_entity", return_value=False) as llm_mock:
        assert dns._verify_domain("xant.com", "XANT", context="sales engagement software") is False
    llm_mock.assert_called_once()


def test_verify_domain_single_token_name_llm_inconclusive_is_rejected():
    # LLM call fails (quota/network) -- an inconclusive read must not be
    # treated as a pass, same conservative bias as the rest of this module.
    with patch.object(dns.website_lookup, "fetch_site_name", return_value="Groove"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals",
                       return_value={"meta_description": "Groove is a sales tool.", "schema_org_text": None}), \
         patch.object(dns, "_llm_confirms_entity", return_value=None):
        assert dns._verify_domain("groove.co", "Groove") is False


# --- End-to-end: discover_domain correctly resolves XANT and Groove ------

def test_discover_domain_xant_rejects_wrong_company_via_llm_then_falls_back_to_search():
    def fake_resolve(host: str) -> bool:
        return host in ("insidesales.com", "xant.com")

    def fake_verify(host, name, context=None):
        # insidesales.com is bot-walled (inconclusive -> False); xant.com
        # resolves and superficially matches on name, but the LLM correctly
        # identifies it as the unrelated Polish company.
        return False

    with patch.object(dns, "resolve", side_effect=fake_resolve), \
         patch.object(dns, "_verify_domain", side_effect=fake_verify), \
         patch.object(dns, "_search_official_site", return_value="xant.ai") as fallback:
        result = dns.discover_domain("XANT (InsideSales.com)", context="sales engagement software")

    assert result == "xant.ai"
    fallback.assert_called_once_with("XANT (InsideSales.com)", "sales engagement software")


def test_discover_domain_groove_rejects_wrong_companies_via_llm_then_falls_back_to_search():
    def fake_resolve(host: str) -> bool:
        return host in ("groove.com", "groove.io", "groove.co")

    with patch.object(dns, "resolve", side_effect=fake_resolve), \
         patch.object(dns, "_verify_domain", return_value=False), \
         patch.object(dns, "_search_official_site", return_value="groove.clari.com") as fallback:
        result = dns.discover_domain("Groove", context="sales engagement software")

    assert result == "groove.clari.com"
    fallback.assert_called_once_with("Groove", "sales engagement software")


def test_discover_domain_groove_end_to_end_llm_disambiguates_real_homepage_content():
    # Full path through the real _verify_domain (not mocked) using the actual
    # homepage evidence found live for the wrong "Groove" (an unrelated
    # market-intelligence product) vs. what the right one would say.
    wrong_company_signals = {
        "meta_description": (
            "Groove continuously observes market changes and emerging "
            "opportunities, helping businesses make better decisions."
        ),
        "schema_org_text": None,
    }

    def fake_resolve(host: str) -> bool:
        return host == "groove.io"

    with patch.object(dns, "resolve", side_effect=fake_resolve), \
         patch.object(dns.website_lookup, "fetch_site_name", return_value="Groove"), \
         patch.object(dns.website_lookup, "fetch_homepage_signals", return_value=wrong_company_signals), \
         patch.object(dns.llm_lookup, "chat_json", return_value={"same_entity": False, "reasoning": "unrelated market-intelligence product"}), \
         patch.object(dns, "_search_official_site", return_value=None) as fallback:
        result = dns.discover_domain("Groove", context="sales engagement software")

    assert result is None
    fallback.assert_called_once()
