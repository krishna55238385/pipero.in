"""Agent 34 — Revenue Forecasting (PDF Phase 6 — MANAGE & REPORT).

"Predicts what revenue will close and when with confidence."

Deliberately NOT an LLM agent — this is a deterministic rollup over
`deals.value` and `deals.probability`, and the PDF's own rule is explicit
that confidence must come "from actual historical data — not gut feel." An
LLM guessing at a dollar figure would be exactly the kind of fabrication
every other agent this session has been built to avoid, so this one just
does arithmetic instead.

Honest limitation, documented rather than hidden: the PDF wants confidence
calibrated against real historical conversion patterns (e.g. "qualified
deals close 40% of the time based on last year's data"). This system has no
closed-deal history yet to calibrate against — `deals.probability` (set by
pipeline stage, or by Agent 24's BANT score) is the best available
confidence signal today, so it's used as-is. Once real win/loss history
exists, this should be recalibrated against actual conversion rates rather
than the stage-default probabilities currently in use.

Three scenarios, computed from every active deal with probability >= 30%
(PDF rule: "deals with less than 30% confidence must be excluded from
committed forecast"):
- conservative: value * probability * 0.8  (discounts even the stated odds)
- base:         value * probability        (takes the stated odds at face value)
- optimistic:   value * min(probability * 1.25, 100)  (assumes some upside)

No quarter-end target exists anywhere in this system yet (not a deals field,
not a settings table), so the PDF's "flag when quarter-end target is at
risk" rule can't be implemented — flagging against a target this system
doesn't know isn't something to guess at. Left as an open gap requiring a
real target input from the business, not invented here.

Append-only history (see schema.sql) so forecast accuracy can be tracked
over time, per the PDF's own rule — each run adds a new snapshot rather than
overwriting the last one.
"""
from gtm_backend.phase3.connectors import supabase

_MIN_COMMITTED_PROBABILITY = 30
_CONSERVATIVE_FACTOR = 0.8
_OPTIMISTIC_FACTOR = 1.25


def generate_revenue_forecast() -> dict:
    """Roll up every active deal into a conservative/base/optimistic
    forecast snapshot and persist it."""
    bar = "═" * 72
    print(f"\n{bar}")
    print("  AGENT 34 — Revenue Forecasting")
    print(bar)

    deals = supabase.get_active_deals(limit=None)
    print(f"  → {len(deals)} active deal(s) examined")

    committed = []
    excluded = 0
    for deal in deals:
        value = deal.get("value")
        probability = deal.get("probability")
        if value is None or probability is None or probability < _MIN_COMMITTED_PROBABILITY:
            excluded += 1
            continue
        committed.append(deal)

    conservative_total = 0.0
    base_total = 0.0
    optimistic_total = 0.0
    breakdown = []
    for deal in committed:
        value = float(deal.get("value") or 0)
        probability = float(deal.get("probability") or 0)
        weighted = value * probability / 100
        conservative_total += weighted * _CONSERVATIVE_FACTOR
        base_total += weighted
        optimistic_total += value * min(probability * _OPTIMISTIC_FACTOR, 100) / 100
        breakdown.append({
            "deal_id": deal.get("id"),
            "company_name": deal.get("title"),
            "value": value,
            "probability": probability,
            "weighted_value": round(weighted, 2),
        })

    forecast = supabase.create_revenue_forecast(
        conservative_total=round(conservative_total, 2),
        base_total=round(base_total, 2),
        optimistic_total=round(optimistic_total, 2),
        committed_deal_count=len(committed),
        excluded_deal_count=excluded,
        total_deal_count=len(deals),
        deal_breakdown=breakdown,
    )
    forecast_id = forecast.get("id") if forecast else None

    print(
        f"  ✓ Agent 34 complete: conservative=${conservative_total:,.2f} · "
        f"base=${base_total:,.2f} · optimistic=${optimistic_total:,.2f} "
        f"({len(committed)} committed, {excluded} excluded <{_MIN_COMMITTED_PROBABILITY}% confidence)"
    )
    return {
        "forecast_id": forecast_id,
        "conservative_total": round(conservative_total, 2),
        "base_total": round(base_total, 2),
        "optimistic_total": round(optimistic_total, 2),
        "committed_deal_count": len(committed),
        "excluded_deal_count": excluded,
        "total_deal_count": len(deals),
    }
