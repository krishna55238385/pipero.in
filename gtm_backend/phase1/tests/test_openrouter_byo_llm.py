"""Tests for the BYO LLM feature: when OPENROUTER_API_KEY is present in this
process's environment (injected per-subprocess by gtm_service/runner.py for
orgs that saved their own OpenRouter key), chat_json routes through
OpenRouter instead of the platform's shared Groq key. Falls back to Groq if
the OpenRouter call itself fails. Unset env = unchanged existing behavior.

_client_openrouter is built once at module import time from the environment,
so each test reloads the module after setting/clearing OPENROUTER_API_KEY to
get a fresh client instance reflecting that env state.
"""
import importlib

import pytest


@pytest.fixture
def openai_module_factory(monkeypatch):
    """Import (or re-import) gtm_backend.phase1.connectors.openai with the
    current env, returning the fresh module object."""
    def _load():
        import gtm_backend.phase1.connectors.openai as mod
        return importlib.reload(mod)
    return _load


def test_no_openrouter_key_leaves_client_openrouter_unset(openai_module_factory, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    mod = openai_module_factory()
    assert mod._client_openrouter is None


def test_openrouter_key_present_builds_client_with_correct_base_url(openai_module_factory, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-openrouter-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash")
    mod = openai_module_factory()
    assert mod._client_openrouter is not None
    assert str(mod._client_openrouter.base_url).rstrip("/") == "https://openrouter.ai/api/v1"
    assert mod._OPENROUTER_MODEL == "deepseek/deepseek-v4-flash"


def test_missing_model_env_falls_back_to_default_model_string(openai_module_factory, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-openrouter-key")
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    mod = openai_module_factory()
    assert mod._OPENROUTER_MODEL  # non-empty default, not blank


def test_chat_completion_routes_through_openrouter_when_configured(openai_module_factory, monkeypatch, mocker):
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-openrouter-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash")
    mod = openai_module_factory()

    fake_response = mocker.Mock()
    create_mock = mocker.patch.object(
        mod._client_openrouter.chat.completions, "create", return_value=fake_response
    )
    groq_create_mock = mocker.patch.object(mod._client.chat.completions, "create")

    result = mod._chat_completion_with_fallback("some-groq-model", "system", "user", 0.1)

    assert result is fake_response
    create_mock.assert_called_once()
    assert create_mock.call_args.kwargs["model"] == "deepseek/deepseek-v4-flash"
    groq_create_mock.assert_not_called()  # never touched Groq at all


def test_openrouter_failure_falls_back_to_groq(openai_module_factory, monkeypatch, mocker):
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-openrouter-key")
    mod = openai_module_factory()

    mocker.patch.object(
        mod._client_openrouter.chat.completions, "create", side_effect=RuntimeError("bad key")
    )
    fake_groq_response = mocker.Mock()
    groq_create_mock = mocker.patch.object(
        mod._client.chat.completions, "create", return_value=fake_groq_response
    )

    result = mod._chat_completion_with_fallback("llama-3.3-70b-versatile", "system", "user", 0.1)

    assert result is fake_groq_response
    groq_create_mock.assert_called_once()


def test_no_openrouter_key_uses_groq_unchanged(openai_module_factory, monkeypatch, mocker):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    mod = openai_module_factory()

    fake_groq_response = mocker.Mock()
    groq_create_mock = mocker.patch.object(
        mod._client.chat.completions, "create", return_value=fake_groq_response
    )

    result = mod._chat_completion_with_fallback("llama-3.3-70b-versatile", "system", "user", 0.1)

    assert result is fake_groq_response
    groq_create_mock.assert_called_once()
