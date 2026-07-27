"""Agent 37 — Data Refresh (PDF Phase 6 — MANAGE & REPORT).

"Continuously re-verifies contact information, updates records when people
change jobs, removes contacts who have left companies, and enriches records
with newly available information."

Honest scope, not the PDF's full spec (see individual rules below):
- "Contact re-verified at least every 90 days" — BUILT. Every lead with an
  email is checked; last_verified_at (a column that already existed in
  schema.sql but was never once set by any agent before this one) now
  actually gets populated.
- "Bounced emails trigger immediate re-verification" — BUILT. A lead whose
  bounce_status is already in a bad state gets re-checked regardless of how
  recently it was last verified, not just leads past the 90-day mark.
- "Must maintain a data quality score per record" — BUILT. Deterministic 0-
  100 completeness+freshness score, computed in pure Python.
- Re-verification itself reuses phase1's existing disify.verify_email() —
  the SAME free deliverability check (MX/format/disposable) Agent 03 already
  uses at enrichment time. Deliberately NOT an LLM call: (a) it's a solved
  problem a deliverability API already handles correctly, (b) this session's
  own Groq quota got fully exhausted today from unrelated agent runs — adding
  a 15th LLM-calling agent on top of that would make the problem worse, not
  better, for zero real benefit over the existing free API.
- "Job change detected → flag high-priority, route to re-engagement" — NOT
  built. Detecting a job change requires re-researching a real person (a
  search+LLM call per contact, expensive, and overlaps with PDF's own
  Champion Tracker Agent 42, Phase 7, not built yet). Explicitly out of scope
  for v1 rather than faked.
- "Contacts at companies that shut down/acquired must be archived" — NOT
  built, same reasoning (requires live company-status research). No code
  path in this system deletes/archives leads at all yet, so there's nothing
  to wire this into regardless.
- "Must run in the background, never interrupting active sequences" — this
  agent only ever reads+patches leads_raw fields (verified, bounce_status,
  last_verified_at, data_quality_score); it never touches outreach_log,
  outreach_sequences, or send state, so it structurally cannot interrupt an
  active sequence.
"""
from datetime import datetime, timedelta, timezone

from gtm_backend.phase1.connectors import disify
from gtm_backend.phase3.connectors import supabase

_STALE_DAYS = 90  # PDF's own rule: "re-verified at least every 90 days"
_BOUNCED_STATUSES = {"no_mx", "disposable", "bad_format", "unknown"}


def run_data_refresh(limit: int | None = None) -> dict:
    """Re-verify stale/bounced leads, compute a data-quality score for every
    examined lead, and persist a monthly-style health snapshot."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 37 — Data Refresh (limit={limit or 'all'})")
    print(bar)

    leads = supabase.get_leads_for_data_refresh(limit=limit)
    print(f"  → {len(leads)} lead(s) with an email examined")

    reverified = 0
    quality_scores: list[int] = []
    bounced_count = 0

    for lead in leads:
        needs_reverify, reason = _needs_reverification(lead)
        if needs_reverify:
            result = disify.verify_email(lead.get("contact_email") or "")
            verified = bool(result.get("verified"))
            bounce_status = result.get("bounce_status") or "unknown"
            last_verified_at = _now_iso()
            reverified += 1
            print(f"  [Agent 37] {lead.get('company_name') or '?':<28} → re-verified ({reason}): {bounce_status}")
        else:
            verified = bool(lead.get("verified"))
            bounce_status = lead.get("bounce_status")
            last_verified_at = lead.get("last_verified_at")

        score = _data_quality_score(lead, verified, bounce_status, last_verified_at)
        quality_scores.append(score)
        if bounce_status in _BOUNCED_STATUSES:
            bounced_count += 1

        supabase.update_lead_raw(
            lead["id"],
            verified=verified,
            bounce_status=bounce_status,
            last_verified_at=last_verified_at,
            data_quality_score=score,
        )

    # Every lead flagged needs_reverification above was processed in this
    # same pass, so "examined but still stale" is 0 by construction — this
    # field exists for a future incremental/batched run (e.g. limit=50 on a
    # much bigger table) where a whole population scan takes multiple runs.
    still_stale = 0
    avg_score = round(sum(quality_scores) / len(quality_scores), 1) if quality_scores else None
    bounce_rate = round(bounced_count / len(leads) * 100, 1) if leads else None

    report = supabase.create_data_quality_report(
        leads_examined=len(leads),
        reverified_count=reverified,
        still_stale_count=max(still_stale, 0),
        avg_quality_score=avg_score,
        bounce_rate=bounce_rate,
    )
    report_id = report.get("id") if report else None

    print(
        f"  ✓ Agent 37 complete: {reverified} re-verified · avg quality score "
        f"{avg_score if avg_score is not None else 'N/A'} · bounce rate "
        f"{bounce_rate if bounce_rate is not None else 'N/A'}% (report {report_id})"
    )
    return {
        "leads_examined": len(leads),
        "reverified_count": reverified,
        "avg_quality_score": avg_score,
        "bounce_rate": bounce_rate,
        "report_id": report_id,
    }


def _needs_reverification(lead: dict) -> tuple[bool, str]:
    """Bounced now (any bad bounce_status) OR never verified OR stale
    (>90 days) — PDF rules verbatim."""
    bounce_status = lead.get("bounce_status")
    if bounce_status in _BOUNCED_STATUSES:
        return True, f"bounce_status={bounce_status}"
    last_verified_at = _parse_dt(lead.get("last_verified_at"))
    if last_verified_at is None:
        return True, "never verified"
    if datetime.now(timezone.utc) - last_verified_at > timedelta(days=_STALE_DAYS):
        return True, f"stale (>{_STALE_DAYS}d)"
    return False, "up to date"


def _data_quality_score(lead: dict, verified: bool, bounce_status: str | None, last_verified_at) -> int:
    """Deterministic 0-100 completeness+freshness score. No LLM — this is a
    field-presence/recency check, not a judgment call."""
    score = 0
    if lead.get("contact_email"):
        score += 20
    if verified and bounce_status == "valid":
        score += 30
    if lead.get("contact_name"):
        score += 15
    if lead.get("contact_title"):
        score += 15
    if lead.get("company_domain"):
        score += 10
    parsed = _parse_dt(last_verified_at)
    if parsed is not None and datetime.now(timezone.utc) - parsed <= timedelta(days=_STALE_DAYS):
        score += 10
    return min(score, 100)


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
