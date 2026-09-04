"""Tests for Task #8 — cross-ICP duplicate lead detection by domain.

Context: Agent 02's dedup previously only checked within a single ICP's own
existing leads (get_existing_company_domains(icp_id)) — running two similar
ICPs for the same org (as happened live: ICP #51 and #52, both "India
SaaS") could insert the same company as two separate lead rows under
different ICPs. leads_raw.icp_id is a single FK column (no lead<->ICP join
table in the schema), so a lead can only ever belong to one ICP — the
correct fix is a second, org-wide domain check that skips-and-counts a
cross-ICP duplicate distinctly from the existing same-ICP dedup counter,
not "also link" the existing lead to the new ICP.
"""
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_02_leads import (
    _drop_cross_icp_duplicates,
    _fresh_candidates,
    generate_leads,
)
from gtm_backend.phase1.connectors import supabase


# -- _drop_cross_icp_duplicates ----------------------------------------------

def test_domain_from_a_different_icp_same_org_is_dropped_and_counted():
    candidates = [
        {"company_name": "Acme HR", "company_domain": "acmehr.com"},
        {"company_name": "Beta HR", "company_domain": "betahr.io"},
    ]
    org_existing_domains = {"acmehr.com"}  # already a lead under ICP #51, this run is ICP #52

    kept, dropped = _drop_cross_icp_duplicates(candidates, org_existing_domains)

    assert [c["company_name"] for c in kept] == ["Beta HR"]
    assert dropped == 1


def test_no_org_wide_domains_keeps_every_candidate():
    candidates = [{"company_name": "Acme HR", "company_domain": "acmehr.com"}]
    kept, dropped = _drop_cross_icp_duplicates(candidates, set())
    assert kept == candidates
    assert dropped == 0


def test_candidate_with_no_domain_is_never_dropped():
    """A candidate whose domain couldn't be resolved must not be treated as
    a false-positive duplicate just because it has nothing to compare."""
    candidates = [{"company_name": "No Domain Co", "company_domain": None}]
    kept, dropped = _drop_cross_icp_duplicates(candidates, {"acmehr.com"})
    assert kept == candidates
    assert dropped == 0


def test_www_prefix_is_normalized_before_comparison():
    candidates = [{"company_name": "Acme HR", "company_domain": "www.acmehr.com"}]
    kept, dropped = _drop_cross_icp_duplicates(candidates, {"acmehr.com"})
    assert kept == []
    assert dropped == 1


# -- get_existing_company_domains_for_org ------------------------------------

def test_get_existing_company_domains_for_org_queries_by_organization_id():
    with patch.object(
        supabase, "_get",
        return_value=[{"company_domain": "acmehr.com"}, {"company_domain": "www.betahr.io"}],
    ) as get_mock:
        result = supabase.get_existing_company_domains_for_org("org-1")

    assert result == {"acmehr.com", "betahr.io"}
    args, kwargs = get_mock.call_args
    assert args[0] == "/leads_raw"
    assert kwargs["params"]["organization_id"] == "eq.org-1"


def test_get_existing_company_domains_for_org_returns_empty_set_when_org_id_missing():
    with patch.object(supabase, "_get") as get_mock:
        result = supabase.get_existing_company_domains_for_org(None)
    assert result == set()
    get_mock.assert_not_called()


# -- existing same-ICP dedup behavior unchanged ------------------------------

def test_same_icp_dedup_unchanged_by_name_and_domain():
    """_fresh_candidates itself is untouched by this task — a regression
    guard confirming its existing name+domain same-ICP behavior still
    works exactly as before."""
    candidates_by_key = {
        "acme hr": {"company_name": "Acme HR", "company_domain": "acmehr.com"},
        "beta hr": {"company_name": "Beta HR", "company_domain": "betahr.io"},
    }
    fresh = _fresh_candidates(candidates_by_key, existing_names={"acme hr"}, existing_domains=set())
    assert [c["company_name"] for c in fresh] == ["Beta HR"]


# -- generate_leads() integration: cross-ICP vs cross-org vs same-ICP -------

_ICP_52 = {
    "id": 52, "name": "India SaaS (round 2)", "organization_id": "org-1",
    "industry": ["SaaS"], "geography": ["India"],
}


def _patch_common(sample_icp_override=None, **extra):
    icp = sample_icp_override or _ICP_52
    base = dict(
        icp_id=52,
        search_results=[{"title": "Acme HR", "link": "https://acmehr.com", "snippet": "..."}],
        normalized={"companies": [{"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com", "geography_confidence": "confirmed"}]},
    )
    base.update(extra)
    return icp, base


def test_cross_icp_duplicate_same_org_is_not_reinserted(mocker):
    """The core scenario: ICP #52 (same org as ICP #51) independently
    rediscovers a company already inserted under ICP #51 — must be skipped,
    not inserted as a second lead row, and counted as cross_icp_duplicates
    distinctly from geo/industry rejections."""
    search_results = [{"title": "Acme HR", "link": "https://acmehr.com", "snippet": "..."}]
    normalized = {"companies": [
        {"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com", "geography_confidence": "confirmed"},
    ]}
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=_ICP_52), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value={"acmehr.com"}) as org_domains_mock, \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[]) as inserter:
        summary = generate_leads(icp_id=52, max_leads=20, min_leads=1)

    org_domains_mock.assert_called_once_with("org-1")
    # 0 fresh candidates never satisfies min_leads=1, so the pagination loop
    # re-processes the same single (always-duplicate) candidate across all
    # 3 pages — the count that matters here is "at least one duplicate
    # detected, zero inserted," not the exact per-page repetition count.
    assert summary["cross_icp_duplicates"] >= 1
    assert summary["leads_inserted"] == 0
    inserter.assert_called_once_with([])


def test_cross_org_same_domain_is_not_considered_a_duplicate(mocker):
    """A domain present under a DIFFERENT org must never suppress a lead —
    orgs are isolated. get_existing_company_domains_for_org is scoped to
    THIS org only, so a candidate is kept whenever the org-wide set (already
    correctly org-filtered) doesn't contain its domain."""
    search_results = [{"title": "Acme HR", "link": "https://acmehr.com", "snippet": "..."}]
    normalized = {"companies": [
        {"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com", "geography_confidence": "confirmed"},
    ]}
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=_ICP_52), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1]) as inserter:
        summary = generate_leads(icp_id=52, max_leads=20, min_leads=1)

    # acmehr.com exists under a DIFFERENT org's leads in the real DB, but
    # get_existing_company_domains_for_org("org-1") correctly returns an
    # empty set (that other org's domain never appears in THIS org's set) —
    # so the candidate is kept and inserted normally.
    assert summary["cross_icp_duplicates"] == 0
    assert summary["leads_inserted"] == 1
    inserted_names = {lead.company_name for lead in inserter.call_args[0][0]}
    assert inserted_names == {"Acme HR"}


def test_same_icp_dedup_still_wins_before_cross_icp_check_runs(mocker):
    """When a candidate is ALREADY a same-ICP duplicate, it must be caught
    by the existing same-ICP path (unchanged) and never reach the cross-ICP
    counter at all — the two counters must stay mutually exclusive per
    candidate, not double-count the same drop."""
    search_results = [{"title": "Acme HR", "link": "https://acmehr.com", "snippet": "..."}]
    normalized = {"companies": [
        {"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com", "geography_confidence": "confirmed"},
    ]}
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=_ICP_52), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value={"acmehr.com"}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains_for_org", return_value={"acmehr.com"}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[]) as inserter:
        summary = generate_leads(icp_id=52, max_leads=20, min_leads=1)

    assert summary["cross_icp_duplicates"] == 0  # caught by the same-ICP path first, not this counter
    assert summary["leads_inserted"] == 0
    inserter.assert_called_once_with([])


def test_no_organization_id_on_icp_skips_cross_icp_check_gracefully(mocker):
    """A bare local run (no org context on the ICP) must not crash or make
    a spurious call — get_existing_company_domains_for_org(None) short-
    circuits to an empty set, so the run behaves exactly as it did before
    Task #8."""
    icp_no_org = {"id": 52, "name": "No Org ICP", "industry": ["SaaS"], "geography": ["India"]}
    search_results = [{"title": "Acme HR", "link": "https://acmehr.com", "snippet": "..."}]
    normalized = {"companies": [
        {"company_name": "Acme HR", "company_website": "https://acmehr.com", "source_url": "https://acmehr.com", "geography_confidence": "confirmed"},
    ]}
    with patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_icp", return_value=icp_no_org), \
         patch("gtm_backend.phase1.agents.agent_02_leads.serpapi.search", return_value=search_results), \
         patch("gtm_backend.phase1.agents.agent_02_leads.llm.chat_json", return_value=normalized), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.extract_domain_from_url", side_effect=lambda u: u.replace("https://", "")), \
         patch("gtm_backend.phase1.agents.agent_02_leads.dns_lookup.discover_domain", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_site_name", return_value=None), \
         patch("gtm_backend.phase1.agents.agent_02_leads.website.fetch_homepage_signals", return_value={"meta_description": None, "schema_org_text": None}), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_names", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.get_existing_company_domains", return_value=set()), \
         patch("gtm_backend.phase1.agents.agent_02_leads.supabase.insert_leads", return_value=[1]) as inserter:
        # deliberately NOT mocking get_existing_company_domains_for_org —
        # the real function must handle organization_id=None on its own
        summary = generate_leads(icp_id=52, max_leads=20, min_leads=1)

    assert summary["cross_icp_duplicates"] == 0
    assert summary["leads_inserted"] == 1
