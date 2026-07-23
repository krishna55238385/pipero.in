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

## Table ownership transfer (2026-07-23)

Same class of issue as above, different table: adding Agent 16/17/18's new
columns to `outreach_replies` failed because that table (plus
`outreach_opens` and `outreach_unsubscribes`) was owned by `postgres`, not
`magnivo_app` — `ALTER TABLE ... ADD COLUMN` requires ownership, and the
`GRANT`s above don't cover it.

Fixed by transferring ownership outright (run once as `postgres` master):

```sql
ALTER TABLE outreach_replies OWNER TO magnivo_app;
ALTER TABLE outreach_opens OWNER TO magnivo_app;
ALTER TABLE outreach_unsubscribes OWNER TO magnivo_app;
```

These three tables are entirely phase3's own data (not shared with any other
system), so full ownership transfer — rather than another narrow grant — was
the right call: `magnivo_app` can now freely `ALTER`/add columns to them
going forward without hitting this again. If a *different* pre-existing
`postgres`-owned table needs a schema change later, it'll need the same
treatment (either a `REFERENCES` grant if only foreign keys are involved, or
an `OWNER TO` transfer if columns need to be added/altered).

**Credential hygiene:** the `postgres` master password was used again for
this operation (second use since the Agent 20 fix). It should be rotated
now — it hasn't been rotated since first being used, which is worth doing
before it's needed a third time.

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
