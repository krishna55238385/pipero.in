import re
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ICP(BaseModel):
    name: str
    product_line: str = "Core"
    industry: list[str] = Field(default_factory=list)
    geography: list[str] = Field(default_factory=list)
    company_size_min: int | None = None
    company_size_max: int | None = None
    revenue_range_min: int | None = None
    revenue_range_max: int | None = None
    business_stage: str | None = None
    buyer_titles: list[str] = Field(default_factory=list)
    user_titles: list[str] = Field(default_factory=list)
    blocker_titles: list[str] = Field(default_factory=list)
    pain_points: str | None = None

    @field_validator(
        "industry",
        "geography",
        "buyer_titles",
        "user_titles",
        "blocker_titles",
        mode="before",
    )
    @classmethod
    def _none_to_empty_list(cls, value: Any) -> Any:
        return [] if value is None else value


class Lead(BaseModel):
    """A company record. Contact fields filled in by Agent 03 (enrichment)."""

    icp_id: int
    company_name: str
    company_domain: str | None = None
    company_website: str | None = None
    company_phone: str | None = None
    company_address: str | None = None
    company_city: str | None = None
    company_state: str | None = None
    company_country: str | None = None
    company_industry: str | None = None
    company_size: int | None = None
    company_linkedin_url: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_title: str | None = None
    contact_linkedin_url: str | None = None
    verified: bool = False
    bounce_status: str | None = None
    source: str = "serpapi"
    sources: list[str] = Field(default_factory=list)
    raw_data: dict[str, Any] = Field(default_factory=dict)

    @field_validator("company_size", mode="before")
    @classmethod
    def _parse_company_size(cls, value: Any) -> int | None:
        """Accept '51-200 employees', '200+', '~150', etc. Pick the largest int found."""
        if value is None or value == "":
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            nums = re.findall(r"\d+", value)
            if not nums:
                return None
            return max(int(n) for n in nums)
        return None

    @field_validator("sources", mode="before")
    @classmethod
    def _none_to_empty_sources(cls, value: Any) -> Any:
        return [] if value is None else value

    @field_validator("raw_data", mode="before")
    @classmethod
    def _none_to_empty_raw_data(cls, value: Any) -> Any:
        return {} if value is None else value


class BuyingSignal(BaseModel):
    """A signal detected by Agent 04. Stored in the buying_signals table.

    Agent 04 gathers raw signal candidates (news, hiring, etc.) and feeds each
    candidate's (company, signal_text, source) to the LLM. The LLM returns
    (signal_type, buying_intent). Signals with intent='na' are discarded.
    """

    lead_id: int
    signal_type: str  # funding | hiring | leadership_change | expansion | competitor_complaint
    weight: int = Field(ge=1, le=10)
    score: int = Field(ge=0, le=100, default=0)  # 0-100 numeric signal strength
    signal_text: str
    signal_summary: str
    signal_source_url: str | None = None
    buying_intent: str  # high | low | na
    detected_at: datetime = Field(default_factory=_utc_now)


class SocialListeningLead(BaseModel):
    """A public-signal candidate detected by Agent 20. Stored in
    social_listening_leads, always as a human-review candidate — never
    auto-promoted into leads_raw (mirrors the "no blind automation on
    unverified data" pattern the rest of phase1 follows for company names).
    """

    icp_id: int | None = None
    platform: str = "web"  # reddit | twitter | forum | news | web
    signal_text: str
    source_url: str
    candidate_company: str | None = None
    candidate_person: str | None = None
    candidate_title: str | None = None
    matched_pain_point: str | None = None
    confidence: str = "low"  # high | medium | low
    status: str = "candidate"  # candidate | promoted | dismissed
    discovered_at: datetime = Field(default_factory=_utc_now)


class ScoreResult(BaseModel):
    lead_id: int
    icp_score: int = Field(ge=0, le=100)
    score_tier: str  # hot | warm | cold | disqualified
    score_breakdown: dict[str, Any]
    score_reasoning: str
    score_version: str = "v2.0"
