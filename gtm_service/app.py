"""GTM trigger service — FastAPI entrypoint.

Endpoints (all /run* and /ga4* require `Authorization: Bearer <GTM_TRIGGER_TOKEN>`):
  GET  /health                  -> liveness
  POST /run/{phase}             -> kick off phase1|phase2|phase3|prepare|signals (background), returns run_id
  GET  /runs/{run_id}           -> poll a run's status/logs
  POST /ga4/sync                -> ingest GA4 visitor signals (background)
  /track/*                      -> phase3 email open/unsubscribe tracking (mounted)

Deploy on an always-on host (Render/Railway). Vercel can't run this.
"""
from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from gtm_service import db, runner, scheduler
from gtm_service.config import config

# Reuse the existing phase3 email-tracking app (open pixel + unsubscribe page).
try:
    from phase3.tracking_server import app as tracking_app
except Exception:  # noqa: BLE001 - tracking is optional if phase3 deps missing
    tracking_app = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Start the background scheduler (worker ping + daily gtm_schedules)."""
    task: asyncio.Task | None = None
    if config.SCHEDULER_ENABLED:
        task = asyncio.create_task(scheduler.run_forever())
    else:
        print("[scheduler] disabled via SCHEDULER_ENABLED")
    yield
    if task is not None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="AI GTM Agency — GTM Trigger Service", version="1.0.0", lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if tracking_app is not None:
    app.mount("/track", tracking_app)


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
def require_token(authorization: Optional[str] = Header(default=None)) -> None:
    if not config.TRIGGER_TOKEN:
        raise HTTPException(status_code=503, detail="GTM_TRIGGER_TOKEN not configured")
    expected = f"Bearer {config.TRIGGER_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class RunRequest(BaseModel):
    organization_id: Optional[str] = None
    icp_id: Optional[int] = None
    limit: Optional[int] = None
    max: Optional[int] = None
    prompt: Optional[str] = None       # phase1 Apollo-style search
    dry_run: bool = False              # phase3
    sender: Optional[str] = None       # phase3: gmail | instantly
    campaign_id: Optional[str] = None  # phase3: stamp this CRM campaign on every outreach_log row
    triggered_by: Optional[str] = None  # CRM user id


class Ga4SyncRequest(BaseModel):
    organization_id: Optional[str] = None


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "gtm-trigger"}


@app.post("/run/{phase}", dependencies=[Depends(require_token)])
def run_phase(phase: str, body: RunRequest, background: BackgroundTasks) -> dict:
    if phase not in {"phase1", "phase2", "phase3", "prepare", "signals"}:
        raise HTTPException(
            status_code=400, detail="phase must be phase1|phase2|phase3|prepare|signals"
        )

    params = body.model_dump(exclude_none=True)
    org = body.organization_id or config.DEFAULT_ORG_ID or None
    label = runner.command_label(phase, params)

    try:
        run_id = db.create_phase_run(
            phase=phase,
            command=label,
            organization_id=org,
            icp_id=body.icp_id,
            params=params,
            triggered_by=body.triggered_by,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"could not create run: {exc}")

    background.add_task(runner.execute_run, run_id, phase, params, org)
    return {"run_id": run_id, "status": "queued", "command": label}


@app.get("/runs/{run_id}", dependencies=[Depends(require_token)])
def get_run(run_id: str) -> dict:
    run = db.get_phase_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return run


@app.post("/ga4/sync", dependencies=[Depends(require_token)])
def ga4_sync(body: Ga4SyncRequest, background: BackgroundTasks) -> dict:
    from gtm_service import ga4_ingest

    def _job() -> None:
        try:
            ga4_ingest.sync_all(body.organization_id)
        except Exception:  # noqa: BLE001 - errors are recorded per-connection
            pass

    background.add_task(_job)
    return {"status": "accepted"}
