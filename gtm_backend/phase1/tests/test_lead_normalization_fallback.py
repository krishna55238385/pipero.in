"""Tests for Agent 02's regex-only fallback normalizer (_fallback_normalize)
and the two related bugs found during live BYO-key verification on Jobraux:

1. Market-research/report/academic-style search results ("Dynamic Scheduling
   Software Market Research Report 2034", "impact of artificial intelligence
   on start-up in delhi ncr") were being inserted as company_name verbatim
   when the LLM normalize call's JSON parsing failed and the pipeline fell
   back to this weaker regex-only path.
2. A researchgate.net paper's author name ("Venugopal Vallepu") was inserted
   as a company_name, then got a mismatched academic-author email attached
   during enrichment — the LLM-exception fallback path skipped the
   aggregator-domain filter that the "0 companies" fallback path already had.
"""
from gtm_backend.phase1.agents.agent_02_leads import (
    _fallback_normalize,
    _filter_aggregators,
    _is_academic_domain,
    _normalize_with_llm,
)


def _result(title, link="https://example.com/page", snippet=""):
    return {"title": title, "link": link, "snippet": snippet}


# -- _fallback_normalize: research/report-style titles ----------------------

def test_market_research_report_title_is_dropped_entirely():
    results = [_result("Dynamic Scheduling Software Market Research Report 2034", link="https://marketresearchfuture.com/foo")]
    out = _fallback_normalize(results)
    assert out == []


def test_impact_of_ai_article_title_is_dropped_entirely():
    results = [_result("Impact of artificial intelligence on start-up in Delhi NCR")]
    out = _fallback_normalize(results)
    assert out == []


def test_industry_analysis_title_is_dropped_entirely():
    results = [_result("Global CRM Software Industry Analysis and Forecast")]
    out = _fallback_normalize(results)
    assert out == []


def test_genuine_company_title_still_passes_through():
    results = [_result("Acme HR - People Management Platform", link="https://acmehr.com")]
    out = _fallback_normalize(results)
    assert len(out) == 1
    assert out[0]["company_name"] == "Acme HR"


def test_listicle_title_still_falls_back_to_domain_name_not_dropped():
    """Regression guard: the new research-report rule must not swallow the
    existing listicle-title-but-real-company-domain case."""
    results = [_result("Top 100 VARs 2024", link="https://netatwork.com/blog/top-100")]
    out = _fallback_normalize(results)
    assert len(out) == 1
    assert out[0]["company_name"] == "Netatwork"


# -- academic/paper domains now treated as aggregators -----------------------

def test_researchgate_result_is_filtered_as_aggregator():
    results = [_result("Venugopal Vallepu — Author Profile", link="https://researchgate.net/profile/venugopal-vallepu")]
    filtered = _filter_aggregators(results)
    assert filtered == []


def test_semanticscholar_and_arxiv_are_filtered_as_aggregators():
    results = [
        _result("Some Paper Title", link="https://semanticscholar.org/paper/123"),
        _result("Another Paper", link="https://arxiv.org/abs/1234.5678"),
    ]
    filtered = _filter_aggregators(results)
    assert filtered == []


# -- widened rules from a live Jobraux run that slipped past the first fix --

def test_best_x_for_y_superlative_without_leading_number_is_dropped():
    """"Best ERP Systems for Small Business (2026)" — a superlative roundup
    with no leading digit, so the original _LISTICLE_TITLE_RE (which only
    matched "Top N"/"N Best") missed it."""
    results = [_result("Best ERP Systems for Small Business (2026)", link="https://g2.com/categories/erp")]
    out = _fallback_normalize(_filter_aggregators(results))
    # g2.com is already an aggregator, but even against a non-aggregator
    # domain the superlative title itself must not become the company_name.
    results2 = [_result("Best WhatsApp Bot Tools for Customer Support", link="https://acmebots.com/blog/best-tools")]
    out2 = _fallback_normalize(results2)
    assert len(out2) == 1
    assert out2[0]["company_name"] != "Best WhatsApp Bot Tools for Customer Support"


def test_bare_filename_title_is_dropped_entirely():
    results = [_result("multi-page.txt", link="https://example.com/uploads/multi-page.txt")]
    out = _fallback_normalize(results)
    assert out == []


def test_academic_thesis_domain_is_treated_as_academic():
    assert _is_academic_domain("https://unitesi.unive.it/thesis/12345") is True
    assert _is_academic_domain("https://someuni.ac.in/papers/x") is True
    assert _is_academic_domain("https://research.someuniversity.edu/paper") is True
    assert _is_academic_domain("https://acmehr.com/about") is False


def test_academic_domain_result_is_filtered_even_without_known_domain_in_blocklist():
    """The "Venugopal Vallepu" / bni-india.in case: a domain not in the fixed
    _AGGREGATOR_DOMAINS list, but still an academic/thesis-style host —
    caught by pattern instead of requiring the exact host to be enumerated."""
    results = [_result("Master's Degree in Management Final Thesis", link="https://unitesi.unive.it/thesis/98765")]
    filtered = _filter_aggregators(results)
    assert filtered == []


# -- LLM-exception fallback path now also filters aggregators ---------------

def test_llm_json_error_fallback_path_filters_aggregators_before_regex_fallback(mocker):
    """Previously the LLM-exception path (raw = chat_json(...) raised) called
    _fallback_normalize on the UNFILTERED raw_results — only the '0
    companies' path filtered aggregators. This let a researchgate.net result
    through as a company. Both fallback paths must filter identically."""
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.llm.chat_json",
        side_effect=ValueError("invalid JSON from LLM"),
    )
    raw_results = [
        _result("Venugopal Vallepu — ResearchGate Profile", link="https://researchgate.net/profile/venugopal-vallepu"),
        _result("Acme HR - People Management Platform", link="https://acmehr.com"),
    ]
    icp = {"industry": "HR Tech", "geography": ["India"]}
    out = _normalize_with_llm(raw_results, icp, icp_id=1)
    names = [c["company_name"] for c in out]
    assert "Venugopal Vallepu" not in names
    assert "Acme HR" in names


# -- second round of widened rules: techreviewer.co / remoterocketship.com --
# -- style junk from a live 5-lead test run --------------------------------

def test_review_profile_title_on_unlisted_domain_is_dropped():
    """"IT Services India Inc. Profile & Reviews" on techreviewer.co — a
    review-directory host not in the fixed _AGGREGATOR_DOMAINS list, caught
    by the title's own reliable "Profile & Reviews" shape instead."""
    results = [_result("IT Services India Inc. Profile & Reviews", link="https://techreviewer.co/companies/it-services-india")]
    out = _fallback_normalize(results)
    assert out == []


def test_job_board_listing_title_is_dropped():
    """"Remote Jobs at Emergence" on remoterocketship.com — a job-board
    LISTING, not a company profile; the listing names a real company but
    this page/domain is the job board, not that company's own site."""
    results = [_result("Remote Jobs at Emergence", link="https://remoterocketship.com/jobs/emergence-123")]
    out = _fallback_normalize(results)
    assert out == []


def test_tips_for_article_title_is_never_kept_as_literal_company_name():
    """"Tips for SaaS businesses in Germany" hosted on stripe.com — this is
    the _ARTICLE_TITLE_RE branch (same one the working NetAtWork listicle
    case relies on), so it substitutes the domain-derived name ("Stripe")
    rather than dropping outright: Stripe IS a real company, just a bad ICP
    fit — catching a bad-fit-but-real company is scoring's job, not the
    normalizer's. What must never happen is keeping the literal article
    title as company_name. The regex_fallback/needs_review tag (tested
    separately) is what flags this kind of domain-substituted result for
    human review rather than trusting it outright."""
    results = [_result("Tips for SaaS businesses in Germany", link="https://stripe.com/resources/tips-saas-germany")]
    out = _fallback_normalize(results)
    assert len(out) == 1
    assert out[0]["company_name"] != "Tips for SaaS businesses in Germany"
    assert out[0]["company_name"] == "Stripe"


# -- normalization_method / needs_review flag --------------------------------

def test_llm_path_tags_candidates_as_llm_normalized(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.llm.chat_json",
        return_value={"companies": [{"company_name": "Acme HR"}]},
    )
    raw_results = [_result("Acme HR", link="https://acmehr.com")]
    out = _normalize_with_llm(raw_results, {"industry": "HR Tech", "geography": ["India"]}, icp_id=1)
    assert out[0]["_normalization_method"] == "llm"


def test_fallback_path_tags_candidates_as_regex_fallback(mocker):
    mocker.patch(
        "gtm_backend.phase1.agents.agent_02_leads.llm.chat_json",
        side_effect=ValueError("invalid JSON from LLM"),
    )
    raw_results = [_result("Acme HR - People Management Platform", link="https://acmehr.com")]
    out = _normalize_with_llm(raw_results, {"industry": "HR Tech", "geography": ["India"]}, icp_id=1)
    assert out[0]["_normalization_method"] == "regex_fallback"


def test_to_lead_sets_needs_review_true_for_regex_fallback_candidates():
    from gtm_backend.phase1.agents.agent_02_leads import _to_lead

    item = {
        "company_name": "Acme HR",
        "company_website": "https://acmehr.com",
        "source_url": "https://acmehr.com",
        "_normalization_method": "regex_fallback",
    }
    lead = _to_lead(item, icp_id=1)
    assert lead.raw_data["needs_review"] is True
    assert lead.raw_data["normalization_method"] == "regex_fallback"


def test_to_lead_sets_needs_review_false_for_llm_candidates():
    from gtm_backend.phase1.agents.agent_02_leads import _to_lead

    item = {
        "company_name": "Acme HR",
        "company_website": "https://acmehr.com",
        "source_url": "https://acmehr.com",
        "_normalization_method": "llm",
    }
    lead = _to_lead(item, icp_id=1)
    assert lead.raw_data["needs_review"] is False


def test_to_lead_defaults_to_llm_when_method_unset():
    """Backward-compat: any candidate dict without the new tag (e.g. an
    older code path not yet updated) must default to "llm"/not-flagged,
    never silently treated as needing review just because the key is
    missing."""
    from gtm_backend.phase1.agents.agent_02_leads import _to_lead

    item = {"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com"}
    lead = _to_lead(item, icp_id=1)
    assert lead.raw_data["needs_review"] is False
    assert lead.raw_data["normalization_method"] == "llm"
