-- Phase 1 schema for AI GTM Agency
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS icp_profiles (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
