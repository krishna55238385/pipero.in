# Run with: uvicorn backend.main:app --reload --port 8000

from typing import Any

from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm

from backend import db
from backend.auth import (
    authenticate_user,
    create_access_token,
    get_current_active_user,
    get_super_admin,
    _fake_user_db,
    get_password_hash,
)

app = FastAPI(title="AI GTM Agency — LLM Usage API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Authentication Endpoints ----------
@app.post("/auth/register")
async def register_user(form_data: OAuth2PasswordRequestForm = Depends()):
    if form_data.username in _fake_user_db:
        raise HTTPException(status_code=400, detail="Username already exists")
    hashed_pw = get_password_hash(form_data.password)
    user = {
        "username": form_data.username,
        "email": form_data.username,  # placeholder; adjust as needed
        "hashed_password": hashed_pw,
        "role": "user",
    }
    _fake_user_db[form_data.username] = user  # type: ignore[arg-type]
    return {"msg": "User registered"}

@app.post("/auth/login")
async def login_user(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer"}

# ---------- Protected API Endpoints ----------
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/usage/summary")
def usage_summary(current_user: Any = Depends(get_current_active_user)) -> dict[str, Any]:
    """Overall LLM usage totals, broken down by model and agent."""
    try:
        return db.get_usage_summary()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/timeline")
def usage_timeline(
    days: int = Query(default=7, ge=1, le=365, description="Number of days to look back"),
    current_user: Any = Depends(get_current_active_user),
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
    current_user: Any = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Paginated raw LLM call log."""
    try:
        return db.get_usage_calls(limit=limit, offset=offset, agent=agent, model=model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/by-icp")
def usage_by_icp(current_user: Any = Depends(get_current_active_user)) -> list[dict[str, Any]]:
    """LLM usage cost grouped by ICP profile."""
    try:
        return db.get_usage_by_icp()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/by-phase")
def usage_by_phase(current_user: Any = Depends(get_current_active_user)) -> list[dict[str, Any]]:
    """LLM usage cost grouped by phase."""
    try:
        return db.get_usage_by_phase()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/usage/by-agent")
def usage_by_agent(current_user: Any = Depends(get_current_active_user)) -> list[dict[str, Any]]:
    """LLM usage cost grouped by agent."""
    try:
        return db.get_usage_by_agent()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

# ---------- Super Admin Example Endpoint ----------
@app.get("/admin/health")
def admin_health(admin: Any = Depends(get_super_admin)) -> dict[str, str]:
    return {"status": "admin ok"}
