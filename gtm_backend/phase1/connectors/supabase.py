import json
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor

from gtm_backend.phase1.core.config import get_settings
from gtm_backend.phase1.core.retries import retry_on_transient
from gtm_backend.phase1.core.schemas import ICP, BuyingSignal, Lead, ScoreResult, SocialListeningLead

_LOCAL_SIGNALS_PATH = Path(__file__).resolve().parent.parent / "data" / "buying_signals.jsonl"


_settings = get_settings()


def _get_connection():
    return psycopg2.connect(_settings.database_url, cursor_factory=RealDictCursor)


# Columns whose Postgres type is jsonb and therefore need an explicit
# json.dumps(...) + ::jsonb cast. Everything else — including ICP's
# industry/geography/buyer_titles/user_titles/blocker_titles, which are
# native Postgres text[] columns, not jsonb — is passed through as a plain
# parameter: psycopg2 adapts a Python list to a Postgres array automatically,
# and casting one of those to ::jsonb would insert the wrong type entirely.
_JSONB_COLUMNS = {"sources", "raw_data", "score_breakdown"}


class SupabaseError(RuntimeError):
    """Raised when a query fails against a missing/broken table.

    Keeps the same shape (`status`, `body`) the old REST-based version had so
    the 404-detection helpers below (`_is_missing_buying_signals_table`) and
    any caller's `except SupabaseError` blocks don't need to change.
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

    No-op when GTM_ORG_ID is unset (standalone use). setdefault never clobbers an
    explicit value already on the row.
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
# PostgREST-style filter/order translation
#
# Every call site in this file builds params exactly like it did against the
# old Supabase REST client (eq., is.null, not.is.null, in.(...), or=(...),
# order=col.desc, select=col1,col2, limit=N) — only these four helpers changed,
# so nothing above this line needed to change at all.
# --------------------------------------------------------------------------- #

def _parse_filter(column: str, expr: str, values: list) -> str:
    """Translate one PostgREST filter value into a SQL condition.

    Supports exactly the operators used anywhere in this file: eq., is.null,
    not.is.null, in.(...). Any parameter value is appended to `values` so the
    caller keeps everything correctly positional for psycopg2.
    """
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


def _parse_or(expr: str, values: list) -> str:
    """Translate or=(col1.is.null,col2.is.null,...) into (col1 IS NULL OR col2 IS NULL OR ...).

    Only the `is.null` operator ever appears inside an `or=` filter in this
    file (get_leads_for_enrichment), so that's all this needs to parse.
    """
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
    """Append `value` to `values` and return its SQL placeholder.

    jsonb columns (see _JSONB_COLUMNS) get json.dumps + an explicit ::jsonb
    cast; everything else — scalars, native Postgres arrays like ICP's
    industry/geography lists, None — goes through as a plain parameter and
    psycopg2 adapts it correctly on its own.
    """
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
def _delete(path: str, params: dict) -> None:
    table = _table_from_path(path)
    values: list = []
    where_clause = _build_where(params, values)
    sql = f"DELETE FROM {table} {where_clause}"
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, values)
                conn.commit()
    except pg_errors.UndefinedTable as exc:
        raise _missing_table_error("DELETE", path, exc) from exc


def insert_icp(icp: ICP, user_prompt: str) -> int:
    payload = icp.model_dump()
    payload["prompts"] = user_prompt
    payload["active"] = True
    payload["created_by"] = "phase1"
    payload["last_reviewed_at"] = _now_iso()
    rows = _post("/icp_profiles", payload)
    if not rows:
        raise RuntimeError("Supabase returned empty response after ICP insert")
    return rows[0]["id"]


def get_icp(icp_id: int) -> dict:
    rows = _get("/icp_profiles", params={"id": f"eq.{icp_id}", "limit": 1})
    if not rows:
        raise RuntimeError(f"ICP with id={icp_id} not found")
    return rows[0]


def get_active_icps() -> list[dict]:
    return _get("/icp_profiles", params={"active": "eq.true"})


def insert_leads(leads: list[Lead]) -> list[int]:
    if not leads:
        return []
    payload = []
    for lead in leads:
        row = lead.model_dump(exclude_none=False)
        row.pop("id", None)
        payload.append(row)
    rows = _post("/leads_raw", payload)
    return [row["id"] for row in rows]


def get_leads_by_icp(icp_id: int, limit: int = 500) -> list[dict]:
    return _get("/leads_raw", params={"icp_id": f"eq.{icp_id}", "limit": limit})


def get_existing_company_names(icp_id: int) -> set[str]:
    rows = _get(
        "/leads_raw",
        params={"icp_id": f"eq.{icp_id}", "select": "company_name"},
    )
    return {row["company_name"].lower() for row in rows if row.get("company_name")}


def get_existing_company_domains(icp_id: int) -> set[str]:
    """Normalized (lowercase, no www.) domains already stored for this ICP.

    Used by Agent 02 to drop rediscovered companies whose name changed slightly
    between runs but whose domain is already in the funnel.
    """
    rows = _get(
        "/leads_raw",
        params={"icp_id": f"eq.{icp_id}", "select": "company_domain"},
    )
    out: set[str] = set()
    for row in rows:
        domain = (row.get("company_domain") or "").strip().lower()
        if domain.startswith("www."):
            domain = domain[4:]
        if domain:
            out.add(domain)
    return out


def get_leads_for_scoring(
    mode: str = "unscored",
    lead_id: int | None = None,
    icp_id: int | None = None,
    limit: int = 500,
) -> list[dict]:
    params: dict = {"is_existing_customer": "eq.false", "limit": limit}
    if mode == "lead_id" and lead_id is not None:
        params["id"] = f"eq.{lead_id}"
    elif mode == "icp_id" and icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    elif mode == "unscored":
        params["scored_at"] = "is.null"
    return _get("/leads_raw", params=params)


def get_leads_for_enrichment(limit: int = 50, icp_id: int | None = None) -> list[dict]:
    """Leads that still need enrichment: any lead with a domain that is either
    missing a contact email OR missing a key firmographic (HQ city / country /
    size). The latter lets a re-run *backfill* location/size onto leads that
    already have an email — they used to be skipped as "already enriched".
    """
    params: dict = {
        "company_domain": "not.is.null",
        "or": (
            "(contact_email.is.null,"
            "company_city.is.null,"
            "company_country.is.null,"
            "company_size.is.null)"
        ),
        "limit": limit,
    }
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    return _get("/leads_raw", params=params)


def get_leads_for_signals(
    limit: int = 50, icp_id: int | None = None, exclude_cold: bool = True
) -> list[dict]:
    """Leads eligible for a signals scan.

    exclude_cold (default True, Task from 2026-08-19 SerpAPI-usage audit):
    skips leads already scored 'cold' — the daily signal-refresh scheduler
    was re-spending 2 SerpAPI calls per lead per day on leads that were
    never going anywhere, the single biggest recurring cost against the
    250/month free-tier quota. Safe to default on everywhere (not just the
    scheduler) because it's a pure no-op on a lead's very first pass through
    this agent: score_tier is NULL until Agent 03 scores it (signals run
    BEFORE scoring in the pipeline), and this filter only ever excludes a
    literal 'cold' value — a NULL tier is never excluded, so first-time
    signal detection for brand-new leads is completely unaffected. Pass
    exclude_cold=False to force a full rescan (e.g. a manual QC pass).
    Filtered in Python, not via the query DSL — the DSL has no OR combinator
    and "score_tier != cold" alone would also silently drop NULL-tier rows
    (SQL NULL comparison semantics), which is exactly the case we need to
    keep.
    """
    params: dict = {
        "company_domain": "not.is.null",
        "limit": limit,
    }
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    rows = _get("/leads_raw", params=params)
    if exclude_cold:
        rows = [r for r in rows if r.get("score_tier") != "cold"]
    return rows


def insert_signals(signals: list[BuyingSignal]) -> list[int]:
    if not signals:
        return []
    payload = []
    for sig in signals:
        row = sig.model_dump(exclude_none=False)
        row["detected_at"] = sig.detected_at.isoformat()
        row.pop("id", None)
        payload.append(row)
    try:
        rows = _post("/buying_signals", payload)
    except SupabaseError as exc:
        if _is_missing_buying_signals_table(exc):
            return _local_signals_append(payload)
        raise
    return [row["id"] for row in rows]


def delete_signals_for_lead(lead_id: int) -> None:
    """Remove all buying_signals for one lead so signals can be regenerated idempotently.

    buying_signals has no natural unique key (PK is a BIGSERIAL id), so re-running
    detection would otherwise pile up duplicate rows. Agent 04 calls this before
    reinserting a lead's freshly detected signals. Best-effort: silently ignored
    when the buying_signals table is missing (local JSONL fallback path)."""
    try:
        _delete("/buying_signals", params={"lead_id": f"eq.{lead_id}"})
    except SupabaseError as exc:
        if _is_missing_buying_signals_table(exc):
            return
        raise


def get_signals_for_lead(lead_id: int) -> list[dict]:
    try:
        return _get(
            "/buying_signals",
            params={"lead_id": f"eq.{lead_id}", "order": "detected_at.desc"},
        )
    except SupabaseError as exc:
        if _is_missing_buying_signals_table(exc):
            rows = _local_signals_read()
            return sorted(
                (row for row in rows if row.get("lead_id") == lead_id),
                key=lambda r: r.get("detected_at", ""),
                reverse=True,
            )
        raise


def get_signals_for_leads(lead_ids: list[int]) -> dict[int, list[dict]]:
    """Batch-fetch signals grouped by lead_id. Returns empty list for leads with no signals."""
    if not lead_ids:
        return {}
    in_clause = ",".join(str(lid) for lid in lead_ids)
    try:
        rows = _get(
            "/buying_signals",
            params={"lead_id": f"in.({in_clause})", "order": "detected_at.desc"},
        )
    except SupabaseError as exc:
        if _is_missing_buying_signals_table(exc):
            wanted = set(lead_ids)
            rows = [row for row in _local_signals_read() if row.get("lead_id") in wanted]
        else:
            raise
    grouped: dict[int, list[dict]] = {lid: [] for lid in lead_ids}
    for row in rows:
        grouped.setdefault(row["lead_id"], []).append(row)
    return grouped


# --- local JSONL fallback (used while buying_signals table doesn't exist) ---


def _is_missing_buying_signals_table(exc: "SupabaseError") -> bool:
    return exc.status == 404 and "buying_signals" in exc.body.lower()


def _local_signals_append(rows: list[dict]) -> list[int]:
    _LOCAL_SIGNALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = _local_signals_read()
    next_id = (max((row["id"] for row in existing), default=0) or 0) + 1
    ids: list[int] = []
    with _LOCAL_SIGNALS_PATH.open("a", encoding="utf-8") as fp:
        for row in rows:
            row = dict(row)
            row["id"] = next_id
            fp.write(json.dumps(row, default=str) + "\n")
            ids.append(next_id)
            next_id += 1
    print(f"[supabase] buying_signals table missing — appended {len(ids)} rows to {_LOCAL_SIGNALS_PATH}")
    return ids


def _local_signals_read() -> list[dict]:
    if not _LOCAL_SIGNALS_PATH.exists():
        return []
    rows = []
    with _LOCAL_SIGNALS_PATH.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def update_lead(lead_id: int, **fields) -> None:
    if not fields:
        return
    _patch("/leads_raw", params={"id": f"eq.{lead_id}"}, json_body=fields)


def update_lead_score(score: ScoreResult, llm_result: dict | None = None) -> None:
    """Persist a lead's score. ``score`` is always the deterministic
    rule-based result; when ``llm_result`` (Agent 03's LLM re-scoring
    output) is also given, icp_score/score_tier are set to the LLM's final
    judgment instead of the rule score, with the rule score preserved
    separately under rule_icp_score/rule_score_tier and the LLM's own
    reasoning/intent summary persisted alongside — previously llm_result was
    computed but only ever printed to the console, never written here at
    all, so the CRM's tier had never actually reflected it for any lead."""
    if llm_result is not None:
        payload = {
            "icp_score": llm_result["llm_icp_score"],
            "score_tier": llm_result["llm_score_tier"],
            "score_breakdown": score.score_breakdown,
            "score_reasoning": score.score_reasoning,
            "scored_at": _now_iso(),
            "score_version": score.score_version,
            "rule_icp_score": score.icp_score,
            "rule_score_tier": score.score_tier,
            "llm_reasoning": llm_result.get("llm_reasoning"),
            "buying_intent_summary": llm_result.get("buying_intent_summary"),
        }
    else:
        payload = {
            "icp_score": score.icp_score,
            "score_tier": score.score_tier,
            "score_breakdown": score.score_breakdown,
            "score_reasoning": score.score_reasoning,
            "scored_at": _now_iso(),
            "score_version": score.score_version,
        }
    _patch("/leads_raw", params={"id": f"eq.{score.lead_id}"}, json_body=payload)


def insert_llm_usage(
    agent: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    estimated_cost_usd: float,
    icp_id: int | None = None,
    phase: str | None = None,
) -> None:
    """Insert one LLM usage row. Silently ignored if table missing."""
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
                "Apply schema: python -m phase1 print-schema"
            )
        # always swallow — never break the pipeline


def get_social_listening_source_urls(icp_id: int | None) -> set[str]:
    """Existing source_urls for this ICP, so a re-run never re-inserts the same
    post twice (unique index on (icp_id, source_url) also enforces this at the
    DB level; this check just avoids a noisy constraint-violation round trip).
    """
    params: dict = {"select": "source_url"}
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    try:
        rows = _get("/social_listening_leads", params=params)
    except SupabaseError as exc:
        if exc.status == 404:
            return set()
        raise
    return {r["source_url"] for r in rows if r.get("source_url")}


def insert_social_listening_leads(rows: list[SocialListeningLead]) -> list[int]:
    """Insert new social-listening candidates. Silently skipped (not raised) if
    the table is missing, so Agent 20 never breaks a phase1 run-all — it's an
    additive/optional agent, not a required step in the pipeline yet."""
    if not rows:
        return []
    payload = []
    for row in rows:
        d = row.model_dump(exclude_none=False)
        d["discovered_at"] = row.discovered_at.isoformat()
        payload.append(d)
    try:
        inserted = _post("/social_listening_leads", payload)
    except SupabaseError as exc:
        if exc.status == 404:
            print(
                "[supabase] social_listening_leads table missing — candidates not persisted. "
                "Apply schema: python -m phase1 print-schema"
            )
            return []
        raise
    return [r["id"] for r in inserted]
