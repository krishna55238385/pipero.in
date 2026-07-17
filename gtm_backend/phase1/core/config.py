from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PHASE1_ROOT = Path(__file__).resolve().parent.parent
# Single project-wide .env at the repo root, shared by every phase.
# gtm_backend/phaseN/core/config.py -> repo root is two levels up (gtm_backend, then root)
REPO_ROOT = PHASE1_ROOT.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gemini_api_key: str
    # LLM model name — the single source of truth lives in the root .env
    # (GEMINI_MODEL). Required: never hardcode a model name in the project.
    gemini_model: str
    # Per-1M-token USD prices for GEMINI_MODEL (cost reporting only).
    gemini_input_cost_per_1m: float = 0.30
    gemini_output_cost_per_1m: float = 2.50
    serp_api_key: str
    database_url: str
    supabase_url: str
    supabase_key: str
    hunter_api_key: str | None = None
    # When set (a CRM organization UUID), every row this phase inserts is tagged
    # with organization_id so the integrated CRM can scope it to one tenant.
    # Injected by the trigger service per run; harmless/empty for standalone use.
    gtm_org_id: str | None = None


def get_settings() -> Settings:
    return Settings()
