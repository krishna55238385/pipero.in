"""Same BYO-LLM routing tests as phase1's/phase2's — phase3's connector
mirrors the same structure exactly, covered separately to catch any
phase-specific copy/paste mistake in the OpenRouter wiring."""
import importlib

import pytest


@pytest.fixture
def openai_module_factory(monkeypatch):
    def _load():
        import gtm_backend.phase3.connectors.openai as mod
        return importlib.reload(mod)
    return _load


def test_no_openrouter_key_leaves_client_openrouter_unset(openai_module_factory, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    mod = openai_module_factory()
    assert mod._client_openrouter is None


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
    groq_create_mock.assert_not_called()


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
