-- Phase 2 schema for AI GTM Agency (UNDERSTAND)
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Tables created/extended:
--   account_intelligence    (Agent 06)
--   account_stakeholders    (Agent 07 — one row per person)
--   stakeholder_maps        (Agent 07 — one row per account)
--   competitor_intel        (Agent 08 — one row per competitor per ICP)
--   market_segment_intel    (Agent 09 — one row per ICP per week)
--   gtm_insights            (Agent 10 — one row per lead per day)
--
-- All tables reference phase1 leads_raw / icp_profiles by ON DELETE CASCADE
-- so cleaning up an ICP cleans up its phase 2 artefacts too.

-- ---------------------------------------------------------------------------
-- Agent 06 — Account Intelligence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_intelligence (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT NOT NULL,
    company_domain TEXT,
    what_they_do TEXT,
    business_model TEXT,
    company_size_estimate TEXT,
    growth_trajectory TEXT,
    competitive_position TEXT,
    recent_moves JSONB DEFAULT '[]'::jsonb,
    likely_pain_points JSONB DEFAULT '[]'::jsonb,
    instability_flags JSONB DEFAULT '[]'::jsonb,
    confirmed_facts JSONB DEFAULT '[]'::jsonb,
    inferences JSONB DEFAULT '[]'::jsonb,
    key_signals_for_outreach JSONB DEFAULT '[]'::jsonb,
    brief_quality_score INTEGER DEFAULT 0,
    status TEXT DEFAULT 'fresh',
    sources_scanned JSONB DEFAULT '[]'::jsonb,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- additive columns (idempotent)
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS company_domain TEXT;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS what_they_do TEXT;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS business_model TEXT;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS company_size_estimate TEXT;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS growth_trajectory TEXT;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS competitive_position TEXT;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS recent_moves JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS likely_pain_points JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS instability_flags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS confirmed_facts JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS inferences JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS key_signals_for_outreach JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS brief_quality_score INTEGER DEFAULT 0;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'fresh';
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS sources_scanned JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE account_intelligence ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_intelligence_lead_id ON account_intelligence(lead_id);
CREATE INDEX IF NOT EXISTS idx_account_intelligence_icp_id ON account_intelligence(icp_id);
CREATE INDEX IF NOT EXISTS idx_account_intelligence_status ON account_intelligence(status);
CREATE INDEX IF NOT EXISTS idx_account_intelligence_refreshed_at ON account_intelligence(refreshed_at);

-- ---------------------------------------------------------------------------
-- Agent 07 — Stakeholder Mapping (two tables)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_stakeholders (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    job_title TEXT,
    role_type TEXT NOT NULL,
    seniority TEXT,
    function_area TEXT,
    linkedin_url TEXT,
    email TEXT,
    email_confidence TEXT DEFAULT 'unknown',
    confidence TEXT DEFAULT 'low',
    risk_flags JSONB DEFAULT '[]'::jsonb,
    rank INTEGER DEFAULT 99,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS role_type TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS seniority TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS function_area TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS email_confidence TEXT DEFAULT 'unknown';
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'low';
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS risk_flags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS rank INTEGER DEFAULT 99;
-- reports_to: full name of this person's manager (who reports to whom).
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS reports_to TEXT;
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE account_stakeholders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_account_stakeholders_lead_id ON account_stakeholders(lead_id);
CREATE INDEX IF NOT EXISTS idx_account_stakeholders_role_type ON account_stakeholders(role_type);

CREATE TABLE IF NOT EXISTS stakeholder_maps (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT NOT NULL,
    company_domain TEXT,
    entry_point_full_name TEXT,
    entry_point_role_type TEXT,
    multi_threading_status TEXT DEFAULT 'single',
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS company_domain TEXT;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS entry_point_full_name TEXT;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS entry_point_role_type TEXT;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS multi_threading_status TEXT DEFAULT 'single';
-- coverage_status='complete' only when Economic Buyer + Champion + Influencer are
-- all present; missing_roles lists the gaps; champion_budget_flag=TRUE when a
-- Champion exists but none of them has budget authority (PDF Agent 07 rules).
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS coverage_status TEXT DEFAULT 'unknown';
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS missing_roles JSONB DEFAULT '[]'::jsonb;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS champion_budget_flag BOOLEAN DEFAULT FALSE;
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE stakeholder_maps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_stakeholder_maps_lead_id ON stakeholder_maps(lead_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_maps_icp_id ON stakeholder_maps(icp_id);

-- ---------------------------------------------------------------------------
-- Agent 08 — Competitive Intelligence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_intel (
    id BIGSERIAL PRIMARY KEY,
    icp_id BIGINT NOT NULL REFERENCES icp_profiles(id) ON DELETE CASCADE,
    competitor_name TEXT NOT NULL,
    competitor_domain TEXT,
    summary TEXT,
    complaint_categories JSONB DEFAULT '[]'::jsonb,
    biggest_weakness TEXT,
    who_loves_them TEXT,
    who_hates_them TEXT,
    talk_tracks JSONB DEFAULT '[]'::jsonb,
    threat_level TEXT DEFAULT 'medium',
    sources JSONB DEFAULT '[]'::jsonb,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE CASCADE;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS competitor_name TEXT;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS competitor_domain TEXT;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS complaint_categories JSONB DEFAULT '[]'::jsonb;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS biggest_weakness TEXT;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS who_loves_them TEXT;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS who_hates_them TEXT;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS talk_tracks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS threat_level TEXT DEFAULT 'medium';
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]'::jsonb;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_competitor_intel_icp_name ON competitor_intel(icp_id, competitor_name);
CREATE INDEX IF NOT EXISTS idx_competitor_intel_threat ON competitor_intel(threat_level);

-- Agent 08 — leads already using a tracked competitor (one row per lead × competitor).
-- PDF rule: "Must flag when a target lead is already using a competitor."
CREATE TABLE IF NOT EXISTS lead_competitor_usage (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
    competitor_name TEXT NOT NULL,
    evidence TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE lead_competitor_usage ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE lead_competitor_usage ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE lead_competitor_usage ADD COLUMN IF NOT EXISTS competitor_name TEXT;
ALTER TABLE lead_competitor_usage ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE lead_competitor_usage ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE lead_competitor_usage ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_competitor_usage ON lead_competitor_usage(lead_id, competitor_name);
CREATE INDEX IF NOT EXISTS idx_lead_competitor_usage_lead ON lead_competitor_usage(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_competitor_usage_icp ON lead_competitor_usage(icp_id);

-- ---------------------------------------------------------------------------
-- Agent 09 — Market Sizing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_segment_intel (
    id BIGSERIAL PRIMARY KEY,
    icp_id BIGINT NOT NULL REFERENCES icp_profiles(id) ON DELETE CASCADE,
    week_of DATE NOT NULL,
    segment_name TEXT,
    lead_total INTEGER DEFAULT 0,
    lead_hot INTEGER DEFAULT 0,
    lead_warm INTEGER DEFAULT 0,
    lead_cold INTEGER DEFAULT 0,
    too_small_flag BOOLEAN DEFAULT FALSE,
    tam_estimate TEXT,
    sam_estimate TEXT,
    som_this_month TEXT,
    competition_density TEXT,
    competition_impact TEXT,
    seasonal_fit TEXT,
    seasonal_note TEXT,
    priority_rank INTEGER DEFAULT 3,
    priority_rationale TEXT,
    recommended_volume INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE CASCADE;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS week_of DATE;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS segment_name TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS lead_total INTEGER DEFAULT 0;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS lead_hot INTEGER DEFAULT 0;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS lead_warm INTEGER DEFAULT 0;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS lead_cold INTEGER DEFAULT 0;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS too_small_flag BOOLEAN DEFAULT FALSE;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS tam_estimate TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS sam_estimate TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS som_this_month TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS competition_density TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS competition_impact TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS seasonal_fit TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS seasonal_note TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS priority_rank INTEGER DEFAULT 3;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS priority_rationale TEXT;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS recommended_volume INTEGER DEFAULT 0;
ALTER TABLE market_segment_intel ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_market_segment_icp_week ON market_segment_intel(icp_id, week_of);
CREATE INDEX IF NOT EXISTS idx_market_segment_week_of ON market_segment_intel(week_of);
CREATE INDEX IF NOT EXISTS idx_market_segment_priority ON market_segment_intel(priority_rank);

-- ---------------------------------------------------------------------------
-- Agent 10 — GTM Insights
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gtm_insights (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT NOT NULL,
    brief_date DATE NOT NULL,
    executive_summary TEXT,
    who_to_target JSONB DEFAULT '{}'::jsonb,
    what_to_say JSONB DEFAULT '{}'::jsonb,
    which_channel JSONB DEFAULT '{}'::jsonb,
    why_market_rationale TEXT,
    why_account_rationale TEXT,
    urgency_signal TEXT,
    flags_and_contradictions JSONB DEFAULT '[]'::jsonb,
    next_actions JSONB DEFAULT '[]'::jsonb,
    model_version TEXT DEFAULT 'gpt-4o-mini',
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS brief_date DATE;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS executive_summary TEXT;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS who_to_target JSONB DEFAULT '{}'::jsonb;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS what_to_say JSONB DEFAULT '{}'::jsonb;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS which_channel JSONB DEFAULT '{}'::jsonb;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS why_market_rationale TEXT;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS why_account_rationale TEXT;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS urgency_signal TEXT;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS flags_and_contradictions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS next_actions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS model_version TEXT DEFAULT 'gpt-4o-mini';
-- Human-review gate: a brief is 'pending_review' until a human approves it, at
-- which point it becomes the active GTM strategy (PDF Agent 10 rule).
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending_review';
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE gtm_insights ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_gtm_insights_lead_date ON gtm_insights(lead_id, brief_date);
CREATE INDEX IF NOT EXISTS idx_gtm_insights_icp_id ON gtm_insights(icp_id);
CREATE INDEX IF NOT EXISTS idx_gtm_insights_brief_date ON gtm_insights(brief_date);
CREATE INDEX IF NOT EXISTS idx_gtm_insights_review_status ON gtm_insights(review_status);
