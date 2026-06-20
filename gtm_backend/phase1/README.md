# Phase 1 — FIND

Five agents that produce a qualified, scored B2B lead pipeline using free-tier APIs. The pipeline takes a free-text ICP prompt, generates company leads, enriches them with verified decision-maker contacts, detects active buying signals, and emits a final 0-100 fit score with a hot/warm/cold tier.

## Pipeline

```
Agent 01 (ICP)
   ↓
Agent 02 (Lead Gen, companies only)
   ↓
Agent 03 (Enrichment, contacts)
   ↓
Agent 04 (Signals, continuous, separate buying_signals table)
   ↓
Agent 05 (Scoring = firmographic + aggregate signal with freshness decay)
```

| #   | Agent                   | Output                                                                      | Reads from / Writes to                                              |
| --- | ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 01  | ICP Definition          | structured ICP from a free-text prompt                                      | writes `icp_profiles`                                               |
| 02  | Lead Generation         | **company records only** — no people, no signals                            | reads `icp_profiles`, writes `leads_raw`                            |
| 03  | Lead Enrichment         | contact name, email, title, LinkedIn (verified)                             | reads/writes `leads_raw` (adds contact fields)                      |
| 04  | Buying Signal Detection | signals with type · weight (6-10) · detected_at — in `buying_signals` table | reads `leads_raw`, writes `buying_signals`                          |
| 05  | ICP Scoring             | firmographic fit (max 70) + aggregate signal score (max 30, decayed by age) | reads `leads_raw` + `buying_signals`, writes back to `leads_raw`    |

Tiers: **hot** ≥80, **warm** ≥50, **cold** otherwise. Existing customers → disqualified. Score version `v2.0`.

## Agents in Detail

### Agent 01 — ICP Definition

- **Purpose:** Convert a free-text prompt into a structured ICP row.
- **Input:** A prompt string passed via the CLI.
- **Process:**
  - Validates the prompt is non-empty.
  - Calls OpenAI `gpt-4o-mini` with the `ICP_DEFINITION_SYSTEM` prompt in JSON mode.
  - Validates the response against the `ICP` Pydantic schema.
  - Persists the ICP plus the raw user prompt via the Supabase REST client.
- **Output:** A single new row in `icp_profiles`; returns the inserted `icp_id`.
- **Run command:**

```bash
python -m phase1 icp "mid-size HR-tech SaaS in India, 50-200 employees, target Heads of HR"
```

### Agent 02 — Lead Generation

- **Purpose:** Find net-new companies matching the ICP. Companies only — no contacts, no signals.
- **Input:** An `icp_id` (read from `icp_profiles`) and an optional `--max` cap.
- **Process:**
  - Builds 3-8 SerpAPI queries from the ICP `industry × geography`, with size and growth-stage suffixes and aggregator-site exclusions (g2, capterra, crunchbase, wikipedia, linkedin).
  - Runs each SerpAPI text search (with per-geography location hint when known).
  - Calls `gpt-4o-mini` with `LEAD_NORMALIZATION_SYSTEM` to extract clean company records from snippets; falls back to a title-split heuristic if the LLM returns empty.
  - Resolves a `company_domain` per candidate via URL parsing and a Cloudflare DoH lookup.
  - Dedupes within the run and against existing `leads_raw` rows for that ICP.
- **Output:** New rows in `leads_raw` with company-only fields populated (`company_name`, `company_domain`, `company_website`, location, industry, size, source).
- **Run command:**

```bash
python -m phase1 leads --icp 1 --max 20
```

### Agent 03 — Lead Enrichment

- **Purpose:** Attach a verified decision-maker contact to leads that have a domain but no contact yet.
- **Input:** Optional `icp_id` filter; pulls leads from `leads_raw` missing contact fields.
- **Process:**
  - Pulls `buyer_titles` from the ICP (defaults to CEO/Founder/Head).
  - Runs a SerpAPI LinkedIn search per company filtered by those titles.
  - Calls `gpt-4o-mini` with `CONTACT_EXTRACTION_SYSTEM` to pick the best person from LinkedIn snippets.
  - Generates email patterns (`first.last@`, `flast@`, etc.) via `core.emails.generate_patterns` and verifies each against Disify until one passes.
  - Optional fallback: queries Hunter.io for the domain (if `HUNTER_API_KEY` is set) and re-verifies through Disify.
- **Output:** Updates the existing `leads_raw` row with `contact_name`, `contact_title`, `contact_linkedin_url`, `contact_email`, `verified`, and `bounce_status`.
- **Run command:**

```bash
python -m phase1 enrich --icp 1
```

### Agent 04 — Buying Signal Detection

- **Purpose:** Find recent, high-signal events (funding, hiring, leadership change, expansion, competitor complaint) for each lead.
- **Input:** Optional `icp_id` filter; reads matching leads from `leads_raw`.
- **Process:**
  - Calls `gpt-4o-mini` with `SIGNAL_QUERY_GENERATION_SYSTEM` to plan up to 8 tailored Google News / Google search queries per lead (static fallback on error).
  - Runs those queries against SerpAPI `google_news` (with `lookback_days`) and `google` engines.
  - Dedupes candidates by source URL and caps at 12 per lead.
  - Issues a single batched `gpt-4o-mini` call with `SIGNAL_CLASSIFICATION_SYSTEM` to classify all candidates into `(signal_type, buying_intent ∈ {high, low, na})`; discards `na`.
  - Computes `weight` from `SIGNAL_TYPE_WEIGHTS` (funding 10, leadership_change 9, hiring 8, expansion 7, competitor_complaint 6), halved for `low` intent.
- **Output:** New rows in `buying_signals` with `lead_id`, `signal_type`, `weight`, `score`, `signal_text`, `signal_source_url`, `buying_intent`.
- **Run command:**

```bash
python -m phase1 signals --icp 1
```

### Agent 05 — ICP Scoring

- **Purpose:** Produce a final 0-100 fit score and tier for each lead, plus a parallel LLM-reasoned score.
- **Input:** Mode (`unscored` / `all`) or a specific `lead_id`; reads `leads_raw` and joined `buying_signals`.
- **Process:**
  - Reads all active ICPs and the target leads with their signals.
  - For each lead, calls `core.scoring.score_lead`, which computes:
    - **Firmographic fit (max 70):** geography 18, buyer_title 18, reachability 14, quality_signal 10, completeness 10.
    - **Aggregate signal score (max 30):** sums `weight × freshness_multiplier` where multipliers are 1.0 (≤14d), 0.7 (≤30d), 0.4 (≤60d), floor 0.1.
    - **Bounce penalty:** −30 if `bounce_status ∈ {no_mx, invalid, bounced}`.
    - **Disqualification:** existing customers → score 0, tier `disqualified`.
    - **Tier:** `hot` ≥80, `warm` ≥50, else `cold`. Clamped 0-100. Version `v2.0`.
  - Calls `gpt-4o-mini` with `ICP_SCORING_SYSTEM` for a parallel LLM score, tier, and reasoning, with graceful fallback to the deterministic score on error.
- **Output:** Updates `leads_raw` with `icp_score`, `score_tier`, `score_breakdown`, `score_reasoning`, `score_version` (and the LLM-side fields printed alongside).
- **Run command:**

```bash
python -m phase1 score --icp 1
```

## Stack (all free tier)

- **LLM:** OpenAI gpt-4o-mini
- **Search:** SerpAPI (100/month)
- **Email verify:** Disify (keyless)
- **Email pattern fallback:** Hunter.io (25/month, optional)
- **Domain discovery:** Cloudflare DoH (keyless)
- **DB:** Supabase REST

## Setup

```bash
pip install -r phase1/requirements.txt
cp phase1/.env.example phase1/.env   # then edit with real keys
```

DB schema (one-time, paste into Supabase SQL editor):

```bash
cat phase1/data/schema.sql
```

## Running

```bash
python -m phase1 icp "mid-size HR-tech SaaS in India, 50-200 employees, target Heads of HR"
python -m phase1 leads --icp 1 --max 20
python -m phase1 enrich --icp 1
python -m phase1 signals --icp 1
python -m phase1 score --icp 1
python -m phase1 run-all --prompt "mid-size HR-tech SaaS in India, 50-200 employees, target Heads of HR"   # chains 01 → 02 → 03 → 04 → 05
python -m phase1 run-all --prompt "Target fast-growing B2B SaaS companies in North America, specifically in the FinTech or Healthcare sectors, with 100-500 employees and annual revenue between $10M-$50M. We're looking for companies in their Growth stage. The key decision-makers (buyers) are CEOs or VPs of Product, while the main users are Product Managers or Engineering Leads. Procurement or Legal VPs might act as blockers. Their primary pain point is inefficient data synchronization across disparate systems leading to delayed product launches."
```

## Testing

The test suite lives in `phase1/tests/`. All tests except the live Supabase smoke check are fully mocked — no network calls, no quota burn.

```bash
# Run the entire suite
pytest phase1/tests/ -v

# Run individual test modules
pytest phase1/tests/test_emails.py -v             # Email pattern generator
pytest phase1/tests/test_dns.py -v                # Domain discovery + blocked URL filter
pytest phase1/tests/test_scoring.py -v            # Deterministic scoring rubric (CRITICAL)
pytest phase1/tests/test_agents.py -v             # All 5 agents (mocked APIs)
pytest phase1/tests/test_connectors_supabase.py -v # Supabase HTTP shape
pytest phase1/tests/test_e2e_pipeline.py -v       # End-to-end with respx mocks
pytest phase1/tests/test_supabase_connection.py -v -s  # LIVE Supabase smoke check (needs real .env)

# Useful flags
pytest phase1/tests/ -v -s               # -s shows print output (helpful for debugging)
pytest phase1/tests/ -v -k "scoring"     # Run only tests matching keyword
pytest phase1/tests/ --tb=short          # Shorter tracebacks on failure
```

Notes:

- All tests except `test_supabase_connection.py` are fully mocked — no network, no quota burn.
- `test_supabase_connection.py` auto-skips if `phase1/.env` has no real `SUPABASE_URL` + `SUPABASE_KEY`.
- The shared fixtures (`sample_icp`, `full_lead`, `thin_lead`) are defined in `phase1/tests/conftest.py`.

## Project Structure

```
phase1/
├── main.py              # CLI entry point
├── __main__.py          # Enables `python -m phase1`
├── agents/              # one file per agent (agent_01_icp.py … agent_05_scoring.py)
├── connectors/          # external API clients (openai, serpapi, supabase, disify, hunter, dns)
├── core/                # pure logic: scoring, schemas, prompts, config, retries, emails
├── data/                # schema.sql + buying_signals.jsonl (local fallback)
└── tests/               # pytest suite (all external APIs mocked except live smoke test)
```

## Phase tracking

Every LLM call made by an agent in this codebase is tagged with a `phase` field (e.g. `"phase1"`) when it is logged to the `llm_usage` table. The dashboard groups cost and token usage by phase so that as new phases come online (phase 2 … phase 8), each phase's contribution to overall LLM spend is visible at a glance.

To onboard a new phase, see [docs/PHASES.md](../docs/PHASES.md).
