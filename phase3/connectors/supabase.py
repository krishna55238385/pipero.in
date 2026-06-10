"""Phase 3 Supabase REST client.

Reads from phase1 tables (icp_profiles, leads_raw) and phase2 tables
(account_intelligence, gtm_insights), and writes to five new phase3 tables:
    outreach_personalisations
    outreach_sequences
    outreach_channel_plans
    outreach_log
    ab_test_results

Also pushes phase3 LLM usage to the shared llm_usage table.

Mirrors phase2/connectors/supabase.py exactly for structure: module-level
httpx.Client, _get/_post/_patch with @retry_on_transient(), SupabaseError,
and a local JSONL fallback under phase3/data/fallbacks/ when a phase3 table
is missing in the live database.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from phase3.core.config import get_settings
from phase3.core.retries import retry_on_transient
from phase3.core.schemas import (
    ABTestResult,
    ChannelPlan,
    OutreachLogEntry,
    OutreachSequence,
    PersonalisationResult,
)


_FALLBACK_DIR = Path(__file__).resolve().parent.parent / "data" / "fallbacks"


_settings = get_settings()
_client = httpx.Client(
    base_url=f"{_settings.supabase_url}/rest/v1",
    headers={
        "apikey": _settings.supabase_key,
        "Authorization": f"Bearer {_settings.supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    },
    timeout=30.0,
)


class SupabaseError(httpx.HTTPError):
    """Raised when Supabase REST returns a non-2xx response."""

    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        self.method = method
        self.path = path
        self.status = status
        self.body = body
        super().__init__(f"Supabase {method} {path} -> {status}: {body}")


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


def _raise_for_status(method: str, path: str, response: httpx.Response) -> None:
    if response.is_success:
        return
    body = response.text
    if response.status_code == 404 and "Could not find the table" in body:
        body += (
            "\n\n[hint] One or more phase3 tables are missing. Apply the schema via "
            "the Supabase SQL editor:\n  python -m phase3 print-schema | pbcopy   "
            "(then paste into Supabase → SQL editor → Run)\n"
            "Or copy directly: phase3/data/schema.sql"
        )
    raise SupabaseError(method, path, response.status_code, body)


@retry_on_transient()
def _get(path: str, params: dict | None = None) -> list[dict]:
    response = _client.get(path, params=params)
    _raise_for_status("GET", path, response)
    return response.json()


@retry_on_transient()
def _post(path: str, json_body: list | dict, headers: dict | None = None) -> list[dict]:
    response = _client.post(path, json=_inject_org(json_body), headers=headers)
    _raise_for_status("POST", path, response)
    return response.json() if response.content else []


@retry_on_transient()
def _patch(path: str, params: dict, json_body: dict) -> list[dict]:
    response = _client.patch(path, params=params, json=json_body)
    _raise_for_status("PATCH", path, response)
    return response.json() if response.content else []


def _upsert(path: str, json_body: list | dict, on_conflict: str) -> list[dict]:
    """PostgREST upsert: POST + Prefer: resolution=merge-duplicates on a unique key."""
    headers = {"Prefer": "resolution=merge-duplicates,return=representation"}
    full_path = f"{path}?on_conflict={on_conflict}"
    return _post(full_path, json_body, headers=headers)


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
    dicts (or None) keyed off lead_id. Done as separate fetches to keep the
    PostgREST query simple.
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
                "Apply schema: python -m phase3 print-schema"
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
    """Mirror a PostgREST upsert in the JSONL fallback.

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
