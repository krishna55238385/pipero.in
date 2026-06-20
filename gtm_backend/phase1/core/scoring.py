"""Deterministic lead scoring.

Final score = baseline (8) + firmographic fit (max 70) + aggregate signal score
(max 30), clamped 0-100.

Tiers (v2.1, biased upward): hot >= 65, warm >= 35, cold otherwise.
Disqualified for existing customers (and for leads with no ICP).

Why this rubric is generous on purpose
--------------------------------------
The previous v2.0 rubric (hot>=80, warm>=50, no baseline, stingy partial credit)
sent most *real* enriched leads to "cold" even when they were good fits. A typical
enriched lead almost never hits the firmographic ceiling: its email is "present but
unverified" (free verifiers rarely confirm corporate mailboxes), its industry string
is phrased differently from the ICP (e.g. "Software Development" vs "B2B SaaS"), and
its location is often only known at country granularity. Under v2.0 such a perfectly
sensible lead scored ~46 -> cold.

v2.1 fixes this WITHOUT making everything 100:

  * Lower tier thresholds:        hot 80 -> 65,  warm 50 -> 35.
  * Add an 8-point BASELINE so a missing field never zeroes the whole lead; signals
    BOOST the score, they never gate it (a clean firmographic lead with NO signals
    can still be "warm").
  * More generous PARTIAL credit (a near-match earns roughly half-to-three-quarters
    instead of ~0):
        - reachability: email present but unverified  0.6 -> 0.8
        - geography:    country-only match            0.6 -> 0.75
        - industry:     present but phrased differently 0.4 -> 0.6
        - industry:     no industry on the ICP itself  0.5 -> 0.7
        - buyer_title:  user-persona title             0.5 -> 0.65
        - buyer_title:  blocker-persona title          0.2 -> 0.35
  * completeness now uses a 0.5 floor + half the populated ratio, so a lead with the
    contact basics filled in always earns most of its (small) completeness budget.

Net effect: a complete, reachable, on-ICP lead clears "warm" comfortably (~75), a
lead with a strong fresh buying signal clears "hot" (~85+), and only genuinely weak
leads (missing firmographics / off-ICP / bounced) land "cold".
"""
from datetime import datetime, timezone
from typing import Any

from .schemas import ScoreResult


SCORE_VERSION = "v2.1"

# Every scored (non-disqualified) lead starts here so a single missing field can't
# zero it out. Small enough that an off-ICP lead still lands cold.
BASELINE_SCORE = 8

FIRMOGRAPHIC_WEIGHTS = {
    "industry": 22,      # industry fit is the strongest ICP signal
    "geography": 16,
    "buyer_title": 16,
    "reachability": 10,
    "completeness": 6,
}

SIGNAL_TYPE_WEIGHTS = {
    "funding": 10,
    "leadership_change": 9,
    "hiring": 8,
    "expansion": 7,
    "competitor_complaint": 6,
}

MAX_SIGNAL_SCORE = 30
# A bounced email also zeroes reachability (see _score_reachability). The penalty is
# sized so that even an otherwise strong-firmographic lead with a dead mailbox falls
# back to "cold" under the v2.1 thresholds — an unreachable lead can't be "warm".
PENALTY_BOUNCED = -35

FRESHNESS_BANDS = ((14, 1.0), (30, 0.7), (60, 0.4))
FRESHNESS_FLOOR = 0.1

CRITICAL_FIELDS = (
    "company_name", "company_domain", "company_website",
    "company_phone", "company_city", "company_country",
    "contact_name", "contact_email", "contact_title",
)

_BOUNCED_STATUSES = {"no_mx", "invalid", "bounced"}
_INVALID_TITLE_MARKERS = {"none", "no title found", "null", ""}


def _normalize(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def _array_contains(arr: list[Any] | None, value: Any) -> bool:
    if not arr:
        return False
    needle = _normalize(value)
    if not needle:
        return False
    for item in arr:
        candidate = _normalize(item)
        if candidate and (needle in candidate or candidate in needle):
            return True
    return False


def _title_matches_any(title: Any, title_array: list[Any] | None) -> bool:
    normalized = _normalize(title)
    if normalized in _INVALID_TITLE_MARKERS:
        return False
    return _array_contains(title_array, title)


def _score_geography(lead: dict, icp: dict) -> tuple[int, str]:
    max_pts = FIRMOGRAPHIC_WEIGHTS["geography"]
    geo = icp.get("geography") or []
    if not geo:
        return 0, "No geography in ICP"
    if _array_contains(geo, lead.get("company_city")) or _array_contains(geo, lead.get("company_state")):
        return max_pts, f"City/state match ({lead.get('company_city') or lead.get('company_state')})"
    if _array_contains(geo, lead.get("company_country")):
        # Country-only is still a real, targetable signal -> three-quarters credit.
        return int(round(max_pts * 0.75)), f"Country-only match ({lead.get('company_country')})"
    return 0, "No geography match"


def _score_buyer_title(lead: dict, icp: dict) -> tuple[int, str]:
    max_pts = FIRMOGRAPHIC_WEIGHTS["buyer_title"]
    title = lead.get("contact_title")
    if _title_matches_any(title, icp.get("buyer_titles")):
        return max_pts, f"Buyer title match ({title})"
    if _title_matches_any(title, icp.get("user_titles")):
        return int(round(max_pts * 0.65)), f"User title match ({title})"
    if _title_matches_any(title, icp.get("blocker_titles")):
        return int(round(max_pts * 0.35)), f"Blocker title match ({title})"
    return 0, "No title match"


def _score_reachability(lead: dict) -> tuple[int, str]:
    max_pts = FIRMOGRAPHIC_WEIGHTS["reachability"]
    if not lead.get("contact_email"):
        return 0, "No email"
    # A confirmed-dead mailbox is the one case that is NOT generous: the lead is
    # unreachable, so reachability is zero (and a separate bounce penalty applies).
    if _normalize(lead.get("bounce_status")) in _BOUNCED_STATUSES:
        return 0, "Email bounced / undeliverable"
    if bool(lead.get("verified")) and _normalize(lead.get("bounce_status")) == "valid":
        return max_pts, "Verified valid email"
    # A deliverable-looking pattern email (the common case — free verifiers
    # often can't confirm corporate mailboxes) is still very usable, so give it
    # most of the credit rather than near-zero.
    return int(round(max_pts * 0.8)), "Email present (unverified)"


def _score_industry(lead: dict, icp: dict) -> tuple[int, str]:
    """Industry fit — the strongest ICP signal. Full credit on a match; partial
    credit when the lead has *an* industry but phrased differently from the ICP
    (enrichment returns e.g. 'Software Development' vs an ICP's 'B2B SaaS')."""
    max_pts = FIRMOGRAPHIC_WEIGHTS["industry"]
    industries = icp.get("industry") or []
    company_industry = lead.get("company_industry")
    if not industries:
        # The ICP itself doesn't constrain industry -> assume a decent default fit.
        return int(round(max_pts * 0.7)), "No industry in ICP"
    if not company_industry:
        return 0, "No company industry"
    if _array_contains(industries, company_industry):
        return max_pts, f"Industry match ({company_industry})"
    # Has an industry but phrased differently from the ICP -> generous partial credit.
    return int(round(max_pts * 0.6)), f"Industry present, partial fit ({company_industry})"


def _score_completeness(lead: dict) -> tuple[int, str]:
    """Completeness budget is small (6) and shouldn't punish leads that are missing
    only a couple of optional fields. We award a 0.5 floor plus half the populated
    ratio, so any lead with the contact basics earns most of the budget while a truly
    empty lead earns ~nothing (the 0.5 floor only applies once at least one field is
    present)."""
    max_pts = FIRMOGRAPHIC_WEIGHTS["completeness"]
    total = len(CRITICAL_FIELDS)
    populated = sum(1 for field in CRITICAL_FIELDS if lead.get(field))
    if total == 0 or populated == 0:
        return 0, f"{populated}/{total} critical fields populated"
    ratio = 0.5 + 0.5 * (populated / total)
    points = int(round(max_pts * ratio))
    return points, f"{populated}/{total} critical fields populated"


def _parse_iso(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def freshness_multiplier(detected_at: datetime, now: datetime | None = None) -> float:
    """Return decay multiplier based on signal age. Newer signals weigh more."""
    reference = now or datetime.now(timezone.utc)
    age_days = max(0, (reference - detected_at).days)
    for cutoff, multiplier in FRESHNESS_BANDS:
        if age_days <= cutoff:
            return multiplier
    return FRESHNESS_FLOOR


def score_signals(signals: list[dict] | None) -> tuple[int, list[str]]:
    """Aggregate buying-signal score with freshness decay. Capped at MAX_SIGNAL_SCORE."""
    if not signals:
        return 0, ["No active signals"]
    total = 0.0
    details = []
    for sig in signals:
        weight = float(sig.get("weight") or 0)
        detected_at = _parse_iso(sig.get("detected_at"))
        if weight <= 0 or detected_at is None:
            continue
        multiplier = freshness_multiplier(detected_at)
        contribution = weight * multiplier
        total += contribution
        details.append(
            f"{sig.get('signal_type', 'unknown')} w={weight:.0f}×{multiplier:.1f}={contribution:.1f}"
        )
    capped = min(MAX_SIGNAL_SCORE, int(round(total)))
    if not details:
        details.append("No usable signals")
    return capped, details


def tier_for(score: int) -> str:
    # Lowered from hot>=80 / warm>=50 (v2.0) so good-fit leads aren't all "cold".
    if score >= 65:
        return "hot"
    if score >= 35:
        return "warm"
    return "cold"


def _disqualified(lead_id: int, reason: str, icp_name: str | None) -> ScoreResult:
    return ScoreResult(
        lead_id=lead_id,
        icp_score=0,
        score_tier="disqualified",
        score_breakdown={"disqualified": {"points": 0, "max": 0, "detail": reason}},
        score_reasoning=f"Score 0/100 (DISQUALIFIED) against ICP '{icp_name or 'unknown'}'. {reason}.",
        score_version=SCORE_VERSION,
    )


def score_lead(lead: dict, icp: dict | None, signals: list[dict] | None = None) -> ScoreResult:
    """Compute final lead score from firmographic fit and active buying signals."""
    lead_id = int(lead.get("id") or lead.get("lead_id") or 0)

    if lead.get("is_existing_customer") is True:
        return _disqualified(lead_id, "Existing customer", (icp or {}).get("name"))
    if not icp:
        return _disqualified(lead_id, "No ICP found", None)

    industry_pts, industry_detail = _score_industry(lead, icp)
    geo_pts, geo_detail = _score_geography(lead, icp)
    title_pts, title_detail = _score_buyer_title(lead, icp)
    reach_pts, reach_detail = _score_reachability(lead)
    complete_pts, complete_detail = _score_completeness(lead)
    signal_pts, signal_details = score_signals(signals)

    breakdown: dict[str, Any] = {
        "industry": {"points": industry_pts, "max": FIRMOGRAPHIC_WEIGHTS["industry"], "detail": industry_detail},
        "geography": {"points": geo_pts, "max": FIRMOGRAPHIC_WEIGHTS["geography"], "detail": geo_detail},
        "buyer_title": {"points": title_pts, "max": FIRMOGRAPHIC_WEIGHTS["buyer_title"], "detail": title_detail},
        "reachability": {"points": reach_pts, "max": FIRMOGRAPHIC_WEIGHTS["reachability"], "detail": reach_detail},
        "completeness": {"points": complete_pts, "max": FIRMOGRAPHIC_WEIGHTS["completeness"], "detail": complete_detail},
        "buying_signals": {"points": signal_pts, "max": MAX_SIGNAL_SCORE, "detail": " | ".join(signal_details)},
    }

    # BASELINE_SCORE keeps a single missing field from zeroing the lead. Signals are
    # additive on top of firmographics — they boost, they never gate.
    total = BASELINE_SCORE + industry_pts + geo_pts + title_pts + reach_pts + complete_pts + signal_pts
    breakdown["baseline"] = {"points": BASELINE_SCORE, "max": BASELINE_SCORE, "detail": "Base score"}

    bounce_status = _normalize(lead.get("bounce_status"))
    penalty_detail = None
    if bounce_status in _BOUNCED_STATUSES:
        total += PENALTY_BOUNCED
        penalty_detail = f"Bounce penalty applied ({bounce_status})"
        breakdown["bounce_penalty"] = {"points": PENALTY_BOUNCED, "max": 0, "detail": penalty_detail}

    total = max(0, min(100, total))
    tier = tier_for(total)

    reasons = [industry_detail, geo_detail, title_detail, reach_detail, complete_detail, breakdown["buying_signals"]["detail"]]
    if penalty_detail:
        reasons.append(penalty_detail)
    reasoning = f"Score {total}/100 ({tier.upper()}) against ICP '{icp.get('name', 'unknown')}'. " + " | ".join(reasons) + "."

    return ScoreResult(
        lead_id=lead_id,
        icp_score=total,
        score_tier=tier,
        score_breakdown=breakdown,
        score_reasoning=reasoning,
        score_version=SCORE_VERSION,
    )
