"""Agent 13 — Channel Strategy.

For each lead that already has a written outreach sequence, decide:
  - which channels to use (primary + optional secondary)
  - the order of channels per touch (channel_sequence)
  - the daily send window in the recipient's local timezone
  - the cadence (touches per week)

Business rules (from AI-GTM-Agency-Business-Architecture-A4.pdf):
- primary_channel ∈ {email, linkedin, phone} (default email if invalid).
- send_window 08:00–18:00 local. Clamped post-LLM.
- ≤ 2 touches per week per recipient. Clamped post-LLM.
- Phone is NEVER the first touch — when chosen as primary, email is forced
  as secondary and prepended to the channel_sequence so a digital touch
  always precedes a call.
"""
import json

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.prompts import CHANNEL_STRATEGY_SYSTEM
from gtm_backend.phase3.core.schemas import ChannelPlan


_VALID_CHANNELS = {"email", "linkedin", "phone"}
_DEFAULT_CHANNEL = "email"
_WINDOW_START_MIN = 8
_WINDOW_END_MAX = 18
_DEFAULT_WINDOW_START = 9
_DEFAULT_WINDOW_END = 17
_MAX_TOUCHES_PER_WEEK = 2
_DEFAULT_TOUCHES_PER_WEEK = 2

# Business decision: email is the ONLY outreach channel for now. When True,
# every touch is forced to email regardless of what the LLM suggests — so no
# lead falls through to linkedin/phone, which Agent 14 (Gmail sender) can't send
# and therefore silently skips.
_FORCE_EMAIL_ONLY = True


def run_channel_strategy(icp_id: int | None = None, limit: int | None = None) -> dict:
    """Decide channel, timing, and frequency for each lead with a sequence."""
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(f"  AGENT 13 — Channel Strategy (ICP #{icp_id}, limit={limit_label})")
    print(bar)

    sequences = supabase.get_sequences(icp_id=icp_id, limit=limit)
    print(f"  → {len(sequences)} sequences need channel plans")

    icp = _safe_get_icp(icp_id)

    written = 0
    for seq in sequences:
        plan = _build_one(seq, icp)
        if plan is None:
            continue
        supabase.upsert_channel_plan(plan)
        written += 1
        company = plan.company_name or "?"
        print(
            f"  [Agent 13] {company:<28} → primary={plan.primary_channel}, "
            f"sequence={plan.channel_sequence}"
        )

    summary = {
        "icp_id": icp_id,
        "sequences_examined": len(sequences),
        "channel_plans_written": written,
    }
    print(f"  ✓ Agent 13 complete: {written} channel plans written")
    return summary


def _build_one(seq: dict, icp: dict | None) -> ChannelPlan | None:
    """Turn one sequence row into a guardrail-checked ChannelPlan."""
    company_name = seq.get("company_name") or "?"
    intel = supabase.get_account_intel_for_lead(seq["lead_id"]) or {}

    payload = json.dumps(
        {
            "company_name": company_name,
            "contact_name": seq.get("contact_name"),
            "contact_title": seq.get("contact_title"),
            "persona": seq.get("persona") or "unknown",
            "account_intel": {
                "company_size_estimate": intel.get("company_size_estimate"),
                "what_they_do": intel.get("what_they_do"),
                "growth_trajectory": intel.get("growth_trajectory"),
            },
            "icp": {
                "industry": (icp or {}).get("industry"),
                "geography": (icp or {}).get("geography"),
            },
        },
        default=str,
    )

    try:
        raw = llm.chat_json(
            CHANNEL_STRATEGY_SYSTEM,
            payload,
            agent="agent_13_channel_strategy",
            icp_id=seq.get("icp_id"),
            phase="phase3",
        )
    except Exception as exc:
        print(f"  [Agent 13] {company_name:<28} → LLM error: {exc}")
        return None

    primary_channel = _normalise_channel(raw.get("primary_channel"), default=_DEFAULT_CHANNEL)
    secondary_channel = _normalise_optional_channel(raw.get("secondary_channel"))
    channel_sequence = _coerce_str_list(raw.get("channel_sequence"))
    start_hour = _coerce_int(raw.get("send_window_start_hour"), default=_DEFAULT_WINDOW_START)
    end_hour = _coerce_int(raw.get("send_window_end_hour"), default=_DEFAULT_WINDOW_END)
    touches = _coerce_int(raw.get("touches_per_week"), default=_DEFAULT_TOUCHES_PER_WEEK)
    timezone_name = str(raw.get("timezone") or "UTC")
    rationale = str(raw.get("rationale") or "")

    start_hour = max(_WINDOW_START_MIN, start_hour)
    end_hour = min(_WINDOW_END_MAX, end_hour)
    if end_hour <= start_hour:
        end_hour = min(_WINDOW_END_MAX, start_hour + 1)
    touches = max(1, min(_MAX_TOUCHES_PER_WEEK, touches))

    if not channel_sequence:
        channel_sequence = [primary_channel] + (
            [secondary_channel] if secondary_channel else []
        )

    if _FORCE_EMAIL_ONLY:
        primary_channel = "email"
        secondary_channel = None
        # Keep the number of touches the copywriter planned, but make them all email.
        channel_sequence = ["email" for _ in (channel_sequence or [primary_channel])]
    elif primary_channel == "phone":
        secondary_channel = "email"
        channel_sequence = ["email"] + channel_sequence

    return ChannelPlan(
        lead_id=seq["lead_id"],
        icp_id=seq.get("icp_id"),
        company_name=company_name,
        primary_channel=primary_channel,
        secondary_channel=secondary_channel,
        channel_sequence=channel_sequence,
        send_window_start_hour=start_hour,
        send_window_end_hour=end_hour,
        timezone=timezone_name,
        touches_per_week=touches,
        rationale=rationale,
    )


def _safe_get_icp(icp_id: int | None) -> dict | None:
    """Fetch an ICP row once for context; tolerate not-found gracefully."""
    if icp_id is None:
        return None
    try:
        return supabase.get_icp(icp_id)
    except Exception:
        return None


def _normalise_channel(value: object, default: str) -> str:
    """Lower-case the channel and fall back to default when invalid."""
    channel = str(value or "").strip().lower()
    return channel if channel in _VALID_CHANNELS else default


def _normalise_optional_channel(value: object) -> str | None:
    """Same as _normalise_channel but returns None for null/invalid inputs."""
    if value is None:
        return None
    channel = str(value).strip().lower()
    if channel in {"", "null", "none"}:
        return None
    return channel if channel in _VALID_CHANNELS else None


def _coerce_str_list(value: object) -> list[str]:
    """Keep only non-empty string entries, lowercased."""
    if not isinstance(value, list):
        return []
    return [str(item).strip().lower() for item in value if isinstance(item, str) and item.strip()]


def _coerce_int(value: object, default: int) -> int:
    """Best-effort int coercion that tolerates LLM string outputs."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
