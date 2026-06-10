# GTM Trigger Service

A thin FastAPI service that lets the **pipero.in CRM** run the Python
`phase1` / `phase2` / `phase3` pipelines on demand (Vercel can't run Python),
ingest GA4 website-visitor signals, and serve the phase3 email open/unsubscribe
tracking endpoints — all writing into the **same Supabase project the CRM reads**.

```
CRM button → Next.js server action (actions/gtm.ts)
           → POST {SERVICE}/run/phase1   (Authorization: Bearer GTM_TRIGGER_TOKEN)
           → subprocess `python -m phase1 run-all ...` with GTM_ORG_ID set
           → rows land in Supabase (leads_raw, buying_signals, ...)
           → CRM reads them live (Prospects, Company tabs, Engage)
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/run/phase1` | `{prompt}` (Apollo search) or `{icp_id, limit, max}` → find → enrich → signals → score |
| POST | `/run/phase2` | `{icp_id, limit}` → account intel → stakeholders → competitive → market → GTM briefs |
| POST | `/run/phase3` | `{icp_id, limit, dry_run, sender}` → personalise → copy → channel → send |
| GET | `/runs/{run_id}` | poll status + logs (also in the `phase_runs` table) |
| POST | `/ga4/sync` | `{organization_id}` → ingest GA4 → `website_visitor_signals` (+ `buying_signals`) |
| * | `/track/open`, `/track/unsubscribe` | phase3 email pixel + unsubscribe (set `TRACKING_BASE_URL=<svc>/track`) |

All `/run*` and `/ga4*` calls require `Authorization: Bearer $GTM_TRIGGER_TOKEN`.
Every request may pass `organization_id`; it is injected as `GTM_ORG_ID` so all
rows the run produces are tagged for that CRM tenant.

## Run locally

```bash
# from the repo root
pip install -r gtm_service/requirements.txt
export SUPABASE_URL=... SUPABASE_KEY=... GTM_TRIGGER_TOKEN=dev-token
export OPENAI_API_KEY=... SERP_API_KEY=...
uvicorn gtm_service.app:app --reload --port 8080
```

## Deploy (Render)

1. Push the repo to GitHub.
2. Render → New → Blueprint → pick `gtm_service/render.yaml`.
3. Fill the `sync: false` secrets (Supabase, OpenAI, SerpAPI, Gmail/Instantly, GA4).
4. After first deploy, set `TRACKING_BASE_URL` to `https://<service>.onrender.com/track`.
5. Copy the generated `GTM_TRIGGER_TOKEN` into the CRM env as `GTM_SERVICE_TOKEN`,
   and set `GTM_SERVICE_URL=https://<service>.onrender.com` in the CRM.

Railway: create a service from `gtm_service/Dockerfile` (build context = repo root)
and set the same environment variables.

## Notes

- The phase pipelines read their own `OPENAI_API_KEY` / `SERP_API_KEY` /
  `SUPABASE_URL` / `SUPABASE_KEY` from the environment (pydantic settings), so set
  those on the host — no `.env` file is required in the container.
- GA4 company-level identity needs a reverse-IP provider writing a custom
  dimension; set `GA4_COMPANY_DIMENSION` to light up company matching + the
  `website_visit` buying-signal mirror. Without it you still get aggregate intent.
