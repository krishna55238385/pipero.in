"""Settings for phase2. Reads the single project-wide root .env shared by all phases."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PHASE2_ROOT = Path(__file__).resolve().parent.parent
# gtm_backend/phaseN/core/config.py -> repo root is two levels up (gtm_backend, then root)
REPO_ROOT = PHASE2_ROOT.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str
    # LLM model name — single source of truth is the root .env (OPENAI_MODEL).
    openai_model: str
    # Per-1M-token USD prices for OPENAI_MODEL (cost reporting only).
    openai_input_cost_per_1m: float = 0.15
    openai_output_cost_per_1m: float = 0.60
    serp_api_key: str
    supabase_url: str
    supabase_key: str
    hunter_api_key: str | None = None
    # CRM organization UUID; when set, every inserted row is tagged for tenancy.
    gtm_org_id: str | None = None


def get_settings() -> Settings:
    return Settings()
