# GTM Backend ↔ Magnivo AI CRM — Integration Guide

This wires the Python **phase1 / phase2 / phase3** GTM pipelines into the
**Magnivo AI** Next.js CRM so every lead, signal, account brief and outreach the
backend produces shows up — live — in the CRM UI, and the CRM can trigger the
pipelines on demand.

```
                         ┌─────────────────────────────────────────┐
   CRM (Vercel)          │            ONE Supabase project          │
   magnivo.ai  ──reads──▶ │  CRM tables (leads, companies, engage…)  │
      │                  │  + GTM tables (leads_raw, buying_signals,│
      │  "Run" button     │    account_intelligence, outreach_*, …)  │
      ▼                  └──────────────▲───────────────────────────┘
   actions/gtm.ts ──POST /run/phaseN──▶ │ writes
                                gtm_service (Render/Railway, Python)
                                  └ subprocess `python -m gtm_backend.phaseN …` (GTM_ORG_ID set)
                                  └ GA4 ingest → website_visitor_signals
                                  └ /track/open · /track/unsubscribe (email pixel)
```

**Key idea:** the phases and the CRM share **one** Supabase database, so results
appear in the CRM the instant a pipeline writes them — no ETL, no sync.

---

## What was added

**DB migrations** (`magnivo.ai/supabase/migrations/`)
- `20260610000000_gtm_phase_tables.sql` — all phase1/2/3 tables, each with a
  nullable `organization_id` (RLS disabled, matching the CRM convention).
- `20260610000100_gtm_crm_bridge.sql` — bridge columns
  (`leads.leads_raw_id`, `leads.verified/bounce_status`,
  `companies.domain/linkedin_url/size_estimate`, `contacts.linkedin_url/…`),
  the `phase_runs` job table, the `gtm_promote_lead()` function and the
  **auto-promote-hot-leads** trigger.
- `20260610000200_gtm_ga4_visitors.sql` — `ga4_connections` + `website_visitor_signals`.

**Python** — `phase{1,2,3}/connectors/supabase.py` now tag every insert with
`organization_id` from `GTM_ORG_ID` (no-op when unset, so standalone use and the
110 existing tests are unaffected).

**gtm_service/** — FastAPI trigger service (run phases, GA4 sync, email tracking).
See `gtm_service/README.md`.

**CRM frontend**
- `src/app/actions/gtm.ts` — all GTM reads + `runPhase*` triggers + `promoteLead`
  + brief approve/reject.
- Prospects pages wired to real data: **Leads** (Apollo-style search, per-lead
  signals, verified/pattern email, promote), **Signals**, **Companies**,
  **Visitors** (GA4), **AI Search**, **ICP & Pipelines** (new).
- Lead detail gets a **GTM Intelligence** section (account intel, buying
  committee, competitors, GTM brief + approve, outreach).
- Analytics gets **Market Sizing** + **AI Pipeline Cost** cards.
- Engage send route enforces the **unsubscribe suppression** list + logs sends.

---

## Setup (fresh Supabase project)

### 1. Create the Supabase project
Create a new project at https://supabase.com. Note the **Project URL**, **anon
key**, **service-role key**, and the **db password** (for the CLI).

### 2. Apply ALL migrations (CRM + GTM, in timestamp order)
From `magnivo.ai/`:
```bash
npx supabase link --project-ref <your-ref>
npx supabase db push          # applies every file in supabase/migrations/
```
(Or paste each `supabase/migrations/*.sql` into the Supabase SQL editor in
filename order — the three `20260610*` files come last.)

### 3. Seed an organization + user, grab the org UUID
```bash
node seed_users.mjs           # or: npm run create-super-admin-krishna
```
Then copy the organization's UUID:
```sql
select id, name from organizations limit 1;
```

### 4. Configure the CRM
Copy `magnivo.ai/.env.local.example` → `magnivo.ai/.env.local` and fill Supabase
keys + `GTM_SERVICE_URL` / `GTM_SERVICE_TOKEN`. Then:
```bash
cd magnivo.ai && npm install && npm run dev
```

### 5. Deploy the trigger service
Follow `gtm_service/README.md` (Render Blueprint = `gtm_service/render.yaml`).
Set on the service:
- `SUPABASE_URL` = the project URL, `SUPABASE_KEY` = **service-role** key
- `OPENAI_API_KEY`, `SERP_API_KEY` (+ optional `HUNTER_API_KEY`)
- `GMAIL_ADDRESS` + `GMAIL_APP_PASSWORD` (phase3 Gmail sender — default)
- `GTM_ORG_ID` = the org UUID from step 3 (default tenant; the CRM also passes it per request)
- `TRACKING_BASE_URL` = `https://<service>.onrender.com/track`
- (optional) `GA4_SA_JSON`, `GA4_COMPANY_DIMENSION`
Copy the generated `GTM_TRIGGER_TOKEN` into the CRM's `GTM_SERVICE_TOKEN`.

---

## How it flows (matches the meeting)

- **Apollo-style search** → Prospects → AI Search (or Leads → Search with AI):
  type a prompt → `runPhase1Search` → service runs find→enrich→signals→score →
  rows land in `leads_raw`/`buying_signals` → **auto-stored**, visible in Leads.
- **2–3 leads per account, each with its own signals** → `account_stakeholders`
  + per-lead `buying_signals`; combined per company on the Companies view and
  the lead detail.
- **Signals** (funding / product launch / acquisition / layoffs / news keywords)
  → Prospects → Signals.
- **Who visited our website** → Prospects → Visitors (GA4) → connect a property,
  Sync now.
- **Emails** → verified emails show a green **Verified** badge, otherwise a
  **Pattern** (first.last@domain) badge; send from Engage (unsubscribes are
  suppressed) or run bulk outreach via ICP → "Reach out" (phase3, Gmail).
- **Hot leads auto-promote** into CRM `leads`/`companies`/`contacts`; warmer ones
  promote on demand with the **Promote** button.

---

## Smoke test

1. `select count(*) from leads_raw;` after an AI search → grows.
2. Prospects → Leads shows the new rows with score + signals + email badge.
3. Click **Promote** → a row appears in CRM → Leads (`leads.leads_raw_id` set).
4. Score a lead `hot` → it auto-appears in CRM Leads (trigger).
5. Lead detail → **GTM Intelligence** tabs populate after phase2/phase3.
6. Engage send to an address in `outreach_unsubscribes` → blocked (409).

---

## Notes
- **RLS is disabled** in this project (CRM convention); org isolation is enforced
  in the server-action layer. Enable RLS later for hardening if desired.
- **GA4 company identity** needs a reverse-IP provider writing a custom dimension
  (`GA4_COMPANY_DIMENSION`); without it you still get aggregate visit intent.
- The phases remain runnable standalone (CLI) — `GTM_ORG_ID` is the only new env.
