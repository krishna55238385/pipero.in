import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

from gtm_backend.phase1.core.config import get_settings
from gtm_backend.phase1.core.retries import retry_on_transient
from gtm_backend.phase1.core.schemas import ICP, BuyingSignal, Lead, ScoreResult

_LOCAL_SIGNALS_PATH = Path(__file__).resolve().parent.parent / "data" / "buying_signals.jsonl"


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
    """Raised when Supabase REST returns a non-2xx response.

    Carries the response body so callers can see *why* a 400/409 happened.
    Inherits from httpx.HTTPError so tenacity still retries transient 5xx.
    """

    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        self.method = method
        self.path = path
        self.status = status
        self.body = body
        super().__init__(f"Supabase {method} {path} -> {status}: {body}")


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


def _raise_for_status(method: str, path: str, response: httpx.Response) -> None:
    if response.is_success:
        return
    body = response.text
    if response.status_code == 404 and "Could not find the table" in body:
        body += (
            "\n\n[hint] One or more tables are missing. Apply the schema once via "
            "the Supabase SQL editor:\n  python -m phase1 print-schema | pbcopy   "
            "(then paste into Supabase → SQL editor → Run)\n"
            "Or copy directly: phase1/data/schema.sql"
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


@retry_on_transient()
def _delete(path: str, params: dict) -> None:
    response = _client.delete(path, params=params)
    _raise_for_status("DELETE", path, response)


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


def get_leads_for_signals(limit: int = 50, icp_id: int | None = None) -> list[dict]:
    params: dict = {
        "company_domain": "not.is.null",
        "limit": limit,
    }
    if icp_id is not None:
        params["icp_id"] = f"eq.{icp_id}"
    return _get("/leads_raw", params=params)


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


def update_lead_score(score: ScoreResult) -> None:
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
