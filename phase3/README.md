# Phase 3 — REACH

Five agents that craft the right message, on the right channel, at the right time. Phase 3 turns the intelligence Phase 2 produced into actual outbound sequences sent through Instantly AI.

| Agent | What it does | Reads | Writes |
|------:|--------------|-------|--------|
| 11 | **Personalisation** — 2–3 verifiable angles per lead (trigger / pain / competitive / role) | `leads_raw`, `gtm_insights`, `account_intelligence` | `outreach_personalisations` |
| 12 | **Outreach Copywriter** — 5-step sequence (intro + 3 follow-ups + breakup), 2 subject variants per step | `outreach_personalisations`, `account_intelligence` | `outreach_sequences` |
| 13 | **Channel Strategy** — channel order, send window, cadence per lead | `icp_profiles`, `account_intelligence`, contact title | `outreach_channel_plans` |
| 14 | **Omnichannel Orchestrator** — sends outreach via **Instantly** (campaign hand-off) *or* **direct Gmail** (`--sender gmail`); `--dry-run` safe | `outreach_sequences`, `outreach_channel_plans`, `outreach_unsubscribes` | `outreach_log` + Instantly/Gmail |
| 15 | **A/B Testing** — pulls Instantly analytics, scores variants, retires losers | `outreach_log` + Instantly analytics | `ab_test_results` |

The package layout mirrors `phase1/` and `phase2/` (`agents/`, `connectors/`, `core/`, `data/`, `tests/`).

## Setup

Phase 3 loads **two** env files: it inherits the shared keys (OpenAI/SerpAPI/Supabase/Hunter) from `phase1/.env`, and reads its **own `phase3/.env`** for phase-3-specific keys (Gmail, Instantly, tracking). Values in `phase3/.env` override `phase1/.env`. Put Agent 14's sending keys in `phase3/.env`, next to the code that uses them:

```bash
# add to phase3/.env
INSTANTLY_API_KEY=your_key_here
```

Without `INSTANTLY_API_KEY`, every Agent 14 (instantly) send is a no-op (use `--dry-run`); the rest of the pipeline still works.

```bash
# from the project root
pip install -r phase3/requirements.txt
```

No new pip dependencies versus phase2 — `httpx`, `pydantic`, `tenacity`, and `openai` are already pinned.

Apply the SQL schema once:

```bash
python -m phase3 print-schema | pbcopy   # then paste into Supabase → SQL editor → Run
# or copy phase3/data/schema.sql directly
```

## CLI usage

```bash
# end-to-end — chains 11 → 12 → 13 → 14 (15 skipped until live data exists)
python -m phase3 run-all --icp 1

# dry-run — Agents 11/12/13 still write to Supabase, Agent 14 prints what it
# would send to Instantly without actually creating a campaign
python -m phase3 run-all --icp 1 --dry-run

# scope to a specific number of leads (useful for testing)
python -m phase3 run-all --icp 1 --limit 5 --dry-run

# per-agent
python -m phase3 personalise       --icp 1
python -m phase3 copywrite         --icp 1
python -m phase3 channel-strategy  --icp 1
python -m phase3 orchestrate       --icp 1 --dry-run
python -m phase3 ab-test           --campaign-id <id>
```

`run-all` chains `11 → 12 → 13 → 14` in sequence. Agent 15 is excluded from `run-all` because it requires live opens/replies from an active Instantly campaign — run it on its own once the campaign has been live long enough to collect ≥50 sends per variant.

`--limit` is optional on all commands. When omitted, every qualifying lead in `leads_raw` is processed. All agent writes are idempotent (upsert), so re-running is safe.

`--dry-run` only affects Agent 14: the orchestrator builds and logs the would-be Instantly campaign but never calls the live API. Use it whenever `INSTANTLY_API_KEY` is unset or you want to inspect output before burning email quota.

## Sending mode B — direct Gmail (ported from the n8n "Email Outreach" automation)

Agent 14 has a second sender that **sends the intro email itself over Gmail SMTP**, instead of handing the campaign to Instantly. It is a faithful Python port of the n8n workflow in `docs/Email Outreach Automation.json`, keeping the parts that matter for cold outreach and dropping the Google-Sheets/Telegram plumbing:

| n8n node | Python equivalent |
|----------|-------------------|
| Gmail "Send a message" | `phase3/connectors/gmail_smtp.py` (SMTP + app password) |
| HTML node (template + tracking pixel) | `phase3/core/email_render.py` |
| `/open` webhook (read status) | `phase3/tracking_server.py` → `outreach_opens` (deduped) |
| `/unsubscribe` webhook | `phase3/tracking_server.py` → `outreach_unsubscribes` |
| Random 1–5 min `Wait` (throttle) | `SEND_THROTTLE_MIN/MAX_SECONDS` |
| `Limit` (Cap) | `DAILY_SEND_CAP` |
| Telegram compose/approve | replaced by the Agent 11→13 pipeline + `--dry-run` review |

What the Gmail sender enforces (deterministically, in Python — not just via prompt):

- **Unsubscribe suppression** — never emails an address present in `outreach_unsubscribes`.
- **No double-send** — skips any lead already logged `status='sent'`.
- **Daily cap** — stops after `DAILY_SEND_CAP` sends per run (reputation guard).
- **Throttle** — randomised delay between sends (`SEND_THROTTLE_MIN/MAX_SECONDS`).
- **Verified-email gate** — same `bounce_status` skip as the Instantly path.
- **Even A/B split** — alternates the two intro subject variants ~50/50 across the batch and logs which one each lead got.
- **Open tracking + one-click unsubscribe** — every email carries a 1×1 pixel and an unsubscribe link (plus `List-Unsubscribe` headers).

### Setup (Gmail mode)

Add to **`phase3/.env`** (phase-3-specific keys live here; shared keys stay in phase1/.env):

```bash
GMAIL_ADDRESS=you@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx        # 16-char app password, not your login password
TRACKING_BASE_URL=https://your-public-host  # phase3/tracking_server.py; blank = send without tracking
EMAIL_BRAND_NAME=AI GTM Agency
DAILY_SEND_CAP=50
SEND_THROTTLE_MIN_SECONDS=20               # optional; 0 = no delay
SEND_THROTTLE_MAX_SECONDS=90
```

App password: https://myaccount.google.com/apppasswords (requires 2-Step Verification on the Google account).

### Run the tracking server (for open/unsubscribe)

```bash
pip install -r phase3/requirements.txt          # adds fastapi + uvicorn
uvicorn phase3.tracking_server:app --host 0.0.0.0 --port 8080
# expose it publicly (e.g. `ngrok http 8080`) and set TRACKING_BASE_URL to that https URL
```

### Send via Gmail

```bash
# preview only — renders the HTML + logs, sends nothing
python -m phase3 orchestrate --icp 1 --sender gmail --dry-run

# real send (needs GMAIL_* configured); chain the whole pipeline:
python -m phase3 run-all --icp 1 --sender gmail
```

If `GMAIL_ADDRESS`/`GMAIL_APP_PASSWORD` are unset, the Gmail sender automatically falls back to dry-run (never sends). The two tracking tables (`outreach_unsubscribes`, `outreach_opens`) are in `phase3/data/schema.sql` — re-run the schema in Supabase to create them. Until they exist, the connector writes opens/unsubscribes to local JSONL fallback files, so nothing breaks.

## Tests

```bash
pytest phase3/tests/ -v
```

Tests stub all outbound APIs (OpenAI, Supabase REST, Instantly REST) so you can run them with junk keys in the env. See `phase3/tests/conftest.py` (added in a later build phase).

## LLM usage tracking

Every `llm.chat_json(...)` call passes `phase="phase3"`. Rows land in the shared `llm_usage` Supabase table and show up on the dashboard automatically:

- "By Phase" tab: phase3 appears alongside phase1 and phase2.
- "By Agent" tab: each of `agent_11_personalisation … agent_15_ab_testing` appears with phase pill, model, last-used, cost, tokens.

## Schema

See `phase3/data/schema.sql`. The file is idempotent — safe to re-run.

Tables created:
- `outreach_personalisations` (one row per lead)
- `outreach_sequences` (one row per lead — 5-step JSON with 2 variants per step)
- `outreach_channel_plans` (one row per lead)
- `outreach_log` (one row per send attempt)
- `ab_test_results` (one row per `(campaign_id, step_number, variant_subject)`)
- `outreach_unsubscribes` (one row per opted-out email — read by the Gmail sender to suppress sends)
- `outreach_opens` (one row per `(lead_id, email, campaign_id)` open event, deduped)
