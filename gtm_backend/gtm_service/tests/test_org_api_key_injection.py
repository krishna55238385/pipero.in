"""Tests for the BYO API key injection seam in run_commands: an org's custom
SerpAPI/OpenRouter keys (if saved) must override the subprocess env, exactly
like GTM_ORG_ID already does; missing keys must leave the env untouched
(falls through to the platform's own default keys)."""
from unittest.mock import patch

from gtm_backend.gtm_service.runner import run_commands

_MOD = "gtm_backend.gtm_service.runner"


def _run(org_keys, organization_id="org-1", monkeypatch=None):
    captured_env = {}

    def fake_subprocess_run(argv, **kwargs):
        captured_env.update(kwargs.get("env") or {})
        result = type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()
        return result

    # The sandbox/host environment may itself have SERP_API_KEY etc. set
    # (this codebase's own platform default) — strip those so assertions
    # about what run_commands added/left-untouched aren't polluted by
    # whatever happens to be in the ambient shell environment.
    if monkeypatch is not None:
        for key in ("SERP_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"):
            monkeypatch.delenv(key, raising=False)

    with patch(f"{_MOD}.db.get_org_api_keys", return_value=org_keys) as get_keys, \
         patch(f"{_MOD}.db.update_phase_run"), \
         patch(f"{_MOD}.db.append_phase_run_log", return_value=""), \
         patch(f"{_MOD}.subprocess.run", side_effect=fake_subprocess_run):
        run_commands("run-1", [["-m", "gtm_backend.phase1", "score"]], organization_id)
    return captured_env, get_keys


def test_org_serpapi_key_overrides_subprocess_env(monkeypatch):
    env, _ = _run({"serpapi_key": "org-serp-key", "openrouter_key": None, "openrouter_model": None}, monkeypatch=monkeypatch)
    assert env["SERP_API_KEY"] == "org-serp-key"
    assert "OPENROUTER_API_KEY" not in env


def test_org_openrouter_key_and_model_override_subprocess_env(monkeypatch):
    env, _ = _run({"serpapi_key": None, "openrouter_key": "org-or-key", "openrouter_model": "deepseek/deepseek-v4-flash"}, monkeypatch=monkeypatch)
    assert env["OPENROUTER_API_KEY"] == "org-or-key"
    assert env["OPENROUTER_MODEL"] == "deepseek/deepseek-v4-flash"
    assert "SERP_API_KEY" not in env


def test_no_org_keys_leaves_env_untouched(monkeypatch):
    env, _ = _run({"serpapi_key": None, "openrouter_key": None, "openrouter_model": None}, monkeypatch=monkeypatch)
    assert "SERP_API_KEY" not in env
    assert "OPENROUTER_API_KEY" not in env
    assert "OPENROUTER_MODEL" not in env


def test_openrouter_key_without_model_omits_model_override(monkeypatch):
    env, _ = _run({"serpapi_key": None, "openrouter_key": "org-or-key", "openrouter_model": None}, monkeypatch=monkeypatch)
    assert env["OPENROUTER_API_KEY"] == "org-or-key"
    assert "OPENROUTER_MODEL" not in env


def test_no_organization_id_skips_db_lookup_entirely(monkeypatch):
    with patch(f"{_MOD}.config.DEFAULT_ORG_ID", ""):
        _, get_keys = _run({"serpapi_key": None, "openrouter_key": None, "openrouter_model": None}, organization_id=None, monkeypatch=monkeypatch)
    get_keys.assert_not_called()
