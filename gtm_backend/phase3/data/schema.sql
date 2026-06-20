-- Phase 3 schema for AI GTM Agency (REACH)
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Apply via:
--   python -m phase3 print-schema | pbcopy   (then paste into Supabase → SQL editor → Run)
--   or copy phase3/data/schema.sql directly.
--
-- Tables created/extended:
--   outreach_personalisations  (Agent 11 — one row per lead)
--   outreach_sequences         (Agent 12 — one row per lead, 5-step JSON)
--   outreach_channel_plans     (Agent 13 — one row per lead)
--   outreach_log               (Agent 14 — one row per send attempt)
--   ab_test_results            (Agent 15 — one row per (campaign, step, variant))
--
-- All tables reference phase1 leads_raw / icp_profiles by ON DELETE CASCADE
-- (or SET NULL on icp_id where appropriate) so cleaning up an ICP cleans up
-- its phase 3 artefacts too.

-- ---------------------------------------------------------------------------
-- Agent 11 — Personalisation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_personalisations (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
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

-- additive columns (idempotent)
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS contact_title TEXT;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS angles JSONB DEFAULT '[]'::jsonb;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 0;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ready';
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_personalisations_lead_id ON outreach_personalisations(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_personalisations_icp_id ON outreach_personalisations(icp_id);
CREATE INDEX IF NOT EXISTS idx_outreach_personalisations_status ON outreach_personalisations(status);
CREATE INDEX IF NOT EXISTS idx_outreach_personalisations_refreshed_at ON outreach_personalisations(refreshed_at);

-- ---------------------------------------------------------------------------
-- Agent 12 — Outreach Copywriter
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_sequences (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT,
    contact_name TEXT,
    persona TEXT DEFAULT 'unknown',
    cta TEXT,
    steps JSONB DEFAULT '[]'::jsonb,
    sequence_quality_score INTEGER DEFAULT 0,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS persona TEXT DEFAULT 'unknown';
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS cta TEXT;
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]'::jsonb;
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS sequence_quality_score INTEGER DEFAULT 0;
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_sequences_lead_id ON outreach_sequences(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_icp_id ON outreach_sequences(icp_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_refreshed_at ON outreach_sequences(refreshed_at);

-- ---------------------------------------------------------------------------
-- Agent 13 — Channel Strategy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_channel_plans (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
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

ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS primary_channel TEXT DEFAULT 'email';
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS secondary_channel TEXT;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS channel_sequence JSONB DEFAULT '[]'::jsonb;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS send_window_start_hour INTEGER DEFAULT 9;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS send_window_end_hour INTEGER DEFAULT 17;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS touches_per_week INTEGER DEFAULT 2;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS rationale TEXT;
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_channel_plans_lead_id ON outreach_channel_plans(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_channel_plans_icp_id ON outreach_channel_plans(icp_id);
CREATE INDEX IF NOT EXISTS idx_outreach_channel_plans_primary_channel ON outreach_channel_plans(primary_channel);

-- ---------------------------------------------------------------------------
-- Agent 14 — Omnichannel Outreach Orchestrator
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_log (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL,
    company_name TEXT,
    contact_email TEXT,
    campaign_id TEXT,
    instantly_lead_id TEXT,
    channel TEXT DEFAULT 'email',
    step_number INTEGER DEFAULT 1,
    variant_subject TEXT,
    status TEXT DEFAULT 'queued',
    error TEXT,
    -- Provider message ids (Gmail API) so replies can be threaded later.
    message_id TEXT,
    thread_id TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS icp_id BIGINT REFERENCES icp_profiles(id) ON DELETE SET NULL;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS instantly_lead_id TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'email';
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS step_number INTEGER DEFAULT 1;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS variant_subject TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'queued';
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS thread_id TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_outreach_log_lead_id ON outreach_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_campaign_id ON outreach_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_status ON outreach_log(status);
CREATE INDEX IF NOT EXISTS idx_outreach_log_created_at ON outreach_log(created_at);

-- ---------------------------------------------------------------------------
-- Agent 15 — A/B Testing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ab_test_results (
    id BIGSERIAL PRIMARY KEY,
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
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS step_number INTEGER;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS variant_subject TEXT;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS open_count INTEGER DEFAULT 0;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS reply_count INTEGER DEFAULT 0;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS open_rate NUMERIC DEFAULT 0;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS reply_rate NUMERIC DEFAULT 0;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS is_winner BOOLEAN DEFAULT FALSE;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS sample_size_met BOOLEAN DEFAULT FALSE;
-- is_retired: a non-winning variant is auto-retired once its step has a winner
-- (PDF Agent 15 rule: "Losing variants must be retired after a significant result").
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS is_retired BOOLEAN DEFAULT FALSE;
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ab_test_results_campaign_step_variant
    ON ab_test_results(campaign_id, step_number, variant_subject);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_campaign_id ON ab_test_results(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_is_winner ON ab_test_results(is_winner);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_is_retired ON ab_test_results(is_retired);

-- ---------------------------------------------------------------------------
-- Agent 14 — Gmail direct-send tracking (ported from the n8n Email Outreach
-- automation). Opens are recorded by the /open pixel; unsubscribes by the
-- /unsubscribe link. Agent 14's gmail sender reads outreach_unsubscribes to
-- suppress opt-outs on subsequent runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_unsubscribes (
    email TEXT PRIMARY KEY,
    lead_id BIGINT REFERENCES leads_raw(id) ON DELETE SET NULL,
    campaign_id TEXT,
    unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE outreach_unsubscribes ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE SET NULL;
ALTER TABLE outreach_unsubscribes ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE outreach_unsubscribes ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE outreach_unsubscribes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS outreach_opens (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    campaign_id TEXT NOT NULL DEFAULT '',
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE outreach_opens ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE outreach_opens ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE outreach_opens ADD COLUMN IF NOT EXISTS campaign_id TEXT DEFAULT '';
ALTER TABLE outreach_opens ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE outreach_opens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- one row per (lead, email, campaign) — repeated pixel hits are idempotent
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_opens_lead_email_campaign
    ON outreach_opens(lead_id, email, campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_opens_campaign_id ON outreach_opens(campaign_id);

-- ---------------------------------------------------------------------------
-- Agent 14 — reply-pause gate. Phase 4's inbox/reply agent writes one row here
-- the moment a reply is detected; Agent 14 reads it to pause all outreach to
-- that lead (PDF rule: "pause all outreach to an account the moment a reply is
-- received"). Harmless until Phase 4 populates it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_replies (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE,
    email TEXT,
    campaign_id TEXT DEFAULT '',
    classification TEXT,           -- interested | not_now | wrong_person | not_interested | unknown
    replied_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS campaign_id TEXT DEFAULT '';
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS classification TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_replies_lead_campaign
    ON outreach_replies(lead_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_replies_lead_id ON outreach_replies(lead_id);
