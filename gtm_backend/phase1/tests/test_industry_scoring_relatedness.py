"""Regression tests for the industry-scoring fix: a lead in a genuinely
unrelated industry (e.g. Consulting against a B2B SaaS ICP) must not get the
same generous partial credit as a lead that's the same business phrased
differently (e.g. Software Development vs B2B SaaS)."""
from gtm_backend.phase1.core.scoring import FIRMOGRAPHIC_WEIGHTS, _score_industry


def test_exact_match_gets_full_credit():
    icp = {"industry": ["B2B SaaS"]}
    lead = {"company_industry": "B2B SaaS"}
    pts, detail = _score_industry(lead, icp)
    assert pts == FIRMOGRAPHIC_WEIGHTS["industry"]
    assert "match" in detail.lower()


def test_related_but_differently_phrased_gets_generous_partial_credit():
    icp = {"industry": ["B2B SaaS"]}
    lead = {"company_industry": "Software Development"}
    pts, detail = _score_industry(lead, icp)
    assert pts == round(FIRMOGRAPHIC_WEIGHTS["industry"] * 0.6)
    assert "partial fit" in detail.lower()


def test_unrelated_industry_gets_much_smaller_credit():
    """The exact scenario that surfaced this bug: a consulting firm ('White
    Lotus') scored 86/100 HOT against a 'Series A-C B2B SaaS in India' ICP,
    largely because Consulting got the same 60% partial credit as a true
    phrasing variant."""
    icp = {"industry": ["Series A-C B2B SaaS"]}
    lead = {"company_industry": "Consulting"}
    pts, detail = _score_industry(lead, icp)
    unrelated_pts = pts
    assert unrelated_pts == round(FIRMOGRAPHIC_WEIGHTS["industry"] * 0.2)

    related_pts, _ = _score_industry({"company_industry": "SaaS Platform"}, icp)
    assert unrelated_pts < related_pts


def test_no_company_industry_gets_zero():
    icp = {"industry": ["B2B SaaS"]}
    lead = {"company_industry": None}
    pts, detail = _score_industry(lead, icp)
    assert pts == 0


def test_no_icp_industry_constraint_gets_default_credit():
    icp = {"industry": []}
    lead = {"company_industry": "Consulting"}
    pts, detail = _score_industry(lead, icp)
    assert pts == round(FIRMOGRAPHIC_WEIGHTS["industry"] * 0.7)
