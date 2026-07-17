"""End-to-end test for the Phase 1 pipeline.

Drives ``phase1.main.main(["run-all", "--prompt", ...])`` with every outbound
HTTP call mocked via ``respx``. No real Gemini/SerpAPI/Disify/Supabase/DNS
traffic. A small in-memory Supabase clone tracks inserts and updates so the
assertions can verify the agents actually wrote what we expect.
"""
from __future__ import annotations

import itertools
import json
import os
import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import respx


SUPABASE_BASE = "https://fake.supabase.co/rest/v1"
SUPABASE_LEADS_URL = f"{SUPABASE_BASE}/leads_raw"
SUPABASE_ICP_URL = f"{SUPABASE_BASE}/icp_profiles"
SUPABASE_SIGNALS_URL = f"{SUPABASE_BASE}/buying_signals"


# --- LLM canned responses ----------------------------------------------------

_ICP_RESPONSE: dict[str, Any] = {
    "name": "Mid-market HR-tech in India",
    "product_line": "Core",
    "industry": ["HR Tech", "SaaS"],
    "geography": ["Bangalore", "Mumbai", "India"],
    "company_size_min": 50,
    "company_size_max": 200,
    "revenue_range_min": None,
    "revenue_range_max": None,
    "business_stage": "Growth",
    "buyer_titles": ["CEO", "Founder", "Head of HR"],
    "user_titles": ["HR Manager", "Recruiter"],
    "blocker_titles": None,  # Exercises the None-to-empty validator on ICP.
    "pain_points": "Hiring takes too long.",
}

_LEAD_NORMALIZATION_RESPONSE: dict[str, Any] = {
    "companies": [
        {
            "company_name": "Acme HR",
            "company_website": "https://acmehr.com",
            "company_city": "Bangalore",
            "company_country": "India",
            "company_industry": "HR Tech",
            "company_size": "51-200 employees",
            "source_url": "https://acmehr.com",
        },
        {
            "company_name": "Beta People",
            "company_website": "https://betapeople.io",
            "company_city": "Mumbai",
            "company_country": "India",
            "company_industry": "SaaS",
            "company_size": None,
            "source_url": "https://betapeople.io",
        },
    ],
}

_CONTACT_RESPONSE: dict[str, Any] = {
    "contact_name": "Priya Iyer",
    "contact_title": "CEO",
    "contact_linkedin_url": "https://linkedin.com/in/priya-iyer",
}

_SIGNAL_RESPONSE: dict[str, Any] = {
    "results": [
        {"id": 0, "signal_type": "funding", "buying_intent": "high"},
        {"id": 1, "signal_type": "hiring", "buying_intent": "low"},
    ]
}

_QUERY_PLAN_RESPONSE: dict[str, Any] = {
    "queries": [
        {"engine": "google_news", "q": "Acme HR funding", "signal_focus": "funding", "num": 3},
        {"engine": "google", "q": "Acme HR hiring careers", "signal_focus": "hiring", "num": 3},
    ],
}

_SCORING_RESPONSE: dict[str, Any] = {
    "llm_icp_score": 78,
    "llm_score_tier": "warm",
    "llm_reasoning": "Strong industry fit and active hiring signals.",
    "buying_intent_summary": "Recent funding + aggressive hiring suggests budget unlocked.",
}


def _gemini_message(payload: dict[str, Any]) -> dict[str, Any]:
    """Wrap a dict into the Gemini generateContent response envelope."""
    return {
        "candidates": [
            {
                "content": {"parts": [{"text": json.dumps(payload)}], "role": "model"},
                "finishReason": "STOP",
                "index": 0,
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 0,
            "candidatesTokenCount": 0,
            "totalTokenCount": 0,
        },
        "modelVersion": os.environ["GEMINI_MODEL"],
    }


def _gemini_handler(request: httpx.Request) -> httpx.Response:
    """Route Gemini generateContent calls to the right canned JSON based on system prompt."""
    body = json.loads(request.content.decode("utf-8"))
    system_parts = (body.get("systemInstruction") or {}).get("parts") or []
    system = "".join(p.get("text", "") for p in system_parts)

    if "B2B sales qualification" in system or "llm_icp_score" in system:
        return httpx.Response(200, json=_gemini_message(_SCORING_RESPONSE))
    if "extract a structured Ideal Customer Profile" in system:
        return httpx.Response(200, json=_gemini_message(_ICP_RESPONSE))
    if "extract company records" in system:
        return httpx.Response(200, json=_gemini_message(_LEAD_NORMALIZATION_RESPONSE))
    if "decision-maker contact" in system:
        return httpx.Response(200, json=_gemini_message(_CONTACT_RESPONSE))
    if "generate Google search queries" in system:
        return httpx.Response(200, json=_gemini_message(_QUERY_PLAN_RESPONSE))
    if "buying signal" in system or "signal_type" in system:
        return httpx.Response(200, json=_gemini_message(_SIGNAL_RESPONSE))
    return httpx.Response(500, json={"error": f"unrouted system prompt: {system[:80]}"})


# --- SerpAPI / DNS / Disify / Hunter -----------------------------------------

_SERP_ORGANIC = [
    {
        "title": "Acme HR | Best HR Tech",
        "link": "https://acmehr.com",
        "snippet": "Acme HR is a Bangalore-based HR platform.",
    },
    {
        "title": "Beta People — Hiring Software",
        "link": "https://betapeople.io",
        "snippet": "Beta People helps growth-stage SaaS hire faster.",
    },
    {
        "title": "Some Directory Listing",
        "link": "https://example.com/dir/12",
        "snippet": "...",
    },
]

_SERP_LINKEDIN = [
    {
        "title": "Priya Iyer - CEO at Acme HR | LinkedIn",
        "link": "https://linkedin.com/in/priya-iyer",
        "snippet": "Priya Iyer — Chief Executive Officer at Acme HR",
    },
    {
        "title": "Acme HR Team",
        "link": "https://linkedin.com/company/acmehr/people",
        "snippet": "...",
    },
]

_SERP_NEWS = [
    {
        "title": "Acme HR raises $10M Series A",
        "link": "https://news.example.com/acme-series-a",
        "snippet": "Bangalore-based Acme HR closes Series A round.",
        "date": "2026-05-01",
    },
    {
        "title": "Acme HR opens Mumbai office",
        "link": "https://news.example.com/acme-mumbai",
        "snippet": "Expansion to Mumbai announced.",
        "date": "2026-04-20",
    },
]


def _serpapi_handler(request: httpx.Request) -> httpx.Response:
    params = parse_qs(urlsplit(str(request.url)).query)
    engine = (params.get("engine") or [""])[0]
    query = (params.get("q") or [""])[0]

    if engine == "google_news":
        return httpx.Response(200, json={"news_results": _SERP_NEWS})
    if "linkedin.com/in" in query:
        return httpx.Response(200, json={"organic_results": _SERP_LINKEDIN})
    return httpx.Response(200, json={"organic_results": _SERP_ORGANIC})


def _disify_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={"format": True, "dns": True, "disposable": False},
    )


def _doh_handler(request: httpx.Request) -> httpx.Response:
    params = parse_qs(urlsplit(str(request.url)).query)
    name = (params.get("name") or [""])[0]
    return httpx.Response(
        200,
        json={
            "Status": 0,
            "Answer": [{"name": name, "type": 1, "data": "127.0.0.1"}],
        },
    )


# --- In-memory Supabase ------------------------------------------------------


class _FakeSupabase:
    """Tiny stand-in for Supabase REST that the test can assert against."""

    def __init__(self) -> None:
        self.icp_profiles: list[dict[str, Any]] = []
        self.leads_raw: list[dict[str, Any]] = []
        self.buying_signals: list[dict[str, Any]] = []
        self._counters = {
            "icp_profiles": itertools.count(1),
            "leads_raw": itertools.count(1),
            "buying_signals": itertools.count(1),
        }

    def _table(self, name: str) -> list[dict[str, Any]]:
        return getattr(self, name)

    def _next_id(self, table: str) -> int:
        return next(self._counters[table])

    @staticmethod
    def _parse_filters(query: dict[str, list[str]]) -> dict[str, str]:
        return {k: v[0] for k, v in query.items() if v}

    @classmethod
    def _matches(cls, row: dict[str, Any], filters: dict[str, str]) -> bool:
        for key, raw in filters.items():
            if key in {"select", "order", "limit", "offset"}:
                continue
            # PostgREST OR group: or=(col.op.val,col.op.val,...). Row passes the
            # group if ANY sub-condition matches. Used by get_leads_for_enrichment
            # to also select leads missing location/size for backfill.
            if key == "or":
                inner = raw.strip()
                if inner.startswith("(") and inner.endswith(")"):
                    inner = inner[1:-1]
                conditions = [c for c in inner.split(",") if c]
                ok = False
                for cond in conditions:
                    col, _, op = cond.partition(".")
                    if cls._matches(row, {col: op}):
                        ok = True
                        break
                if not ok:
                    return False
                continue
            if raw.startswith("eq."):
                expected = raw[3:]
                actual = row.get(key)
                if actual is None and expected.lower() == "false":
                    continue
                if isinstance(actual, bool):
                    if expected.lower() != str(actual).lower():
                        return False
                    continue
                if str(actual) != expected:
                    return False
            elif raw == "is.null":
                if row.get(key) is not None:
                    return False
            elif raw == "not.is.null":
                if row.get(key) is None:
                    return False
            elif raw.startswith("in."):
                inner = raw[3:].strip("()")
                wanted = {item.strip() for item in inner.split(",") if item.strip()}
                if str(row.get(key)) not in wanted:
                    return False
            else:
                return False
        return True

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = urlsplit(str(request.url)).path
        table = path.rsplit("/", 1)[-1]
        if table not in {"icp_profiles", "leads_raw", "buying_signals"}:
            return httpx.Response(404, text=f"unknown table {table}")

        method = request.method.upper()
        if method == "POST":
            return self._handle_post(table, request)
        if method == "GET":
            return self._handle_get(table, request)
        if method == "PATCH":
            return self._handle_patch(table, request)
        if method == "DELETE":
            return self._handle_delete(table, request)
        return httpx.Response(405, text=f"method {method} not allowed")

    def _handle_post(self, table: str, request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        rows = payload if isinstance(payload, list) else [payload]
        inserted: list[dict[str, Any]] = []
        for row in rows:
            new_row = dict(row)
            new_row["id"] = self._next_id(table)
            self._table(table).append(new_row)
            inserted.append(new_row)
        return httpx.Response(201, json=inserted)

    def _handle_get(self, table: str, request: httpx.Request) -> httpx.Response:
        query = parse_qs(urlsplit(str(request.url)).query)
        filters = self._parse_filters(query)
        limit_raw = filters.get("limit")
        limit = int(limit_raw) if limit_raw and limit_raw.isdigit() else None

        rows = [row for row in self._table(table) if self._matches(row, filters)]
        if limit is not None:
            rows = rows[:limit]
        return httpx.Response(200, json=rows)

    def _handle_patch(self, table: str, request: httpx.Request) -> httpx.Response:
        query = parse_qs(urlsplit(str(request.url)).query)
        filters = self._parse_filters(query)
        updates = json.loads(request.content.decode("utf-8"))
        updated: list[dict[str, Any]] = []
        for row in self._table(table):
            if self._matches(row, filters):
                row.update(updates)
                updated.append(row)
        return httpx.Response(200, json=updated)

    def _handle_delete(self, table: str, request: httpx.Request) -> httpx.Response:
        query = parse_qs(urlsplit(str(request.url)).query)
        filters = self._parse_filters(query)
        kept = [row for row in self._table(table) if not self._matches(row, filters)]
        setattr(self, table, kept)
        return httpx.Response(204)


# --- The actual test ---------------------------------------------------------


def _install_routes(router: respx.Router, store: _FakeSupabase) -> None:
    router.route(
        url__regex=r"^https://generativelanguage\.googleapis\.com/v1beta/models/.+:generateContent.*"
    ).mock(
        side_effect=_gemini_handler,
    )
    router.get("https://serpapi.com/search").mock(side_effect=_serpapi_handler)
    router.route(url__regex=r"^https://www\.disify\.com/api/email/.*").mock(
        side_effect=_disify_handler,
    )
    router.get(url__regex=r"^https://cloudflare-dns\.com/dns-query.*").mock(
        side_effect=_doh_handler,
    )
    router.route(url__regex=rf"^{re.escape(SUPABASE_BASE)}/.*").mock(
        side_effect=store.handle,
    )


def test_run_all_end_to_end() -> None:
    store = _FakeSupabase()
    with respx.mock(assert_all_called=False) as router:
        _install_routes(router, store)
        from gtm_backend.phase1.main import main

        exit_code = main(["run-all", "--prompt", "HR-tech SaaS in Bangalore and Mumbai"])
    assert exit_code == 0

    # --- ICP ---------------------------------------------------------------
    assert len(store.icp_profiles) == 1
    icp_row = store.icp_profiles[0]
    assert icp_row["name"] == "Mid-market HR-tech in India"
    assert icp_row["blocker_titles"] == []
    assert icp_row["active"] is True
    assert icp_row["prompts"] == "HR-tech SaaS in Bangalore and Mumbai"

    # --- Leads (Agent 02 + Agent 03) --------------------------------------
    assert store.leads_raw, "expected at least one lead inserted"
    acme = next(
        (lead for lead in store.leads_raw if lead["company_name"] == "Acme HR"),
        None,
    )
    assert acme is not None, "Acme HR lead should be inserted by Agent 02"
    assert acme["company_size"] == 200
    assert isinstance(acme["company_size"], int)

    assert acme["contact_name"] == "Priya Iyer"
    assert acme["contact_email"]
    assert acme["contact_email"].endswith("@acmehr.com")
    assert acme["verified"] is True
    assert acme["bounce_status"] == "valid"

    # --- Signals (Agent 04) -----------------------------------------------
    assert store.buying_signals, "expected at least one signal inserted"
    allowed_types = {"funding", "leadership_change", "hiring", "expansion", "competitor_complaint"}
    for signal in store.buying_signals:
        assert signal["signal_type"] in allowed_types
        assert 1 <= signal["weight"] <= 10
        assert signal["buying_intent"] in {"high", "low"}
        assert signal["signal_text"]
        assert signal["signal_source_url"]
    assert any(sig["lead_id"] == acme["id"] for sig in store.buying_signals)

    # --- Scoring (Agent 05) ------------------------------------------------
    assert acme["icp_score"] is not None
    assert isinstance(acme["icp_score"], int)
    assert acme["score_tier"] in {"hot", "warm", "cold", "disqualified"}
    assert acme["score_breakdown"], "score_breakdown should be a non-empty dict"
    assert isinstance(acme["score_breakdown"], dict)
    assert acme["scored_at"], "scored_at should be populated by PATCH"
