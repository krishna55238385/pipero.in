"""gtm_backend.service — FastAPI surface for the GTM product backend.

A clean, feature-named HTTP API that mirrors the deploy-time
``gtm_service`` trigger service, but delegates **in-process** to the
``gtm_backend`` feature modules instead of spawning ``python -m phaseN``
subprocesses.

Routes
------
    GET  /health            liveness
    POST /run/find          FIND stage  (phase1: ICP → leads → enrich → signals → score)
    POST /run/understand    UNDERSTAND  (phase2: account intel → stakeholders →
                            competitive → market sizing → GTM brief)
    POST /run/reach         REACH       (phase3: personalize → copywrite → channel → send)

Compatibility aliases for the existing trigger service paths are also
registered (``/run/phase1`` → find, ``/run/phase2`` → understand,
``/run/phase3`` → reach) so callers wired to ``gtm_service`` keep working.

Auth: all ``/run/*`` routes require ``Authorization: Bearer <GTM_TRIGGER_TOKEN>``
(same env var as ``gtm_service``); ``/health`` is open. If the token env var is
unset, auth is treated as not-configured and the route returns 503 — matching
``gtm_service``.

Import-safe: importing this module never starts a pipeline. If FastAPI is not
installed, ``app`` is ``None`` and importing still succeeds (so the smoke test
passes in minimal environments).

Run locally::

    uvicorn gtm_backend.service:app --reload --port 8080
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator, Optional

from gtm_backend import (
    account_intel,
    competitive,
    enrich,
    find_leads,
    gtm_brief,
    market_sizing,
    score,
    send,
    signals,
    stakeholders,
)
from gtm_backend import personalize as personalize_mod
from gtm_backend import copywriter as copywriter_mod
from gtm_backend import channel as channel_mod

try:  # FastAPI is optional so this module imports in minimal environments.
    from fastapi import Depends, FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel

    _HAVE_FASTAPI = True
except Exception:  # noqa: BLE001
    _HAVE_FASTAPI = False


# --------------------------------------------------------------------------- #
# Org tagging — mirror the trigger service: set GTM_ORG_ID for the run so every
# row the phases insert is tagged for the CRM tenant.
# --------------------------------------------------------------------------- #
@contextmanager
def _org_context(organization_id: Optional[str]) -> Iterator[None]:
    org = organization_id or os.getenv("GTM_ORG_ID") or None
    if not org:
        yield
        return
    previous = os.environ.get("GTM_ORG_ID")
    os.environ["GTM_ORG_ID"] = org
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("GTM_ORG_ID", None)
        else:
            os.environ["GTM_ORG_ID"] = previous


# --------------------------------------------------------------------------- #
# Pipeline stage runners (in-process; mirror the phaseN run-all chains)
# --------------------------------------------------------------------------- #
def run_find(
    prompt: Optional[str] = None,
    icp_id: Optional[int] = None,
    limit: Optional[int] = None,
    max_leads: int = 20,
) -> dict:
    """FIND stage. Apollo-style ``prompt`` defines a fresh ICP; otherwise an
    existing ``icp_id`` is re-run. Chains ICP → leads → enrich → signals → score.
    """
    if prompt:
        icp_id = find_leads.define_icp(prompt)
        find_leads.generate_leads(icp_id, max_leads)
    elif icp_id is not None:
        find_leads.generate_leads(icp_id, max_leads)
    else:
        raise ValueError("find requires either 'prompt' or 'icp_id'")

    lim = limit if limit is not None else 50
    enrich.enrich_leads(icp_id, lim)
    signals.detect_signals(icp_id, limit=lim)
    score.score_leads(mode="icp_id", icp_id=icp_id, limit=lim)
    return {"stage": "find", "icp_id": icp_id, "status": "completed"}


def run_understand(
    icp_id: Optional[int] = None,
    limit: Optional[int] = None,
    max_competitors: int = 5,
) -> dict:
    """UNDERSTAND stage: account intel → stakeholders → competitive →
    market sizing → GTM brief."""
    account_intel.build_account_intelligence(icp_id, limit)
    stakeholders.map_stakeholders(icp_id, limit)
    competitive.gather_competitive_intel(icp_id, max_competitors)
    market_sizing.size_markets()
    gtm_brief.generate_insights(icp_id, limit)
    return {"stage": "understand", "icp_id": icp_id, "status": "completed"}


def run_reach(
    icp_id: Optional[int] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
    sender: str = "instantly",
) -> dict:
    """REACH stage: personalize → copywrite → channel → send."""
    personalize_mod.run_personalisation(icp_id, limit)
    copywriter_mod.run_copywriting(icp_id, limit)
    channel_mod.run_channel_strategy(icp_id, limit)
    send.send_outreach(icp_id, limit, dry_run, sender)
    return {"stage": "reach", "icp_id": icp_id, "status": "completed"}


# --------------------------------------------------------------------------- #
# FastAPI app (only when FastAPI is installed)
# --------------------------------------------------------------------------- #
if _HAVE_FASTAPI:

    app = FastAPI(title="pipero GTM backend", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def require_token(authorization: Optional[str] = Header(default=None)) -> None:
        token = os.getenv("GTM_TRIGGER_TOKEN", "")
        if not token:
            raise HTTPException(status_code=503, detail="GTM_TRIGGER_TOKEN not configured")
        if authorization != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="invalid or missing bearer token")

    class FindRequest(BaseModel):
        organization_id: Optional[str] = None
        prompt: Optional[str] = None
        icp_id: Optional[int] = None
        limit: Optional[int] = None
        max: Optional[int] = 20

    class UnderstandRequest(BaseModel):
        organization_id: Optional[str] = None
        icp_id: Optional[int] = None
        limit: Optional[int] = None
        max_competitors: int = 5

    class ReachRequest(BaseModel):
        organization_id: Optional[str] = None
        icp_id: Optional[int] = None
        limit: Optional[int] = None
        dry_run: bool = False
        sender: str = "instantly"

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "service": "gtm-backend"}

    @app.post("/run/find", dependencies=[Depends(require_token)])
    def http_find(body: FindRequest) -> dict:
        try:
            with _org_context(body.organization_id):
                return run_find(
                    prompt=body.prompt,
                    icp_id=body.icp_id,
                    limit=body.limit,
                    max_leads=body.max or 20,
                )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/run/understand", dependencies=[Depends(require_token)])
    def http_understand(body: UnderstandRequest) -> dict:
        with _org_context(body.organization_id):
            return run_understand(
                icp_id=body.icp_id,
                limit=body.limit,
                max_competitors=body.max_competitors,
            )

    @app.post("/run/reach", dependencies=[Depends(require_token)])
    def http_reach(body: ReachRequest) -> dict:
        with _org_context(body.organization_id):
            return run_reach(
                icp_id=body.icp_id,
                limit=body.limit,
                dry_run=body.dry_run,
                sender=body.sender,
            )

    # Compatibility aliases for the existing gtm_service phase paths.
    @app.post("/run/phase1", dependencies=[Depends(require_token)])
    def http_phase1(body: FindRequest) -> dict:
        return http_find(body)

    @app.post("/run/phase2", dependencies=[Depends(require_token)])
    def http_phase2(body: UnderstandRequest) -> dict:
        return http_understand(body)

    @app.post("/run/phase3", dependencies=[Depends(require_token)])
    def http_phase3(body: ReachRequest) -> dict:
        return http_reach(body)

else:  # pragma: no cover - exercised only when FastAPI is absent
    app = None
