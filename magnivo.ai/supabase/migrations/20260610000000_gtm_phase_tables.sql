-- ============================================================================
-- GTM Pipeline tables (Phase 1 FIND, Phase 2 UNDERSTAND, Phase 3 REACH)
-- ----------------------------------------------------------------------------
-- These tables are produced/consumed by the Python phase1/phase2/phase3
-- pipelines (see /phase1, /phase2, /phase3). They are folded into the CRM's
-- Supabase project so the Next.js app can read them directly with zero ETL.
--
-- Design notes:
--   * Internal keys stay BIGINT/BIGSERIAL (the Python connectors reference each
--     other by leads_raw.id / icp_profiles.id). We do NOT convert these to UUID.
--   * Every org-owned table gets a NULLABLE `organization_id UUID` + index.
--     Multi-tenant isolation is enforced in the server-action layer (the CRM
--     bypasses RLS in this project — see 20240602000000_crm_core_entities.sql).
--     Nullable keeps the phases runnable standalone; the trigger service sets
--     organization_id from GTM_ORG_ID on every insert.
--   * The bridge to the CRM's UUID world (leads.leads_raw_id, promote function)
--     lives in 20260610000100_gtm_crm_bridge.sql.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Phase 1 — Agent 01: ICP profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.icp_profiles (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    product_line TEXT DEFAULT 'Core',
    industry TEXT[],
    geography TEXT[],
    company_size_min INTEGER,
    company_size_max INTEGER,
    revenue_range_min BIGINT,
    revenue_range_max BIGINT,
    business_stage TEXT,
    buyer_titles TEXT[],
    user_titles TEXT[],
    blocker_titles TEXT[],
    pain_points TEXT,
    prompts TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_reviewed_at TIMESTAMPTZ
);
ALTER TABLE public.icp_profiles ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_icp_profiles_org_id ON public.icp_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_icp_profiles_active ON public.icp_profiles(active);

-- ---------------------------------------------------------------------------
-- Phase 1 — Agents 02/03/05: raw leads (denormalized company + contact + score)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads_raw (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    company_domain TEXT,
    company_website TEXT,
    company_phone TEXT,
    company_address TEXT,
    company_city TEXT,
    company_state TEXT,
    company_country TEXT,
    company_industry TEXT,
    company_size TEXT,
    company_linkedin_url TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_title TEXT,
    contact_linkedin_url TEXT,
    verified BOOLEAN DEFAULT FALSE,
    bounce_status TEXT,
    last_verified_at TIMESTAMPTZ,
    source TEXT,
    sources JSONB DEFAULT '[]'::jsonb,
    raw_data JSONB DEFAULT '{}'::jsonb,
    icp_score INTEGER,
    score_tier TEXT,
    score_breakdown JSONB,
    score_reasoning TEXT,
    scored_at TIMESTAMPTZ,
    score_version TEXT,
    is_existing_customer BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.leads_raw ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_leads_raw_org_id ON public.leads_raw(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_raw_icp_id ON public.leads_raw(icp_id);
CREATE INDEX IF NOT EXISTS idx_leads_raw_score_tier ON public.leads_raw(score_tier);
CREATE INDEX IF NOT EXISTS idx_leads_raw_verified ON public.leads_raw(verified);
CREATE INDEX IF NOT EXISTS idx_leads_raw_company_name_lower ON public.leads_raw(LOWER(company_name));

-- ---------------------------------------------------------------------------
-- Phase 1 — Agent 04: buying signals (funding / product launch / acquisition /
-- layoffs / news keywords). One row per signal per lead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.buying_signals (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
    signal_text TEXT,
    signal_summary TEXT,
    signal_source_url TEXT,
    buying_intent TEXT CHECK (buying_intent IN ('high', 'low', 'na')),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.buying_signals ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_buying_signals_org_id ON public.buying_signals(organization_id);
CREATE INDEX IF NOT EXISTS idx_buying_signals_lead_id ON public.buying_signals(lead_id);
CREATE INDEX IF NOT EXISTS idx_buying_signals_detected_at ON public.buying_signals(detected_at);
CREATE INDEX IF NOT EXISTS idx_buying_signals_type ON public.buying_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_buying_signals_intent ON public.buying_signals(buying_intent);

-- ---------------------------------------------------------------------------
-- Phase 1/2/3 — LLM usage / cost tracking (powers Settings -> Usage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.llm_usage (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    model TEXT NOT NULL,
    phase TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_llm_usage_org_id ON public.llm_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_agent ON public.llm_usage(agent);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON public.llm_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_model ON public.llm_usage(model);
CREATE INDEX IF NOT EXISTS idx_llm_usage_phase ON public.llm_usage(phase);

-- ---------------------------------------------------------------------------
-- Phase 2 — Agent 06: account intelligence (one brief per lead)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_intelligence (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
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
ALTER TABLE public.account_intelligence ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_intelligence_lead_id ON public.account_intelligence(lead_id);
CREATE INDEX IF NOT EXISTS idx_account_intelligence_org_id ON public.account_intelligence(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_intelligence_icp_id ON public.account_intelligence(icp_id);
CREATE INDEX IF NOT EXISTS idx_account_intelligence_status ON public.account_intelligence(status);

-- ---------------------------------------------------------------------------
-- Phase 2 — Agent 07: stakeholders (one row per person) + maps (one per account)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_stakeholders (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
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
    reports_to TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.account_stakeholders ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_account_stakeholders_org_id ON public.account_stakeholders(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_stakeholders_lead_id ON public.account_stakeholders(lead_id);
CREATE INDEX IF NOT EXISTS idx_account_stakeholders_role_type ON public.account_stakeholders(role_type);

CREATE TABLE IF NOT EXISTS public.stakeholder_maps (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT NOT NULL,
    company_domain TEXT,
    entry_point_full_name TEXT,
    entry_point_role_type TEXT,
    multi_threading_status TEXT DEFAULT 'single',
    coverage_status TEXT DEFAULT 'unknown',
    missing_roles JSONB DEFAULT '[]'::jsonb,
    champion_budget_flag BOOLEAN DEFAULT FALSE,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.stakeholder_maps ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stakeholder_maps_lead_id ON public.stakeholder_maps(lead_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_maps_org_id ON public.stakeholder_maps(organization_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_maps_icp_id ON public.stakeholder_maps(icp_id);

-- ---------------------------------------------------------------------------
-- Phase 2 — Agent 08: competitor intel + per-lead competitor usage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_intel (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    icp_id BIGINT NOT NULL REFERENCES public.icp_profiles(id) ON DELETE CASCADE,
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
ALTER TABLE public.competitor_intel ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_competitor_intel_icp_name ON public.competitor_intel(icp_id, competitor_name);
CREATE INDEX IF NOT EXISTS idx_competitor_intel_org_id ON public.competitor_intel(organization_id);
CREATE INDEX IF NOT EXISTS idx_competitor_intel_threat ON public.competitor_intel(threat_level);

CREATE TABLE IF NOT EXISTS public.lead_competitor_usage (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
    competitor_name TEXT NOT NULL,
    evidence TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.lead_competitor_usage ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_competitor_usage ON public.lead_competitor_usage(lead_id, competitor_name);
CREATE INDEX IF NOT EXISTS idx_lead_competitor_usage_org_id ON public.lead_competitor_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_competitor_usage_lead ON public.lead_competitor_usage(lead_id);

-- ---------------------------------------------------------------------------
-- Phase 2 — Agent 09: market sizing (one row per ICP per week)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_segment_intel (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    icp_id BIGINT NOT NULL REFERENCES public.icp_profiles(id) ON DELETE CASCADE,
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
ALTER TABLE public.market_segment_intel ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_market_segment_icp_week ON public.market_segment_intel(icp_id, week_of);
CREATE INDEX IF NOT EXISTS idx_market_segment_org_id ON public.market_segment_intel(organization_id);
CREATE INDEX IF NOT EXISTS idx_market_segment_week_of ON public.market_segment_intel(week_of);
CREATE INDEX IF NOT EXISTS idx_market_segment_priority ON public.market_segment_intel(priority_rank);

-- ---------------------------------------------------------------------------
-- Phase 2 — Agent 10: GTM insights (strategic brief; human-review gated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gtm_insights (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
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
    review_status TEXT DEFAULT 'pending_review',
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.gtm_insights ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gtm_insights_lead_date ON public.gtm_insights(lead_id, brief_date);
CREATE INDEX IF NOT EXISTS idx_gtm_insights_org_id ON public.gtm_insights(organization_id);
CREATE INDEX IF NOT EXISTS idx_gtm_insights_icp_id ON public.gtm_insights(icp_id);
CREATE INDEX IF NOT EXISTS idx_gtm_insights_review_status ON public.gtm_insights(review_status);

-- ---------------------------------------------------------------------------
-- Phase 3 — Agent 11: personalisation angles (one row per lead)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_personalisations (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT,
    contact_name TEXT,
    contact_title TEXT,
    angles JSONB DEFAULT '[]'::jsonb,
    quality_score INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ready',
    held_reason TEXT,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.outreach_personalisations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_personalisations_lead_id ON public.outreach_personalisations(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_personalisations_org_id ON public.outreach_personalisations(organization_id);
CREATE INDEX IF NOT EXISTS idx_outreach_personalisations_status ON public.outreach_personalisations(status);

-- ---------------------------------------------------------------------------
-- Phase 3 — Agent 12: outreach sequences (5-step JSON, 2 variants per step)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_sequences (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT,
    contact_name TEXT,
    persona TEXT DEFAULT 'unknown',
    cta TEXT,
    steps JSONB DEFAULT '[]'::jsonb,
    sequence_quality_score INTEGER DEFAULT 0,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.outreach_sequences ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_sequences_lead_id ON public.outreach_sequences(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_org_id ON public.outreach_sequences(organization_id);

-- ---------------------------------------------------------------------------
-- Phase 3 — Agent 13: channel plans (one row per lead)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_channel_plans (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT,
    primary_channel TEXT DEFAULT 'email',
    secondary_channel TEXT,
    channel_sequence JSONB DEFAULT '[]'::jsonb,
    send_window_start_hour INTEGER DEFAULT 9,
    send_window_end_hour INTEGER DEFAULT 17,
    timezone TEXT DEFAULT 'UTC',
    touches_per_week INTEGER DEFAULT 2,
    rationale TEXT,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.outreach_channel_plans ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_channel_plans_lead_id ON public.outreach_channel_plans(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_channel_plans_org_id ON public.outreach_channel_plans(organization_id);

-- ---------------------------------------------------------------------------
-- Phase 3 — Agent 14: outreach log (one row per send attempt)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_log (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT NOT NULL REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES public.icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT,
    contact_email TEXT,
    campaign_id TEXT,
    instantly_lead_id TEXT,
    channel TEXT DEFAULT 'email',
    step_number INTEGER DEFAULT 1,
    variant_subject TEXT,
    status TEXT DEFAULT 'queued',
    error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.outreach_log ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_outreach_log_org_id ON public.outreach_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_lead_id ON public.outreach_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_campaign_id ON public.outreach_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_status ON public.outreach_log(status);
CREATE INDEX IF NOT EXISTS idx_outreach_log_created_at ON public.outreach_log(created_at);

-- ---------------------------------------------------------------------------
-- Phase 3 — Agent 15: A/B test results (one row per campaign/step/variant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ab_test_results (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    variant_subject TEXT NOT NULL,
    sent_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    open_rate NUMERIC DEFAULT 0,
    reply_rate NUMERIC DEFAULT 0,
    is_winner BOOLEAN DEFAULT FALSE,
    sample_size_met BOOLEAN DEFAULT FALSE,
    is_retired BOOLEAN DEFAULT FALSE,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.ab_test_results ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ab_test_results_campaign_step_variant
    ON public.ab_test_results(campaign_id, step_number, variant_subject);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_org_id ON public.ab_test_results(organization_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_campaign_id ON public.ab_test_results(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_is_winner ON public.ab_test_results(is_winner);

-- ---------------------------------------------------------------------------
-- Phase 3 — Agent 14: engagement tracking (opens / unsubscribes / replies)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_unsubscribes (
    email TEXT PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT REFERENCES public.leads_raw(id) ON DELETE SET NULL,
    campaign_id TEXT,
    unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.outreach_unsubscribes ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_outreach_unsubscribes_org_id ON public.outreach_unsubscribes(organization_id);

CREATE TABLE IF NOT EXISTS public.outreach_opens (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    campaign_id TEXT NOT NULL DEFAULT '',
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.outreach_opens ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_opens_lead_email_campaign
    ON public.outreach_opens(lead_id, email, campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_opens_org_id ON public.outreach_opens(organization_id);
CREATE INDEX IF NOT EXISTS idx_outreach_opens_campaign_id ON public.outreach_opens(campaign_id);

CREATE TABLE IF NOT EXISTS public.outreach_replies (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id BIGINT REFERENCES public.leads_raw(id) ON DELETE CASCADE,
    email TEXT,
    campaign_id TEXT DEFAULT '',
    classification TEXT,
    replied_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.outreach_replies ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_replies_lead_campaign
    ON public.outreach_replies(lead_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_replies_org_id ON public.outreach_replies(organization_id);
CREATE INDEX IF NOT EXISTS idx_outreach_replies_lead_id ON public.outreach_replies(lead_id);

-- ---------------------------------------------------------------------------
-- Match the CRM convention: this project bypasses RLS and enforces org
-- isolation in the server-action layer. Keep GTM tables consistent.
-- ---------------------------------------------------------------------------
ALTER TABLE public.icp_profiles            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads_raw               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.buying_signals          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_usage               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_intelligence    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_stakeholders    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stakeholder_maps        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_intel        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_competitor_usage   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_segment_intel    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gtm_insights            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_personalisations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_sequences      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_channel_plans  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_log            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_test_results         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_unsubscribes   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_opens          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_replies        DISABLE ROW LEVEL SECURITY;
