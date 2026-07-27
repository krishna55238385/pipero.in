-- Phase 1 schema for AI GTM Agency
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS icp_profiles (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS organization_id UUID;

ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS product_line TEXT DEFAULT 'Core';
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS industry TEXT[];
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS geography TEXT[];
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS company_size_min INTEGER;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS company_size_max INTEGER;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS revenue_range_min BIGINT;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS revenue_range_max BIGINT;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS business_stage TEXT;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS buyer_titles TEXT[];
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS user_titles TEXT[];
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS blocker_titles TEXT[];
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS pain_points TEXT;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS prompts TEXT;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS leads_raw (
    id BIGSERIAL PRIMARY KEY,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE CASCADE;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_domain TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_website TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_phone TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_address TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_city TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_state TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_country TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_industry TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_size TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS company_linkedin_url TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS contact_title TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS contact_linkedin_url TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS bounce_status TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
-- Agent 37 — Data Refresh (phase4/MANAGE & REPORT) addition. last_verified_at
-- already existed but was never actually set anywhere in the codebase before
-- Agent 37 — every lead has been "unverified since creation" by omission,
-- not by any real check. data_quality_score is new: a deterministic 0-100
-- completeness+freshness score, computed and stored per record (PDF rule:
-- "must maintain a data quality score per record").
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS data_quality_score INTEGER;
-- Agent 38 — Inbound Signal Capture addition. `source` (below) already means
-- something else (which search API found the lead — "serpapi"/"serper"), so
-- a NEW column is needed for lead-origin-channel rather than overloading it.
-- Default 'outbound' — every existing/future Agent 02 row is outbound by
-- definition; Agent 38 sets 'inbound_signal' on the leads it creates. PDF
-- rule: "inbound leads must be tagged separately from outbound leads for
-- attribution."
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS lead_channel TEXT DEFAULT 'outbound';
-- organization_id: _inject_org (phase3/connectors/supabase.py) tags EVERY
-- _post()/_upsert() insert unconditionally whenever GTM_ORG_ID is set — no
-- per-table opt-out exists. Agent 38's create_inbound_lead() writes here via
-- _post("/leads_raw", ...), so this table needs the column just like any
-- other, even though most leads_raw rows are written by phase1 agents that
-- don't set GTM_ORG_ID. Added proactively after finding this same missing-
-- column bug hit data_quality_reports and nurture_touches live — this one
-- hadn't crashed yet only because Agent 38 had never found a real visitor
-- signal to promote into a new lead.
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]'::jsonb;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS raw_data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS icp_score INTEGER;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS score_tier TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS score_reasoning TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS score_version TEXT;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS is_existing_customer BOOLEAN DEFAULT FALSE;
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE leads_raw ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_leads_raw_icp_id ON leads_raw(icp_id);
CREATE INDEX IF NOT EXISTS idx_leads_raw_score_tier ON leads_raw(score_tier);
CREATE INDEX IF NOT EXISTS idx_leads_raw_verified ON leads_raw(verified);
CREATE INDEX IF NOT EXISTS idx_leads_raw_company_name_lower ON leads_raw(LOWER(company_name));

CREATE TABLE IF NOT EXISTS buying_signals (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
    score INTEGER NOT NULL DEFAULT 0,
    signal_text TEXT,
    signal_summary TEXT,
    signal_source_url TEXT,
    buying_intent TEXT CHECK (buying_intent IN ('high', 'low', 'na')),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE buying_signals ADD COLUMN IF NOT EXISTS signal_text TEXT;
ALTER TABLE buying_signals ADD COLUMN IF NOT EXISTS buying_intent TEXT;
-- score: 0-100 numeric signal strength (BuyingSignal.score). Without this the
-- whole phase-1 run-all crashes on insert with PGRST204 "Could not find 'score'".
ALTER TABLE buying_signals ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;
-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — see leads_raw's comment above
-- for the full explanation. Closing the same documentation/safety gap here.
ALTER TABLE buying_signals ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_buying_signals_lead_id ON buying_signals(lead_id);
CREATE INDEX IF NOT EXISTS idx_buying_signals_detected_at ON buying_signals(detected_at);
CREATE INDEX IF NOT EXISTS idx_buying_signals_type ON buying_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_buying_signals_intent ON buying_signals(buying_intent);

CREATE TABLE IF NOT EXISTS llm_usage (
    id BIGSERIAL PRIMARY KEY,
    agent TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS phase TEXT;
-- organization_id: already present in production (added out-of-band at some
-- point, undocumented) — this line just syncs schema.sql to match reality,
-- found while investigating the nurture_touches/data_quality_reports bug
-- class. Harmless no-op if the column already exists.
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_llm_usage_agent ON llm_usage(agent);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_model ON llm_usage(model);
CREATE INDEX IF NOT EXISTS idx_llm_usage_phase ON llm_usage(phase);

UPDATE llm_usage SET phase = 'phase1' WHERE phase IS NULL;

-- ---------------------------------------------------------------------------
-- Agent 20 — Social Listening (PDF Phase 4 — ENGAGE)
-- Catches people/companies publicly signalling they need what you offer
-- (Reddit/forum/news posts matching an ICP's pain points), independent of
-- the already-known leads_raw list. Candidates are NEVER auto-promoted into
-- leads_raw — a human reviews and promotes via the CRM, same "no blind
-- automation on unverified data" principle as the rest of phase1.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_listening_leads (
    id BIGSERIAL PRIMARY KEY,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE CASCADE,
    platform TEXT,                     -- reddit | twitter | forum | news | web
    signal_text TEXT NOT NULL,
    source_url TEXT NOT NULL,
    candidate_company TEXT,
    candidate_person TEXT,
    candidate_title TEXT,
    matched_pain_point TEXT,
    confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
    status TEXT NOT NULL DEFAULT 'candidate', -- candidate | promoted | dismissed
    promoted_lead_id BIGINT REFERENCES leads_raw(id) ON DELETE SET NULL,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE CASCADE;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS signal_text TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS candidate_company TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS candidate_person TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS candidate_title TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS matched_pain_point TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'candidate';
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS promoted_lead_id BIGINT REFERENCES leads_raw(id) ON DELETE SET NULL;
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE social_listening_leads ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_social_listening_source_url ON social_listening_leads(icp_id, source_url);
CREATE INDEX IF NOT EXISTS idx_social_listening_icp_id ON social_listening_leads(icp_id);
CREATE INDEX IF NOT EXISTS idx_social_listening_status ON social_listening_leads(status);

-- ---------------------------------------------------------------------------
-- Agent 37 — Data Refresh (phase4/MANAGE & REPORT)
-- ---------------------------------------------------------------------------
-- Append-only monthly-health snapshot, same reasoning as revenue_forecasts/
-- board_reports/roi_attribution_snapshots — PDF rule "must report monthly on
-- overall database health and decay rate" needs history to show a trend, not
-- just a current number. Per-record state (data_quality_score, verified,
-- bounce_status, last_verified_at) lives directly on leads_raw — this table
-- is only the aggregate summary of each refresh run.
CREATE TABLE IF NOT EXISTS data_quality_reports (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    leads_examined INTEGER,
    reverified_count INTEGER,
    still_stale_count INTEGER,
    avg_quality_score NUMERIC,
    bounce_rate NUMERIC,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE data_quality_reports ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE data_quality_reports ADD COLUMN IF NOT EXISTS leads_examined INTEGER;
ALTER TABLE data_quality_reports ADD COLUMN IF NOT EXISTS reverified_count INTEGER;
ALTER TABLE data_quality_reports ADD COLUMN IF NOT EXISTS still_stale_count INTEGER;
ALTER TABLE data_quality_reports ADD COLUMN IF NOT EXISTS avg_quality_score NUMERIC;
ALTER TABLE data_quality_reports ADD COLUMN IF NOT EXISTS bounce_rate NUMERIC;
ALTER TABLE data_quality_reports ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_data_quality_reports_generated_at ON data_quality_reports(generated_at);

-- ---------------------------------------------------------------------------
-- Agent 38 — Inbound Signal Capture (phase4/MANAGE & REPORT)
-- ---------------------------------------------------------------------------
-- Reads the CRM's existing `website_visitor_signals` table (GA4-backed,
-- already company-level aggregated data — no individual-tracking privacy
-- concern, PDF rule already satisfied by the data source itself). One row
-- per (organization, company_domain) — upserted so a company visiting again
-- refreshes the existing row instead of piling up duplicates. Mirrors the
-- candidate/promoted status pattern already used by social_listening_leads.
CREATE TABLE IF NOT EXISTS inbound_signal_captures (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    company_name TEXT,
    company_domain TEXT NOT NULL,
    signal_strength TEXT,          -- low | medium | high (from website_visitor_signals)
    sessions INTEGER,
    page_views INTEGER,
    high_intent_pages_hit BOOLEAN NOT NULL DEFAULT FALSE,  -- pricing/case-study page visited
    status TEXT NOT NULL DEFAULT 'candidate',              -- candidate | promoted | held
    held_reason TEXT,
    promoted_lead_id BIGINT REFERENCES leads_raw(id) ON DELETE SET NULL,
    captured_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS company_domain TEXT;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS signal_strength TEXT;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS sessions INTEGER;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS page_views INTEGER;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS high_intent_pages_hit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'candidate';
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS promoted_lead_id BIGINT REFERENCES leads_raw(id) ON DELETE SET NULL;
ALTER TABLE inbound_signal_captures ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_inbound_signal_captures_org_domain ON inbound_signal_captures(organization_id, company_domain);
CREATE INDEX IF NOT EXISTS idx_inbound_signal_captures_status ON inbound_signal_captures(status);
