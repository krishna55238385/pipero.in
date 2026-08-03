"""Tests for chat_json's local retry-on-invalid-JSON behavior.

Root-cause fix for a live bug found on Jobraux: Agent 02's normalization LLM
call would occasionally return an empty/malformed completion body, and since
the shared retry_on_transient decorator deliberately only retries
transport-level failures (never a 200 response with bad content — retrying a
non-idempotent write on an HTTP error risks duplicating it), a single bad
completion fell straight through to the caller's much weaker regex-only
fallback normalizer on the very first hiccup. This is different: nothing was
written, so retrying a malformed *content* body once is safe and often
recovers cleanly.
"""
import json

import pytest

import gtm_backend.phase1.connectors.openai as openai_mod


class _FakeUsage:
    prompt_tokens = 10
    completion_tokens = 5
    total_tokens = 15


class _FakeChoice:
    def __init__(self, content):
        self.message = type("M", (), {"content": content})()


class _FakeResponse:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]
        self.usage = _FakeUsage()


def test_succeeds_immediately_on_valid_json(mocker):
    good = _FakeResponse(json.dumps({"companies": []}))
    fallback_mock = mocker.patch.object(
        openai_mod, "_chat_completion_with_fallback", return_value=good
    )
    result = openai_mod.chat_json("system", "user")
    assert result == {"companies": []}
    fallback_mock.assert_called_once()


def test_retries_once_after_empty_content_then_succeeds(mocker):
    empty = _FakeResponse(None)
    good = _FakeResponse(json.dumps({"companies": [{"company_name": "Acme"}]}))
    fallback_mock = mocker.patch.object(
        openai_mod, "_chat_completion_with_fallback", side_effect=[empty, good]
    )
    result = openai_mod.chat_json("system", "user")
    assert result["companies"][0]["company_name"] == "Acme"
    assert fallback_mock.call_count == 2


def test_retries_once_after_malformed_json_then_succeeds(mocker):
    malformed = _FakeResponse("not valid json {{{")
    good = _FakeResponse(json.dumps({"ok": True}))
    fallback_mock = mocker.patch.object(
        openai_mod, "_chat_completion_with_fallback", side_effect=[malformed, good]
    )
    result = openai_mod.chat_json("system", "user")
    assert result == {"ok": True}
    assert fallback_mock.call_count == 2


def test_raises_after_two_consecutive_failures(mocker):
    empty = _FakeResponse(None)
    fallback_mock = mocker.patch.object(
        openai_mod, "_chat_completion_with_fallback", side_effect=[empty, empty]
    )
    with pytest.raises(RuntimeError, match="empty/invalid JSON"):
        openai_mod.chat_json("system", "user")
    assert fallback_mock.call_count == 2


def test_usage_is_logged_for_every_attempt_including_the_failed_one(mocker):
    empty = _FakeResponse(None)
    good = _FakeResponse(json.dumps({"ok": True}))
    mocker.patch.object(
        openai_mod, "_chat_completion_with_fallback", side_effect=[empty, good]
    )
    log_mock = mocker.patch.object(openai_mod, "log_usage")
    openai_mod.chat_json("system", "user", agent="agent_02_leads")
    assert log_mock.call_count == 2
