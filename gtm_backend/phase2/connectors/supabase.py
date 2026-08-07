"""Phase 2 direct-Postgres (RDS) client.

Reads from phase1 tables (icp_profiles, leads_raw, buying_signals) and
writes to five phase2 tables:
    account_intelligence
    account_stakeholders
    stakeholder_maps
    competitor_intel
    lead_competitor_usage
    market_segment_intel
    gtm_insights

Also pushes phase2 LLM usage to the shared llm_usage table.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor

from gtm_backend.phase2.core.config import get_settings
from gtm_backend.phase2.core.retries import retry_on_transient
from gtm_backend.phase2.core.schemas import (
    AccountBrief,
    Competitor,
    GTMInsight,
    LeadCompetitorUsage,
    SegmentSizing,
    Stakeholder,
    StakeholderMap,
)


_FALLBACK_DIR = Path(__file__).resolve().parent.parent / "data" / "fallbacks"


_settings = get_settings()


def _get_connection():
    return psycopg2.connect(_settings.database_url, cursor_factory=RealDictCursor)


# Columns whose Postgres type is jsonb and therefore need an explicit
# json.dumps(...) + ::jsonb cast. Unlike phase1 (icp_profiles' text[] columns),
# every structured field phase2 writes is jsonb — there are no native Postgres
# array columns anywhere in this file's tables.
_JSONB_COLUMNS = {
    # account_intelligence (Agent 06)
    "recent_moves", "likely_pain_points", "instability_flags",
    "confirmed_facts", "inferences", "key_signals_for_outreach", "sources_scanned",
    # account_stakeholders (Agent 07)
    "risk_flags",
    # stakeholder_maps (Agent 07)
    "missing_roles",
    # competitor_intel (Agent 08)
    "complaint_categories", "talk_tracks", "sources",
    # gtm_insights (Agent 10)
    "who_to_target", "what_to_say", "which_channel",
    "flags_and_contradictions", "next_actions",
}


class SupabaseError(RuntimeError):
    """Raised when a query fails against a missing/broken table.

    Keeps the same shape (`status`, `body`) the old REST-based version had so
    `_missing_table` and any caller's `except SupabaseError` blocks don't need
    to change.
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

    No-op when GTM_ORG_ID is unset; setdefault never clobbers an explicit value.
    """
    if not _ORG_ID:
        return body
    rows = body if isinstance(body, list) else [body]
    for row in rows:
        if isinstance(row, dict):
            row.setdefault("organization_id", _ORG_ID)
    return body


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table_from_path(path: str) -> str:
    return path.lstrip("/")


def _missing_table_error(method: str, path: str, exc: Exception) -> SupabaseError:
    table = _table_from_path(path)
    body = (
        f"Could not find the table '{table}' in the schema cache: {exc}\n\n"
        f"[hint] Apply the schema for this table in RDS, then retry."
    )
    return SupabaseError(method, path, 404, body)


# --------------------------------------------------------------------------- #
# PostgREST-style filter/order translation — same helpers as phase1. No `or=`
# support here: nothing in this file ever builds an `or=` filter.
# --------------------------------------------------------------------------- #

def _parse_filter(column: str, expr: str, values: list) -> str:
    if expr == "is.null":
        return f"{column} IS NULL"
    if expr == "not.is.null":
        return f"{column} IS NOT NULL"
    if expr.startswith("eq."):
        values.append(expr[len("eq."):])
        return f"{column} = %s"
    if expr.startswith("in.(") and expr.endswith(")"):
        inner = expr[len("in.("):-1]
        items = [v.strip() for v in inner.split(",") if v.strip() != ""]
        values.extend(items)
        placeholders = ", ".join(["%s"] * len(items))
        return f"{column} IN ({placeholders})"
    raise ValueError(f"Unsupported filter for column {column!r}: {expr!r}")


def _build_where(params: dict, values: list) -> str:
    conditions = [
        _parse_filter(key, expr, values)
        for key, expr in params.items()
        if key not in ("select", "order", "limit")
    ]
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
    # Every caller in this file builds each row from the same pydantic model,
    # so all rows in one call always share the same key set.
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
def _upsert(path: str, json_body: dict | list[dict], conflict_columns: list[str]) -> list[dict]:
    """INSERT ... ON CONFLICT (conflict_columns) DO UPDATE ... RETURNING *.

    Atomic replacement for the old "SELECT by key, then PATCH or POST" pattern
    every upsert_* function used to do by hand: same net effect for a single
    caller (insert if the key is new, full replace of every other column if it
    already exists), but in one round trip with no gap between the existence
    check and the write — the old two-step version had a real (if unlikely in
    this pipeline's single-writer-per-run usage) TOCTOU race where two
    concurrent calls for the same key could both see "not found" and both
    INSERT, producing a duplicate row.

    Accepts either a single dict (original single-row behavior) or a list of
    dicts (multi-row upsert in one statement — added for batched writes like
    bulk_upsert_account_briefs; every dict in the list must have the same set
    of keys, matching the phase3 _upsert's list-handling behavior)."""
    table = _table_from_path(path)
    rows_in = json_body if isinstance(json_body, list) else [json_body]
    rows_in = [_inject_org(row) for row in rows_in]
    if not rows_in:
        return []
    columns = list(rows_in[0].keys())
    col_list = ", ".join(columns)
    values: list = []
    value_groups = []
    for row in rows_in:
        placeholders = [_value_placeholder(col, row.get(col), values) for col in columns]
        value_groups.append("(" + ", ".join(placeholders) + ")")
    conflict_list = ", ".join(conflict_columns)
    update_cols = [c for c in columns if c not in conflict_columns]
    set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES {', '.join(value_groups)} "
        f"ON CONFLICT ({conflict_list}) DO UPDATE SET {set_clause} "
        f"RETURNING *"
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
    rows = _get("/icp_profiles", params={"id": f"eq.{icp_id}", "limit": 1})
    if not rows:
        raise RuntimeError(f"ICP with id={icp_id} not found")
    return rows[0]


def get_active_icps() -> list[dict]:
    return _get("/icp_profiles", params={"active": "eq.true"})


def get_leads_for_account_intel(icp_id: int | None = None, limit: int | None = None) -> list[dict]:
    """Leads that should get an account intelligence brief.

    Per the business doc, we want leads with a known domain and that aren't
    already existing customers. Pass limit=None (default) to fetch all leads.
    """
    params: dict = {
        "company_domain": "not.is.null",
        "is_existing_customer": "eq.false",
    }
    if limit is not None:
        params["limit"] = limit
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    return _get("/leads_raw", params=params)


def get_signals_for_leads(lead_ids: list[int]) -> dict[int, list[dict]]:
    if not lead_ids:
        return {}
    in_clause = ",".join(str(lid) for lid in lead_ids)
    try:
        rows = _get(
            "/buying_signals",
            params={"lead_id": f"in.({in_clause})", "order": "detected_at.desc"},
        )
    except SupabaseError:
        return {lid: [] for lid in lead_ids}
    grouped: dict[int, list[dict]] = {lid: [] for lid in lead_ids}
    for row in rows:
        grouped.setdefault(row["lead_id"], []).append(row)
    return grouped


def get_scored_lead_counts_by_icp(icp_id: int) -> dict[str, int]:
    """Aggregate lead counts (total/hot/warm/cold) for one ICP. Done client-side."""
    rows = _get(
        "/leads_raw",
        params={"icp_id": f"eq.{icp_id}", "select": "score_tier,is_existing_customer"},
    )
    total = sum(1 for r in rows if not r.get("is_existing_customer"))
    hot = sum(1 for r in rows if r.get("score_tier") == "hot")
    warm = sum(1 for r in rows if r.get("score_tier") == "warm")
    cold = sum(1 for r in rows if r.get("score_tier") == "cold")
    return {"total": total, "hot": hot, "warm": warm, "cold": cold}


# -- Account intelligence (Agent 06) --------------------------------------

def upsert_account_brief(brief: AccountBrief) -> int:
    payload = _account_brief_payload(brief)
    try:
        rows = _upsert("/account_intelligence", payload, conflict_columns=["lead_id"])
    except SupabaseError as exc:
        if _missing_table(exc, "account_intelligence"):
            return _local_fallback_append("account_intelligence", payload)
        raise
    return rows[0]["id"] if rows else 0


def bulk_upsert_account_briefs(briefs: list[AccountBrief]) -> None:
    """Batched form of upsert_account_brief — one multi-row statement for
    many briefs instead of one upsert per lead in Agent 06's main loop (same
    N+1-on-writes pattern already fixed for Agent 37's bulk_update_leads_raw)."""
    if not briefs:
        return
    payloads = [_account_brief_payload(b) for b in briefs]
    try:
        _upsert("/account_intelligence", payloads, conflict_columns=["lead_id"])
    except SupabaseError as exc:
        if _missing_table(exc, "account_intelligence"):
            for payload in payloads:
                _local_fallback_append("account_intelligence", payload)
            return
        raise


def get_account_brief(lead_id: int) -> dict | None:
    try:
        rows = _get(
            "/account_intelligence",
            params={"lead_id": f"eq.{lead_id}", "limit": 1},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "account_intelligence"):
            return _local_fallback_find("account_intelligence", "lead_id", lead_id)
        raise
    return rows[0] if rows else None


def get_account_briefs(lead_ids: list[int]) -> dict[int, dict]:
    """Batched form of get_account_brief — one query for many leads instead of
    one query per lead. Added for Agent 08's _flag_competitor_usage, which
    previously called get_account_brief() once per lead in a loop (an N+1
    query pattern — same fix already applied to get_signals_for_leads)."""
    if not lead_ids:
        return {}
    in_clause = ",".join(str(lid) for lid in lead_ids)
    try:
        rows = _get(
            "/account_intelligence",
            params={"lead_id": f"in.({in_clause})"},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "account_intelligence"):
            return {}
        raise
    # Most-recent-per-lead: keep the first row seen per lead_id (rows aren't
    # guaranteed ordered here, but account_intelligence is upserted on a
    # unique lead_id conflict target, so there's at most one row per lead
    # anyway — this just guards against that assumption ever changing).
    briefs: dict[int, dict] = {}
    for row in rows:
        briefs.setdefault(row["lead_id"], row)
    return briefs


def _account_brief_payload(brief: AccountBrief) -> dict:
    raw = brief.model_dump(mode="json")
    raw["refreshed_at"] = brief.refreshed_at.isoformat()
    return raw


# -- Stakeholders (Agent 07) ----------------------------------------------

def insert_stakeholders(stakeholders: list[Stakeholder]) -> list[int]:
    if not stakeholders:
        return []
    payload = []
    for sh in stakeholders:
        row = sh.model_dump(mode="json")
        row["detected_at"] = sh.detected_at.isoformat()
        row.pop("id", None)
        payload.append(row)
    try:
        rows = _post("/account_stakeholders", payload)
    except SupabaseError as exc:
        if _missing_table(exc, "account_stakeholders"):
            return _local_fallback_append_many("account_stakeholders", payload)
        raise
    return [row["id"] for row in rows]


def upsert_stakeholder_map(smap: StakeholderMap) -> int:
    payload = {
        "lead_id": smap.lead_id,
        "icp_id": smap.icp_id,
        "company_name": smap.company_name,
        "company_domain": smap.company_domain,
        "entry_point_full_name": smap.entry_point_full_name,
        "entry_point_role_type": smap.entry_point_role_type,
        "multi_threading_status": smap.multi_threading_status,
        "coverage_status": smap.coverage_status,
        "missing_roles": smap.missing_roles,
        "champion_budget_flag": smap.champion_budget_flag,
        "refreshed_at": smap.refreshed_at.isoformat(),
    }
    try:
        rows = _upsert("/stakeholder_maps", payload, conflict_columns=["lead_id"])
    except SupabaseError as exc:
        if _missing_table(exc, "stakeholder_maps"):
            return _local_fallback_append("stakeholder_maps", payload)
        raise
    return rows[0]["id"] if rows else 0


def get_stakeholders_for_lead(lead_id: int) -> list[dict]:
    try:
        return _get(
            "/account_stakeholders",
            params={"lead_id": f"eq.{lead_id}", "order": "rank.asc"},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "account_stakeholders"):
            return [row for row in _local_fallback_read("account_stakeholders")
                    if row.get("lead_id") == lead_id]
        raise


def get_stakeholder_map_for_lead(lead_id: int) -> dict | None:
    try:
        rows = _get(
            "/stakeholder_maps",
            params={"lead_id": f"eq.{lead_id}", "limit": 1},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "stakeholder_maps"):
            return _local_fallback_find("stakeholder_maps", "lead_id", lead_id)
        raise
    return rows[0] if rows else None


# -- Competitive intel (Agent 08) -----------------------------------------

def upsert_competitor(competitor: Competitor) -> int:
    payload = competitor.model_dump(mode="json")
    payload["refreshed_at"] = competitor.refreshed_at.isoformat()
    try:
        rows = _upsert("/competitor_intel", payload, conflict_columns=["icp_id", "competitor_name"])
    except SupabaseError as exc:
        if _missing_table(exc, "competitor_intel"):
            return _local_fallback_append("competitor_intel", payload)
        raise
    return rows[0]["id"] if rows else 0


def get_competitors_for_icp(icp_id: int) -> list[dict]:
    try:
        return _get(
            "/competitor_intel",
            params={"icp_id": f"eq.{icp_id}", "order": "threat_level.desc"},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "competitor_intel"):
            return [row for row in _local_fallback_read("competitor_intel")
                    if row.get("icp_id") == icp_id]
        raise


def delete_stale_competitors(icp_id: int, keep_names: list[str]) -> int:
    """Remove competitor_intel rows for this ICP not in the current run's set.

    Agent 08's competitor discovery is LLM-driven and can pick a different
    set of names on each re-run. upsert_competitor() only overwrites rows
    whose name matches the new set, so without this, a competitor dropped
    from one run to the next (e.g. "Salesforce Commerce Cloud" swapped for
    "Magento") would linger in the table forever. Called once per ICP after
    the current run's names are known and before/after writing new cards.
    """
    names = [n for n in keep_names if n]
    table = _table_from_path("/competitor_intel")
    values: list = [icp_id]
    if names:
        placeholders = ", ".join(["%s"] * len(names))
        values.extend(names)
        sql = (
            f"DELETE FROM {table} WHERE icp_id = %s "
            f"AND competitor_name NOT IN ({placeholders})"
        )
    else:
        sql = f"DELETE FROM {table} WHERE icp_id = %s"
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, values)
                deleted = cur.rowcount
                conn.commit()
                return deleted
    except pg_errors.UndefinedTable:
        return 0


def upsert_lead_competitor_usage(usage: LeadCompetitorUsage) -> int:
    """Insert or update a 'lead already uses competitor X' flag (by lead+name)."""
    payload = {
        "lead_id": usage.lead_id,
        "icp_id": usage.icp_id,
        "competitor_name": usage.competitor_name,
        "evidence": usage.evidence,
        "detected_at": usage.detected_at.isoformat(),
    }
    try:
        rows = _upsert("/lead_competitor_usage", payload, conflict_columns=["lead_id", "competitor_name"])
    except SupabaseError as exc:
        if _missing_table(exc, "lead_competitor_usage"):
            return _local_fallback_append("lead_competitor_usage", payload)
        raise
    return rows[0]["id"] if rows else 0


# -- Market sizing (Agent 09) ---------------------------------------------

def upsert_market_segments(segments: list[SegmentSizing]) -> list[int]:
    if not segments:
        return []
    payload = []
    for seg in segments:
        row = seg.model_dump(mode="json")
        payload.append(row)
    ids: list[int] = []
    for row in payload:
        try:
            returned = _upsert("/market_segment_intel", row, conflict_columns=["icp_id", "week_of"])
        except SupabaseError as exc:
            if _missing_table(exc, "market_segment_intel"):
                ids.append(_local_fallback_append("market_segment_intel", row))
                continue
            raise
        if returned:
            ids.append(returned[0]["id"])
    return ids


def get_market_segments(week_of: str | None = None, icp_id: int | None = None) -> list[dict]:
    params: dict = {"order": "priority_rank.asc"}
    if week_of:
        params["week_of"] = f"eq.{week_of}"
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    try:
        return _get("/market_segment_intel", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "market_segment_intel"):
            rows = _local_fallback_read("market_segment_intel")
            if week_of:
                rows = [r for r in rows if r.get("week_of") == week_of]
            if icp_id is not None:
                rows = [r for r in rows if r.get("icp_id") == icp_id]
            return rows
        raise


# -- GTM insights (Agent 10) ----------------------------------------------

def upsert_gtm_insight(insight: GTMInsight) -> int:
    payload = insight.model_dump(mode="json")
    payload["generated_at"] = insight.generated_at.isoformat()
    try:
        rows = _upsert("/gtm_insights", payload, conflict_columns=["lead_id", "brief_date"])
    except SupabaseError as exc:
        if _missing_table(exc, "gtm_insights"):
            return _local_fallback_append("gtm_insights", payload)
        raise
    return rows[0]["id"] if rows else 0


def get_gtm_insights_for_lead(lead_id: int) -> list[dict]:
    try:
        return _get(
            "/gtm_insights",
            params={"lead_id": f"eq.{lead_id}", "order": "brief_date.desc"},
        )
    except SupabaseError as exc:
        if _missing_table(exc, "gtm_insights"):
            return [row for row in _local_fallback_read("gtm_insights")
                    if row.get("lead_id") == lead_id]
        raise


def get_pending_gtm_insights(icp_id: int | None = None) -> list[dict]:
    """GTM briefs awaiting human review (review_status='pending_review')."""
    params: dict = {"review_status": "eq.pending_review", "order": "brief_date.desc"}
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    try:
        return _get("/gtm_insights", params=params)
    except SupabaseError as exc:
        if _missing_table(exc, "gtm_insights"):
            return [row for row in _local_fallback_read("gtm_insights")
                    if row.get("review_status", "pending_review") == "pending_review"]
        raise


def approve_gtm_insight(
    lead_id: int,
    brief_date: str | None = None,
    reviewed_by: str = "human",
    status: str = "approved",
) -> int:
    """Mark a lead's GTM brief approved (or rejected) — the human-review gate.

    Returns the number of rows updated. Without brief_date, applies to all of
    the lead's briefs (typically just today's).
    """
    params = {"lead_id": f"eq.{lead_id}"}
    if brief_date is not None:
        params["brief_date"] = f"eq.{brief_date}"
    payload = {
        "review_status": status,
        "reviewed_by": reviewed_by,
        "reviewed_at": _now_iso(),
    }
    try:
        rows = _patch("/gtm_insights", params=params, json_body=payload)
    except SupabaseError as exc:
        if _missing_table(exc, "gtm_insights"):
            return 0
        raise
    return len(rows)


# -- LLM usage logging ----------------------------------------------------

def insert_llm_usage(
    agent: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    estimated_cost_usd: float,
    icp_id: int | None = None,
    phase: str | None = "phase2",
) -> None:
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
                "Apply schema: python -m phase2 print-schema"
            )


# -- Local JSONL fallback (used when phase2 tables don't exist) -----------

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


def _local_fallback_find(table_name: str, key: str, value: object) -> dict | None:
    for row in _local_fallback_read(table_name):
        if row.get(key) == value:
            return row
    return None
