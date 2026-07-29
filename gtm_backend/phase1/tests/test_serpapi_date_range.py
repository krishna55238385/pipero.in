"""Regression tests for the signal-freshness fix: lookback windows over 30
days must produce a precise custom date range, not silently widen to
Google's "past year" bucket."""
from datetime import datetime, timedelta, timezone

from gtm_backend.phase1.connectors.serpapi import _days_to_tbs


def test_small_windows_still_use_relative_buckets():
    assert _days_to_tbs(1) == "qdr:d"
    assert _days_to_tbs(7) == "qdr:w"
    assert _days_to_tbs(30) == "qdr:m"


def test_90_day_lookback_uses_precise_custom_range_not_past_year():
    tbs = _days_to_tbs(90)
    assert tbs.startswith("cdr:1,cd_min:")
    assert "qdr:y" not in tbs

    today = datetime.now(timezone.utc).date()
    expected_start = today - timedelta(days=90)
    fmt = lambda d: f"{d.month}/{d.day}/{d.year}"
    assert tbs == f"cdr:1,cd_min:{fmt(expected_start)},cd_max:{fmt(today)}"


def test_180_day_lookback_also_uses_custom_range():
    tbs = _days_to_tbs(180)
    assert tbs.startswith("cdr:1,cd_min:")


def test_beyond_one_year_falls_back_to_year_bucket():
    assert _days_to_tbs(400) == "qdr:y"


def test_search_news_passes_computed_tbs_through(mocker):
    from gtm_backend.phase1.connectors import serpapi

    request_mock = mocker.patch(
        "gtm_backend.phase1.connectors.serpapi._request",
        return_value={"news_results": []},
    )
    serpapi.search_news("Acme HR", days=90, num=5)

    called_params = request_mock.call_args[0][0]
    assert called_params["tbs"].startswith("cdr:1,cd_min:")
