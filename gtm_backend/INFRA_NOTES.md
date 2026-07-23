# Infra Notes — RDS / Database

Running log of infrastructure-level changes made outside of application code
(schema migrations, permission grants, service config) — the kind of thing
that's easy to forget was deliberate rather than a misconfiguration.

## Database

- **Engine:** Postgres, hosted on AWS RDS.
- **Host:** `magnivo-db.ctsk486cmn88.ap-south-1.rds.amazonaws.com`
- **App connects via:** `DATABASE_URL` in `/home/ubuntu/pipero.in/.env` (EC2),
  using the `magnivo_app` role — NOT the `postgres` superuser.
- Despite files being named `supabase.py`/`SupabaseError`, the app does **not**
  use Supabase's REST/JS client — it connects directly via `psycopg2`. The
  naming is legacy from an earlier Supabase-hosted setup.

## Permission grants (2026-07-22)

Applying Agent 20's schema (`social_listening_leads`, a new table with
foreign keys into `icp_profiles` and `leads_raw`) failed because `magnivo_app`
only had `USAGE` on schema `public` — `icp_profiles` and `leads_raw` are
owned by `postgres`, so the app role couldn't `CREATE` new tables or
reference existing ones as foreign keys.

Fixed with two grants, run once as the `postgres` master user:

```sql
-- Lets magnivo_app create new tables in the public schema going forward
-- (needed for every future agent that introduces its own table).
GRANT CREATE ON SCHEMA public TO magnivo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO magnivo_app;

-- Lets magnivo_app create foreign keys that reference tables owned by
-- postgres (icp_profiles, leads_raw) — schema-level CREATE alone doesn't
-- cover this; each referenced table needs its own REFERENCES grant.
GRANT REFERENCES ON icp_profiles, leads_raw TO magnivo_app;
```

**These are permanent role changes on the RDS instance**, not scoped to one
migration. If a future migration references a *different* pre-existing table
owned by `postgres` (not `icp_profiles`/`leads_raw`), it will need its own
additional `GRANT REFERENCES ON <table> TO magnivo_app;` — this fix doesn't
cover tables added later unless they're created by `magnivo_app` itself (new
tables it creates are automatically owned by it, no extra grant needed).

**Credential hygiene:** the `postgres` master password was used once for this
operation and should be treated as rotated/retired after use — it should not
be reused for routine work; the app always runs as `magnivo_app` via
`DATABASE_URL`.

## Known related issue (pre-existing, not caused by the above)

`GTM_ORG_ID` was previously missing from `/home/ubuntu/pipero.in/.env`
entirely, causing every lead phase1 generated to be written with
`organization_id = NULL` (invisible to the org-scoped CRM UI). Fixed same day
by adding the var to `.env` and confirming via `EnvironmentFile=` in
`magnivo.service` that it's actually loaded into the live process (don't
trust the `.env` file alone — verify with `sudo cat /proc/<pid>/environ`
after any env change). ~10,008 old NULL-org rows still exist DB-wide from
before this fix and before the ICP/org model existed; considered safe to
ignore. See session summary doc for full detail if needed.
