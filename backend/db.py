"""Supabase REST client for the backend API.

Reads SUPABASE_URL and SUPABASE_KEY from environment variables (or a .env file
in the backend/ directory).
"""

import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

_SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
_SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
_GTM_ORG_ID = os.environ.get("GTM_ORG_ID", "")

_TABLE_MISSING_PHRASES = ("Could not find the table", "relation", "does not exist")


def _org_filter(params: dict) -> dict:
    """Restrict queries to the configured GTM org (matches Pipero CRM behaviour)."""
    if _GTM_ORG_ID:
        params["organization_id"] = f"eq.{_GTM_ORG_ID}"
    return params


def _make_client() -> httpx.Client:
    return httpx.Client(
        base_url=f"{_SUPABASE_URL}/rest/v1",
        headers={
            "apikey": _SUPABASE_KEY,
            "Authorization": f"Bearer {_SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "count=exact",
        },
        timeout=30.0,
    )


def _get(path: str, params: dict | None = None) -> tuple[list[dict], int | None]:
    """Returns (rows, total_count). total_count is None if not requested."""
    with _make_client() as client:
        response = client.get(path, params=params)
    if response.status_code == 404 or (
        response.status_code in (400, 404)
        and any(p in response.text for p in _TABLE_MISSING_PHRASES)
    ):
        return [], None
    response.raise_for_status()
    content_range = response.headers.get("content-range", "")
    total: int | None = None
    if "/" in content_range:
        raw_total = content_range.split("/")[-1]
        if raw_total != "*":
            try:
                total = int(raw_total)
            except ValueError:
                pass
    return response.json(), total


# ---------------------------------------------------------------------------
# Usage summary
# ---------------------------------------------------------------------------

def get_usage_summary() -> dict[str, Any]:
    rows, _ = _get("/llm_usage", params=_org_filter({"select": "*", "limit": "10000"}))

    total_calls = 0
    total_prompt = 0
    total_completion = 0
    total_tokens = 0
    total_cost = 0.0
    by_model: dict[str, dict] = defaultdict(lambda: {
        "calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
        "total_tokens": 0, "cost_usd": 0.0,
    })
    by_agent: dict[str, dict] = defaultdict(lambda: {
        "calls": 0, "total_tokens": 0, "cost_usd": 0.0,
    })
    by_phase: dict[str, dict] = defaultdict(lambda: {
        "calls": 0, "total_tokens": 0, "cost_usd": 0.0,
    })

    for row in rows:
        total_calls += 1
        pt = row.get("prompt_tokens") or 0
        ct = row.get("completion_tokens") or 0
        tt = row.get("total_tokens") or 0
        cost = float(row.get("estimated_cost_usd") or 0.0)
        model = row.get("model") or "unknown"
        agent = row.get("agent") or "unknown"
        phase = row.get("phase") or "unknown"

        total_prompt += pt
        total_completion += ct
        total_tokens += tt
        total_cost += cost

        by_model[model]["calls"] += 1
        by_model[model]["prompt_tokens"] += pt
        by_model[model]["completion_tokens"] += ct
        by_model[model]["total_tokens"] += tt
        by_model[model]["cost_usd"] += cost

        by_agent[agent]["calls"] += 1
        by_agent[agent]["total_tokens"] += tt
        by_agent[agent]["cost_usd"] += cost

        by_phase[phase]["calls"] += 1
        by_phase[phase]["total_tokens"] += tt
        by_phase[phase]["cost_usd"] += cost

    # Round floats for cleaner JSON
    for m in by_model.values():
        m["cost_usd"] = round(m["cost_usd"], 8)
    for a in by_agent.values():
        a["cost_usd"] = round(a["cost_usd"], 8)
    for p in by_phase.values():
        p["cost_usd"] = round(p["cost_usd"], 8)

    return {
        "total_calls": total_calls,
        "total_prompt_tokens": total_prompt,
        "total_completion_tokens": total_completion,
        "total_tokens": total_tokens,
        "total_cost_usd": round(total_cost, 8),
        "by_model": dict(by_model),
        "by_agent": dict(by_agent),
        "by_phase": dict(by_phase),
    }


# ---------------------------------------------------------------------------
# Usage timeline
# ---------------------------------------------------------------------------

def get_usage_timeline(days: int = 7) -> list[dict[str, Any]]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows, _ = _get(
        "/llm_usage",
        params=_org_filter({
            "select": "created_at,total_tokens,estimated_cost_usd",
            "created_at": f"gte.{cutoff}",
            "limit": "50000",
        }),
    )

    # Build a day-keyed accumulator covering the full requested range
    today = date.today()
    day_data: dict[str, dict] = {}
    for i in range(days):
        d = (today - timedelta(days=days - 1 - i)).isoformat()
        day_data[d] = {"date": d, "calls": 0, "total_tokens": 0, "cost_usd": 0.0}

    for row in rows:
        raw_ts = row.get("created_at") or ""
        try:
            day_str = raw_ts[:10]  # "YYYY-MM-DD"
        except Exception:
            continue
        if day_str not in day_data:
            continue
        day_data[day_str]["calls"] += 1
        day_data[day_str]["total_tokens"] += row.get("total_tokens") or 0
        day_data[day_str]["cost_usd"] += float(row.get("estimated_cost_usd") or 0.0)

    result = list(day_data.values())
    for entry in result:
        entry["cost_usd"] = round(entry["cost_usd"], 8)
    return result


# ---------------------------------------------------------------------------
# Raw call log (paginated)
# ---------------------------------------------------------------------------

def get_usage_calls(
    limit: int = 50,
    offset: int = 0,
    agent: str = "",
    model: str = "",
) -> dict[str, Any]:
    params: dict[str, Any] = _org_filter({
        "select": "*",
        "order": "created_at.desc",
        "limit": str(limit),
        "offset": str(offset),
    })
    if agent:
        params["agent"] = f"eq.{agent}"
    if model:
        params["model"] = f"eq.{model}"

    rows, total = _get("/llm_usage", params=params)

    # If Prefer: count=exact header wasn't honoured, fall back to len(rows)
    if total is None:
        total = len(rows)

    return {"total": total, "rows": rows}


# ---------------------------------------------------------------------------
# Usage by ICP
# ---------------------------------------------------------------------------

def get_usage_by_icp() -> list[dict[str, Any]]:
    usage_rows, _ = _get(
        "/llm_usage",
        params=_org_filter({
            "select": "icp_id,total_tokens,estimated_cost_usd",
            "limit": "50000",
        }),
    )

    # Aggregate by icp_id
    agg: dict[object, dict] = defaultdict(lambda: {
        "calls": 0, "total_tokens": 0, "cost_usd": 0.0,
    })
    for row in usage_rows:
        icp_id = row.get("icp_id")
        key = icp_id if icp_id is not None else "unknown"
        agg[key]["calls"] += 1
        agg[key]["total_tokens"] += row.get("total_tokens") or 0
        agg[key]["cost_usd"] += float(row.get("estimated_cost_usd") or 0.0)

    if not agg:
        return []

    # Fetch ICP names
    icp_ids = [i for i in agg.keys() if isinstance(i, int)]
    icp_names: dict[int, str] = {}
    if icp_ids:
        icp_ids_clause = ",".join(str(i) for i in icp_ids)
        icp_rows, _ = _get(
            "/icp_profiles",
            params={
                "select": "id,name",
                "id": f"in.({icp_ids_clause})",
            },
        )
        icp_names = {
            row["id"]: row.get("name") or f"ICP #{row['id']}"
            for row in icp_rows
        }

    result = []
    for key, stats in sorted(agg.items(), key=lambda x: x[1]["cost_usd"], reverse=True):
        if key == "unknown":
            icp_id_out = None
            icp_name_out = "Unknown"
        else:
            icp_id_out = key
            icp_name_out = icp_names.get(key, f"ICP #{key}")
        result.append(
            {
                "icp_id": icp_id_out,
                "icp_name": icp_name_out,
                "calls": stats["calls"],
                "total_tokens": stats["total_tokens"],
                "cost_usd": round(stats["cost_usd"], 8),
            }
        )
    return result


# ---------------------------------------------------------------------------
# Usage by phase
# ---------------------------------------------------------------------------

def get_usage_by_phase() -> list[dict[str, Any]]:
    # select=* avoids PostgREST 400 if the `phase` column hasn't been added
    # to llm_usage yet on this Supabase instance.
    rows, _ = _get(
        "/llm_usage",
        params=_org_filter({"select": "*", "limit": "50000"}),
    )

    agg: dict[str, dict] = defaultdict(lambda: {
        "calls": 0, "total_tokens": 0, "cost_usd": 0.0, "agents": set(),
    })
    for row in rows:
        phase = row.get("phase") or "unknown"
        agg[phase]["calls"] += 1
        agg[phase]["total_tokens"] += row.get("total_tokens") or 0
        agg[phase]["cost_usd"] += float(row.get("estimated_cost_usd") or 0.0)
        agent = row.get("agent")
        if agent:
            agg[phase]["agents"].add(agent)

    result = []
    for phase, stats in sorted(agg.items(), key=lambda x: x[1]["cost_usd"], reverse=True):
        result.append({
            "phase": phase,
            "calls": stats["calls"],
            "total_tokens": stats["total_tokens"],
            "cost_usd": round(stats["cost_usd"], 8),
            "agent_count": len(stats["agents"]),
        })
    return result


# ---------------------------------------------------------------------------
# Usage by agent
# ---------------------------------------------------------------------------

def get_usage_by_agent() -> list[dict[str, Any]]:
    # select=* keeps the endpoint working on Supabase instances where the
    # `phase` column hasn't been added yet (it'll be None and bucket as
    # 'unknown'). Switching to a narrow select silently returns 0 rows when
    # ANY column is missing because PostgREST returns 400 "column does not
    # exist" and _get treats that as a missing-table response.
    rows, _ = _get(
        "/llm_usage",
        params=_org_filter({"select": "*", "limit": "10000"}),
    )

    agg: dict[str, dict] = defaultdict(lambda: {
        "calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "cost_usd": 0.0,
        "phases": defaultdict(int),
        "models": set(),
        "last_used_at": None,
    })
    for row in rows:
        agent = row.get("agent") or "unknown"
        stats = agg[agent]
        stats["calls"] += 1
        stats["prompt_tokens"] += row.get("prompt_tokens") or 0
        stats["completion_tokens"] += row.get("completion_tokens") or 0
        stats["total_tokens"] += row.get("total_tokens") or 0
        stats["cost_usd"] += float(row.get("estimated_cost_usd") or 0.0)

        phase = row.get("phase")
        if phase:
            stats["phases"][phase] += 1

        model = row.get("model")
        if model:
            stats["models"].add(model)

        created_at = row.get("created_at")
        if created_at and (stats["last_used_at"] is None or created_at > stats["last_used_at"]):
            stats["last_used_at"] = created_at

    result = []
    for agent, stats in agg.items():
        phases = stats["phases"]
        most_common_phase = max(phases.items(), key=lambda x: x[1])[0] if phases else None
        result.append({
            "agent": agent,
            "calls": stats["calls"],
            "prompt_tokens": stats["prompt_tokens"],
            "completion_tokens": stats["completion_tokens"],
            "total_tokens": stats["total_tokens"],
            "cost_usd": round(stats["cost_usd"], 6),
            "phase": most_common_phase,
            "models": sorted(stats["models"]),
            "last_used_at": stats["last_used_at"],
        })
    result.sort(key=lambda x: x["cost_usd"], reverse=True)
    return result
