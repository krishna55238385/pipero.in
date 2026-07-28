"""Focused tests for ``phase1.connectors.supabase``.

Covers the payload/params shape each public function builds, Lead schema
integer coercion, and SupabaseError propagation.

These tests mock at the ``_get``/``_post``/``_patch`` module-level seam —
the same boundary every public function in this module calls through,
regardless of transport. This module used to talk to Supabase's REST API
(mocked here via respx/httpx); it was migrated to talk directly to
Postgres/RDS via psycopg2, but these tests were never updated and kept
mocking the old REST calls, which the code no longer makes — so every test
either connected to nothing (respx routes never matched) or crashed trying
to open a real Postgres connection. Mocking `_get`/`_post`/`_patch` instead
of the transport verifies the exact same thing the original tests intended
(did the function build the right payload/params) without caring how that
payload is actually delivered — the correct abstraction level for these
tests, and stable across future transport changes.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def supabase_mod():
    from gtm_backend.phase1.connectors import supabase
    return supabase


def test_insert_icp_posts_payload_and_returns_id(mocker, supabase_mod) -> None:
    from gtm_backend.phase1.core.schemas import ICP

    post_mock = mocker.patch.object(supabase_mod, "_post", return_value=[{"id": 7}])

    icp = ICP(
        name="Test ICP",
        product_line="Core",
        industry=["SaaS"],
        geography=["India"],
        buyer_titles=["CEO"],
    )
    icp_id = supabase_mod.insert_icp(icp, user_prompt="HR tech in India")

    assert icp_id == 7
    post_mock.assert_called_once()
    path, body = post_mock.call_args[0]
    assert path == "/icp_profiles"
    assert body["name"] == "Test ICP"
    assert body["industry"] == ["SaaS"]
    assert body["prompts"] == "HR tech in India"
    assert body["active"] is True
    assert body["created_by"] == "phase1"
    assert isinstance(body["last_reviewed_at"], str) and body["last_reviewed_at"]


def test_insert_leads_drops_id_and_coerces_company_size(mocker, supabase_mod) -> None:
    from gtm_backend.phase1.core.schemas import Lead

    post_mock = mocker.patch.object(
        supabase_mod, "_post", return_value=[{"id": 101}, {"id": 102}]
    )

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
    ids = supabase_mod.insert_leads(leads)

    assert ids == [101, 102]
    post_mock.assert_called_once()
    path, body = post_mock.call_args[0]
    assert path == "/leads_raw"
    assert isinstance(body, list) and len(body) == 2
    assert "id" not in body[0]
    assert body[0]["company_size"] == 200
    assert body[1]["company_size"] is None
    assert body[0]["company_name"] == "Acme HR"


def test_insert_leads_empty_returns_empty_list_without_http(mocker, supabase_mod) -> None:
    post_mock = mocker.patch.object(supabase_mod, "_post")

    assert supabase_mod.insert_leads([]) == []
    post_mock.assert_not_called()


def test_insert_signals_serializes_detected_at_as_iso_string(mocker, supabase_mod) -> None:
    from gtm_backend.phase1.core.schemas import BuyingSignal

    post_mock = mocker.patch.object(supabase_mod, "_post", return_value=[{"id": 9}])

    signal = BuyingSignal(
        lead_id=42,
        signal_type="funding",
        weight=10,
        signal_text="Acme HR raised $10M Series A",
        signal_summary="Raised Series A",
        signal_source_url="https://news/x",
        buying_intent="high",
    )
    ids = supabase_mod.insert_signals([signal])

    assert ids == [9]
    path, body = post_mock.call_args[0]
    assert path == "/buying_signals"
    assert isinstance(body, list) and len(body) == 1
    detected_at = body[0]["detected_at"]
    assert isinstance(detected_at, str)
    assert "T" in detected_at
    assert detected_at.endswith("+00:00") or detected_at.endswith("Z")


def test_update_lead_score_patches_with_scoring_fields(mocker, supabase_mod) -> None:
    from gtm_backend.phase1.core.schemas import ScoreResult

    patch_mock = mocker.patch.object(supabase_mod, "_patch", return_value=[{"id": 55}])

    score = ScoreResult(
        lead_id=55,
        icp_score=82,
        score_tier="hot",
        score_breakdown={"geography": {"points": 18, "max": 18, "detail": "match"}},
        score_reasoning="Strong fit",
    )
    supabase_mod.update_lead_score(score)

    patch_mock.assert_called_once()
    path = patch_mock.call_args[0][0]
    params = patch_mock.call_args.kwargs["params"]
    body = patch_mock.call_args.kwargs["json_body"]
    assert path == "/leads_raw"
    assert params == {"id": "eq.55"}
    assert body["icp_score"] == 82
    assert body["score_tier"] == "hot"
    assert body["score_breakdown"] == {
        "geography": {"points": 18, "max": 18, "detail": "match"},
    }
    assert body["score_reasoning"] == "Strong fit"
    assert body["score_version"] == "v2.0"
    assert isinstance(body["scored_at"], str) and body["scored_at"]


def test_get_leads_for_enrichment_filters_by_icp_id(mocker, supabase_mod) -> None:
    get_mock = mocker.patch.object(supabase_mod, "_get", return_value=[])

    rows = supabase_mod.get_leads_for_enrichment(limit=10, icp_id=42)

    assert rows == []
    get_mock.assert_called_once()
    path, kwargs = get_mock.call_args[0][0], get_mock.call_args[1]
    params = kwargs.get("params") if kwargs else get_mock.call_args[0][1]
    assert path == "/leads_raw"
    assert params["icp_id"] == "eq.42"
    assert params["company_domain"] == "not.is.null"
    assert params["limit"] == 10
    # Email OR missing-firmographic clause drives the backfill behavior.
    or_clause = params["or"]
    assert "contact_email.is.null" in or_clause
    assert "company_city.is.null" in or_clause
    assert "company_country.is.null" in or_clause
    assert "company_size.is.null" in or_clause


def test_get_leads_for_enrichment_omits_icp_filter_when_none(mocker, supabase_mod) -> None:
    get_mock = mocker.patch.object(supabase_mod, "_get", return_value=[])

    supabase_mod.get_leads_for_enrichment(limit=10, icp_id=None)

    path, kwargs = get_mock.call_args[0][0], get_mock.call_args[1]
    params = kwargs.get("params") if kwargs else get_mock.call_args[0][1]
    assert path == "/leads_raw"
    assert "icp_id" not in params


def test_supabase_error_surfaces_response_body(mocker, supabase_mod) -> None:
    from gtm_backend.phase1.core.schemas import ICP

    error_body = '{"code":"23505","message":"duplicate key value"}'
    mocker.patch.object(
        supabase_mod,
        "_post",
        side_effect=supabase_mod.SupabaseError(
            "POST", "/icp_profiles", 400, error_body
        ),
    )

    icp = ICP(name="Conflict ICP")

    with pytest.raises(supabase_mod.SupabaseError) as exc_info:
        supabase_mod.insert_icp(icp, user_prompt="trigger conflict")

    rendered = str(exc_info.value)
    assert "400" in rendered
    assert "duplicate key value" in rendered
    assert "/icp_profiles" in rendered
    assert exc_info.value.status == 400
    assert exc_info.value.body == error_body
