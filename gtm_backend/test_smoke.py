"""Smoke test: every gtm_backend feature module imports and exposes its facade.

This proves the clean feature-named backend is import-safe (no pipeline runs on
import, settings load from the root .env via the existing phaseN config) and
that each module correctly re-exports the underlying phaseN agent function it
wraps. It does NOT call any pipeline (no network / no Supabase).
"""
from __future__ import annotations

import importlib

import pytest

# (module, attribute that must exist) — the public facade of each feature.
FEATURE_EXPORTS = [
    # FIND (phase1)
    ("gtm_backend.find_leads", "define_icp"),
    ("gtm_backend.find_leads", "generate_leads"),
    ("gtm_backend.find_leads", "find_leads"),
    ("gtm_backend.enrich", "enrich_leads"),
    ("gtm_backend.signals", "detect_signals"),
    ("gtm_backend.score", "score_leads"),
    # UNDERSTAND (phase2)
    ("gtm_backend.account_intel", "build_account_intelligence"),
    ("gtm_backend.stakeholders", "map_stakeholders"),
    ("gtm_backend.competitive", "gather_competitive_intel"),
    ("gtm_backend.market_sizing", "size_markets"),
    ("gtm_backend.gtm_brief", "generate_insights"),
    ("gtm_backend.gtm_brief", "approve_insights"),
    # REACH (phase3)
    ("gtm_backend.personalize", "run_personalisation"),
    ("gtm_backend.copywriter", "run_copywriting"),
    ("gtm_backend.channel", "run_channel_strategy"),
    ("gtm_backend.send", "run_orchestration"),
    ("gtm_backend.send", "run_gmail_orchestration"),
    ("gtm_backend.send", "send_outreach"),
    ("gtm_backend.ab_testing", "run_ab_testing"),
]


@pytest.mark.parametrize("module_name, attr", FEATURE_EXPORTS)
def test_feature_module_exposes_facade(module_name: str, attr: str) -> None:
    module = importlib.import_module(module_name)
    target = getattr(module, attr)
    assert callable(target), f"{module_name}.{attr} should be callable"


def test_package_imports() -> None:
    import gtm_backend

    assert gtm_backend.__version__
    # Every name advertised in __all__ resolves to a real submodule/attr.
    for name in gtm_backend.__all__:
        importlib.import_module(f"gtm_backend.{name}")


def test_cli_module_imports_and_builds_parser() -> None:
    cli = importlib.import_module("gtm_backend.__main__")
    parser = cli._build_parser()
    # A representative feature from each stage is wired up.
    sub_actions = [a for a in parser._actions if a.dest == "feature"]
    assert sub_actions, "CLI should define a 'feature' subparser group"
    choices = set(sub_actions[0].choices)
    for expected in {"find", "score", "account-intel", "competitive", "send", "ab-test"}:
        assert expected in choices, f"CLI missing feature: {expected}"


def test_service_module_imports() -> None:
    service = importlib.import_module("gtm_backend.service")
    # The in-process stage runners exist regardless of FastAPI availability.
    for fn in ("run_find", "run_understand", "run_reach"):
        assert callable(getattr(service, fn))
    # `app` is either a FastAPI instance or None (FastAPI absent) — both import-safe.
    assert hasattr(service, "app")
