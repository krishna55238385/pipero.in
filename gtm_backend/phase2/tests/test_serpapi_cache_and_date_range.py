"""Regression tests for the phase2 SerpAPI optimization: a disk cache ported
from phase1 (previously phase2 had none, re-spending live credits every
re-run) plus the same date-range fix already applied in phase1."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from gtm_backend.phase2.connectors import serpapi


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    """Point the cache at a scratch dir so tests never touch/pollute the real
    .cache/serpapi_phase2 dir, and reset in-module quota state between tests."""
    monkeypatch.setattr(serpapi, "_CACHE_DIR", tmp_path / "serpapi_cache")
    serpapi._quota_exhausted = False
    yield


def test_repeat_query_reuses_cached_result_no_second_http_call(mocker):
    fake_response = mocker.Mock()
    fake_response.status_code = 200
    fake_response.json.return_value = {"organic_results": [{"title": "Acme HR"}]}
    fake_response.raise_for_status.return_value = None
    get_mock = mocker.patch.object(serpapi._client, "get", return_value=fake_response)

    first = serpapi.search("Acme HR", num=5)
    second = serpapi.search("Acme HR", num=5)

    assert first == second == [{"title": "Acme HR"}]
    assert get_mock.call_count == 1  # second call served from cache, no HTTP


def test_days_to_tbs_90_days_uses_precise_custom_range_not_past_year():
    tbs = serpapi._days_to_tbs(90)
    assert tbs.startswith("cdr:1,cd_min:")
    assert "qdr:y" not in tbs

    today = datetime.now(timezone.utc).date()
    expected_start = today - timedelta(days=90)
    fmt = lambda d: f"{d.month}/{d.day}/{d.year}"
    assert tbs == f"cdr:1,cd_min:{fmt(expected_start)},cd_max:{fmt(today)}"


def test_days_to_tbs_small_windows_still_use_relative_buckets():
    assert serpapi._days_to_tbs(1) == "qdr:d"
    assert serpapi._days_to_tbs(7) == "qdr:w"
    assert serpapi._days_to_tbs(30) == "qdr:m"
