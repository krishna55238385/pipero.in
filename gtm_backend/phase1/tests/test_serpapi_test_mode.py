"""Tests for GTM_TEST_MODE: an opt-in env flag that makes the SerpAPI
connector return canned fixture data instead of a real network call, so the
full pipeline can be run repeatedly for free during development without
spending real SerpAPI/Serper quota. Off by default — unset/false must be a
zero-behavior-change no-op versus the pre-existing live-API code path."""
from unittest.mock import MagicMock

import gtm_backend.phase1.connectors.serpapi as serpapi_mod
from gtm_backend import serpapi_fixtures


def test_test_mode_enabled_recognizes_truthy_values(monkeypatch):
    for value in ("1", "true", "True", "YES", "yes"):
        monkeypatch.setenv("GTM_TEST_MODE", value)
        assert serpapi_fixtures.test_mode_enabled() is True


def test_test_mode_disabled_by_default_and_on_falsy_values(monkeypatch):
    monkeypatch.delenv("GTM_TEST_MODE", raising=False)
    assert serpapi_fixtures.test_mode_enabled() is False
    for value in ("0", "false", "", "no"):
        monkeypatch.setenv("GTM_TEST_MODE", value)
        assert serpapi_fixtures.test_mode_enabled() is False


def test_fixture_response_returns_news_shape_for_google_news_engine():
    data = serpapi_fixtures.fixture_response({"engine": "google_news", "q": "Acme HR funding"})
    assert "news_results" in data
    assert len(data["news_results"]) > 0
    assert "organic_results" not in data


def test_fixture_response_returns_linkedin_shape_for_linkedin_queries():
    data = serpapi_fixtures.fixture_response({"engine": "google", "q": 'site:linkedin.com/in "Acme HR" (CEO)'})
    assert "organic_results" in data
    assert any("linkedin.com/in" in r["link"] for r in data["organic_results"])


def test_fixture_response_returns_plain_organic_results_otherwise():
    data = serpapi_fixtures.fixture_response({"engine": "google", "q": "HR tech companies India"})
    assert "organic_results" in data
    assert len(data["organic_results"]) > 0
    # None of the fixture titles/links look like known junk shapes.
    for r in data["organic_results"]:
        assert "market research" not in r["title"].lower()


def test_request_uses_fixture_and_skips_network_when_test_mode_on(monkeypatch, mocker):
    monkeypatch.setenv("GTM_TEST_MODE", "1")
    get_mock = mocker.patch.object(serpapi_mod._client, "get")
    result = serpapi_mod.search("HR tech companies India")
    get_mock.assert_not_called()
    assert len(result) > 0


def test_request_hits_real_client_when_test_mode_off(monkeypatch, mocker):
    monkeypatch.delenv("GTM_TEST_MODE", raising=False)
    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {"organic_results": [{"title": "Real Co", "link": "https://real.co", "snippet": ""}]}
    fake_response.raise_for_status.return_value = None
    get_mock = mocker.patch.object(serpapi_mod._client, "get", return_value=fake_response)
    # Also bypass the disk cache so this test's outcome only depends on the
    # live-call code path, not on a leftover cache entry from another test.
    mocker.patch.object(serpapi_mod, "_cache_get", return_value=None)
    mocker.patch.object(serpapi_mod, "_cache_set")
    # Task #7's proactive quota check also calls _client.get() once (a
    # separate, free account.json lookup) — irrelevant to what THIS test is
    # actually verifying (that a real search request happens), so it's
    # disabled here rather than asserting on call count == 2.
    mocker.patch.object(serpapi_mod, "check_serpapi_quota")
    result = serpapi_mod.search("some unique test-mode-off query")
    get_mock.assert_called_once()
    assert result[0]["title"] == "Real Co"
