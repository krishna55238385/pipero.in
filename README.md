# Magnivo AI

**Magnivo AI** is an AI-powered GTM (go-to-market) lead-generation platform: an
AI agent pipeline finds, enriches, scores, researches and reaches out to leads,
and a Next.js CRM surfaces all of it live for the sales team.

This repository is a **monorepo with two systems**, each having a frontend and a
backend — **four runnable components** in total:

| # | Component | Folder | Stack | What it is |
|---|-----------|--------|-------|------------|
| 1 | **Magnivo AI — CRM (frontend)** | [`magnivo.ai/`](magnivo.ai/) | Next.js + Supabase + Clerk | The product the customer uses: prospecting, CRM, Engage email, analytics. |
| 2 | **GTM backend (the AI pipeline)** | [`gtm_backend/`](gtm_backend/) | Python (FastAPI + OpenAI) | The 15-agent GTM pipeline (find → understand → reach) the CRM runs on demand. |
| 3 | **LLM Usage Dashboard — API** | [`backend/`](backend/) | Python (FastAPI) | Internal tool: an LLM / API usage & cost monitor for the team. |
| 4 | **LLM Usage Dashboard — UI** | [`frontend/`](frontend/) | React + Vite | The dashboard UI for component 3. |

> **One Supabase project** is shared by everything. **One `.env` at the repo
> root** configures the Python side. See [`INTEGRATION.md`](INTEGRATION.md) for
> how the CRM and the GTM pipeline are wired together.

---

## Repository layout

```
.
├── magnivo.ai/          # 1. Magnivo AI CRM — Next.js front end (the product)
├── gtm_backend/         # 2. GTM AI pipeline — ONE consolidated Python backend
│   ├── find_leads.py …  #    feature-named modules (find / understand / reach)
│   ├── service.py       #    in-process FastAPI app
│   ├── phase1/          #    FIND     agents 01–05
│   ├── phase2/          #    UNDERSTAND agents 06–10
│   ├── phase3/          #    REACH    agents 11–15
│   └── gtm_service/     #    deploy-time trigger service the CRM calls (Render)
├── backend/             # 3. LLM usage dashboard — FastAPI API
├── frontend/            # 4. LLM usage dashboard — React/Vite UI
├── .env.example         # single project-wide env template (copy to .env)
└── INTEGRATION.md       # how the CRM ↔ GTM pipeline integrate
```

---

## Prerequisites

- **Python 3.13** (a `.venv` is used for all Python components)
- **Node.js 18+** and **npm**
- A **Supabase** project (URL + keys)
- An **OpenAI API key** and a **SerpAPI key** (for the GTM pipeline)

---

## 1. One-time setup

```bash
# clone
git clone https://github.com/krishna55238385/pipero.in.git
cd pipero.in        # the repo root (this monorepo)

# Python virtual env (used by gtm_backend AND the dashboard API)
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r gtm_backend/phase1/requirements.txt
pip install -r gtm_backend/gtm_service/requirements.txt
pip install -r backend/requirements.txt

# Single root .env — copy the template and fill in your keys
cp .env.example .env
# then edit .env: OPENAI_API_KEY, OPENAI_MODEL, SERP_API_KEY,
#                 SUPABASE_URL, SUPABASE_KEY, … (see comments in the file)
```

> **Important:** there is a **single `.env` at the repo root**. The GTM pipeline
> (`gtm_backend`, all phases) and the dashboard API read from it. After editing
> `.env`, restart any running Python service to pick up the changes.

---

## 2. Run each component

### Component 1 — Magnivo AI CRM (frontend)

The customer-facing product. Needs its own `magnivo.ai/.env.local` (Supabase +
Clerk keys + the GTM trigger-service URL/token).

```bash
cd magnivo.ai
cp .env.local.example .env.local     # fill Supabase, Clerk, GTM_SERVICE_URL/TOKEN
npm install
npm run dev                          # http://localhost:3000
```

See [`magnivo.ai/README.md`](magnivo.ai/README.md) for the full env list and
Vercel deployment steps.

### Component 2 — GTM backend (the AI pipeline)

The GTM pipeline lives in **`gtm_backend/`** and reads the root `.env`.

**a) Unified CLI** — run the pipeline by hand (feature-named subcommands):

```bash
source .venv/bin/activate

# FIND
python -m gtm_backend find --prompt "Series B fintechs in the EU" --max 20
python -m gtm_backend find-all --prompt "..." --max 20   # ICP→leads→enrich→signals→score
# UNDERSTAND
python -m gtm_backend understand-all --icp 1
# REACH
python -m gtm_backend reach-all --icp 1 --sender gmail --dry-run
```

(The legacy per-phase CLIs still work too: `python -m gtm_backend.phase1 run-all …`)

**b) Trigger service** — the HTTP service the CRM calls (Vercel can't run Python):

```bash
source .venv/bin/activate
export GTM_TRIGGER_TOKEN=dev-token
uvicorn gtm_backend.gtm_service.app:app --reload --port 8080
# health: curl localhost:8080/health
```

Point the CRM at it via `GTM_SERVICE_URL=http://localhost:8080` and
`GTM_SERVICE_TOKEN=dev-token` in `magnivo.ai/.env.local`.
Deploy it with `gtm_backend/gtm_service/render.yaml` (Render Blueprint) —
see [`gtm_backend/gtm_service/README.md`](gtm_backend/gtm_service/README.md).

### Component 3 — LLM Usage Dashboard API

An internal FastAPI service that reads `llm_usage` from Supabase and reports
cost/usage. Reads `SUPABASE_URL` / `SUPABASE_KEY` from the environment (or a
`backend/.env`).

```bash
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000     # http://localhost:8000
# health: curl localhost:8000/health
```

### Component 4 — LLM Usage Dashboard UI

The React/Vite dashboard that talks to component 3.

```bash
cd frontend
npm install
npm run dev                                        # http://localhost:5173
```

---

## 3. Quick start (everything at once)

Open four terminals from the repo root:

```bash
# 1) Magnivo AI CRM
cd magnivo.ai && npm run dev                                   # :3000

# 2) GTM trigger service
source .venv/bin/activate && uvicorn gtm_backend.gtm_service.app:app --reload --port 8080   # :8080

# 3) LLM usage dashboard API
source .venv/bin/activate && uvicorn backend.main:app --reload --port 8000                  # :8000

# 4) LLM usage dashboard UI
cd frontend && npm run dev                                     # :5173
```

---

## 4. Tests

The Python GTM pipeline is covered by a hermetic (offline-mocked) test suite:

```bash
source .venv/bin/activate
python -m pytest gtm_backend -q
# 152 passed
```

---

## 5. Deployment

| Component | Where |
|-----------|-------|
| Magnivo AI CRM (`magnivo.ai/`) | **Vercel** (Next.js) |
| GTM trigger service (`gtm_backend/gtm_service/`) | **Render** / Railway (Docker) — `render.yaml` blueprint |
| LLM usage dashboard | run internally (API + Vite UI) |

All components share **one Supabase project**. The GTM trigger service must be
on an always-on host (Vercel can't run the Python pipeline).
