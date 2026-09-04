"""Tests for Task #7 — third independent search provider (Tavily) + quota
monitoring alerts.

Context: SerpAPI and Serper.dev hit zero credits SIMULTANEOUSLY during a
live demo, stalling lead generation entirely with nothing behind either.
This adds Tavily as a third fallback rung (SerpAPI -> Serper -> Tavily) and
logs a highly-visible warning (this codebase has no Slack/email alerting —
confirmed by search) whenever a provider reports low remaining quota or a
hard failure.
"""
import httpx
import pytest

from gtm_backend.phase1.connectors import serpapi


@pytest.fixture(autouse=True)
def _reset_provider_state(monkeypatch):
    """Every test starts with a clean chain state — none of the module-level
    exhaustion/quota-checked flags leak between tests."""
    monkeypatch.setattr(serpapi, "_quota_exhausted", False)
    monkeypatch.setattr(serpapi, "_serper_exhausted", False)
    monkeypatch.setattr(serpapi, "_serpapi_quota_checked", False)
    monkeypatch.setattr(serpapi, "_serper_quota_checked", False)
    monkeypatch.setattr(serpapi, "_quota_warnings", [])
    monkeypatch.setattr(serpapi, "_cache_get", lambda params: None)
    monkeypatch.setattr(serpapi, "_cache_set", lambda params, data: None)


def _http_error(status_code, text=""):
    resp = httpx.Response(status_code, text=text, request=httpx.Request("GET", "https://example.com"))
    return resp


# -- 1. Fallback chain tries all three providers in order -------------------

def test_chain_falls_through_serpapi_to_serper_to_tavily_on_failure(mocker, monkeypatch):
    """All three configured; SerpAPI 429s, Serper also fails, Tavily
    succeeds — the chain must try each in order and return Tavily's
    result, not give up after the first or second failure."""
    monkeypatch.setattr(serpapi._settings, "serper_api_key", "serper-key")
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", "tavily-key")

    mocker.patch.object(
        serpapi, "_serpapi_request", side_effect=serpapi._QuotaExceeded("429")
    )
    mocker.patch.object(
        serpapi, "_serper_request", side_effect=RuntimeError("serper down")
    )
    tavily_mock = mocker.patch.object(
        serpapi, "_tavily_request",
        return_value={"organic_results": [{"title": "Tavily Co", "link": "https://tavily-co.com", "snippet": "..."}]},
    )
    mocker.patch.object(serpapi, "check_serpapi_quota")
    mocker.patch.object(serpapi, "check_serper_quota")

    result = serpapi.search("test query")

    assert result == [{"title": "Tavily Co", "link": "https://tavily-co.com", "snippet": "..."}]
    tavily_mock.assert_called_once()
    assert serpapi._quota_exhausted is True
    assert serpapi._serper_exhausted is True


def test_chain_raises_serp_quota_error_when_all_three_fail():
    """No provider left standing -> SerpQuotaError (the exception every
    caller already expects and handles), not an unhandled exception."""
    import gtm_backend.phase1.connectors.serpapi as mod

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mod._settings, "serper_api_key", "serper-key")
        mp.setattr(mod._settings, "tavily_api_key", "tavily-key")
        mp.setattr(mod, "_serpapi_request", lambda p: (_ for _ in ()).throw(mod._QuotaExceeded("429")))
        mp.setattr(mod, "_serper_request", lambda p: (_ for _ in ()).throw(RuntimeError("serper down")))
        mp.setattr(mod, "_tavily_request", lambda p: (_ for _ in ()).throw(RuntimeError("tavily down")))
        mp.setattr(mod, "check_serpapi_quota", lambda: None)
        mp.setattr(mod, "check_serper_quota", lambda: None)
        mp.setattr(mod, "_quota_exhausted", False)
        mp.setattr(mod, "_serper_exhausted", False)

        with pytest.raises(mod.SerpQuotaError):
            mod.search("test query")


def test_chain_skips_straight_to_tavily_when_serper_not_configured(mocker, monkeypatch):
    """No Serper key at all (not just exhausted) — the chain must skip it
    entirely and go straight to Tavily, same graceful-degradation Serper
    itself already gets when unconfigured."""
    monkeypatch.setattr(serpapi._settings, "serper_api_key", None)
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", "tavily-key")

    mocker.patch.object(serpapi, "_serpapi_request", side_effect=serpapi._QuotaExceeded("429"))
    serper_mock = mocker.patch.object(serpapi, "_serper_request")
    tavily_mock = mocker.patch.object(
        serpapi, "_tavily_request",
        return_value={"organic_results": [{"title": "T", "link": "https://t.com", "snippet": ""}]},
    )
    mocker.patch.object(serpapi, "check_serpapi_quota")

    result = serpapi.search("test query")

    serper_mock.assert_not_called()
    tavily_mock.assert_called_once()
    assert len(result) == 1


# -- 2. Graceful degradation with zero/one/all three keys configured --------

def test_no_fallback_keys_configured_raises_after_serpapi_429(mocker, monkeypatch):
    """Zero fallback keys — matches the exact pre-Task-#7 behavior for a
    lone SerpAPI setup: SerpQuotaError, no crash, no silent hang."""
    monkeypatch.setattr(serpapi._settings, "serper_api_key", None)
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", None)
    mocker.patch.object(serpapi, "_serpapi_request", side_effect=serpapi._QuotaExceeded("429"))

    with pytest.raises(serpapi.SerpQuotaError):
        serpapi.search("test query")


def test_only_serpapi_key_present_behaves_exactly_as_before(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serper_api_key", None)
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", None)
    mocker.patch.object(
        serpapi, "_serpapi_request",
        return_value={"organic_results": [{"title": "Acme", "link": "https://acme.com", "snippet": ""}]},
    )
    mocker.patch.object(serpapi, "check_serpapi_quota")

    result = serpapi.search("test query")
    assert result == [{"title": "Acme", "link": "https://acme.com", "snippet": ""}]


def test_all_three_keys_configured_uses_serpapi_first_when_healthy(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serper_api_key", "serper-key")
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", "tavily-key")
    serpapi_mock = mocker.patch.object(
        serpapi, "_serpapi_request",
        return_value={"organic_results": [{"title": "Acme", "link": "https://acme.com", "snippet": ""}]},
    )
    serper_mock = mocker.patch.object(serpapi, "_serper_request")
    tavily_mock = mocker.patch.object(serpapi, "_tavily_request")
    mocker.patch.object(serpapi, "check_serpapi_quota")

    result = serpapi.search("test query")

    serpapi_mock.assert_called_once()
    serper_mock.assert_not_called()
    tavily_mock.assert_not_called()
    assert result == [{"title": "Acme", "link": "https://acme.com", "snippet": ""}]


def test_tavily_unconfigured_skips_gracefully_after_serpapi_and_serper_fail(mocker, monkeypatch):
    """Tavily key unset — the chain must exhaust cleanly at Serper without
    ever attempting a Tavily call, not error trying to build one."""
    monkeypatch.setattr(serpapi._settings, "serper_api_key", "serper-key")
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", None)
    mocker.patch.object(serpapi, "_serpapi_request", side_effect=serpapi._QuotaExceeded("429"))
    mocker.patch.object(serpapi, "_serper_request", side_effect=RuntimeError("serper down"))
    tavily_mock = mocker.patch.object(serpapi, "_tavily_request")
    mocker.patch.object(serpapi, "check_serpapi_quota")
    mocker.patch.object(serpapi, "check_serper_quota")

    with pytest.raises(serpapi.SerpQuotaError):
        serpapi.search("test query")

    tavily_mock.assert_not_called()


# -- 3. Existing SerpAPI->Serper behavior unchanged when SerpAPI succeeds ---

def test_serpapi_success_never_touches_serper_or_tavily(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serper_api_key", "serper-key")
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", "tavily-key")
    mocker.patch.object(
        serpapi, "_serpapi_request",
        return_value={"organic_results": [{"title": "Real Co", "link": "https://real.co", "snippet": ""}]},
    )
    serper_mock = mocker.patch.object(serpapi, "_serper_request")
    tavily_mock = mocker.patch.object(serpapi, "_tavily_request")
    mocker.patch.object(serpapi, "check_serpapi_quota")

    result = serpapi.search("some query")

    assert result[0]["title"] == "Real Co"
    serper_mock.assert_not_called()
    tavily_mock.assert_not_called()
    assert serpapi._quota_exhausted is False


# -- 4. Quota monitoring: low-quota warnings ---------------------------------

def test_serpapi_low_quota_logs_warning(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serp_api_key", "real-key")
    fake_response = mocker.Mock()
    fake_response.raise_for_status = mocker.Mock()
    fake_response.json.return_value = {"searches_per_month": 250, "total_searches_left": 30}  # 12%
    mocker.patch.object(serpapi._client, "get", return_value=fake_response)

    serpapi.check_serpapi_quota()

    warnings = serpapi.get_and_clear_quota_warnings()
    assert len(warnings) == 1
    assert "SerpAPI" in warnings[0]
    assert "30/250" in warnings[0]


def test_serpapi_healthy_quota_logs_nothing(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serp_api_key", "real-key")
    fake_response = mocker.Mock()
    fake_response.raise_for_status = mocker.Mock()
    fake_response.json.return_value = {"searches_per_month": 250, "total_searches_left": 200}  # 80%
    mocker.patch.object(serpapi._client, "get", return_value=fake_response)

    serpapi.check_serpapi_quota()

    assert serpapi.get_and_clear_quota_warnings() == []


def test_serpapi_quota_check_only_fires_once_per_run(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serp_api_key", "real-key")
    fake_response = mocker.Mock()
    fake_response.raise_for_status = mocker.Mock()
    fake_response.json.return_value = {"searches_per_month": 250, "total_searches_left": 10}
    get_mock = mocker.patch.object(serpapi._client, "get", return_value=fake_response)

    serpapi.check_serpapi_quota()
    serpapi.check_serpapi_quota()
    serpapi.check_serpapi_quota()

    get_mock.assert_called_once()  # not once per call


def test_serper_low_balance_logs_warning(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serper_api_key", "serper-key")
    fake_response = mocker.Mock()
    fake_response.raise_for_status = mocker.Mock()
    fake_response.json.return_value = {"balance": 5, "rateLimit": 5}
    mocker.patch.object(serpapi._client, "get", return_value=fake_response)

    serpapi.check_serper_quota()

    warnings = serpapi.get_and_clear_quota_warnings()
    assert len(warnings) == 1
    assert "Serper.dev" in warnings[0]
    assert "5" in warnings[0]


def test_quota_check_failure_is_swallowed_not_raised(mocker, monkeypatch):
    """A broken/unreachable account endpoint must never break the actual
    pipeline run — this is a monitoring nicety, not a hard dependency."""
    monkeypatch.setattr(serpapi._settings, "serp_api_key", "real-key")
    mocker.patch.object(serpapi._client, "get", side_effect=Exception("network error"))

    serpapi.check_serpapi_quota()  # must not raise
    assert serpapi.get_and_clear_quota_warnings() == []


def test_hard_failure_429_is_logged_as_a_quota_warning(mocker, monkeypatch):
    monkeypatch.setattr(serpapi._settings, "serper_api_key", None)
    monkeypatch.setattr(serpapi._settings, "tavily_api_key", None)
    mocker.patch.object(serpapi, "_serpapi_request", side_effect=serpapi._QuotaExceeded("SerpAPI 429"))

    with pytest.raises(serpapi.SerpQuotaError):
        serpapi.search("test query")

    warnings = serpapi.get_and_clear_quota_warnings()
    assert len(warnings) == 1
    assert "SerpAPI" in warnings[0]


def test_get_and_clear_quota_warnings_actually_clears():
    serpapi._log_quota_warning("Test", "warning 1")
    first = serpapi.get_and_clear_quota_warnings()
    second = serpapi.get_and_clear_quota_warnings()
    assert first == ["Test: warning 1"]
    assert second == []


# -- Tavily connector itself -------------------------------------------------

def test_tavily_request_translates_organic_results(mocker):
    ok_response = mocker.Mock()
    ok_response.status_code = 200
    ok_response.raise_for_status = mocker.Mock()
    ok_response.json.return_value = {
        "results": [{"title": "Acme", "url": "https://acme.com", "content": "Acme does things"}]
    }
    mocker.patch.object(serpapi._client, "post", return_value=ok_response)

    data = serpapi._tavily_request({"q": "acme"})

    assert data == {
        "organic_results": [{"title": "Acme", "link": "https://acme.com", "snippet": "Acme does things", "date": None}]
    }


def test_tavily_request_translates_news_results():
    import gtm_backend.phase1.connectors.serpapi as mod

    class _Resp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {"results": [{"title": "Acme raises Series A", "url": "https://news.example.com/acme", "content": "..."}]}

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mod._client, "post", lambda *a, **k: _Resp())
        data = mod._tavily_request({"q": "acme funding", "engine": "google_news"})

    assert "news_results" in data
    assert data["news_results"][0]["link"] == "https://news.example.com/acme"


def test_tavily_request_raises_quota_exceeded_on_429():
    import gtm_backend.phase1.connectors.serpapi as mod

    class _Resp:
        status_code = 429
        text = "rate limited"

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mod._client, "post", lambda *a, **k: _Resp())
        with pytest.raises(mod._QuotaExceeded):
            mod._tavily_request({"q": "acme"})
