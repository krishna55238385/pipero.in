"""Phase 3 RDS (direct Postgres) client.

Reads from phase1 tables (icp_profiles, leads_raw) and phase2 tables
(account_intelligence, gtm_insights), and writes to five new phase3 tables:
    outreach_personalisations
    outreach_sequences
    outreach_channel_plans
    outreach_log
    ab_test_results

Also pushes phase3 LLM usage to the shared llm_usage table.

Migrated from the Supabase REST client to direct psycopg2/RDS access,
mirroring phase1/connectors/supabase.py's migration exactly: every call site
in this codebase already builds params PostgREST-style (eq., is.null,
not.is.null, in.(...), or=(...), order=col.desc, select=col1,col2, limit=N),
so only the internals of _get/_post/_patch changed — no agent file needed to
change. The one addition phase1 didn't need is a real SQL upsert (INSERT ...
ON CONFLICT ... DO UPDATE) since several phase3 tables are upserted by a
natural key (lead_id, or campaign_id+step_number+variant_subject) rather than
just inserted.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor

from gtm_backend.phase3.core.config import get_settings
from gtm_backend.phase3.core.retries import retry_on_transient
from gtm_backend.phase3.core.schemas import (
    ABTestResult,
    ChannelPlan,
    OutreachLogEntry,
    OutreachSequence,
    PersonalisationResult,
    ReplyRecord,
)


_FALLBACK_DIR = Path(__file__).resolve().parent.parent / "data" / "fallbacks"

_settings = get_settings()


def _get_connection():
    return psycopg2.connect(_settings.database_url, cursor_factory=RealDictCursor)


# Columns whose Postgres type is jsonb and therefore need an explicit
# json.dumps(...) + ::jsonb cast (see phase3/data/schema.sql). Everything else
# is a plain scalar column — psycopg2 adapts it directly.
_JSONB_COLUMNS = {
    "angles", "steps", "channel_sequence", "deal_breakdown", "pain_points_referenced",
    "pipeline_by_stage", "top_risks", "going_well", "needs_attention",
    "cost_by_phase", "channel_breakdown", "related_lead_ids",
}


class SupabaseError(RuntimeError):
    """Raised when a query fails against a missing/broken table.

    Keeps the same shape (`status`, `body`) the old REST-based version had so
    the 404-detection helpers below (`_missing_table`) and any caller's
    `except SupabaseError` blocks don't need to change.
    """

    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        self.method = method
        self.path = path
        self.status = status
        self.body = body
        super().__init__(f"{method} {path} -> {status}: {body}")


_ORG_ID = _settings.gtm_org_id or None


def _inject_org(body: list | dict) -> list | dict:
    """Tag insert payloads with organization_id (GTM_ORG_ID) for CRM tenancy.

    No-op when GTM_ORG_ID is unset. setdefault never clobbers an explicit
    value already on the row.
    """
    if not _ORG_ID:
        return body
    rows = body if isinstance(body, list) else [body]
    for row in rows:
        if isinstance(row, dict):
            row.setdefault("organization_id", _ORG_ID)
    return body


def _scope_to_org(params: dict) -> dict:
    """Read-side counterpart to _inject_org: adds an organization_id filter
    to a _get() params dict, when GTM_ORG_ID is set and the caller hasn't
    already specified one. No-op when GTM_ORG_ID is unset.

    Added 2026-07-25 after finding several read functions (get_all_deals,
    get_active_deals, get_qualified_deals, revenue/pipeline/proposal
    readers) had NO org scoping at all — every agent using them was reading
    across every organization in the database, not just its own. Caught via
    a board report that mixed a deal from org "Dysonc" into a conversion
    rate that should have been scoped to org "MT". This mirrors an
    equality filter, same as _parse_filter's eq., so it also naturally
    excludes rows where organization_id IS NULL (old pre-tenancy rows) —
    same behavior the CRM's own getDeals() action already has.
    """
    if not _ORG_ID or "organization_id" in params:
        return params
    return {**params, "organization_id": f"eq.{_ORG_ID}"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table_from_path(path: str) -> str:
    return path.lstrip("/")


def _missing_table_error(method: str, path: str, exc: Exception) -> SupabaseError:
    table = _table_from_path(path)
    body = (
        f"Could not find the table '{table}' in the schema cache: {exc}\n\n"
        f"[hint] Apply the schema for this table in RDS "
        f"(phase3/data/schema.sql), then retry."
    )
    return SupabaseError(method, path, 404, body)


# --------------------------------------------------------------------------- #
# PostgREST-style filter/order translation
#
# Every call site in this file builds params exactly like it did against the
# old Supabase REST client (eq., is.null, not.is.null, in.(...), or=(...),
# order=col.desc, select=col1,col2, limit=N) — only these helpers, plus the
# request functions below, changed.
# --------------------------------------------------------------------------- #

def _parse_filter(column: str, expr: str, values: list) -> str:
    if expr == "is.null":
        return f"{column} IS NULL"
    if expr == "not.is.null":
        return f"{column} IS NOT NULL"
    if expr.startswith("eq."):
        values.append(expr[len("eq."):])
        return f"{column} = %s"
    if expr.startswith("gte."):
        values.append(expr[len("gte."):])
        return f"{column} >= %s"
    if expr.startswith("in.(") and expr.endswith(")"):
        inner = expr[len("in.("):-1]
        items = [v.strip() for v in inner.split(",") if v.strip() != ""]
        values.extend(items)
        placeholders = ", ".join(["%s"] * len(items))
        return f"{column} IN ({placeholders})"
    raise ValueError(f"Unsupported filter for column {column!r}: {expr!r}")


def _parse_or(expr: str, values: list) -> str:
    """Translate or=(col1.is.null,col2.is.null,...) into (col1 IS NULL OR ...)."""
    inner = expr[1:-1]  # strip outer ( )
    conditions = []
    for part in inner.split(","):
        column, _, rest = part.partition(".")
        conditions.append(_parse_filter(column, rest, values))
    return "(" + " OR ".join(conditions) + ")"


def _build_where(params: dict, values: list) -> str:
    conditions = []
    for key, expr in params.items():
        if key in ("select", "order", "limit"):
            continue
        if key == "or":
            conditions.append(_parse_or(expr, values))
        else:
            conditions.append(_parse_filter(key, expr, values))
    if not conditions:
        return ""
    return "WHERE " + " AND ".join(conditions)


def _build_order(params: dict) -> str:
    order = params.get("order")
    if not order:
        return ""
    parts = []
    for item in order.split(","):
        column, _, direction = item.partition(".")
        parts.append(f"{column} {'DESC' if direction == 'desc' else 'ASC'}")
    return "ORDER BY " + ", ".join(parts)


def _build_limit(params: dict, values: list) -> str:
    limit = params.get("limit")
    if limit is None:
        return ""
    values.append(int(limit))
    return "LIMIT %s"


def _value_placeholder(column: str, value: object, values: list) -> str:
    if column in _JSONB_COLUMNS and isinstance(value, (dict, list)):
        values.append(json.dumps(value))
        return "%s::jsonb"
    values.append(value)
    return "%s"


@retry_on_transient()
def _get(path: str, params: dict | None = None) -> list[dict]:
    table = _table_from_path(path)
    params = params or {}
    select_cols = params.get("select", "*")
    values: list = []
    where_clause = _build_where(params, values)
    order_clause = _build_order(params)
    limit_clause = _build_limit(params, values)
    sql = f"SELECT {select_cols} FROM {table} {where_clause} {order_clause} {limit_clause}".strip()
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, values)
                return [dict(row) for row in cur.fetchall()]
    except pg_errors.UndefinedTable as exc:
        raise _missing_table_error("GET", path, exc) from exc


@retry_on_transient()
def _post(path: str, json_body: list | dict) -> list[dict]:
    table = _table_from_path(path)
    json_body = _inject_org(json_body)
    rows = json_body if isinstance(json_body, list) else [json_body]
    if not rows:
        return []
    columns = list(rows[0].keys())
    col_list = ", ".join(columns)
    values: list = []
    value_groups = []
    for row in rows:
        placeholders = [_value_placeholder(col, row.get(col), values) for col in columns]
        value_groups.append("(" + ", ".join(placeholders) + ")")
    sql = f"INSERT INTO {table} ({col_list}) VALUES {', '.join(value_groups)} RETURNING *"
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, values)
                conn.commit()
                return [dict(row) for row in cur.fetchall()]
    except pg_errors.UndefinedTable as exc:
        raise _missing_table_error("POST", path, exc) from exc


@retry_on_transient()
def _patch(path: str, params: dict, json_body: dict) -> list[dict]:
    table = _table_from_path(path)
    values: list = []
    set_parts = [f"{col} = {_value_placeholder(col, val, values)}" for col, val in json_body.items()]
    set_clause = ", ".join(set_parts)
    where_clause = _build_where(params, values)
    sql = f"UPDATE {table} SET {set_clause} {where_clause} RETURNING *"
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, values)
                conn.commit()
                return [dict(row) for row in cur.fetchall()]
    except pg_errors.UndefinedTable as exc:
        raise _missing_table_error("PATCH", path, exc) from exc


@retry_on_transient()
def _upsert(path: str, json_body: list | dict, on_conflict: str) -> list[dict]:
    """SQL equivalent of the old PostgREST upsert (POST + Prefer: resolution=
    merge-duplicates): INSERT ... ON CONFLICT (key) DO UPDATE SET col = EXCLUDED.col
    for every non-key column.
    """
    table = _table_from_path(path)
    json_body = _inject_org(json_body)
    rows = json_body if isinstance(json_body, list) else [json_body]
    if not rows:
        return []
    conflict_cols = [c.strip() for c in on_conflict.split(",")]
    columns = list(rows[0].keys())
    update_cols = [c for c in columns if c not in conflict_cols]
    col_list = ", ".join(columns)
    conflict_list = ", ".join(conflict_cols)
    values: list = []
    value_groups = []
    for row in rows:
        placeholders = [_value_placeholder(col, row.get(col), values) for col in columns]
        value_groups.append("(" + ", ".join(placeholders) + ")")
    if update_cols:
        update_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
        conflict_clause = f"DO UPDATE SET {update_clause}"
    else:
        conflict_clause = "DO NOTHING"
    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES {', '.join(value_groups)} "
        f"ON CONFLICT ({conflict_list}) {conflict_clause} RETURNING *"
    )
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, values)
                conn.commit()
                return [dict(row) for row in cur.fetchall()]
    except pg_errors.UndefinedTable as exc:
        raise _missing_table_error("POST", path, exc) from exc


# -- Reads from phase1 tables ---------------------------------------------

def get_icp(icp_id: int) -> dict:
    """Fetch one ICP profile by id. Raises if not found."""
    rows = _get("/icp_profiles", params={"id": f"eq.{icp_id}", "limit": 1})
    if not rows:
        raise RuntimeError(f"ICP with id={icp_id} not found")
    return rows[0]


def get_active_icps() -> list[dict]:
    """Fetch every active ICP profile."""
    return _get("/icp_profiles", params={"active": "eq.true"})


def get_leads_for_personalisation(
    icp_id: int | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Leads that should get a personalisation pass.

    Returns lead rows where `company_domain` is set and the lead is not an
    existing customer, each enriched with `_gtm_insight` and `_account_intel`
    dicts (or None) keyed off lead_id. Done as separate fetches to keep each
    query simple.
    """
    params: dict = {
        "company_domain": "not.is.null",
        "is_existing_customer": "eq.false",
    }
    if limit is not None:
        params["limit"] = limit
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    leads = _get("/leads_raw", params=params)
    if not leads:
        return []

    lead_ids = [lead["id"] for lead in leads]
    gtm_by_lead = _fetch_latest_gtm_by_lead(lead_ids)
    intel_by_lead = _fetch_account_intel_by_lead(lead_ids)
    for lead in leads:
        lead["_gtm_insight"] = gtm_by_lead.get(lead["id"])
        lead["_account_intel"] = intel_by_lead.get(lead["id"])
    return leads


def get_account_intel_for_lead(lead_id: int) -> dict | None:
    """Fetch the account_intelligence row for a single lead, if present."""
    try:
        rows = _get(
            "/account_intelligence",
            params={"lead_id": f"eq.{lead_id}", "limit": 1},
        )
    except SupabaseError:
        return None
    return rows[0] if rows else None


def _fetch_latest_gtm_by_lead(lead_ids: list[int]) -> dict[int, dict]:
    if not lead_ids:
        return {}
    in_clause = ",".join(str(lid) for lid in lead_ids)
    try:
        rows = _get(
            "/gtm_insights",
            params={"lead_id": f"in.({in_clause})", "order": "brief_date.desc"},
        )
    except SupabaseError:
        return {}
    latest: dict[int, dict] = {}
    for row in rows:
        latest.setdefault(row["lead_id"], row)
    return latest


def _fetch_account_intel_by_lead(lead_ids: list[int]) -> dict[int, dict]:
    if not lead_ids:
        return {}
    in_clause = ",".join(str(lid) for lid in lead_ids)
    try:
        rows = _get(
            "/account_intelligence",
            params={"lead_id": f"in.({in_clause})"},
        )
    except SupabaseError:
        return {}
    by_lead: dict[int, dict] = {}
    for row in rows:
        by_lead.setdefault(row["lead_id"], row)
    return by_lead


# -- Personalisations (Agent 11) ------------------------------------------

def upsert_personalisation(p: PersonalisationResult) -> None:
    """Insert or merge one personalisation row keyed on lead_id."""
    payload = _personalisation_payload(p)
    try:
        _upsert("/outreach_personalisations", payload, on_conflict="lead_id")
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_personalisations"):
            _local_fallback_upsert("outreach_personalisations", payload, ["lead_id"])
            return
        raise


def get_personalisations_for_lead(lead_id: int) -> dict | None:
    """Fetch the personalisation row for one lead, if any."""
    try:
        rows = _get(
            "/outreach_personalisations",
            params={"lead_id": f"eq.{lead_id}", "limit": 1},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_personalisations"):
            return _local_fallback_find("outreach_personalisations", "lead_id", lead_id)
        raise
    return rows[0] if rows else None


def get_personalisations(
    icp_id: int | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Fetch personalisation rows, optionally filtered by icp_id."""
    params: dict = {"order": "refreshed_at.desc"}
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/outreach_personalisations", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_personalisations"):
            rows = _local_fallback_read("outreach_personalisations")
            if icp_id is not None:
                rows = [r for r in rows if r.get("icp_id") == icp_id]
            if limit is not None:
                rows = rows[:limit]
            return rows
        raise


def _personalisation_payload(p: PersonalisationResult) -> dict:
    return {
        "lead_id": p.lead_id,
        "icp_id": p.icp_id,
        "company_name": p.company_name,
        "contact_name": p.contact_name,
        "contact_title": p.contact_title,
        "angles": [a.model_dump() for a in p.angles],
        "quality_score": p.quality_score,
        "status": p.status,
        "held_reason": p.held_reason,
        "refreshed_at": _now_iso(),
    }


# -- Sequences (Agent 12) -------------------------------------------------

def upsert_sequence(s: OutreachSequence) -> None:
    """Insert or merge one 5-step sequence row keyed on lead_id."""
    payload = _sequence_payload(s)
    try:
        _upsert("/outreach_sequences", payload, on_conflict="lead_id")
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_sequences"):
            _local_fallback_upsert("outreach_sequences", payload, ["lead_id"])
            return
        raise


def get_sequences(
    icp_id: int | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Fetch sequence rows, optionally filtered by icp_id."""
    params: dict = {"order": "refreshed_at.desc"}
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/outreach_sequences", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_sequences"):
            rows = _local_fallback_read("outreach_sequences")
            if icp_id is not None:
                rows = [r for r in rows if r.get("icp_id") == icp_id]
            if limit is not None:
                rows = rows[:limit]
            return rows
        raise


def _sequence_payload(s: OutreachSequence) -> dict:
    return {
        "lead_id": s.lead_id,
        "icp_id": s.icp_id,
        "company_name": s.company_name,
        "contact_name": s.contact_name,
        "persona": s.persona,
        "cta": s.cta,
        "steps": [step.model_dump() for step in s.steps],
        "sequence_quality_score": s.sequence_quality_score,
        "refreshed_at": _now_iso(),
    }


# -- Channel plans (Agent 13) ---------------------------------------------

def upsert_channel_plan(c: ChannelPlan) -> None:
    """Insert or merge one channel plan row keyed on lead_id."""
    payload = _channel_plan_payload(c)
    try:
        _upsert("/outreach_channel_plans", payload, on_conflict="lead_id")
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_channel_plans"):
            _local_fallback_upsert("outreach_channel_plans", payload, ["lead_id"])
            return
        raise


def get_channel_plans(
    icp_id: int | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Fetch channel plan rows, optionally filtered by icp_id."""
    params: dict = {"order": "refreshed_at.desc"}
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/outreach_channel_plans", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_channel_plans"):
            rows = _local_fallback_read("outreach_channel_plans")
            if icp_id is not None:
                rows = [r for r in rows if r.get("icp_id") == icp_id]
            if limit is not None:
                rows = rows[:limit]
            return rows
        raise


def _channel_plan_payload(c: ChannelPlan) -> dict:
    return {
        "lead_id": c.lead_id,
        "icp_id": c.icp_id,
        "company_name": c.company_name,
        "primary_channel": c.primary_channel,
        "secondary_channel": c.secondary_channel,
        "channel_sequence": list(c.channel_sequence),
        "send_window_start_hour": c.send_window_start_hour,
        "send_window_end_hour": c.send_window_end_hour,
        "timezone": c.timezone,
        "touches_per_week": c.touches_per_week,
        "rationale": c.rationale,
        "refreshed_at": _now_iso(),
    }


# -- Outreach log (Agent 14) ----------------------------------------------

def insert_outreach_log(entries: list[OutreachLogEntry]) -> None:
    """Append outreach log rows. One per send attempt."""
    if not entries:
        return
    payload = [_outreach_log_payload(e) for e in entries]
    try:
        _post("/outreach_log", payload)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_log"):
            _local_fallback_append_many("outreach_log", payload)
            return
        raise


def get_outreach_log(campaign_id: str | None = None) -> list[dict]:
    """Fetch outreach log rows, optionally filtered by campaign_id."""
    params: dict = {"order": "created_at.desc"}
    if campaign_id is not None:
        params["campaign_id"] = f"eq.{campaign_id}"
    try:
        return _get("/outreach_log", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_log"):
            rows = _local_fallback_read("outreach_log")
            if campaign_id is not None:
                rows = [r for r in rows if r.get("campaign_id") == campaign_id]
            return rows
        raise


def _outreach_log_payload(e: OutreachLogEntry) -> dict:
    return {
        "lead_id": e.lead_id,
        "icp_id": e.icp_id,
        "company_name": e.company_name,
        "contact_email": e.contact_email,
        "campaign_id": e.campaign_id,
        "instantly_lead_id": e.instantly_lead_id,
        "channel": e.channel,
        "step_number": e.step_number,
        "variant_subject": e.variant_subject,
        "status": e.status,
        "error": e.error,
        "message_id": e.message_id,
        "thread_id": e.thread_id,
        # Stamp the actual send time so the log can answer "when was this sent?".
        # Only real sends get a timestamp; queued/skipped/dry_run/failed stay null.
        "sent_at": _now_iso() if e.status == "sent" else None,
    }


# -- A/B test results (Agent 15) ------------------------------------------

def upsert_ab_test_results(rows: list[ABTestResult]) -> None:
    """Insert or merge A/B test result rows keyed on (campaign_id, step, variant)."""
    if not rows:
        return
    payload = [_ab_result_payload(r) for r in rows]
    try:
        _upsert(
            "/ab_test_results",
            payload,
            on_conflict="campaign_id,step_number,variant_subject",
        )
    except SupabaseError as exc:
        if _missing_table(exc, "ab_test_results"):
            _local_fallback_upsert_many(
                "ab_test_results", payload, ["campaign_id", "step_number", "variant_subject"]
            )
            return
        raise


def _ab_result_payload(r: ABTestResult) -> dict:
    return {
        "campaign_id": r.campaign_id,
        "step_number": r.step_number,
        "variant_subject": r.variant_subject,
        "sent_count": r.sent_count,
        "open_count": r.open_count,
        "reply_count": r.reply_count,
        "open_rate": r.open_rate,
        "reply_rate": r.reply_rate,
        "is_winner": r.is_winner,
        "sample_size_met": r.sample_size_met,
        "is_retired": r.is_retired,
        "refreshed_at": _now_iso(),
    }


# -- Unsubscribes & opens (gmail sender + tracking server) ----------------

def get_unsubscribed_emails() -> set[str]:
    """Return the set of lower-cased emails that have unsubscribed."""
    try:
        rows = _get("/outreach_unsubscribes", params={"select": "email"})
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_unsubscribes"):
            rows = _local_fallback_read("outreach_unsubscribes")
        else:
            raise
    return {(r.get("email") or "").strip().lower() for r in rows if r.get("email")}


def record_unsubscribe(email: str, lead_id: int | None = None, campaign_id: str | None = None) -> None:
    """Upsert one unsubscribe row keyed on email. Idempotent (one-click safe)."""
    payload = {
        "email": (email or "").strip().lower(),
        "lead_id": lead_id,
        "campaign_id": campaign_id,
        "unsubscribed_at": _now_iso(),
    }
    try:
        _upsert("/outreach_unsubscribes", payload, on_conflict="email")
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_unsubscribes"):
            _local_fallback_upsert("outreach_unsubscribes", payload, ["email"])
            return
        raise


def record_open(lead_id: int, email: str, campaign_id: str | None = None) -> None:
    """Upsert one open event keyed on (lead_id, email, campaign_id).

    The unique key makes repeated pixel hits idempotent — each (lead, email,
    campaign) open is recorded once, matching the n8n "READ STATUS" dedupe.
    """
    payload = {
        "lead_id": lead_id,
        "email": (email or "").strip().lower(),
        "campaign_id": campaign_id or "",
        "opened_at": _now_iso(),
    }
    try:
        _upsert(
            "/outreach_opens",
            payload,
            on_conflict="lead_id,email,campaign_id",
        )
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_opens"):
            _local_fallback_upsert("outreach_opens", payload, ["lead_id", "email", "campaign_id"])
            return
        raise


def get_sent_lead_ids(campaign_id: str | None = None) -> set[int]:
    """lead_ids already marked status='sent' in outreach_log (for send dedupe)."""
    rows = get_outreach_log(campaign_id=campaign_id)
    return {
        row["lead_id"]
        for row in rows
        if row.get("status") == "sent" and row.get("lead_id") is not None
    }


def get_replied_lead_ids() -> set[int]:
    """lead_ids that have replied, for the Agent 14 reply-pause gate.

    Reads outreach_replies, which Phase 4's inbox/reply agent populates the
    moment a reply is detected. Returns an empty set when the table is missing
    or empty, so the gate is a harmless no-op until Phase 4 lands.
    """
    try:
        rows = _get("/outreach_replies", params={"select": "lead_id"})
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            rows = _local_fallback_read("outreach_replies")
        else:
            raise
    return {row["lead_id"] for row in rows if row.get("lead_id") is not None}


def get_recently_opened_lead_ids(within_hours: int = 24) -> set[int]:
    """lead_ids with an open event in the last `within_hours`.

    Backs the PDF rule "never send a follow-up if the previous message was
    opened in the last 24 hours". Opens are recorded by the tracking pixel into
    outreach_opens. Returns an empty set when the table is missing.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=within_hours)).isoformat()
    try:
        rows = _get(
            "/outreach_opens",
            params={"select": "lead_id,opened_at", "opened_at": f"gte.{cutoff}"},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_opens"):
            rows = [
                r for r in _local_fallback_read("outreach_opens")
                if (r.get("opened_at") or "") >= cutoff
            ]
        else:
            raise
    return {row["lead_id"] for row in rows if row.get("lead_id") is not None}


# -- LLM usage logging ----------------------------------------------------

def insert_llm_usage(
    agent: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    estimated_cost_usd: float,
    icp_id: int | None = None,
    phase: str | None = "phase3",
) -> None:
    """Append one row to the shared llm_usage table. Silent on missing table."""
    payload = {
        "agent": agent,
        "model": model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_usd": str(round(estimated_cost_usd, 6)),
        "icp_id": icp_id,
        "phase": phase,
    }
    try:
        _post("/llm_usage", payload)
    except SupabaseError as exc:
        if exc.status == 404:
            print(
                "[supabase] llm_usage table missing — usage not persisted. "
                "Apply schema: phase3/data/schema.sql"
            )


# -- Local JSONL fallback (used when phase3 tables don't exist) -----------

def _missing_table(exc: SupabaseError, table_name: str) -> bool:
    return exc.status == 404 and table_name in exc.body.lower()


def _fallback_path(table_name: str) -> Path:
    _FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
    return _FALLBACK_DIR / f"{table_name}.jsonl"


def _local_fallback_read(table_name: str) -> list[dict]:
    path = _fallback_path(table_name)
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def _local_fallback_append(table_name: str, row: dict) -> int:
    path = _fallback_path(table_name)
    existing = _local_fallback_read(table_name)
    next_id = (max((r.get("id", 0) for r in existing), default=0) or 0) + 1
    row = dict(row)
    row["id"] = next_id
    with path.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(row, default=str) + "\n")
    print(f"[supabase] {table_name} missing — appended row #{next_id} to {path}")
    return next_id


def _local_fallback_append_many(table_name: str, rows: list[dict]) -> list[int]:
    ids = []
    for row in rows:
        ids.append(_local_fallback_append(table_name, row))
    return ids


def _local_fallback_upsert(table_name: str, row: dict, key: list[str]) -> int:
    """Mirror a SQL upsert in the JSONL fallback.

    Replaces the existing row whose ``key`` columns all match (keeping its id),
    otherwise appends a new row. This keeps fallback behaviour consistent with
    the live ``on_conflict`` unique key, so re-running an agent doesn't pile up
    duplicate rows that would later collide with the table's unique index.
    """
    path = _fallback_path(table_name)
    existing = _local_fallback_read(table_name)
    merged: dict | None = None
    out: list[dict] = []
    for r in existing:
        if merged is None and all(r.get(k) == row.get(k) for k in key):
            merged = {**r, **row, "id": r.get("id")}
            out.append(merged)
        else:
            out.append(r)
    if merged is None:
        next_id = (max((r.get("id", 0) for r in out), default=0) or 0) + 1
        merged = {**row, "id": next_id}
        out.append(merged)
    with path.open("w", encoding="utf-8") as fp:
        for r in out:
            fp.write(json.dumps(r, default=str) + "\n")
    return merged["id"]


def _local_fallback_upsert_many(table_name: str, rows: list[dict], key: list[str]) -> list[int]:
    # Sequential so within-batch duplicates collapse the same way live upsert would.
    return [_local_fallback_upsert(table_name, row, key) for row in rows]


def _local_fallback_find(table_name: str, key: str, value: object) -> dict | None:
    for row in _local_fallback_read(table_name):
        if row.get(key) == value:
            return row
    return None


def get_lead_by_email(email: str) -> dict | None:
    """Look up the lead a reply's From-address belongs to.

    Case-insensitive exact match on contact_email. Returns the most recently
    created row if (unexpectedly) more than one lead shares an email.
    """
    if not email:
        return None
    try:
        rows = _get(
            "/leads_raw",
            params={"select": "id,company_name,contact_email,icp_id", "order": "created_at.desc"},
        )
    except SupabaseError:
        return None
    target = email.strip().lower()
    for row in rows:
        if (row.get("contact_email") or "").strip().lower() == target:
            return row
    return None


def get_reply_for_lead(lead_id: int, campaign_id: str = "") -> dict | None:
    """Existing outreach_replies row for this (lead, campaign), if any —
    used to keep classify_reply idempotent (a reply thread re-scanned twice
    should not create a duplicate row or reclassify)."""
    try:
        rows = _get(
            "/outreach_replies",
            params={"lead_id": f"eq.{lead_id}", "campaign_id": f"eq.{campaign_id}", "limit": 1},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            return _local_fallback_find("outreach_replies", "lead_id", lead_id)
        raise
    return rows[0] if rows else None


def insert_reply(reply: ReplyRecord) -> int | None:
    """Insert one classified reply. Returns the new row's id, or None if the
    table is missing (best-effort — Agent 16 must never crash a caller over
    a schema not being applied yet)."""
    payload = reply.model_dump(exclude_none=False)
    try:
        rows = _post("/outreach_replies", payload)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            print(
                "[supabase] outreach_replies table missing — reply not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0]["id"] if rows else None


def get_replies_needing_draft(limit: int | None = None) -> list[dict]:
    """outreach_replies rows classified but not yet drafted (response_status='pending_draft')."""
    params: dict = {"response_status": "eq.pending_draft", "order": "created_at.asc"}
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/outreach_replies", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            return []
        raise


def get_reply_by_id(reply_id: int) -> dict | None:
    try:
        rows = _get("/outreach_replies", params={"id": f"eq.{reply_id}", "limit": 1})
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            return None
        raise
    return rows[0] if rows else None


def update_reply(reply_id: int, **fields) -> None:
    """Patch arbitrary columns on one outreach_replies row (draft, status, send metadata)."""
    if not fields:
        return
    try:
        _patch("/outreach_replies", {"id": f"eq.{reply_id}"}, fields)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            return
        raise


def get_replies_needing_objection_check(limit: int | None = None) -> list[dict]:
    """Replies classified as not_now/has_question that haven't been through
    Agent 18's objection detection yet (objection_checked=false). Scoped to
    these two classifications — an 'interested' or 'wrong_person' reply
    isn't pushback, and not_interested/unknown never get a draft at all."""
    params: dict = {
        "objection_checked": "eq.false",
        "classification": "in.(not_now,has_question)",
        "order": "created_at.asc",
    }
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/outreach_replies", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            return []
        raise


# -- Agent 24 — Deal Qualification (phase4) -------------------------------
#
# NOTE: unlike everything above (which reads/writes gtm_backend's own
# leads_raw/outreach_* tables), the functions below read/write the CRM's own
# `leads` and `deals` tables — a *different* leads table (UUID id, owned by
# magnivo.ai) living on this same Postgres instance. This is intentional:
# Agent 24's job is to turn a qualified reply into something that shows up in
# the CRM pipeline the sales team actually looks at, not a phase3-only table.
# Matched by email, never by any numeric id (the two "leads" tables don't
# share a key) — and every function here is best-effort/None-returning on a
# miss rather than guessing, same conservative pattern as the rest of phase3.

def get_crm_lead_by_email(email: str) -> dict | None:
    """Look up the CRM's own `leads` row (UUID id) for a reply's From-address.
    Case-insensitive exact match. Returns None (never guesses) if no CRM lead
    has this email yet — e.g. the lead was never imported/promoted into the
    CRM's leads table."""
    if not email:
        return None
    try:
        rows = _get("/leads", params=_scope_to_org({"email": f"eq.{email.strip().lower()}", "limit": 1}))
    except SupabaseError:
        return None
    return rows[0] if rows else None


def get_deal_for_crm_lead(crm_lead_id: str) -> dict | None:
    """Most recent deal already attached to this CRM lead, if any — so
    qualifying the same lead twice updates one deal instead of creating
    duplicates."""
    try:
        rows = _get(
            "/deals",
            params=_scope_to_org({"lead_id": f"eq.{crm_lead_id}", "order": "created_at.desc", "limit": 1}),
        )
    except SupabaseError:
        return None
    return rows[0] if rows else None


def create_deal(**fields) -> dict | None:
    """Insert a new row into the CRM's `deals` table. organization_id is
    auto-tagged from GTM_ORG_ID by _post/_inject_org same as every other
    insert in this file."""
    try:
        rows = _post("/deals", fields)
    except SupabaseError as exc:
        if _missing_table(exc, "deals"):
            print("[supabase] deals table missing — cannot create deal.")
            return None
        raise
    return rows[0] if rows else None


def update_deal(deal_id: str, **fields) -> None:
    """Patch arbitrary columns on one existing CRM deal row."""
    if not fields:
        return
    try:
        _patch("/deals", {"id": f"eq.{deal_id}"}, fields)
    except SupabaseError as exc:
        if _missing_table(exc, "deals"):
            return
        raise


def get_replies_needing_qualification(limit: int | None = None) -> list[dict]:
    """outreach_replies rows classified 'interested' that haven't been run
    through Agent 24 yet (deal_qualified=false). Scoped to 'interested' only
    — the only classification that signals real buying intent worth scoring
    for a deal; everything else (not_now, has_question, wrong_person,
    not_interested, unknown) has nothing to qualify."""
    params: dict = {
        "deal_qualified": "eq.false",
        "classification": "eq.interested",
        "order": "created_at.asc",
    }
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/outreach_replies", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "outreach_replies"):
            return []
        raise


# -- Per-org seller product description (Agents 11/12/25/27) ---------------

def get_current_org_product_description() -> str | None:
    """Product description for whichever org this whole process run is
    scoped to (GTM_ORG_ID / _ORG_ID).

    Unlike Agents 25/27 (which read the CRM's multi-tenant `deals` table and
    so must look up each individual deal's own organization_id), phase3's
    leads_raw/outreach_* pipeline has no per-row organization_id at all — the
    entire pipeline run is already scoped to one client via _ORG_ID/_inject_org
    (see module docstring). So "the org running right now" is simply _ORG_ID,
    not something read off each lead. Returns None when GTM_ORG_ID is unset
    (agents fall back to their existing generic-but-honest behavior).
    """
    return get_org_product_description(_ORG_ID)


def get_org_product_description(organization_id: str | None) -> str | None:
    """Fetch the requesting client's own product_description from the CRM's
    `organizations` table. Returns None (never guesses/falls back to another
    org's value) when organization_id is missing, the org row has no
    description set, or the table/column isn't there yet — Agents 25/27 treat
    None as "stay generic," which is the safe default either way."""
    if not organization_id:
        return None
    try:
        rows = _get(
            "/organizations",
            params={"id": f"eq.{organization_id}", "select": "product_description", "limit": 1},
        )
    except SupabaseError:
        return None
    if not rows:
        return None
    value = rows[0].get("product_description")
    return value.strip() if isinstance(value, str) and value.strip() else None


# -- Agent 25 — Proposal Generation (phase4) ------------------------------

def get_qualified_deals(limit: int | None = None) -> list[dict]:
    """CRM deals Agent 24 marked 'qualified' — the only status a proposal is
    allowed to be generated for (PDF rule: unqualified deals never receive a
    proposal)."""
    params: dict = {"status": "eq.qualified", "order": "created_at.asc"}
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/deals", params=_scope_to_org(params))
    except SupabaseError:
        return []


def get_proposal_for_deal(deal_id: str) -> dict | None:
    """Existing deal_proposals row for this deal, if any — keeps proposal
    generation idempotent (a qualified deal re-scanned twice doesn't get a
    duplicate proposal)."""
    try:
        rows = _get("/deal_proposals", params={"deal_id": f"eq.{deal_id}", "limit": 1})
    except SupabaseError as exc:
        if _missing_table(exc, "deal_proposals"):
            return None
        raise
    return rows[0] if rows else None


def create_deal_proposal(**fields) -> dict | None:
    """Insert one deal_proposals row. Always status='draft' at creation —
    Agent 25 never marks a proposal 'approved'/'sent' itself, matching Agent
    17's same human-review-first pattern."""
    try:
        rows = _post("/deal_proposals", fields)
    except SupabaseError as exc:
        if _missing_table(exc, "deal_proposals"):
            print(
                "[supabase] deal_proposals table missing — proposal not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0] if rows else None


# -- Agent 26 — Proposal Follow-up (phase4) --------------------------------

def get_sent_proposals(limit: int | None = None) -> list[dict]:
    """deal_proposals rows a human has marked status='sent' — the only status
    Agent 26 acts on (a 'draft'/'held' proposal was never sent, nothing to
    follow up on; PDF rule: follow-up timing is measured from send time)."""
    params: dict = {"status": "eq.sent", "order": "sent_at.asc"}
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/deal_proposals", params=_scope_to_org(params))
    except SupabaseError as exc:
        if _missing_table(exc, "deal_proposals"):
            return []
        raise


def update_deal_proposal(proposal_id: int, **fields) -> None:
    """Patch arbitrary columns on one deal_proposals row (follow-up draft,
    engagement counters, alert flag)."""
    if not fields:
        return
    try:
        _patch("/deal_proposals", {"id": f"eq.{proposal_id}"}, fields)
    except SupabaseError as exc:
        if _missing_table(exc, "deal_proposals"):
            return
        raise


# -- Agent 27 — Executive Engagement (phase4) ------------------------------

def get_brief_for_deal(deal_id: str) -> dict | None:
    """Existing executive_briefs row for this deal, if any — keeps brief
    generation idempotent."""
    try:
        rows = _get("/executive_briefs", params={"deal_id": f"eq.{deal_id}", "limit": 1})
    except SupabaseError as exc:
        if _missing_table(exc, "executive_briefs"):
            return None
        raise
    return rows[0] if rows else None


def create_executive_brief(**fields) -> dict | None:
    """Insert one executive_briefs row. Always draft/held — never sent
    automatically, same human-review-first pattern as every messaging agent
    this session."""
    try:
        rows = _post("/executive_briefs", fields)
    except SupabaseError as exc:
        if _missing_table(exc, "executive_briefs"):
            print(
                "[supabase] executive_briefs table missing — brief not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0] if rows else None


# -- Agent 32 — CRM Sync (phase4) ------------------------------------------

def get_all_crm_leads() -> list[dict]:
    """Every CRM lead row (org-scoped) — used to detect duplicate contacts.
    Unlike get_crm_lead_by_email (an exact-match lookup for one email), this
    pulls the full set so the agent can group by normalized email itself."""
    try:
        return _get("/leads", params=_scope_to_org({"order": "created_at.asc"}))
    except SupabaseError:
        return []


def upsert_crm_sync_flag(**fields) -> dict | None:
    """Insert or refresh one crm_sync_flags row, keyed on (flag_type,
    dedupe_key) — a re-run refreshes an existing flag (detected_at, details)
    rather than piling up duplicate rows for the same issue. Never touches
    resolved_at/resolved_note on conflict, so a human's resolution isn't
    silently wiped by the next scheduled run re-detecting the same issue
    before the underlying data is actually fixed."""
    try:
        rows = _upsert("/crm_sync_flags", fields, on_conflict="flag_type,dedupe_key")
    except SupabaseError as exc:
        if _missing_table(exc, "crm_sync_flags"):
            print(
                "[supabase] crm_sync_flags table missing — flag not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0] if rows else None


def get_unresolved_crm_sync_flags(flag_type: str | None = None) -> list[dict]:
    """Currently-open flags (resolved_at IS NULL), optionally filtered to one
    flag_type — what a human/ops dashboard would actually want to see."""
    params: dict = {"resolved_at": "is.null", "order": "detected_at.desc"}
    if flag_type is not None:
        params["flag_type"] = f"eq.{flag_type}"
    try:
        return _get("/crm_sync_flags", params=_scope_to_org(params))
    except SupabaseError as exc:
        if _missing_table(exc, "crm_sync_flags"):
            return []
        raise


# -- Agent 33 — Pipeline Management (phase4) -------------------------------

_CLOSED_STATUSES = {"won", "lost", "closed_won", "closed_lost"}


def get_active_deals(limit: int | None = None) -> list[dict]:
    """Every CRM deal not already closed — Agent 33 reviews the whole live
    pipeline, not just 'qualified' ones (unlike Agents 25/27, which are
    scoped to the qualified stage specifically).

    Filters closed statuses out in Python (not in the SQL WHERE), so `limit`
    is applied AFTER filtering — otherwise a SQL-level LIMIT could return a
    page that's mostly closed deals and silently hand back fewer active ones
    than the caller asked for.
    """
    try:
        rows = _get("/deals", params=_scope_to_org({"order": "created_at.asc"}))
    except SupabaseError:
        return []
    active = [r for r in rows if (r.get("status") or "").lower() not in _CLOSED_STATUSES]
    return active[:limit] if limit is not None else active


def upsert_pipeline_status(**fields) -> dict | None:
    """Insert or refresh the one pipeline_status row for a deal (natural key:
    deal_id) — a live snapshot, re-upserted every review run rather than
    accumulating a new row per review."""
    try:
        rows = _upsert("/pipeline_status", fields, on_conflict="deal_id")
    except SupabaseError as exc:
        if _missing_table(exc, "pipeline_status"):
            print(
                "[supabase] pipeline_status table missing — status not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0] if rows else None


# -- Agent 34 — Revenue Forecasting (phase4) -------------------------------

def create_revenue_forecast(**fields) -> dict | None:
    """Insert one revenue_forecasts snapshot row. Append-only (see schema.sql
    comment) — every run adds a new row rather than overwriting, so forecast
    accuracy can be tracked over time against actuals later."""
    try:
        rows = _post("/revenue_forecasts", fields)
    except SupabaseError as exc:
        if _missing_table(exc, "revenue_forecasts"):
            print(
                "[supabase] revenue_forecasts table missing — forecast not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0] if rows else None


# -- Agent 35 — Board Reporting (phase4) -----------------------------------

def get_all_deals() -> list[dict]:
    """Every CRM deal, open or closed — needed for conversion-rate math
    (won / (won + lost)), unlike get_active_deals() which deliberately
    excludes closed deals for pipeline-review purposes."""
    try:
        return _get("/deals", params=_scope_to_org({"order": "created_at.asc"}))
    except SupabaseError:
        return []


def get_recent_revenue_forecasts(limit: int = 2) -> list[dict]:
    """Most recent forecast snapshots, newest first — used to compute the
    period-over-period delta the PDF requires (current vs. previous run)."""
    try:
        return _get("/revenue_forecasts", params=_scope_to_org({"order": "generated_at.desc", "limit": limit}))
    except SupabaseError as exc:
        if _missing_table(exc, "revenue_forecasts"):
            return []
        raise


def get_at_risk_pipeline_status(limit: int | None = None) -> list[dict]:
    """Latest pipeline_status rows flagged at_risk or stuck — the 'top
    risks' input for the board report. pipeline_status is one row per deal
    (upserted), so this is already deduplicated to the current state."""
    params: dict = {"risk_level": "in.(at_risk,stuck)", "order": "reviewed_at.desc"}
    if limit is not None:
        params["limit"] = limit
    try:
        return _get("/pipeline_status", params=_scope_to_org(params))
    except SupabaseError as exc:
        if _missing_table(exc, "pipeline_status"):
            return []
        raise


# -- Agent 36 — ROI Attribution (phase4) -----------------------------------

def get_llm_cost_by_phase() -> dict[str, float]:
    """Total estimated_cost_usd from the shared llm_usage table, grouped by
    phase — the real cost basis for cost-per-lead/deal math. Not org-scoped:
    llm_usage has no organization_id (it's a phase1-4 shared table keyed by
    agent/phase, not by CRM tenant), same reason leads_raw has none — the
    whole backend process runs scoped to one org via GTM_ORG_ID already."""
    try:
        rows = _get("/llm_usage", params={"select": "phase, estimated_cost_usd"})
    except SupabaseError:
        return {}
    totals: dict[str, float] = {}
    for row in rows:
        phase = row.get("phase") or "unknown"
        try:
            cost = float(row.get("estimated_cost_usd") or 0)
        except (TypeError, ValueError):
            cost = 0.0
        totals[phase] = totals.get(phase, 0.0) + cost
    return totals


def get_lead_count() -> int:
    """Total rows in leads_raw — the denominator for cost-per-lead. Counts
    every lead ever generated, not scoped to a time window (matches the
    all-time approach Agent 35 already uses for conversion_rate)."""
    try:
        rows = _get("/leads_raw", params={"select": "id"})
    except SupabaseError:
        return 0
    return len(rows)


def create_roi_attribution_snapshot(**fields) -> dict | None:
    """Insert one roi_attribution_snapshots row. Append-only, same reasoning
    as revenue_forecasts/board_reports — trend over time is the point."""
    try:
        rows = _post("/roi_attribution_snapshots", fields)
    except SupabaseError as exc:
        if _missing_table(exc, "roi_attribution_snapshots"):
            print(
                "[supabase] roi_attribution_snapshots table missing — snapshot not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0] if rows else None


def get_recent_roi_attribution_snapshots(limit: int = 2) -> list[dict]:
    """Most recent ROI snapshots, newest first — lets Agent 36 note whether
    a negative-ROI flag is a one-off or consistent across runs (PDF rule:
    'if a channel is consistently showing negative ROI, it must be flagged')."""
    try:
        return _get(
            "/roi_attribution_snapshots",
            params=_scope_to_org({"order": "generated_at.desc", "limit": limit}),
        )
    except SupabaseError as exc:
        if _missing_table(exc, "roi_attribution_snapshots"):
            return []
        raise


def create_board_report(**fields) -> dict | None:
    """Insert one board_reports snapshot row. Append-only, same reasoning as
    revenue_forecasts — each report is a point-in-time record, not something
    to overwrite."""
    try:
        rows = _post("/board_reports", fields)
    except SupabaseError as exc:
        if _missing_table(exc, "board_reports"):
            print(
                "[supabase] board_reports table missing — report not persisted. "
                "Apply schema: python -m phase3 print-schema"
            )
            return None
        raise
    return rows[0] if rows else None
