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
-- Agent 16 — Inbox Management additions: the raw reply text (audit trail /
-- human review), how confident the classification is, and a short suggested
-- next action (e.g. "book meeting", "request correct contact").
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS reply_text TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS suggested_action TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS reviewed BOOLEAN NOT NULL DEFAULT FALSE;
-- Agent 17 — Reply Handling additions: a drafted response, always held for
-- human approval before send (PDF rule: "all automated responses must be
-- reviewed before sending"). response_status: pending_draft (classified, no
-- draft yet) | pending_review (drafted, awaiting approval) | approved (queued
-- to send) | sent | no_response_needed (e.g. not_interested — pause only).
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS draft_response TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending_draft';
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS drafted_at TIMESTAMPTZ;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS response_message_id TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS response_thread_id TEXT;
-- Agent 18 — Objection Handling additions. Runs on classification IN
-- (not_now, has_question) before Agent 17 drafts, so the draft can address
-- the SPECIFIC objection instead of a generic acknowledgment. objection_type
-- is null when the reply doesn't actually contain an objection (e.g. a plain
-- factual question with no pushback).
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS objection_type TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS objection_phrase TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS rebuttal_angle TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS objection_checked BOOLEAN NOT NULL DEFAULT FALSE;
-- Agent 24 — Deal Qualification (phase4/CONVERT) addition. Set once a reply
-- classified 'interested' has been scored and either turned into (or matched
-- to) a row in the CRM's own `deals` table, so re-runs don't re-score it.
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS deal_qualified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_replies_lead_campaign
    ON outreach_replies(lead_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_replies_lead_id ON outreach_replies(lead_id);

-- ---------------------------------------------------------------------------
-- Per-organization seller product description (Agents 25/27)
-- ---------------------------------------------------------------------------
-- Each CRM organization is a genuinely separate client business (PDF Agent 47
-- "Multi-Tenant Management" — each client's data/workspace is isolated; PDF
-- Agent 48 "White-Label Delivery" — outputs carry the client's brand, not the
-- agency's). A single global product description was architecturally wrong
-- for Agents 25 (Proposal Generation) and 27 (Executive Engagement), which
-- both need to know what THIS client's business actually sells. Stored on
-- `organizations` itself (the CRM's own tenant table) rather than a new
-- table, per the natural 1:1 relationship — one description per org.
-- `organizations` is a shared CRM table (not owned by magnivo_app), so this
-- ALTER may need a one-time grant fix on first deploy, same as past
-- shared-table ALTERs (see INFRA_NOTES.md) — flagged here, not worked around.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS product_description TEXT;

-- ---------------------------------------------------------------------------
-- Agent 25 — Proposal Generation (phase4/CONVERT)
-- ---------------------------------------------------------------------------
-- Deliberately its OWN table rather than more columns on the CRM's `deals`
-- table: `deals` is a shared, live table the Next.js CRM app already reads/
-- writes directly, and every previous ALTER TABLE on a table not owned by
-- magnivo_app has needed a manual grant/ownership fix (see INFRA_NOTES.md).
-- No FK to deals(id) for the same reason — deals is owned by `postgres`, not
-- magnivo_app, and a FK constraint would need its own REFERENCES grant. This
-- table is fully owned by magnivo_app since it creates it, so it needs no
-- extra grants. deal_id is validated in application logic (Agent 25 only
-- writes it after reading a real deal row), not by a DB constraint.
CREATE TABLE IF NOT EXISTS deal_proposals (
    id BIGSERIAL PRIMARY KEY,
    deal_id UUID NOT NULL,
    crm_lead_id UUID,
    company_name TEXT,
    proposal_text TEXT,
    pain_points_referenced JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'draft',              -- draft | approved | sent
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS crm_lead_id UUID;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS proposal_text TEXT;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS pain_points_referenced JSONB DEFAULT '[]'::jsonb;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_deal_proposals_deal_id ON deal_proposals(deal_id);

-- Agent 26 — Proposal Follow-up additions. sent_at/opened_at/open_count/
-- shared_with_others are populated by whatever eventually sends+tracks the
-- proposal (not built yet — same "build the agent ahead of the real
-- integration" pattern as Agent 16/inbox). Until that exists these just stay
-- null/0/false and Agent 26 simply never fires, which is the safe default.
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS shared_with_others BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS seller_alerted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS followup_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS draft_followup_text TEXT;
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS followup_status TEXT NOT NULL DEFAULT 'none';
-- organization_id: every _post/_upsert in supabase.py auto-injects this via
-- _inject_org whenever GTM_ORG_ID is set — required on any table Agent
-- 25-27/33 write to, or the insert/upsert fails with UndefinedColumn (hit
-- live on pipeline_status 2026-07-24; backfilling it here too since the same
-- bug was latent on this table, just never triggered — no row had been
-- inserted into deal_proposals yet). Nullable UUID, no FK, matches the
-- existing pattern on phase1's social_listening_leads.
ALTER TABLE deal_proposals ADD COLUMN IF NOT EXISTS organization_id UUID;

-- ---------------------------------------------------------------------------
-- Agent 27 — Executive Engagement (phase4/CONVERT)
-- ---------------------------------------------------------------------------
-- Own table, same reasoning as deal_proposals — no FK into the CRM's `deals`
-- (owned by postgres, not magnivo_app), deal_id validated in application
-- logic only.
CREATE TABLE IF NOT EXISTS executive_briefs (
    id BIGSERIAL PRIMARY KEY,
    deal_id UUID NOT NULL,
    crm_lead_id UUID,
    company_name TEXT,
    brief_text TEXT,
    business_outcome_summary TEXT,
    peer_reference TEXT,
    status TEXT DEFAULT 'draft',              -- draft | held | approved | sent
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS crm_lead_id UUID;
ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS brief_text TEXT;
ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS business_outcome_summary TEXT;
ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS peer_reference TEXT;
ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE executive_briefs ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_executive_briefs_deal_id ON executive_briefs(deal_id);

-- ---------------------------------------------------------------------------
-- Agent 33 — Pipeline Management (phase4/MANAGE & REPORT)
-- ---------------------------------------------------------------------------
-- One row per deal, upserted on every review run (a live snapshot, not a
-- history log — phase6/Board Reporting can aggregate over these later if a
-- history is ever needed). Own table, no FK into the shared CRM `deals`,
-- same reasoning as deal_proposals/executive_briefs.
CREATE TABLE IF NOT EXISTS pipeline_status (
    id BIGSERIAL PRIMARY KEY,
    deal_id UUID NOT NULL,
    crm_lead_id UUID,
    company_name TEXT,
    risk_level TEXT DEFAULT 'healthy',        -- healthy | at_risk | stuck
    days_since_activity INTEGER,
    next_best_action TEXT,
    risk_reasoning TEXT,
    reviewed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS crm_lead_id UUID;
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'healthy';
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS days_since_activity INTEGER;
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS next_best_action TEXT;
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS risk_reasoning TEXT;
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE pipeline_status ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pipeline_status_deal_id ON pipeline_status(deal_id);

-- ---------------------------------------------------------------------------
-- Agent 34 — Revenue Forecasting (phase4/MANAGE & REPORT)
-- ---------------------------------------------------------------------------
-- Append-only history log, NOT upserted like pipeline_status — the PDF's own
-- rule is "must track forecast accuracy over time," which requires keeping
-- every past forecast snapshot to compare against actuals later, not just
-- the latest one.
CREATE TABLE IF NOT EXISTS revenue_forecasts (
    id BIGSERIAL PRIMARY KEY,
    conservative_total NUMERIC,
    base_total NUMERIC,
    optimistic_total NUMERIC,
    committed_deal_count INTEGER,
    excluded_deal_count INTEGER,
    total_deal_count INTEGER,
    deal_breakdown JSONB DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS conservative_total NUMERIC;
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS base_total NUMERIC;
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS optimistic_total NUMERIC;
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS committed_deal_count INTEGER;
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS excluded_deal_count INTEGER;
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS total_deal_count INTEGER;
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS deal_breakdown JSONB DEFAULT '[]'::jsonb;
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE revenue_forecasts ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_generated_at ON revenue_forecasts(generated_at);

-- ---------------------------------------------------------------------------
-- Agent 35 — Board Reporting (phase4/MANAGE & REPORT)
-- ---------------------------------------------------------------------------
-- Append-only, same reasoning as revenue_forecasts — each report is a point-
-- in-time snapshot; keeping history is what makes "period-over-period
-- comparison" (a PDF rule) possible on the NEXT report. organization_id
-- included from the start this time (lesson from Agent 33/34).
CREATE TABLE IF NOT EXISTS board_reports (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    pipeline_by_stage JSONB DEFAULT '{}'::jsonb,
    conversion_rate NUMERIC,
    conversion_rate_note TEXT,
    forecast_base_total NUMERIC,
    forecast_delta_from_previous NUMERIC,
    top_risks JSONB DEFAULT '[]'::jsonb,
    going_well JSONB DEFAULT '[]'::jsonb,
    needs_attention JSONB DEFAULT '[]'::jsonb,
    executive_summary TEXT,
    report_text TEXT,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS pipeline_by_stage JSONB DEFAULT '{}'::jsonb;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS conversion_rate NUMERIC;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS conversion_rate_note TEXT;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS forecast_base_total NUMERIC;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS forecast_delta_from_previous NUMERIC;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS top_risks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS going_well JSONB DEFAULT '[]'::jsonb;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS needs_attention JSONB DEFAULT '[]'::jsonb;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS executive_summary TEXT;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS report_text TEXT;
ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_board_reports_generated_at ON board_reports(generated_at);

-- ---------------------------------------------------------------------------
-- Agent 36 — ROI Attribution (phase4/MANAGE & REPORT)
-- ---------------------------------------------------------------------------
-- Append-only, same reasoning as revenue_forecasts/board_reports — the PDF
-- rule "attribution data must be reviewed monthly" implies keeping history,
-- and cost-per-acquisition trend ("reducing quarter over quarter") can only
-- be judged by comparing snapshots over time, not from one point-in-time row.
--
-- Deliberately scoped honestly, not to the PDF's full spec: the PDF asks for
-- multi-touch, multi-CHANNEL attribution and cost-per-meeting. This system
-- currently has exactly one outbound channel (email — phase3's
-- CHANNEL_STRATEGY_SYSTEM is a hard "email-only" rule) and no Meeting Booking
-- agent (22/23 blocked on a calendar vendor decision). channel_breakdown
-- therefore has exactly one real row today; cost_per_meeting is omitted
-- entirely rather than invented. limitations_note records this in the row
-- itself so nobody reads a single-channel report as if it were the
-- multi-channel comparison the PDF describes.
CREATE TABLE IF NOT EXISTS roi_attribution_snapshots (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    total_llm_cost_usd NUMERIC,
    cost_by_phase JSONB DEFAULT '{}'::jsonb,
    lead_count INTEGER,
    qualified_deal_count INTEGER,
    closed_won_count INTEGER,
    closed_won_revenue NUMERIC,
    cost_per_lead NUMERIC,
    cost_per_qualified_deal NUMERIC,
    cost_per_closed_deal NUMERIC,
    channel_breakdown JSONB DEFAULT '[]'::jsonb,
    sourced_pipeline_value NUMERIC,
    influenced_pipeline_value NUMERIC,
    roi_ratio NUMERIC,
    flagged_negative_roi BOOLEAN NOT NULL DEFAULT FALSE,
    limitations_note TEXT,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS total_llm_cost_usd NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS cost_by_phase JSONB DEFAULT '{}'::jsonb;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS lead_count INTEGER;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS qualified_deal_count INTEGER;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS closed_won_count INTEGER;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS closed_won_revenue NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS cost_per_lead NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS cost_per_qualified_deal NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS cost_per_closed_deal NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS channel_breakdown JSONB DEFAULT '[]'::jsonb;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS sourced_pipeline_value NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS influenced_pipeline_value NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS roi_ratio NUMERIC;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS flagged_negative_roi BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS limitations_note TEXT;
ALTER TABLE roi_attribution_snapshots ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_roi_attribution_generated_at ON roi_attribution_snapshots(generated_at);
