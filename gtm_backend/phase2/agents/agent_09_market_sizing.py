"""Agent 09 — Market Sizing.

For each active ICP segment, aggregate this week's lead counts from
phase1's leads_raw, then ask the LLM to produce a TAM/SAM/SOM estimate,
competition density read, seasonal fit and a priority rank.

Business rules enforced (from architecture PDF):
- Calculated bottom-up from actual lead counts in our DB.
- Separates TAM / SAM / SOM.
- Flags segments with < 100 qualified leads as too_small.
- Factors in seasonal buying patterns (encoded in the prompt).
- Skips the whole run if total leads across segments < 5.
- Runs on a WEEKLY cadence, not per-invocation (PDF: "market sizing is
  recomputed weekly"). This agent is called from service.py's run_understand()
  which itself runs per single-ICP live pipeline requests (e.g. every time a
  user clicks "AI search" for one ICP in the CRM) — without a freshness gate,
  every single one of those per-ICP requests was firing a full LLM call
  scanning ALL active ICPs system-wide (one real deployment saw 27 ICPs /
  306 leads scanned per call), which is what actually exhausted the daily
  Groq token quota fastest during testing, not any one agent's per-call size.
  Fixed by skipping the LLM call entirely (cheap, zero-token DB read only) if
  a market_segment_intel snapshot for the current week_of already exists.

Writes one row per ICP into market_segment_intel keyed by (icp_id, week_of).
"""
import json
from datetime import date, timedelta

from gtm_backend.phase2.connectors import openai as llm
from gtm_backend.phase2.connectors import supabase
from gtm_backend.phase2.core.prompts import MARKET_SIZING_SYSTEM
from gtm_backend.phase2.core.schemas import MarketMap, SegmentSizing


_MIN_LEADS_THRESHOLD = 5
_TOO_SMALL_THRESHOLD = 100
# Max ICP segments per LLM call. A single call across all active ICPs (seen
# live at 28 segments) produces enough per-segment JSON (TAM/SAM/SOM text,
# competition/seasonal notes, rationale) to blow the model's completion-token
# budget mid-document, causing a hard JSON-parse failure and the whole agent
# skipping. Batching keeps each call's output well under that ceiling.
_BATCH_SIZE = 8


def size_markets(force: bool = False) -> dict:
    """Produce this week's ranked market map. Returns the upsert summary.

    Skips the LLM call (a cheap DB read only) if this week's snapshot
    already exists, since this agent runs on a weekly cadence — not once per
    single-ICP pipeline invocation. Pass force=True to bypass (e.g. for a
    manual re-run/CLI command)."""
    bar = "═" * 72
    week_of = _week_of_monday()
    print(f"\n{bar}")
    print(f"  AGENT 09 — Market Sizing (week_of={week_of})")
    print(bar)

    if not force:
        existing = supabase.get_market_segments(week_of=week_of)
        if existing:
            print(
                f"  ↷ SKIPPED — {len(existing)} segment(s) already computed "
                f"for week_of={week_of} (weekly cadence, not per-run; "
                f"pass force=True to recompute)"
            )
            return {"week_of": week_of, "already_computed": True, "segments_written": 0, "skipped": True}

    icps = supabase.get_active_icps()
    print(f"  → {len(icps)} active ICP segment(s)")

    segments = _build_segments(icps, week_of)
    total_leads = sum(seg["lead_total"] for seg in segments)
    print(f"  → total leads across segments: {total_leads}")

    if total_leads < _MIN_LEADS_THRESHOLD:
        print(
            f"  [Agent 09] SKIPPED — total leads {total_leads} < "
            f"{_MIN_LEADS_THRESHOLD} threshold"
        )
        return {"week_of": week_of, "total_leads": total_leads, "skipped": True}

    current_month = date.today().strftime("%B")
    enriched: list[SegmentSizing] = []
    batches = [segments[i:i + _BATCH_SIZE] for i in range(0, len(segments), _BATCH_SIZE)]
    for batch_num, batch in enumerate(batches, start=1):
        payload = json.dumps({
            "week_of": week_of,
            "current_month": current_month,
            "total_leads": total_leads,
            "segments": batch,
        })
        try:
            raw = llm.chat_json(
                MARKET_SIZING_SYSTEM,
                payload,
                agent="agent_09_market_sizing",
                icp_id=None,
                phase="phase2",
            )
        except Exception as exc:
            print(f"  [Agent 09] batch {batch_num}/{len(batches)} LLM error: {exc}")
            continue
        enriched.extend(_enrich_segments(raw, batch, week_of))

    if not enriched:
        print("  [Agent 09] no segments sized — all batches failed")
        return {"week_of": week_of, "total_leads": total_leads, "skipped": True}

    # Portfolio-level primary/secondary/avoid picks are computed here (not by
    # the LLM) since each batch only ever sees a subset of segments and can't
    # rank across the full portfolio. Rank by priority_rank first (1=best),
    # then hot leads, then total leads, as a deterministic tiebreaker.
    ranked = sorted(enriched, key=lambda s: (s.priority_rank, -s.lead_hot, -s.lead_total))
    primary = ranked[0].segment_name if ranked else None
    secondary = ranked[1].segment_name if len(ranked) > 1 else None
    avoid = next((s.segment_name for s in reversed(ranked) if s.too_small_flag or s.priority_rank == 3), None)

    market_map = MarketMap(
        week_of=week_of,
        total_leads=total_leads,
        skipped=False,
        summary=f"{len(enriched)} segment(s) sized across {len(batches)} batch(es).",
        primary_gtm_segment=primary,
        secondary_gtm_segment=secondary,
        avoid_this_week=avoid,
        focus_reason=None,
        segments=enriched,
    )
    inserted_ids = supabase.upsert_market_segments(market_map.segments)

    summary = {
        "week_of": week_of,
        "total_leads": total_leads,
        "segments_written": len(inserted_ids),
        "primary_gtm_segment": market_map.primary_gtm_segment,
        "secondary_gtm_segment": market_map.secondary_gtm_segment,
        "avoid_this_week": market_map.avoid_this_week,
        "skipped": False,
    }
    print(
        f"  ✓ Agent 09 complete: {len(inserted_ids)} segments · "
        f"primary={market_map.primary_gtm_segment} · "
        f"secondary={market_map.secondary_gtm_segment} · "
        f"avoid={market_map.avoid_this_week}"
    )
    return summary


def _week_of_monday() -> str:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat()


def _build_segments(icps: list[dict], week_of: str) -> list[dict]:
    rows: list[dict] = []
    for icp in icps:
        counts = supabase.get_scored_lead_counts_by_icp(icp["id"])
        rows.append({
            "icp_id": icp["id"],
            "segment_name": icp.get("name") or f"ICP {icp['id']}",
            "industry": icp.get("industry"),
            "geography": icp.get("geography"),
            "company_size_min": icp.get("company_size_min"),
            "company_size_max": icp.get("company_size_max"),
            "buyer_titles": icp.get("buyer_titles") or [],
            "lead_total": counts["total"],
            "lead_hot": counts["hot"],
            "lead_warm": counts["warm"],
            "lead_cold": counts["cold"],
            "too_small_flag": counts["total"] < _TOO_SMALL_THRESHOLD,
            "week_of": week_of,
        })
    return rows


def _enrich_segments(
    raw: dict, segments: list[dict], week_of: str,
) -> list[SegmentSizing]:
    """Merge one batch's LLM sizing output onto that batch's base segment rows."""
    raw_segments = raw.get("segments") if isinstance(raw.get("segments"), list) else []
    by_icp = {seg["icp_id"]: seg for seg in segments}
    enriched: list[SegmentSizing] = []
    for item in raw_segments:
        if not isinstance(item, dict):
            continue
        icp_id = item.get("icp_id")
        base = by_icp.get(icp_id)
        if not base:
            continue
        enriched.append(SegmentSizing(
            icp_id=icp_id,
            segment_name=str(item.get("segment_name") or base["segment_name"]),
            lead_total=base["lead_total"],
            lead_hot=base["lead_hot"],
            lead_warm=base["lead_warm"],
            lead_cold=base["lead_cold"],
            too_small_flag=bool(item.get("too_small_flag") or base["too_small_flag"]),
            tam_estimate=str(item.get("tam_estimate") or ""),
            sam_estimate=str(item.get("sam_estimate") or ""),
            som_this_month=str(item.get("som_this_month") or ""),
            competition_density=str(item.get("competition_density") or "unknown"),
            competition_impact=str(item.get("competition_impact") or ""),
            seasonal_fit=str(item.get("seasonal_fit") or "unknown"),
            seasonal_note=str(item.get("seasonal_note") or ""),
            priority_rank=_clamp_rank(item.get("priority_rank")),
            priority_rationale=str(item.get("priority_rationale") or ""),
            recommended_volume=_clamp_volume(item.get("recommended_volume")),
            week_of=week_of,
        ))
    return enriched


def _clamp_rank(value: object) -> int:
    try:
        rank = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 3
    return max(1, min(3, rank))


def _clamp_volume(value: object) -> int:
    try:
        volume = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return max(0, min(10000, volume))
