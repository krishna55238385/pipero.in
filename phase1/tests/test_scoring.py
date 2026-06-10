"""Tests for the deterministic v2.0 scoring rubric.

Most critical test file — validates the formula in core/scoring.py:
firmographic (max 70) + signal aggregate (max 30, decayed) − bounce penalty (-30 if bounced).
"""
from datetime import datetime, timedelta, timezone

from phase1.core.scoring import (
    FIRMOGRAPHIC_WEIGHTS,
    MAX_SIGNAL_SCORE,
    SIGNAL_TYPE_WEIGHTS,
    freshness_multiplier,
    score_lead,
    score_signals,
    tier_for,
)


def test_tier_thresholds():
    # v2.1 thresholds (biased upward): hot >= 65, warm >= 35, cold otherwise.
    assert tier_for(100) == "hot"
    assert tier_for(65) == "hot"
    assert tier_for(64) == "warm"
    assert tier_for(35) == "warm"
    assert tier_for(34) == "cold"
    assert tier_for(0) == "cold"


def test_firmographic_weights_sum_to_70():
    assert sum(FIRMOGRAPHIC_WEIGHTS.values()) == 70


def test_max_signal_score_is_30():
    assert MAX_SIGNAL_SCORE == 30


def test_signal_type_weights():
    assert SIGNAL_TYPE_WEIGHTS["funding"] == 10
    assert SIGNAL_TYPE_WEIGHTS["leadership_change"] == 9
    assert SIGNAL_TYPE_WEIGHTS["hiring"] == 8
    assert SIGNAL_TYPE_WEIGHTS["expansion"] == 7
    assert SIGNAL_TYPE_WEIGHTS["competitor_complaint"] == 6


def test_full_firmographic_match_clears_hot(full_lead, sample_icp):
    # v2.1: baseline 8 + industry 22 + geo 16 + title 16 + reach 10 + completeness 6 = 78.
    # A complete, reachable, on-ICP lead is now "hot" even with NO signals (signals
    # boost, they don't gate).
    result = score_lead(full_lead, sample_icp, signals=None)
    assert result.icp_score == 78
    assert result.score_tier == "hot"


def test_with_fresh_funding_signal_pushes_to_max(full_lead, sample_icp):
    # 78 firmographic + 10 fresh-funding signal = 88 (clamped well under 100).
    now = datetime.now(timezone.utc)
    signals = [{
        "signal_type": "funding",
        "weight": 10,
        "detected_at": now.isoformat(),
    }]
    result = score_lead(full_lead, sample_icp, signals=signals)
    assert result.icp_score == 88
    assert result.score_tier == "hot"


def test_disqualified_for_existing_customer(full_lead, sample_icp):
    full_lead["is_existing_customer"] = True
    result = score_lead(full_lead, sample_icp)
    assert result.score_tier == "disqualified"
    assert result.icp_score == 0


def test_disqualified_when_no_icp(full_lead):
    result = score_lead(full_lead, None)
    assert result.score_tier == "disqualified"


def test_bounce_penalty_applied(full_lead, sample_icp):
    full_lead["bounce_status"] = "no_mx"
    full_lead["verified"] = False
    result = score_lead(full_lead, sample_icp)
    assert "bounce_penalty" in result.score_breakdown
    # An undeliverable mailbox zeroes reachability AND takes the penalty, so even a
    # full-firmographic lead lands cold — an unreachable lead can't be warm.
    assert result.score_breakdown["reachability"]["points"] == 0
    assert result.score_tier == "cold"


def test_thin_lead_low_score(thin_lead, sample_icp):
    result = score_lead(thin_lead, sample_icp)
    assert result.icp_score < 30
    assert result.score_tier == "cold"


def test_freshness_decay():
    now = datetime.now(timezone.utc)
    assert freshness_multiplier(now - timedelta(days=1), now) == 1.0
    assert freshness_multiplier(now - timedelta(days=20), now) == 0.7
    assert freshness_multiplier(now - timedelta(days=45), now) == 0.4
    assert freshness_multiplier(now - timedelta(days=120), now) == 0.1


def test_signal_aggregation_caps_at_30():
    now = datetime.now(timezone.utc).isoformat()
    signals = [
        {"signal_type": "funding", "weight": 10, "detected_at": now},
        {"signal_type": "leadership_change", "weight": 9, "detected_at": now},
        {"signal_type": "hiring", "weight": 8, "detected_at": now},
        {"signal_type": "expansion", "weight": 7, "detected_at": now},
        {"signal_type": "competitor_complaint", "weight": 6, "detected_at": now},
    ]
    points, _ = score_signals(signals)
    assert points == 30


def test_signal_decayed_contributes_less():
    now = datetime.now(timezone.utc)
    old_signal = [{
        "signal_type": "funding",
        "weight": 10,
        "detected_at": (now - timedelta(days=200)).isoformat(),
    }]
    points, _ = score_signals(old_signal)
    assert points == 1


def test_empty_signals_yield_zero():
    points, details = score_signals([])
    assert points == 0
    assert details == ["No active signals"]


def test_country_only_match_partial_credit(sample_icp):
    lead = {
        "id": 1,
        "icp_id": 1,
        "company_name": "X",
        "company_country": "India",
        "contact_title": "CEO",
        "contact_email": "x@x.com",
        "verified": True,
        "bounce_status": "valid",
    }
    result = score_lead(lead, sample_icp)
    geo = result.score_breakdown["geography"]
    # v2.1: country-only match earns 0.75 of the geography budget.
    assert geo["points"] == round(FIRMOGRAPHIC_WEIGHTS["geography"] * 0.75)


def test_user_title_partial_credit(sample_icp, full_lead):
    full_lead["contact_title"] = "HR Manager"
    result = score_lead(full_lead, sample_icp)
    title = result.score_breakdown["buyer_title"]
    # v2.1: a user-persona (not buyer) title earns 0.65 of the buyer-title budget.
    assert title["points"] == round(FIRMOGRAPHIC_WEIGHTS["buyer_title"] * 0.65)
