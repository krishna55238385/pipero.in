# LLM Usage Dashboard

An **internal** tool (not the customer product) that monitors LLM / API usage and
cost for the team. It reads the `llm_usage` table from the shared Supabase project
and visualises totals by model and by agent.

Two parts:

| Part | Folder | Stack |
|------|--------|-------|
| **API** | `backend/` (this folder) | Python · FastAPI |
| **UI** | [`../frontend/`](../frontend/) | React · Vite · Recharts |

> Part of the Magnivo AI monorepo — see the [root README](../README.md) for the
> full project overview.

---

## Prerequisites

- Python 3.13 (use the repo-root `.venv`)
- Node.js 18+ and npm
- Access to the shared **Supabase** project (`SUPABASE_URL`, `SUPABASE_KEY`)

---

## Run the API (`backend/`)

The API reads `SUPABASE_URL` / `SUPABASE_KEY` (and optional `GTM_ORG_ID`) from the
environment, or from a `backend/.env` file. The simplest path is to use the
single root `.env` (export it, or copy the relevant keys into `backend/.env`).

```bash
# from the repo root
source .venv/bin/activate
pip install -r backend/requirements.txt        # first time only

uvicorn backend.main:app --reload --port 8000
# health check:
curl http://localhost:8000/health
```

Key endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | liveness |
| GET | `/api/usage/summary` | overall usage totals, by model and agent |

---

## Run the UI (`frontend/`)

```bash
cd frontend
npm install            # first time only
npm run dev            # http://localhost:5173
```

The Vite dev server proxies to the API on port 8000.

---

## Scripts (UI)

```bash
npm run dev       # start the Vite dev server
npm run build     # production build
npm run preview   # preview the production build
```
