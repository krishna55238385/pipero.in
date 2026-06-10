"""Environment configuration for the GTM trigger service.

All values come from OS environment variables so the same image runs on
Render/Railway with secrets injected by the platform. The phase pipelines
themselves read their own OPENAI/SERP/SUPABASE keys from the environment too
(pydantic BaseSettings reads real env vars), so set those on the host as well.
"""
import os
from pathlib import Path

# Repo root = parent of this package (so `python -m phase1` resolves).
REPO_ROOT = Path(__file__).resolve().parent.parent


class Config:
    # --- Supabase (the single shared CRM project) ---------------------------
    # The service writes phase_runs / visitor signals with a service-role key.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_KEY: str = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SERVICE_KEY")
        or os.getenv("SUPABASE_KEY", "")
    )

    # --- Auth: shared bearer token the CRM sends on every trigger call ------
    TRIGGER_TOKEN: str = os.getenv("GTM_TRIGGER_TOKEN", "")

    # --- Execution ----------------------------------------------------------
    PYTHON_BIN: str = os.getenv("GTM_PYTHON_BIN", "python")
    REPO_ROOT: str = os.getenv("GTM_REPO_ROOT", str(REPO_ROOT))
    # Hard ceiling per individual CLI step (seconds).
    STEP_TIMEOUT: int = int(os.getenv("GTM_STEP_TIMEOUT", "1800"))
    # Default org used when a request omits organization_id (single-tenant dev).
    DEFAULT_ORG_ID: str = os.getenv("GTM_ORG_ID", "")

    # --- GA4 ingest (optional) ---------------------------------------------
    # The service-account JSON, inline (GA4_SA_JSON) or a file path (GA4_SA_FILE).
    GA4_SA_JSON: str = os.getenv("GA4_SA_JSON", "")
    GA4_SA_FILE: str = os.getenv("GA4_SA_FILE", "")

    # --- Scheduler / CRM integration -----------------------------------------
    # Base URL of the pipero.in CRM (used to ping its engage campaign worker).
    # Leave blank to skip the worker ping entirely.
    CRM_BASE_URL: str = os.getenv("CRM_BASE_URL", "")
    # Shared secret sent as x-worker-token to {CRM_BASE_URL}/api/engage/worker.
    ENGAGE_WORKER_TOKEN: str = os.getenv("ENGAGE_WORKER_TOKEN", "")
    # Master switch for the background scheduler loop (gtm_schedules + worker ping).
    SCHEDULER_ENABLED: bool = (
        os.getenv("SCHEDULER_ENABLED", "true").strip().lower()
        not in {"0", "false", "no", "off"}
    )

    @classmethod
    def require(cls, *names: str) -> None:
        missing = [n for n in names if not getattr(cls, n, "")]
        if missing:
            raise RuntimeError(
                f"Missing required env for gtm_service: {', '.join(missing)}"
            )


config = Config()
