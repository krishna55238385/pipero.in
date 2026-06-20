"""Phase 2 Supabase REST client.

Reads from phase1 tables (icp_profiles, leads_raw, buying_signals) and
writes to four new phase2 tables:
    account_intelligence
    account_stakeholders
    competitor_intel
    market_segment_intel
    gtm_insights

Also pushes phase2 LLM usage to the shared llm_usage table.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

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
            "\n\n[hint] One or more phase2 tables are missing. Apply the schema via "
            "the Supabase SQL editor:\n  python -m phase2 print-schema | pbcopy   "
            "(then paste into Supabase → SQL editor → Run)\n"
            "Or copy directly: phase2/data/schema.sql"
        )
    raise SupabaseError(method, path, response.status_code, body)


@retry_on_transient()
def _get(path: str, params: dict | None = None) -> list[dict]:
    response = _client.get(path, params=params)
    _raise_for_status("GET", path, response)
    return response.json()


@retry_on_transient()
def _post(path: str, json_body: list | dict) -> list[dict]:
    response = _client.post(path, json=_inject_org(json_body))
    _raise_for_status("POST", path, response)
    return response.json()


@retry_on_transient()
def _patch(path: str, params: dict, json_body: dict) -> list[dict]:
    response = _client.patch(path, params=params, json=json_body)
    _raise_for_status("PATCH", path, response)
    return response.json()


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
    existing = _get(
        "/account_intelligence",
        params={"lead_id": f"eq.{brief.lead_id}", "limit": 1, "select": "id"},
    )
    try:
        if existing:
            rows = _patch(
                "/account_intelligence",
                params={"lead_id": f"eq.{brief.lead_id}"},
                json_body=payload,
            )
        else:
            rows = _post("/account_intelligence", payload)
    except SupabaseError as exc:
        if _missing_table(exc, "account_intelligence"):
            return _local_fallback_append("account_intelligence", payload)
        raise
    return rows[0]["id"] if rows else 0


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
    existing = _get(
        "/stakeholder_maps",
        params={"lead_id": f"eq.{smap.lead_id}", "limit": 1, "select": "id"},
    )
    try:
        if existing:
            rows = _patch(
                "/stakeholder_maps",
                params={"lead_id": f"eq.{smap.lead_id}"},
                json_body=payload,
            )
        else:
            rows = _post("/stakeholder_maps", payload)
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
    existing = _get(
        "/competitor_intel",
        params={
            "icp_id": f"eq.{competitor.icp_id}",
            "competitor_name": f"eq.{competitor.competitor_name}",
            "limit": 1,
            "select": "id",
        },
    )
    try:
        if existing:
            rows = _patch(
                "/competitor_intel",
                params={
                    "icp_id": f"eq.{competitor.icp_id}",
                    "competitor_name": f"eq.{competitor.competitor_name}",
                },
                json_body=payload,
            )
        else:
            rows = _post("/competitor_intel", payload)
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


def upsert_lead_competitor_usage(usage: LeadCompetitorUsage) -> int:
    """Insert or update a 'lead already uses competitor X' flag (by lead+name)."""
    payload = {
        "lead_id": usage.lead_id,
        "icp_id": usage.icp_id,
        "competitor_name": usage.competitor_name,
        "evidence": usage.evidence,
        "detected_at": usage.detected_at.isoformat(),
    }
    existing = _get(
        "/lead_competitor_usage",
        params={
            "lead_id": f"eq.{usage.lead_id}",
            "competitor_name": f"eq.{usage.competitor_name}",
            "limit": 1,
            "select": "id",
        },
    )
    try:
        if existing:
            rows = _patch(
                "/lead_competitor_usage",
                params={
                    "lead_id": f"eq.{usage.lead_id}",
                    "competitor_name": f"eq.{usage.competitor_name}",
                },
                json_body=payload,
            )
        else:
            rows = _post("/lead_competitor_usage", payload)
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
        existing = _get(
            "/market_segment_intel",
            params={
                "icp_id": f"eq.{row['icp_id']}",
                "week_of": f"eq.{row['week_of']}",
                "limit": 1,
                "select": "id",
            },
        )
        try:
            if existing:
                returned = _patch(
                    "/market_segment_intel",
                    params={
                        "icp_id": f"eq.{row['icp_id']}",
                        "week_of": f"eq.{row['week_of']}",
                    },
                    json_body=row,
                )
            else:
                returned = _post("/market_segment_intel", row)
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
    existing = _get(
        "/gtm_insights",
        params={
            "lead_id": f"eq.{insight.lead_id}",
            "brief_date": f"eq.{insight.brief_date}",
            "limit": 1,
            "select": "id",
        },
    )
    try:
        if existing:
            rows = _patch(
                "/gtm_insights",
                params={
                    "lead_id": f"eq.{insight.lead_id}",
                    "brief_date": f"eq.{insight.brief_date}",
                },
                json_body=payload,
            )
        else:
            rows = _post("/gtm_insights", payload)
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
