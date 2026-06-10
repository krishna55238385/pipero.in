"""Pydantic schemas for phase 2 outputs.

Each Agent 06–10 has a strict output shape. Schemas are used both to validate
LLM responses and to drive the supabase REST insert payloads.
"""
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator

from phase2.core.config import get_settings


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _default_model_version() -> str:
    """Record which model generated a brief — sourced from the root .env
    (OPENAI_MODEL), so the model name is never hardcoded here."""
    return get_settings().openai_model


# -- Agent 06 — Account Intelligence --------------------------------------

class RecentMove(BaseModel):
    date: str | None = None
    move_type: str  # funding | hiring | leadership | product | acquisition | partnership | layoffs | other
    summary: str
    source_url: str | None = None


class PainPoint(BaseModel):
    pain: str
    evidence: str | None = None
    confidence: str = "low"  # low | medium | high


class ConfirmedFact(BaseModel):
    fact: str
    source: str = "website"  # website | news
    source_url: str | None = None


class Inference(BaseModel):
    inference: str
    confidence: str = "low"  # low | medium


class InstabilityFlag(BaseModel):
    flag: str
    severity: str = "low"  # low | medium | high
    evidence: str | None = None


class AccountBrief(BaseModel):
    """Output of Agent 06 — Account Intelligence."""

    lead_id: int
    icp_id: int | None = None
    company_name: str
    company_domain: str | None = None
    what_they_do: str = ""
    business_model: str = "unknown"  # B2B | B2C | B2B2C | marketplace | other | unknown
    company_size_estimate: str = "unknown"  # SMB | Mid-market | Enterprise | unknown
    growth_trajectory: str = ""
    competitive_position: str = ""
    recent_moves: list[RecentMove] = Field(default_factory=list)
    likely_pain_points: list[PainPoint] = Field(default_factory=list)
    instability_flags: list[InstabilityFlag] = Field(default_factory=list)
    confirmed_facts: list[ConfirmedFact] = Field(default_factory=list)
    inferences: list[Inference] = Field(default_factory=list)
    key_signals_for_outreach: list[str] = Field(default_factory=list)
    brief_quality_score: int = Field(default=0, ge=0, le=100)
    status: str = "fresh"  # fresh | low_quality | scrape_failed
    sources_scanned: list[str] = Field(default_factory=list)
    refreshed_at: datetime = Field(default_factory=_utc_now)


# -- Agent 07 — Stakeholder Mapping ---------------------------------------

class Stakeholder(BaseModel):
    """One person in the buying committee."""

    lead_id: int
    full_name: str
    job_title: str | None = None
    role_type: str  # economic_buyer | champion | influencer | blocker | user | unknown
    seniority: str | None = None  # C-suite | VP | Director | Manager | IC | unknown
    function_area: str | None = None  # Eng | Product | Sales | Finance | HR | Ops | unknown
    linkedin_url: str | None = None
    email: str | None = None
    email_confidence: str = "unknown"  # verified | guessed | unknown
    confidence: str = "low"  # high | medium | low (overall record confidence)
    risk_flags: list[str] = Field(default_factory=list)
    reports_to: str | None = None  # full name of this person's manager
    rank: int = 99
    detected_at: datetime = Field(default_factory=_utc_now)


class StakeholderMap(BaseModel):
    """All stakeholders for one account, plus recommended entry point."""

    lead_id: int
    icp_id: int | None = None
    company_name: str
    company_domain: str | None = None
    stakeholders: list[Stakeholder] = Field(default_factory=list)
    entry_point_full_name: str | None = None
    entry_point_role_type: str | None = None
    multi_threading_status: str = "single"  # single | multi (≥3 engaged)
    # 'complete' only when Economic Buyer + Champion + Influencer are all present.
    coverage_status: str = "unknown"  # complete | incomplete | unknown
    missing_roles: list[str] = Field(default_factory=list)  # of the 3 required roles
    # True when a Champion exists but none has budget authority (C-suite/VP).
    champion_budget_flag: bool = False
    refreshed_at: datetime = Field(default_factory=_utc_now)


# -- Agent 08 — Competitive Intelligence ----------------------------------

class CompetitorComplaintCategory(BaseModel):
    category: str  # price | support | features | reliability
    severity: str = "low"  # low | medium | high
    top_complaints: list[str] = Field(default_factory=list)


class TalkTrack(BaseModel):
    scenario: str  # incumbent | considering | differentiation
    message: str


class LeadCompetitorUsage(BaseModel):
    """A target lead found to already be using a tracked competitor."""

    lead_id: int
    icp_id: int | None = None
    competitor_name: str
    evidence: str | None = None  # the brief text that mentioned the competitor
    detected_at: datetime = Field(default_factory=_utc_now)


class Competitor(BaseModel):
    icp_id: int
    competitor_name: str
    competitor_domain: str | None = None
    summary: str = ""
    complaint_categories: list[CompetitorComplaintCategory] = Field(default_factory=list)
    biggest_weakness: str | None = None
    who_loves_them: str | None = None
    who_hates_them: str | None = None
    talk_tracks: list[TalkTrack] = Field(default_factory=list)
    threat_level: str = "medium"  # low | medium | high
    sources: list[str] = Field(default_factory=list)
    refreshed_at: datetime = Field(default_factory=_utc_now)


# -- Agent 09 — Market Sizing ---------------------------------------------

class SegmentSizing(BaseModel):
    """One ICP segment with its TAM/SAM/SOM and priority rank."""

    icp_id: int
    segment_name: str
    lead_total: int = 0
    lead_hot: int = 0
    lead_warm: int = 0
    lead_cold: int = 0
    too_small_flag: bool = False
    tam_estimate: str = ""
    sam_estimate: str = ""
    som_this_month: str = ""
    competition_density: str = "unknown"  # low | medium | high | unknown
    competition_impact: str = ""
    seasonal_fit: str = "unknown"  # strong | neutral | weak | unknown
    seasonal_note: str = ""
    priority_rank: int = Field(default=3, ge=1, le=3)
    priority_rationale: str = ""
    recommended_volume: int = 0
    week_of: str = ""  # YYYY-MM-DD (Monday)


class MarketMap(BaseModel):
    """The full ranked market map (one row per ICP)."""

    week_of: str
    total_leads: int
    skipped: bool = False
    summary: str = ""
    primary_gtm_segment: str | None = None
    secondary_gtm_segment: str | None = None
    avoid_this_week: str | None = None
    focus_reason: str | None = None
    segments: list[SegmentSizing] = Field(default_factory=list)


# -- Agent 10 — GTM Insight Generator --------------------------------------

class GTMTargeting(BaseModel):
    segment: str | None = None
    priority_rank: int = 3
    entry_point_name: str | None = None
    entry_point_role: str | None = None
    secondary_contacts: list[str] = Field(default_factory=list)


class GTMMessage(BaseModel):
    core_message: str = ""
    unique_value_proposition: str = ""
    pain_points_to_address: list[str] = Field(default_factory=list)
    competitive_angle: str = ""


class GTMChannelPlan(BaseModel):
    primary_channel: str = "email"  # email | linkedin | phone | event | other
    sequence: list[str] = Field(default_factory=list)
    cadence: str = ""


class GTMInsight(BaseModel):
    """Output of Agent 10. One row per (lead_id, week)."""

    lead_id: int
    icp_id: int | None = None
    company_name: str
    brief_date: str  # YYYY-MM-DD
    executive_summary: str = ""
    who_to_target: GTMTargeting = Field(default_factory=GTMTargeting)
    what_to_say: GTMMessage = Field(default_factory=GTMMessage)
    which_channel: GTMChannelPlan = Field(default_factory=GTMChannelPlan)
    why_market_rationale: str = ""
    why_account_rationale: str = ""
    urgency_signal: str = ""
    flags_and_contradictions: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    # Human-review gate: a brief is not the active GTM strategy until approved.
    review_status: str = "pending_review"  # pending_review | approved | rejected
    model_version: str = Field(default_factory=_default_model_version)
    generated_at: datetime = Field(default_factory=_utc_now)


