# Phase 2 — UNDERSTAND

Five agents that go deep on every qualified account that Phase 1 surfaces.

| Agent | What it does | Reads | Writes |
|------:|--------------|-------|--------|
| 06 | **Account Intelligence** — per-account brief (what they do, recent moves, pain points, signals) | `leads_raw`, SerpAPI web + news | `account_intelligence` |
| 07 | **Stakeholder Mapping** — buying committee with entry-point recommendation | `account_intelligence`, SerpAPI LinkedIn | `account_stakeholders`, `stakeholder_maps` |
| 08 | **Competitive Intelligence** — competitor cards with talk tracks | `icp_profiles`, SerpAPI web + news | `competitor_intel` |
| 09 | **Market Sizing** — TAM/SAM/SOM per ICP with priority rank | `icp_profiles`, `leads_raw` | `market_segment_intel` |
| 10 | **GTM Insight Generator** — cross-agent synthesis into actionable briefs | all of 06–09 | `gtm_insights` |

The package layout mirrors `phase1/` (`agents/`, `connectors/`, `core/`, `data/`, `tests/`).

## Setup

Phase 2 reuses the **same** `.env` as Phase 1. No new keys to configure.

```bash
# from the project root
pip install -r phase2/requirements.txt
```

Apply the SQL schema once:

```bash
python -m phase2 print-schema | pbcopy   # then paste into Supabase → SQL editor → Run
# or copy phase2/data/schema.sql directly
```

## CLI usage

```bash
# end-to-end — processes ALL leads for the ICP (recommended)
python -m phase2 run-all --icp 1

# scope to a specific number of leads (useful for testing)
python -m phase2 run-all --icp 1 --limit 5

# run across all active ICPs
python -m phase2 run-all

# per-agent
python -m phase2 account-intel --icp 1
python -m phase2 stakeholders  --icp 1
python -m phase2 competitive   --icp 1 --max 5
python -m phase2 market-sizing
python -m phase2 gtm-insights  --icp 1
```

`run-all` chains `06 → 07 → 08 → 09 → 10` in sequence.

`--limit` is optional on all commands. When omitted, every qualifying lead in `leads_raw` is processed — no artificial cap. New leads added to the database are automatically picked up on the next run. All agent writes are idempotent (upsert), so re-running is safe.

## Tests

```bash
pytest phase2/tests/ -v
```

Tests stub all outbound APIs (OpenAI, SerpAPI, Supabase REST) so you can run them with junk keys in the env. See `phase2/tests/conftest.py`.

## LLM usage tracking

Every `llm.chat_json(...)` call passes `phase="phase2"`. Rows land in the shared `llm_usage` Supabase table and show up on the dashboard automatically:

- "By Phase" tab: phase2 appears alongside phase1.
- "By Agent" tab: each of `agent_06_account_intel … agent_10_gtm_insights` appears with phase pill, model, last-used, cost, tokens.

## Schema

See `phase2/data/schema.sql`. The file is idempotent — safe to re-run.

Tables created:
- `account_intelligence` (one row per lead)
- `account_stakeholders` (many rows per lead)
- `stakeholder_maps` (one row per lead)
- `competitor_intel` (one row per (icp_id, competitor_name))
- `market_segment_intel` (one row per (icp_id, week_of))
- `gtm_insights` (one row per (lead_id, brief_date))
