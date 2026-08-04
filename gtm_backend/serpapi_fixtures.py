"""Canned SerpAPI/Serper-shaped fixture data for GTM_TEST_MODE.

Shared by phase1/connectors/serpapi.py and phase2/connectors/serpapi.py (and
therefore every agent that searches through either — Agents 02, 04, 05, 06,
07, 08, 20, 42, and lead_enrichment) so the whole pipeline can be exercised
repeatedly, for free, without spending real SerpAPI/Serper credits.

Deliberately small, clean, and non-junk-shaped: this exists to test pipeline
*mechanics* (does a run complete, does scoring/enrichment/UI behave, do
writes land correctly) — not to test real-world search-result messiness or
discover new junk-title shapes, which only a live call against the real
internet can do. Opt-in only: GTM_TEST_MODE unset/false = zero change from
today's live-API behavior.
"""
import os


def test_mode_enabled() -> bool:
    return os.getenv("GTM_TEST_MODE", "").strip().lower() in {"1", "true", "yes"}


ORGANIC_RESULTS = [
    {
        "title": "Acme HR - People Management Platform",
        "link": "https://acmehr.com",
        "snippet": "Acme HR builds HR software for growing mid-market companies in India.",
    },
    {
        "title": "Beta People - Payroll & Compliance",
        "link": "https://betapeople.io",
        "snippet": "Beta People provides payroll automation and compliance tooling for SMBs.",
    },
    {
        "title": "Vertex Analytics",
        "link": "https://vertexanalytics.co",
        "snippet": "Vertex Analytics offers B2B data intelligence and reporting tools.",
    },
]

NEWS_RESULTS = [
    {
        "title": "Acme HR raises Series A funding round",
        "link": "https://news.example.com/acme-hr-series-a",
        "snippet": "Acme HR announced a $10M Series A round led by a growth-stage fund.",
        "date": "3 days ago",
    },
    {
        "title": "Beta People appoints new VP of Sales",
        "link": "https://news.example.com/beta-people-vp-sales",
        "snippet": "Beta People named a new VP of Sales as it expands into new markets.",
        "date": "1 week ago",
    },
]

LINKEDIN_RESULTS = [
    {
        "title": "Priya Iyer - CEO at Acme HR | LinkedIn",
        "link": "https://linkedin.com/in/priya-iyer-acmehr",
        "snippet": "CEO at Acme HR. Building people-management software for India.",
    },
    {
        "title": "Rahul Nair - VP Sales at Beta People | LinkedIn",
        "link": "https://linkedin.com/in/rahul-nair-betapeople",
        "snippet": "VP Sales at Beta People.",
    },
]


def fixture_response(params: dict) -> dict:
    """Build a canned response shaped exactly like a real SerpAPI/Serper
    result for the given request params — engine=google_news gets news
    results, a linkedin.com/in query gets profile-shaped organic results,
    everything else gets the plain company-organic-results fixture."""
    engine = (params or {}).get("engine", "")
    query = ((params or {}).get("q") or "").lower()
    if engine == "google_news":
        return {"news_results": list(NEWS_RESULTS)}
    if "linkedin.com/in" in query:
        return {"organic_results": list(LINKEDIN_RESULTS)}
    return {"organic_results": list(ORGANIC_RESULTS)}
