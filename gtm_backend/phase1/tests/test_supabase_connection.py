"""Live connectivity test for the configured Supabase instance.

Verifies that the configured SUPABASE_URL + SUPABASE_KEY can reach all
required tables. Run once after changing Supabase credentials:

    python -m pytest phase1/tests/test_supabase_connection.py -v -s

These tests make real HTTP calls — they are NOT mocked. conftest.py stubs
env vars with fake values for unit tests; we reload real credentials from
phase1/.env here before any module is imported.
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest


# Override the fake env vars set by conftest.py with real credentials.
# Must happen before any phase1 connector module is imported.
#
# Scoped to just the keys this file's own tests read (Supabase/DB connectivity
# + backend.db's usage-summary lookup) — NOT a blind copy of every .env line.
# A blind copy previously leaked unrelated keys like GMAIL_ADDRESS /
# GMAIL_APP_PASSWORD into os.environ for the rest of the pytest process,
# undoing phase3/tests/conftest.py's deliberate empty-string overrides and
# making phase3's gmail_smtp tests attempt a real SMTP send whenever phase1
# and phase3 ran in the same invocation.
_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"  # repo-root .env
_REAL_CREDENTIAL_KEYS = {"SUPABASE_URL", "SUPABASE_KEY", "DATABASE_URL", "GTM_ORG_ID"}
if _ENV_PATH.exists():
    for _line in _ENV_PATH.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            _k = _k.strip()
            if _k in _REAL_CREDENTIAL_KEYS:
                os.environ[_k] = _v.strip()


def _has_real_supabase() -> bool:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "")
    return bool(url and "supabase.co" in url and key.startswith("eyJ"))


skip_if_no_env = pytest.mark.skipif(
    not _has_real_supabase(),
    reason="Real SUPABASE_URL / SUPABASE_KEY not available",
)


@pytest.fixture(autouse=True)
def _reload_phase1_supabase_with_real_env():
    """Phase 1 unit tests (and phase2's conftest) cache supabase / config
    modules with stub URLs at import time. Drop every cached module that
    snapshots SUPABASE_URL so the next import re-reads the real env vars
    set at module top from phase1/.env.
    """
    stale = [
        name for name in list(sys.modules)
        if name.startswith("gtm_backend.phase1.connectors")
        or name.startswith("gtm_backend.phase1.core.config")
        or name.startswith("backend")
    ]
    for name in stale:
        del sys.modules[name]
    yield


@skip_if_no_env
def test_supabase_url_is_reachable() -> None:
    """Basic TCP + TLS check: the Supabase project responds."""
    import httpx
    from gtm_backend.phase1.core.config import get_settings

    s = get_settings()
    r = httpx.get(
        f"{s.supabase_url}/rest/v1/",
        headers={
            "apikey": s.supabase_key,
            "Authorization": f"Bearer {s.supabase_key}",
        },
        timeout=10,
    )
    # 200/404 = reachable; 401 = reachable too (the /rest/v1/ root rejects the
    # anon key by design — a response at all proves TCP+TLS+project are up).
    assert r.status_code in (200, 401, 404), (
        f"Unexpected status {r.status_code}: {r.text[:200]}"
    )


@skip_if_no_env
def test_icp_profiles_table_exists() -> None:
    """icp_profiles table is present and queryable."""
    from gtm_backend.phase1.connectors import supabase

    rows = supabase.get_active_icps()
    assert isinstance(rows, list)
    print(f"  icp_profiles: {len(rows)} active ICP(s) found")


@skip_if_no_env
def test_leads_raw_table_exists() -> None:
    """leads_raw table is present and queryable."""
    from gtm_backend.phase1.connectors import supabase

    rows = supabase.get_leads_for_scoring(mode="unscored", limit=1)
    assert isinstance(rows, list)
    print(f"  leads_raw: {len(rows)} unscored lead(s) found")


@skip_if_no_env
def test_buying_signals_table_exists() -> None:
    """buying_signals table is present (or falls back to local JSONL)."""
    from gtm_backend.phase1.connectors import supabase

    rows = supabase.get_signals_for_leads([])
    assert rows == {}


@skip_if_no_env
def test_llm_usage_table_exists() -> None:
    """llm_usage table is present and queryable via backend db module."""
    from backend.db import get_usage_summary

    summary = get_usage_summary()
    assert isinstance(summary, dict)
    assert "total_calls" in summary
    assert "total_cost_usd" in summary
    print(
        f"  llm_usage: {summary['total_calls']} call(s), "
        f"total cost ${summary['total_cost_usd']:.6f}"
    )


@skip_if_no_env
def test_all_tables_summary() -> None:
    """Print a quick health summary of all tables to stdout."""
    from gtm_backend.phase1.connectors import supabase
    from backend.db import get_usage_summary

    icps = supabase.get_active_icps()
    leads = supabase.get_leads_for_scoring(mode="unscored", limit=500)
    usage = get_usage_summary()

    print("\n  ── Supabase Health Check ────────────────────")
    print(f"  Active ICPs     : {len(icps)}")
    print(f"  Unscored leads  : {len(leads)}")
    print(f"  LLM calls logged: {usage['total_calls']}")
    print(f"  Total tokens    : {usage['total_tokens']}")
    print(f"  Total cost (USD): ${usage['total_cost_usd']:.6f}")
    print("  ─────────────────────────────────────────────")
