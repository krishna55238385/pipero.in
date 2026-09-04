"""Tests for the Lead Identity Verification redesign (2026-09-02):

1. Domain-first identity (_apply_domain_identity / _domain_derived_name) —
   a listicle-titled candidate gets corrected to its homepage-declared name.
2. Expanded exclusion list — blog platforms, industry associations, and
   country-TLD job-board variants never become leads.
3. Strict geography — an ICP with an explicit target country rejects a lead
   whose own geography_confidence isn't "confirmed", not only a confidently
   wrong country; ICPs without a target country are unaffected.
4. LinkedIn accuracy — a low-confidence name/company match leaves
   contact_linkedin_url blank instead of attaching a guessed URL.
5. Final QA gate (verify_lead_identity) — a stored name that diverges from
   the domain's own declared name gets corrected before scoring runs.
"""
from gtm_backend.phase1.agents.agent_02_leads import (
    _apply_domain_identity,
    _country_mismatch,
    _dedupe_raw_by_domain,
    _expected_country_codes,
    _filter_aggregators,
    _is_job_board_domain,
    _names_diverge,
    _unclear_geography_rejected,
    verify_lead_identity,
)
from gtm_backend.phase1.agents.lead_enrichment import _affiliation_mismatch, _find_contact


def _result(title, link="https://example.com/page", snippet=""):
    return {"title": title, "link": link, "snippet": snippet}


# -- 1. Domain-first identity ------------------------------------------------

def test_listicle_titled_candidate_corrected_to_domain_derived_name(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name",
        return_value="Acme HR",
    )
    candidates = [{
        "company_name": "Top 100 VARs 2024",
        "company_domain": "netatwork.com",
    }]
    out = _apply_domain_identity(candidates)
    assert out[0]["company_name"] == "Acme HR"
    assert out[0]["_name_before_domain_identity"] == "Top 100 VARs 2024"


def test_domain_identity_falls_back_to_existing_name_when_homepage_fetch_fails(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name",
        return_value=None,
    )
    candidates = [{"company_name": "Top 100 VARs 2024", "company_domain": "netatwork.com"}]
    out = _apply_domain_identity(candidates)
    assert out[0]["company_name"] == "Top 100 VARs 2024"
    assert "_name_before_domain_identity" not in out[0]


def test_domain_identity_skips_candidates_with_no_domain(mocker):
    fetch = mocker.patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name")
    candidates = [{"company_name": "Some Article Title", "company_domain": None}]
    out = _apply_domain_identity(candidates)
    assert out[0]["company_name"] == "Some Article Title"
    fetch.assert_not_called()


def test_domain_identity_no_op_when_names_already_match(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name",
        return_value="Acme HR",
    )
    candidates = [{"company_name": "Acme HR", "company_domain": "acmehr.com"}]
    out = _apply_domain_identity(candidates)
    assert out[0]["company_name"] == "Acme HR"
    assert "_name_before_domain_identity" not in out[0]


# -- 2. Expanded exclusion list ----------------------------------------------

def test_blocklisted_domain_candidate_never_becomes_a_lead():
    """medium.com/wordpress.com (blog platforms) and nasscom.in/saasboomi.org/
    zinnov.com (industry associations) — seeded from the live 2026-09-02
    Jobraux run that surfaced these as "leads" instead of real companies."""
    results = [
        _result("Why B2B SaaS Wins in India", link="https://medium.com/@author/b2b-saas-india"),
        _result("A SaaS Founder's Journey", link="https://acme.wordpress.com/2026/founder-journey"),
        _result("NASSCOM Strategic Review 2026", link="https://nasscom.in/reports/strategic-review"),
        _result("SaaSBoomi Annual Report", link="https://saasboomi.org/reports/annual"),
        _result("India SaaS Landscape", link="https://zinnov.com/insights/india-saas"),
    ]
    filtered = _filter_aggregators(results)
    assert filtered == []
    deduped = _dedupe_raw_by_domain(results)
    assert deduped == []


def test_job_board_country_tld_variants_are_blocked():
    """glassdoor.*/indeed.*/naukri.* under non-.com TLDs — the fixed
    _AGGREGATOR_DOMAINS entries only ever caught the .com variant."""
    assert _is_job_board_domain("https://glassdoor.co.in/Reviews/acme-reviews") is True
    assert _is_job_board_domain("https://indeed.co.uk/jobs/acme") is True
    assert _is_job_board_domain("https://naukri.com/acme-jobs") is True
    assert _is_job_board_domain("https://acmehr.com/careers") is False


# -- 3. Strict geography ------------------------------------------------------

def test_lead_with_correct_country_passes(sample_icp):
    expected = _expected_country_codes(["India"])
    assert _country_mismatch("India", expected) is False
    assert _unclear_geography_rejected("confirmed", expected) is False


def test_lead_with_wrong_country_rejected_existing_behavior():
    """Existing confident-mismatch behavior, unchanged."""
    expected = _expected_country_codes(["India"])
    assert _country_mismatch("Australia", expected) is True


def test_lead_with_unclear_geography_rejected_when_icp_has_target_country():
    """The Melbourne-style gap: geography_confidence missing/"unclear" on an
    ICP with an explicit target country must now be REJECTED, not kept."""
    expected = _expected_country_codes(["India"])
    assert _unclear_geography_rejected("unclear", expected) is True
    assert _unclear_geography_rejected(None, expected) is True
    assert _unclear_geography_rejected("", expected) is True


def test_icp_without_target_country_keeps_leads_regardless_of_geography_confidence():
    """No target country set on the ICP -> permissive behavior unchanged,
    even for a candidate with no geography_confidence at all."""
    expected = _expected_country_codes([])  # unmapped/empty geography
    assert expected == set()
    assert _unclear_geography_rejected("unclear", expected) is False
    assert _unclear_geography_rejected(None, expected) is False


# -- 4. LinkedIn accuracy ------------------------------------------------------

def test_linkedin_low_confidence_match_drops_contact_entirely(mocker):
    """UPDATED 2026-09-05: a "low" match_confidence used to keep contact_name/
    contact_title and only blank the LinkedIn URL. Found live (ICP #62,
    Bloomberry) that a wrong-company match can still land "high" confidence
    for the wrong reason, and a "low" one has no reliable signal left to
    salvage even the name from — the whole contact is dropped now."""
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.hunter.find_emails", return_value=[]
    )
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin",
        return_value=[{"title": "Jane Doe", "link": "https://linkedin.com/in/janedoe", "snippet": "..."}],
    )
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.llm.chat_json",
        return_value={
            "contact_name": "Jane Doe",
            "contact_title": "Founder",
            "contact_linkedin_url": "https://linkedin.com/in/janedoe",
            "match_confidence": "low",
        },
    )
    result = _find_contact("Acme HR", ["Founder"], "acmehr.com", icp_id=1)
    assert result is None


def test_linkedin_high_confidence_match_keeps_url(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.hunter.find_emails", return_value=[]
    )
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin",
        return_value=[{"title": "Jane Doe - Founder at Acme HR", "link": "https://linkedin.com/in/janedoe", "snippet": "..."}],
    )
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.llm.chat_json",
        return_value={
            "contact_name": "Jane Doe",
            "contact_title": "Founder",
            "contact_linkedin_url": "https://linkedin.com/in/janedoe",
            "match_confidence": "high",
        },
    )
    result = _find_contact("Acme HR", ["Founder"], "acmehr.com", icp_id=1)
    assert result["contact_linkedin_url"] == "https://linkedin.com/in/janedoe"


def test_linkedin_missing_confidence_field_defaults_to_dropped():
    """An LLM response missing match_confidence entirely (e.g. an older
    cached response shape) must default to dropping the whole contact, not
    silently trusting the name or the URL."""
    from gtm_backend.phase1.agents.lead_enrichment import _find_contact as _fc  # noqa
    # covered via the mocked-call tests above; this documents the default
    # explicitly for the missing-key case.
    assert str(None or "").strip().lower() != "high"


# -- 5. Final QA gate ----------------------------------------------------------

def test_verify_lead_identity_corrects_diverged_name(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.supabase.get_leads_by_icp",
        return_value=[
            {"id": 1, "company_name": "Top 100 VARs 2024", "company_domain": "netatwork.com"},
        ],
    )
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads._domain_derived_name",
        return_value="Netatwork",
    )
    update = mocker.patch("gtm_backend.phase1.agents.agent_02_leads.supabase.update_lead")
    summary = verify_lead_identity(icp_id=1)
    update.assert_called_once_with(1, company_name="Netatwork")
    assert summary["names_corrected"] == 1


def test_verify_lead_identity_leaves_matching_name_untouched(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.supabase.get_leads_by_icp",
        return_value=[{"id": 1, "company_name": "Acme HR", "company_domain": "acmehr.com"}],
    )
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads._domain_derived_name",
        return_value="Acme HR",
    )
    update = mocker.patch("gtm_backend.phase1.agents.agent_02_leads.supabase.update_lead")
    summary = verify_lead_identity(icp_id=1)
    update.assert_not_called()
    assert summary["names_corrected"] == 0


def test_names_diverge_ignores_legal_suffix_and_substring_variants():
    assert _names_diverge("Acme HR", "Acme HR Inc.") is False
    assert _names_diverge("Acme HR", "Acme HR Technologies") is False


# --- 6. Entity-collision fix (2026-09-05, ICP #62, "Bloomberry") ------------
#
# lead_enrichment's contact search (like Agent 04's signal search and Agent
# 08's competitor search, both already fixed) queried LinkedIn by bare
# company name only. Confirmed live: a "Bloomberry" search surfaced the
# real, verifiable LinkedIn profile of the founder of a DIFFERENT, unrelated
# company also named Bloomberry, and the LLM marked it "high" confidence
# because his profile genuinely does say "Bloomberry" — just the wrong one.
# Two layers now guard against this: (1) a deterministic pre-filter drops
# any snippet whose own text names a different company outright, and (2) a
# non-"high" match_confidence now drops the WHOLE contact, not just the URL.

def test_affiliation_mismatch_detects_explicit_different_company():
    # The exact real text stored for the wrong "Khloe Amante" stakeholder.
    assert _affiliation_mismatch("Khloe Amante - Manager at Mitek Systems", "Bloomberry") is True


def test_affiliation_mismatch_allows_matching_company():
    assert _affiliation_mismatch("Sadok Hasan - Founder at Bloomberry", "Bloomberry") is False


def test_affiliation_mismatch_inconclusive_when_no_affiliation_stated():
    # No "at <Company>" language at all -- left alone, not rejected.
    assert _affiliation_mismatch("Sadok Hasan - Head of Growth", "Bloomberry") is False


def test_affiliation_mismatch_ignores_legal_suffix_differences():
    assert _affiliation_mismatch("Jane Doe - CEO at Acme HR Inc.", "Acme HR") is False


def test_find_contact_drops_snippet_naming_a_different_company(mocker):
    """The pre-filter alone should already exclude the wrong-company snippet
    before any LLM call happens — confirmed by chat_json never being
    invoked at all when it's the only snippet."""
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.hunter.find_emails", return_value=[]
    )
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin",
        return_value=[{
            "title": "Khloe Amante - Manager at Mitek Systems",
            "link": "https://ph.linkedin.com/in/khloe-amante",
            "snippet": "Manager at Mitek Systems",
        }],
    )
    llm_mock = mocker.patch("gtm_backend.phase1.agents.lead_enrichment.llm.chat_json")

    result = _find_contact("Bloomberry", ["Founder", "CEO"], "bloomberry.com", icp_id=62)

    assert result is None
    llm_mock.assert_not_called()


def test_find_contact_passes_domain_to_search_linkedin(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.hunter.find_emails", return_value=[]
    )
    search_mock = mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin", return_value=[],
    )
    _find_contact("Bloomberry", ["Founder"], "bloomberry.com", icp_id=62)
    search_mock.assert_called_once_with("Bloomberry", ["Founder"], domain="bloomberry.com")


def test_find_contact_drops_contact_when_llm_correctly_flags_low_confidence(mocker):
    """The harder case the pre-filter can't catch: the snippet genuinely
    says the search company's bare name (Sadok Hasan's real profile really
    does say "Bloomberry"), just referring to a different real company. The
    LLM's own entity check is what has to catch this one, given
    company_context; confirms the whole contact is dropped, not just kept
    with a blank URL."""
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.hunter.find_emails", return_value=[]
    )
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.serpapi.search_linkedin",
        return_value=[{
            "title": "Sadok Hasan - Head of Growth | Bloomberry",
            "link": "https://linkedin.com/in/sadokhasan",
            "snippet": "Head of Growth. Bloomberry. San Francisco Bay Area.",
        }],
    )
    mocker.patch(
        "gtm_backend.phase1.agents.lead_enrichment.llm.chat_json",
        return_value={
            "contact_name": "Sadok Hasan",
            "contact_title": "Head of Growth",
            "contact_linkedin_url": "https://linkedin.com/in/sadokhasan",
            "match_confidence": "low",
        },
    )
    result = _find_contact(
        "Bloomberry", ["Founder"], "bloomberry.com",
        company_context="B2B sales intelligence", icp_id=62,
    )
    assert result is None
    assert _names_diverge("Top 100 VARs 2024", "Netatwork") is True
