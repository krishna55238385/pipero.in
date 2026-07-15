from __future__ import annotations
import json
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor
from gtm_backend.gtm_service.config import Config as config

import psycopg2
from psycopg2.extras import RealDictCursor
from gtm_backend.gtm_service.config import Config

def _get_db_connection():
    return psycopg2.connect(config.DATABASE_URL, cursor_factory=RealDictCursor)

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# --------------------------------------------------------------------------- #
# phase_runs
# --------------------------------------------------------------------------- #
def create_phase_run(phase: str, command: str, organization_id: str | None, icp_id: int | None, params: dict, triggered_by: str | None = None) -> str:
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO phase_runs (phase, command, organization_id, icp_id, params, status, triggered_by)
                VALUES (%s, %s, %s, %s, %s::jsonb, 'queued', %s) RETURNING id;
            """, (phase, command, organization_id, icp_id, json.dumps(params), triggered_by))
            conn.commit()
            return cur.fetchone()['id']

def update_phase_run(run_id: str, **fields: Any) -> None:
    fields["updated_at"] = _now_iso()
    set_parts = []
    values = []
    for key, value in fields.items():
        if isinstance(value, (dict, list)):
            set_parts.append(f"{key} = %s::jsonb")
            values.append(json.dumps(value))
        else:
            set_parts.append(f"{key} = %s")
            values.append(value)
    set_clause = ", ".join(set_parts)
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE phase_runs SET {set_clause} WHERE id = %s", (*values, run_id))
            conn.commit()

def append_phase_run_log(run_id: str, chunk: str, current: str) -> str:
    combined = (current + chunk)[-60000:]
    update_phase_run(run_id, logs=combined)
    return combined

def get_phase_run(run_id: str) -> dict | None:
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM phase_runs WHERE id = %s LIMIT 1", (run_id,))
            return cur.fetchone()

# --------------------------------------------------------------------------- #
# gtm_schedules
# --------------------------------------------------------------------------- #
def get_enabled_schedules() -> list[dict]:
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM gtm_schedules WHERE enabled = TRUE")
            return cur.fetchall()

def claim_schedule(schedule_id: str, run_date: str) -> bool:
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE gtm_schedules 
                SET last_run_date = %s, last_run_status = 'running', last_run_log = '', updated_at = %s
                WHERE id = %s AND (last_run_date IS NULL OR last_run_date != %s)
            """, (run_date, _now_iso(), schedule_id, run_date))
            conn.commit()
            return cur.rowcount > 0

def update_schedule(schedule_id: str, **fields: Any) -> None:
    fields["updated_at"] = _now_iso()
    set_clause = ", ".join([f"{k} = %s" for k in fields.keys()])
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE gtm_schedules SET {set_clause} WHERE id = %s", (*fields.values(), schedule_id))
            conn.commit()

# --------------------------------------------------------------------------- #
# GA4 / visitor signals
# --------------------------------------------------------------------------- #
def get_ga4_connections(organization_id: str | None = None) -> list[dict]:
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            if organization_id:
                cur.execute("SELECT * FROM ga4_connections WHERE sync_enabled = TRUE AND organization_id = %s", (organization_id,))
            else:
                cur.execute("SELECT * FROM ga4_connections WHERE sync_enabled = TRUE")
            return cur.fetchall()

_VISITOR_SIGNAL_COLUMNS = [
    "organization_id", "source", "company_name", "company_domain",
    "matched_company_id", "matched_lead_id", "dimension", "dimension_value",
    "region", "country", "channel", "sessions", "engaged_sessions", "page_views",
    "avg_engagement_seconds", "top_pages", "visitor_score", "signal_strength",
    "window_start", "window_end", "raw", "last_seen_at",
]
_VISITOR_SIGNAL_JSON_COLUMNS = {"top_pages", "raw"}
# Matches uniq_website_visitor_signals (organization_id, source,
# COALESCE(dimension_value, ''), COALESCE(window_end, '1970-01-01')) so a
# re-sync of the same GA4 window updates metrics instead of duplicating rows.
# first_seen_at is deliberately excluded from both the column list and the
# UPDATE SET below, so it keeps its now() default on first insert and is never
# overwritten on conflict.
_VISITOR_SIGNAL_UPSERT_SQL = f"""
    INSERT INTO website_visitor_signals ({", ".join(_VISITOR_SIGNAL_COLUMNS)})
    VALUES ({", ".join(f"%s::jsonb" if c in _VISITOR_SIGNAL_JSON_COLUMNS else "%s" for c in _VISITOR_SIGNAL_COLUMNS)})
    ON CONFLICT (organization_id, source, COALESCE(dimension_value, ''), COALESCE(window_end, '1970-01-01'))
    DO UPDATE SET {", ".join(f"{c} = EXCLUDED.{c}" for c in _VISITOR_SIGNAL_COLUMNS if c not in ("organization_id", "source", "dimension_value", "window_end"))}
"""


def upsert_visitor_signals(rows: list[dict]) -> int:
    if not rows:
        return 0
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            for row in rows:
                values = [
                    json.dumps(row.get(c)) if c in _VISITOR_SIGNAL_JSON_COLUMNS else row.get(c)
                    for c in _VISITOR_SIGNAL_COLUMNS
                ]
                cur.execute(_VISITOR_SIGNAL_UPSERT_SQL, values)
        conn.commit()
    return len(rows)
