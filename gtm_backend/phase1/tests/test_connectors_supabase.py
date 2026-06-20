"""Focused tests for ``phase1.connectors.supabase``.

Covers HTTP shape (paths, params, payloads), the Lead schema integer coercion
on the wire, and the ``SupabaseError`` behavior surfacing 4xx response bodies.
"""
from __future__ import annotations

import json
from urllib.parse import unquote

import httpx
import pytest
import respx


BASE_URL = "https://fake.supabase.co/rest/v1"


def _read_request_json(request: httpx.Request) -> object:
    return json.loads(request.content.decode("utf-8"))


@respx.mock
def test_insert_icp_posts_payload_and_returns_id() -> None:
    from gtm_backend.phase1.connectors import supabase
    from gtm_backend.phase1.core.schemas import ICP

    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = _read_request_json(request)
        return httpx.Response(201, json=[{"id": 7}])

    respx.post(f"{BASE_URL}/icp_profiles").mock(side_effect=_handler)

    icp = ICP(
        name="Test ICP",
        product_line="Core",
        industry=["SaaS"],
        geography=["India"],
        buyer_titles=["CEO"],
    )
    icp_id = supabase.insert_icp(icp, user_prompt="HR tech in India")

    assert icp_id == 7
    body = captured["body"]
    assert isinstance(body, dict)
    assert body["name"] == "Test ICP"
    assert body["industry"] == ["SaaS"]
    assert body["prompts"] == "HR tech in India"
    assert body["active"] is True
    assert body["created_by"] == "phase1"
    assert isinstance(body["last_reviewed_at"], str) and body["last_reviewed_at"]


@respx.mock
def test_insert_leads_drops_id_and_coerces_company_size() -> None:
    from gtm_backend.phase1.connectors import supabase
    from gtm_backend.phase1.core.schemas import Lead

    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = _read_request_json(request)
        return httpx.Response(201, json=[{"id": 101}, {"id": 102}])

    respx.post(f"{BASE_URL}/leads_raw").mock(side_effect=_handler)

    leads = [
        Lead(
            icp_id=1,
            company_name="Acme HR",
            company_domain="acmehr.com",
            company_size="51-200 employees",
            sources=["serpapi"],
        ),
        Lead(
            icp_id=1,
            company_name="Beta HR",
            company_domain="betahr.io",
        ),
    ]
    ids = supabase.insert_leads(leads)

    assert ids == [101, 102]
    body = captured["body"]
    assert isinstance(body, list) and len(body) == 2
    assert "id" not in body[0]
    assert body[0]["company_size"] == 200
    assert body[1]["company_size"] is None
    assert body[0]["company_name"] == "Acme HR"


def test_insert_leads_empty_returns_empty_list_without_http() -> None:
    from gtm_backend.phase1.connectors import supabase

    assert supabase.insert_leads([]) == []


@respx.mock
def test_insert_signals_serializes_detected_at_as_iso_string() -> None:
    from gtm_backend.phase1.connectors import supabase
    from gtm_backend.phase1.core.schemas import BuyingSignal

    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = _read_request_json(request)
        return httpx.Response(201, json=[{"id": 9}])

    respx.post(f"{BASE_URL}/buying_signals").mock(side_effect=_handler)

    signal = BuyingSignal(
        lead_id=42,
        signal_type="funding",
        weight=10,
        signal_text="Acme HR raised $10M Series A",
        signal_summary="Raised Series A",
        signal_source_url="https://news/x",
        buying_intent="high",
    )
    ids = supabase.insert_signals([signal])

    assert ids == [9]
    body = captured["body"]
    assert isinstance(body, list) and len(body) == 1
    detected_at = body[0]["detected_at"]
    assert isinstance(detected_at, str)
    assert "T" in detected_at
    assert detected_at.endswith("+00:00") or detected_at.endswith("Z")


@respx.mock
def test_update_lead_score_patches_with_scoring_fields() -> None:
    from gtm_backend.phase1.connectors import supabase
    from gtm_backend.phase1.core.schemas import ScoreResult

    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = _read_request_json(request)
        return httpx.Response(200, json=[{"id": 55}])

    respx.patch(f"{BASE_URL}/leads_raw").mock(side_effect=_handler)

    score = ScoreResult(
        lead_id=55,
        icp_score=82,
        score_tier="hot",
        score_breakdown={"geography": {"points": 18, "max": 18, "detail": "match"}},
        score_reasoning="Strong fit",
    )
    supabase.update_lead_score(score)

    url = captured["url"]
    assert isinstance(url, str)
    assert "id=eq.55" in url
    body = captured["body"]
    assert isinstance(body, dict)
    assert body["icp_score"] == 82
    assert body["score_tier"] == "hot"
    assert body["score_breakdown"] == {
        "geography": {"points": 18, "max": 18, "detail": "match"},
    }
    assert body["score_reasoning"] == "Strong fit"
    assert body["score_version"] == "v2.0"
    assert isinstance(body["scored_at"], str) and body["scored_at"]


@respx.mock
def test_get_leads_for_enrichment_filters_by_icp_id() -> None:
    from gtm_backend.phase1.connectors import supabase

    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json=[])

    respx.get(f"{BASE_URL}/leads_raw").mock(side_effect=_handler)

    rows = supabase.get_leads_for_enrichment(limit=10, icp_id=42)

    assert rows == []
    url = captured["url"]
    assert isinstance(url, str)
    decoded = unquote(url)
    assert "icp_id=eq.42" in decoded
    assert "company_domain=not.is.null" in decoded
    assert "limit=10" in decoded
    # Email OR missing-firmographic clause drives the backfill behavior.
    assert "contact_email.is.null" in decoded
    assert "company_city.is.null" in decoded
    assert "company_country.is.null" in decoded
    assert "company_size.is.null" in decoded


@respx.mock
def test_get_leads_for_enrichment_omits_icp_filter_when_none() -> None:
    from gtm_backend.phase1.connectors import supabase

    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json=[])

    respx.get(f"{BASE_URL}/leads_raw").mock(side_effect=_handler)

    supabase.get_leads_for_enrichment(limit=10, icp_id=None)

    url = captured["url"]
    assert isinstance(url, str)
    assert "icp_id" not in url


@respx.mock
def test_supabase_error_surfaces_response_body() -> None:
    from gtm_backend.phase1.connectors import supabase
    from gtm_backend.phase1.core.schemas import ICP

    error_body = '{"code":"23505","message":"duplicate key value"}'
    respx.post(f"{BASE_URL}/icp_profiles").mock(
        return_value=httpx.Response(400, text=error_body),
    )

    icp = ICP(name="Conflict ICP")

    with pytest.raises(supabase.SupabaseError) as exc_info:
        supabase.insert_icp(icp, user_prompt="trigger conflict")

    rendered = str(exc_info.value)
    assert "400" in rendered
    assert "duplicate key value" in rendered
    assert "/icp_profiles" in rendered
    assert exc_info.value.status == 400
    assert exc_info.value.body == error_body
