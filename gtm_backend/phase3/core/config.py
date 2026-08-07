"""Settings for phase3.

Reads the single project-wide root .env (../.env) shared by every phase. All
keys — the shared API keys and the phase-3-only credentials (GMAIL_*,
INSTANTLY_API_KEY, TRACKING_BASE_URL, …) — live in that one file.
"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PHASE3_ROOT = Path(__file__).resolve().parent.parent
# gtm_backend/phaseN/core/config.py -> repo root is two levels up (gtm_backend, then root)
REPO_ROOT = PHASE3_ROOT.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str
    # LLM model name — single source of truth is the root .env (OPENAI_MODEL).
    openai_model: str
    # Per-1M-token USD prices for OPENAI_MODEL (cost reporting only; unused
    # while phase3 is pointed at Groq — kept for an easy revert).
    openai_input_cost_per_1m: float = 0.15
    openai_output_cost_per_1m: float = 0.60
    # Per-1M-token USD prices for phase3's actual Groq model
    # (llama-3.3-70b-versatile), mirrors phase1/core/config.py. Distinct field
    # from openai_input/output_cost_per_1m above so a revert to real OpenAI
    # doesn't require touching this value.
    groq_input_cost_per_1m: float = 0.59
    groq_output_cost_per_1m: float = 0.79
    serp_api_key: str
    database_url: str
    supabase_url: str
    supabase_key: str
    hunter_api_key: str | None = None
    instantly_api_key: str | None = None
    # CRM organization UUID; when set, every inserted row is tagged for tenancy.
    gtm_org_id: str | None = None

    # -- Gmail direct-send (Agent 14, --sender gmail) --------------------
    # A Gmail address + 16-char app password (https://myaccount.google.com/apppasswords).
    # When unset, the gmail sender is "not configured" and every send is a no-op.
    gmail_address: str | None = None
    gmail_app_password: str | None = None

    # -- Gmail via OAuth (Agent 14 default sender) -----------------------
    # Official OAuth client creds (same client the CRM uses) — used to refresh
    # the token of the mailbox connected in the CRM's Engage module, so outreach
    # sends through that official account. No personal Gmail / app password.
    google_client_id: str | None = None
    google_client_secret: str | None = None

    # Public base URL of the phase3 tracking server (phase3/tracking_server.py).
    # Used to build the open-tracking pixel and unsubscribe link embedded in
    # every email. e.g. "https://track.yourdomain.com" or an ngrok URL.
    tracking_base_url: str | None = None

    # Brand name shown in the email footer ("You are receiving this from …").
    email_brand_name: str = "AI GTM Agency"

    # Reputation guardrails for the gmail sender.
    daily_send_cap: int = 50          # max emails per orchestration run
    send_throttle_min_seconds: float = 0.0   # random inter-send delay lower bound
    send_throttle_max_seconds: float = 0.0   # random inter-send delay upper bound

    # When True, the gmail sender skips any lead whose recipient-local time is
    # outside its channel plan's [send_window_start_hour, send_window_end_hour)
    # (PDF Agent 14 rule: no sends before 8am or after 6pm local time). Turn off
    # for an immediate blast or when recipient timezones are unknown/unreliable.
    enforce_send_window: bool = True

    # -- Cal.com (Agent 22 — Meeting Booking) -----------------------------
    # v1: one shared Cal.com account for the whole platform (not per-org) —
    # matches where the business actually is today (single client, Jobraux).
    # Multi-tenant calendar isolation (each client connecting their own
    # calendar) is a PDF Agent 47/48 concern, deliberately deferred until
    # there's an actual second client to design it against.
    calcom_api_key: str | None = None
    calcom_event_type_id: int | None = None

    # NOTE: no global seller_product_description setting. The CRM is
    # multi-tenant (PDF Agent 47/48: each organization is a separate client
    # business, isolated from every other client) — a single shared product
    # description would be wrong for every org but one. Agents 25/27 instead
    # look up each deal's own organization's product_description via
    # supabase.get_org_product_description(deal["organization_id"]), reading
    # a per-org column on the CRM's `organizations` table.


def get_settings() -> Settings:
    return Settings()
