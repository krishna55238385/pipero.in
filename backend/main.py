# Run with: uvicorn backend.main:app --reload --port 8000

from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from backend import db

app = FastAPI(title="AI GTM Agency — LLM Usage API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/usage/summary")
def usage_summary() -> dict[str, Any]:
    """Overall LLM usage totals, broken down by model and agent."""
    try:
        return db.get_usage_summary()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/timeline")
def usage_timeline(
    days: int = Query(default=7, ge=1, le=365, description="Number of days to look back"),
) -> list[dict[str, Any]]:
    """Per-day LLM usage for the last N days."""
    try:
        return db.get_usage_timeline(days=days)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/calls")
def usage_calls(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    agent: str = Query(default="", description="Filter by agent name"),
    model: str = Query(default="", description="Filter by model name"),
) -> dict[str, Any]:
    """Paginated raw LLM call log."""
    try:
        return db.get_usage_calls(limit=limit, offset=offset, agent=agent, model=model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/by-icp")
def usage_by_icp() -> list[dict[str, Any]]:
    """LLM usage cost grouped by ICP profile."""
    try:
        return db.get_usage_by_icp()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/by-phase")
def usage_by_phase() -> list[dict[str, Any]]:
    """LLM usage cost grouped by phase."""
    try:
        return db.get_usage_by_phase()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/by-agent")
def usage_by_agent() -> list[dict[str, Any]]:
    """LLM usage cost grouped by agent."""
    try:
        return db.get_usage_by_agent()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
