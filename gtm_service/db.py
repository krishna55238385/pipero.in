"""Supabase REST helper for the trigger service (phase_runs + GA4 signals).

Uses the service-role key so it can write regardless of RLS. Kept dependency-light
(httpx only) to match the phase connectors.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from gtm_service.config import config


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client() -> httpx.Client:
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL / service key not configured")
    return httpx.Client(
        base_url=f"{config.SUPABASE_URL}/rest/v1",
        headers={
            "apikey": config.SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {config.SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        timeout=30.0,
    )


# --------------------------------------------------------------------------- #
# phase_runs
# --------------------------------------------------------------------------- #
def create_phase_run(
    phase: str,
    command: str,
    organization_id: str | None,
    icp_id: int | None,
    params: dict,
    triggered_by: str | None = None,
) -> str:
    with _client() as c:
        row = {
            "phase": phase,
            "command": command,
            "organization_id": organization_id or None,
            "icp_id": icp_id,
            "params": params,
            "status": "queued",
            "logs": "",
            "triggered_by": triggered_by,
        }
        resp = c.post("/phase_runs", json=row)
        resp.raise_for_status()
        return resp.json()[0]["id"]


def update_phase_run(run_id: str, **fields: Any) -> None:
    fields["updated_at"] = _now_iso()
    with _client() as c:
        resp = c.patch(
            "/phase_runs",
            params={"id": f"eq.{run_id}"},
            json=fields,
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()


def append_phase_run_log(run_id: str, chunk: str, current: str) -> str:
    """Append a chunk to a run's logs (caller tracks the running buffer)."""
    combined = (current + chunk)[-60000:]  # cap stored log size
    update_phase_run(run_id, logs=combined)
    return combined


def get_phase_run(run_id: str) -> dict | None:
    with _client() as c:
        resp = c.get("/phase_runs", params={"id": f"eq.{run_id}", "limit": 1})
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None


# --------------------------------------------------------------------------- #
# gtm_schedules (daily automation)
# --------------------------------------------------------------------------- #
def get_enabled_schedules() -> list[dict]:
    with _client() as c:
        resp = c.get("/gtm_schedules", params={"enabled": "eq.true"})
        resp.raise_for_status()
        return resp.json()


def claim_schedule(schedule_id: str, run_date: str) -> bool:
    """Atomically claim a due schedule for `run_date`.

    The PATCH filter only matches when last_run_date is still a *different*
    day, so two concurrent ticks (or two service instances) can't both run the
    same schedule: PostgREST returns the updated rows, and an empty list means
    someone else claimed it first.
    """
    with _client() as c:
        resp = c.patch(
            "/gtm_schedules",
            params={
                "id": f"eq.{schedule_id}",
                "or": f"(last_run_date.is.null,last_run_date.neq.{run_date})",
            },
            json={
                "last_run_date": run_date,
                "last_run_status": "running",
                "last_run_log": "",
                "updated_at": _now_iso(),
            },
        )
        resp.raise_for_status()
        return bool(resp.json())


def update_schedule(schedule_id: str, **fields: Any) -> None:
    fields["updated_at"] = _now_iso()
    with _client() as c:
        resp = c.patch(
            "/gtm_schedules",
            params={"id": f"eq.{schedule_id}"},
            json=fields,
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()


# --------------------------------------------------------------------------- #
# GA4 / visitor signals
# --------------------------------------------------------------------------- #
def get_ga4_connections(organization_id: str | None = None) -> list[dict]:
    params = {"sync_enabled": "eq.true"}
    if organization_id:
        params["organization_id"] = f"eq.{organization_id}"
    with _client() as c:
        resp = c.get("/ga4_connections", params=params)
        resp.raise_for_status()
        return resp.json()


def upsert_visitor_signals(rows: list[dict]) -> int:
    if not rows:
        return 0
    with _client() as c:
        resp = c.post(
            "/website_visitor_signals",
            json=rows,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        resp.raise_for_status()
        return len(rows)


def match_company_by_domain(organization_id: str, domain: str) -> dict | None:
    """Find a CRM company (and any linked leads_raw row) by domain/website."""
    if not domain:
        return None
    like = f"*{domain}*"
    with _client() as c:
        resp = c.get(
            "/companies",
            params={
                "organization_id": f"eq.{organization_id}",
                "or": f"(domain.ilike.{like},website.ilike.{like})",
                "limit": 1,
            },
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None


def find_leads_raw_by_domain(organization_id: str, domain: str) -> int | None:
    if not domain:
        return None
    like = f"*{domain}*"
    with _client() as c:
        resp = c.get(
            "/leads_raw",
            params={
                "organization_id": f"eq.{organization_id}",
                "company_domain": f"ilike.{like}",
                "select": "id",
                "limit": 1,
            },
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0]["id"] if rows else None


def insert_website_buying_signal(
    organization_id: str, lead_id: int, summary: str, source_url: str, weight: int
) -> None:
    """Mirror a strong website visit into buying_signals (type website_visit)."""
    row = {
        "organization_id": organization_id,
        "lead_id": lead_id,
        "signal_type": "website_visit",
        "weight": max(1, min(10, weight)),
        "signal_summary": summary,
        "signal_source_url": source_url,
        "buying_intent": "high" if weight >= 6 else "low",
        "detected_at": _now_iso(),
    }
    with _client() as c:
        resp = c.post(
            "/buying_signals", json=row, headers={"Prefer": "return=minimal"}
        )
        resp.raise_for_status()


def update_ga4_connection(conn_id: str, **fields: Any) -> None:
    fields["updated_at"] = _now_iso()
    with _client() as c:
        resp = c.patch(
            "/ga4_connections",
            params={"id": f"eq.{conn_id}"},
            json=fields,
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()
