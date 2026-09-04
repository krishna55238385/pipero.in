from __future__ import annotations
import json
import os
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

def get_org_api_keys(organization_id: str | None) -> dict:
    """Decrypt and return this org's custom API keys, if any.

    Returns {"serpapi_key": str|None, "openrouter_key": str|None,
    "openrouter_model": str|None}. Missing organization_id, missing table, or
    a missing/unset API_KEY_ENCRYPTION_SECRET all resolve to "no custom keys"
    (all None) rather than raising — callers fall back to the platform's own
    default keys in that case, same as any other optional per-org override
    in this codebase. Never logs or returns the encryption secret itself.
    """
    empty = {"serpapi_key": None, "openrouter_key": None, "openrouter_model": None}
    if not organization_id:
        return empty
    secret = os.getenv("API_KEY_ENCRYPTION_SECRET")
    if not secret:
        return empty
    try:
        with _get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT provider, pgp_sym_decrypt(encrypted_key, %s) AS key, model
                    FROM organization_api_keys
                    WHERE organization_id = %s
                    """,
                    (secret, organization_id),
                )
                rows = cur.fetchall()
    except Exception:
        return empty
    result = dict(empty)
    for row in rows:
        if row.get("provider") == "serpapi":
            result["serpapi_key"] = row.get("key")
        elif row.get("provider") == "openrouter":
            result["openrouter_key"] = row.get("key")
            result["openrouter_model"] = row.get("model")
    return result


def get_active_run_for_icp(icp_id: int) -> dict | None:
    """Return the currently queued/running phase_runs row for this ICP, if any.

    Used to guard against duplicate concurrent pipeline runs for the same
    ICP — e.g. a user double-clicking "Find leads" while "Define & run ICP"
    is still mid-flight for the same ICP, which previously spawned two
    overlapping subprocess chains against the same rows. Missing table or any
    DB error resolves to "no active run" (fail open) so a guard-check outage
    never blocks legitimate runs.
    """
    if icp_id is None:
        return None
    try:
        with _get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, phase, status, started_at
                    FROM phase_runs
                    WHERE icp_id = %s AND status IN ('queued', 'running')
                    LIMIT 1
                    """,
                    (icp_id,),
                )
                return cur.fetchone()
    except Exception:
        return None


def has_existing_leads(icp_id: int) -> bool:
    """True if this ICP already has at least one row in leads_raw.

    Used by the "prepare" phase (the CRM's "Find leads" button) to decide
    whether to re-run Agent 02 lead generation: previously it always
    re-searched for companies on every click, even when the ICP already had
    leads from a prior run (e.g. the initial "define ICP" flow, which itself
    already ran the full phase1 chain once) — a real cost, not just a
    correctness no-op, since dedup only discards *after* paying for the
    SerpAPI + LLM search. Missing table = treat as "no leads yet" so the
    search still runs rather than silently skipping on a fresh install.
    """
    try:
        with _get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM leads_raw WHERE icp_id = %s) AS exists_flag",
                    (icp_id,),
                )
                row = cur.fetchone()
                return bool(row and row.get("exists_flag"))
    except Exception:
        return False

# --------------------------------------------------------------------------- #
# gtm_schedules
# --------------------------------------------------------------------------- #
def get_orgs_with_connected_mailbox() -> list[str]:
    """Every distinct organization_id with at least one connected Gmail
    mailbox — used by the scheduler's reply/meeting pipeline tick (Task #50)
    to decide which orgs actually have something to poll/draft/propose for,
    instead of the old single hardcoded-org crontab entry. An org with no
    mailbox has nothing this pipeline could do (poll-inbox needs a mailbox
    to read, draft-replies/propose-meetings need one to send from), so it's
    filtered out here rather than iterated and silently no-op'd every tick."""
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT organization_id FROM engage_mailboxes "
                "WHERE provider = 'gmail' AND organization_id IS NOT NULL"
            )
            return [row["organization_id"] for row in cur.fetchall()]


def get_orgs_with_leads() -> list[str]:
    """Every distinct organization_id with at least one lead that has a
    contact_email — used by the scheduler's Agent 37 (Data Refresh) daily
    tick (Task #6) to decide which orgs actually have something to
    re-verify. Unlike the reply/meeting pipeline tick above, this
    deliberately does NOT require a connected mailbox — Agent 37 only reads
    leads_raw and calls the free disify.verify_email() check, nothing about
    it depends on Gmail being connected. Mirrors get_leads_for_data_refresh's
    own contact_email filter (phase3/connectors/supabase.py) so an org with
    leads but no emails on any of them is correctly skipped too, same as
    that function would examine 0 leads for it anyway."""
    with _get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT organization_id FROM leads_raw "
                "WHERE contact_email IS NOT NULL AND organization_id IS NOT NULL"
            )
            return [row["organization_id"] for row in cur.fetchall()]


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
