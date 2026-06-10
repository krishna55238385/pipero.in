"""Pydantic schemas for phase 3 outputs.

Each Agent 11–15 has a strict output shape. Schemas are used both to validate
LLM responses and to drive the supabase REST insert payloads.
"""
from pydantic import BaseModel, Field


# -- Agent 11 — Personalisation -------------------------------------------

class PersonalisationAngle(BaseModel):
    """One verifiable personalisation hook for a lead."""

    model_config = {"extra": "ignore"}

    angle_type: str  # trigger_event | pain_point | competitive | role_specific | other
    text: str
    evidence: str | None = None
    confidence: str = "medium"  # low | medium | high


class PersonalisationResult(BaseModel):
    """Output of Agent 11 — Personalisation."""

    model_config = {"extra": "ignore"}

    lead_id: int
    icp_id: int | None = None
    company_name: str
    contact_name: str | None = None
    contact_title: str | None = None
    angles: list[PersonalisationAngle] = Field(default_factory=list)
    quality_score: int = 0
    status: str = "ready"  # ready | held | low_quality
    held_reason: str | None = None


# -- Agent 12 — Outreach Copywriter ---------------------------------------

class SequenceVariant(BaseModel):
    """A subject + body variant for one sequence step (for A/B testing)."""

    model_config = {"extra": "ignore"}

    subject: str
    body: str


class SequenceStep(BaseModel):
    """One step in a 5-touch outreach sequence with 2 subject variants."""

    model_config = {"extra": "ignore"}

    step_number: int  # 1..5
    step_type: str  # intro | follow_up | breakup
    delay_days: int  # days after previous step
    variants: list[SequenceVariant] = Field(default_factory=list)


class OutreachSequence(BaseModel):
    """Output of Agent 12 — Outreach Copywriter."""

    model_config = {"extra": "ignore"}

    lead_id: int
    icp_id: int | None = None
    company_name: str
    contact_name: str | None = None
    persona: str = "unknown"  # CEO | HR | engineer | other — for tone
    steps: list[SequenceStep] = Field(default_factory=list)
    cta: str = ""
    sequence_quality_score: int = 0


# -- Agent 13 — Channel Strategy ------------------------------------------

class ChannelPlan(BaseModel):
    """Output of Agent 13 — Channel Strategy."""

    model_config = {"extra": "ignore"}

    lead_id: int
    icp_id: int | None = None
    company_name: str
    primary_channel: str = "email"  # email | linkedin | phone
    secondary_channel: str | None = None
    channel_sequence: list[str] = Field(default_factory=list)
    send_window_start_hour: int = 9  # local recipient time, 24h
    send_window_end_hour: int = 17
    timezone: str = "UTC"
    touches_per_week: int = 2
    rationale: str = ""


# -- Agent 14 — Orchestrator (log entries) --------------------------------

class OutreachLogEntry(BaseModel):
    """One entry written to outreach_log by Agent 14 per send attempt."""

    model_config = {"extra": "ignore"}

    lead_id: int
    icp_id: int | None = None
    company_name: str
    contact_email: str | None = None
    campaign_id: str | None = None  # Instantly campaign id (uuid string)
    instantly_lead_id: str | None = None
    channel: str = "email"
    step_number: int = 1
    variant_subject: str | None = None
    status: str = "queued"  # queued | sent | failed | dry_run | skipped
    error: str | None = None
    # Gmail send identifiers (direct-gmail path only; reply threading needs them)
    message_id: str | None = None
    thread_id: str | None = None


# -- Agent 15 — A/B Testing -----------------------------------------------

class ABTestResult(BaseModel):
    """One row per (campaign_id, step_number, variant_subject)."""

    model_config = {"extra": "ignore"}

    campaign_id: str
    step_number: int
    variant_subject: str
    sent_count: int = 0
    open_count: int = 0
    reply_count: int = 0
    open_rate: float = 0.0
    reply_rate: float = 0.0
    is_winner: bool = False
    sample_size_met: bool = False  # True once sent_count >= 50
    is_retired: bool = False  # True for non-winning variants once a winner is declared
