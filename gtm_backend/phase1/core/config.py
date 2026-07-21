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

    openai_api_key: str
    # LLM model name — the single source of truth lives in the root .env
    # (OPENAI_MODEL). Required: never hardcode a model name in the project.
    openai_model: str
    # Per-1M-token USD prices for OPENAI_MODEL (cost reporting only).
    openai_input_cost_per_1m: float = 0.15
    openai_output_cost_per_1m: float = 0.60
    # Per-1M-token USD prices for phase1's actual Groq model (llama-3.3-70b-versatile).
    # Distinct from openai_input/output_cost_per_1m above, which phase2/phase3 use
    # for their real OpenAI gpt-4o-mini calls — sharing one field would mis-price
    # whichever phase didn't match the value.
    groq_input_cost_per_1m: float = 0.59
    groq_output_cost_per_1m: float = 0.79
    serp_api_key: str
    # Optional fallback search provider — used when SerpAPI returns 429 (quota
    # exhausted). Unset = no fallback, same behaviour as before (SerpQuotaError
    # propagates and callers use their existing LLM-knowledge fallback, if any).
    serper_api_key: str | None = None
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
