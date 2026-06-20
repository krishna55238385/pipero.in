"""Environment configuration for the GTM trigger service.

All values come from OS environment variables so the same image runs on
Render/Railway with secrets injected by the platform. The phase pipelines
themselves read their own OPENAI/SERP/SUPABASE keys from the environment too
(pydantic BaseSettings reads real env vars), so set those on the host as well.
"""
import os
from pathlib import Path

# Repo root = two levels up (gtm_backend, then root) so `python -m gtm_backend.phase1` resolves.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _load_root_env() -> None:
    """Best-effort load of the repo-root .env into os.environ.

    Dependency-free (no python-dotenv) so the service runs the same whether the
    platform injects secrets (Render/Railway) or they sit in a local .env. Vars
    already present in the environment ALWAYS win — we only fill in the missing
    ones — so host/command-line overrides are never clobbered. This is what makes
    "set GA4_SA_FILE in .env, restart gtm_service" reliably take effect regardless
    of how the process is launched. Parses simple KEY=VALUE lines (ignoring blanks,
    # comments, optional `export ` prefixes, and surrounding quotes).
    """
    env_path = REPO_ROOT / ".env"
    try:
        if not env_path.exists():
            return
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                val = val[1:-1]
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:  # noqa: BLE001 - never let env parsing crash startup
        pass


# Load .env BEFORE Config reads os.getenv at class-definition time.
_load_root_env()


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
    # Base URL of the Magnivo AI CRM (used to ping its engage campaign worker).
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
