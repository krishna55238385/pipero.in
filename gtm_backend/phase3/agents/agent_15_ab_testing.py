"""Agent 15 — A/B Testing.

Pull Instantly campaign analytics for each campaign present in
outreach_log (or one explicit campaign_id), score each subject-line
variant on open_rate / reply_rate, and upsert one row per
(campaign_id, step_number, variant_subject) into ab_test_results.

Deterministic winner rule (no LLM needed):
- reply_rate is the dominant signal; open_rate breaks ties.
- A step's winner is the variant with the highest (reply_rate,
  open_rate) tuple, BUT only when at least one of that step's variants
  has sent_count >= 50. Below the threshold, no winner is declared.
- Once a winner is declared for a step, every other variant in that step
  is marked is_retired=True so it stops being sent (PDF: "Losing variants
  must be retired after a statistically significant result").
"""
from gtm_backend.phase3.connectors import instantly
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.schemas import ABTestResult


_SAMPLE_SIZE_THRESHOLD = 50


def run_ab_testing(campaign_id: str | None = None) -> dict:
    """Pull Instantly analytics, score variants, write ab_test_results."""
    bar = "═" * 72
    label = campaign_id or "all"
    print(f"\n{bar}")
    print(f"  AGENT 15 — A/B Testing (campaign_id={label})")
    print(bar)

    if campaign_id is not None:
        campaign_ids = [campaign_id]
    else:
        campaign_ids = _discover_campaign_ids()

    if not campaign_ids:
        print("  → no campaigns to analyse")
        summary = {
            "campaigns_analysed": 0,
            "variants_scored": 0,
            "winners_declared": 0,
            "status": "ok",
        }
        print("  ✓ Agent 15 complete: nothing to do")
        return summary

    if not instantly.is_configured():
        print("  → INSTANTLY_API_KEY not set — skipping live analytics pull")
        summary = {
            "campaigns_analysed": 0,
            "variants_scored": 0,
            "winners_declared": 0,
            "status": "skipped",
        }
        print("  ✓ Agent 15 complete: skipped (no API key)")
        return summary

    rows: list[ABTestResult] = []
    campaigns_analysed = 0
    winners_declared = 0

    for cid in campaign_ids:
        try:
            analytics = instantly.get_campaign_analytics(cid)
        except Exception as exc:
            print(f"  [Agent 15] campaign={_short(cid)}... → analytics fetch failed: {exc}")
            continue

        variants = _extract_variants(analytics)
        if not variants:
            print(f"  [Agent 15] campaign={_short(cid)}... → no per-variant data, using aggregate")
            variants = [_aggregate_variant(analytics)]

        campaign_rows = _score_variants(cid, variants)
        rows.extend(campaign_rows)
        campaigns_analysed += 1
        local_winners = sum(1 for r in campaign_rows if r.is_winner)
        winners_declared += local_winners
        print(
            f"  [Agent 15] campaign={_short(cid)}... → "
            f"{len(campaign_rows)} variants, {local_winners} winners declared"
        )

    supabase.upsert_ab_test_results(rows)

    summary = {
        "campaigns_analysed": campaigns_analysed,
        "variants_scored": len(rows),
        "winners_declared": winners_declared,
        "status": "ok",
    }
    print(
        f"  ✓ Agent 15 complete: {campaigns_analysed} campaign(s) · "
        f"{len(rows)} variants · {winners_declared} winners"
    )
    return summary


def _discover_campaign_ids() -> list[str]:
    """Return distinct non-null campaign_ids from the outreach_log table."""
    try:
        rows = supabase.get_outreach_log()
    except Exception as exc:
        print(f"  [Agent 15] outreach_log fetch failed: {exc}")
        return []
    ids: list[str] = []
    seen: set[str] = set()
    for row in rows:
        cid = row.get("campaign_id")
        if cid and cid not in seen:
            seen.add(cid)
            ids.append(cid)
    return ids


def _extract_variants(analytics: dict) -> list[dict]:
    """Pull per-(step, variant) counts from any of several Instantly response shapes."""
    if not isinstance(analytics, dict):
        return []
    variants: list[dict] = []

    by_variant = analytics.get("by_variant")
    if isinstance(by_variant, list):
        for item in by_variant:
            coerced = _coerce_variant(item, default_step=None)
            if coerced is not None:
                variants.append(coerced)
        if variants:
            return variants

    steps = analytics.get("steps")
    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict):
                continue
            step_no = step.get("step_number") or step.get("step") or 1
            step_variants = step.get("variants") or []
            if not isinstance(step_variants, list):
                continue
            for variant in step_variants:
                coerced = _coerce_variant(variant, default_step=step_no)
                if coerced is not None:
                    variants.append(coerced)
        if variants:
            return variants

    nested = analytics.get("variants")
    if isinstance(nested, list):
        for variant in nested:
            coerced = _coerce_variant(variant, default_step=None)
            if coerced is not None:
                variants.append(coerced)

    return variants


def _coerce_variant(item: object, default_step: object) -> dict | None:
    """Coerce one Instantly variant dict into our normalised shape, or None."""
    if not isinstance(item, dict):
        return None
    subject = item.get("variant_subject") or item.get("subject")
    if not subject:
        return None
    step_no = item.get("step_number") or item.get("step") or default_step or 1
    return {
        "step_number": _to_int(step_no, default=1),
        "variant_subject": str(subject),
        "sent_count": _to_int(item.get("sent_count") or item.get("sent"), default=0),
        "open_count": _to_int(item.get("open_count") or item.get("opens"), default=0),
        "reply_count": _to_int(item.get("reply_count") or item.get("replies"), default=0),
    }


def _aggregate_variant(analytics: dict) -> dict:
    """Build a single aggregate variant when no per-variant breakdown is available."""
    sent = (
        analytics.get("sent_count")
        or analytics.get("sent")
        or analytics.get("emails_sent")
    )
    opens = (
        analytics.get("open_count")
        or analytics.get("opens")
        or analytics.get("emails_opened")
    )
    replies = (
        analytics.get("reply_count")
        or analytics.get("replies")
        or analytics.get("emails_replied")
    )
    return {
        "step_number": 1,
        "variant_subject": "aggregate",
        "sent_count": _to_int(sent, default=0),
        "open_count": _to_int(opens, default=0),
        "reply_count": _to_int(replies, default=0),
    }


def _to_int(value: object, default: int = 0) -> int:
    """Best-effort int coercion that falls back to default on bad input."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _score_variants(campaign_id: str, variants: list[dict]) -> list[ABTestResult]:
    """Compute open/reply rates per variant and mark per-step winners."""
    grouped: dict[int, list[ABTestResult]] = {}
    for variant in variants:
        sent = variant["sent_count"]
        opens = variant["open_count"]
        replies = variant["reply_count"]
        open_rate = (opens / sent) if sent else 0.0
        reply_rate = (replies / sent) if sent else 0.0
        row = ABTestResult(
            campaign_id=campaign_id,
            step_number=variant["step_number"],
            variant_subject=variant["variant_subject"],
            sent_count=sent,
            open_count=opens,
            reply_count=replies,
            open_rate=round(open_rate, 4),
            reply_rate=round(reply_rate, 4),
            sample_size_met=sent >= _SAMPLE_SIZE_THRESHOLD,
            is_winner=False,
            is_retired=False,
        )
        grouped.setdefault(row.step_number, []).append(row)

    for step_rows in grouped.values():
        if not any(r.sample_size_met for r in step_rows):
            continue
        winner = max(step_rows, key=lambda r: (r.reply_rate, r.open_rate))
        winner.is_winner = True
        # Once a step has a winner, every other variant in that step is retired
        # (PDF Agent 15: "Losing variants must be retired after a significant
        # result"). Only the winner stays active for future sends.
        for row in step_rows:
            row.is_retired = row is not winner

    return [row for step_rows in grouped.values() for row in step_rows]


def _short(campaign_id: str) -> str:
    """Truncate a campaign id to its first 8 characters for log lines."""
    return campaign_id[:8] if campaign_id else ""
