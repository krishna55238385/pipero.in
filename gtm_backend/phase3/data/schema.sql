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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE outreach_personalisations ADD COLUMN IF NOT EXISTS organization_id UUID;

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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE outreach_sequences ADD COLUMN IF NOT EXISTS organization_id UUID;

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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE outreach_channel_plans ADD COLUMN IF NOT EXISTS organization_id UUID;

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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS organization_id UUID;

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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS organization_id UUID;

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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE outreach_unsubscribes ADD COLUMN IF NOT EXISTS organization_id UUID;
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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE outreach_opens ADD COLUMN IF NOT EXISTS organization_id UUID;
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

-- organization_id: _inject_org tags every _post()/_upsert() insert
-- unconditionally whenever GTM_ORG_ID is set — no per-table opt-out
-- exists. Closing a documentation/safety gap found while auditing this
-- bug class (already hit data_quality_reports and nurture_touches live).
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS organization_id UUID;
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
-- Agent 22 — Meeting Booking (phase4/CONVERT) addition. Set once a reply
-- classified 'interested' has been checked for meeting intent (whether or
-- not it actually resulted in a proposed meeting), so re-runs don't
-- re-check it. Mirrors deal_qualified's idempotency pattern above.
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS meeting_booking_checked BOOLEAN NOT NULL DEFAULT FALSE;

-- Task #32/#34 — real inbox ingestion (Agent 16 inbox poller) needs to
-- record MULTIPLE replies per (lead, campaign) over time: a prospect who
-- says "interested" and later replies again to confirm a meeting time is
-- two separate real messages, not one. The old uniq_outreach_replies_lead_
-- campaign index made that architecturally impossible — only ONE reply per
-- lead per campaign could ever exist, full stop. Dropped in favor of a real
-- per-message dedupe key: message_id, the actual Gmail message id of the
-- inbound reply. That's what makes re-polling the same inbox message safe
-- (never double-classified) while still allowing a second, genuinely
-- different reply to be recorded. message_id is NULL for the legacy/manual
-- path (hand-inserted test rows, `classify-reply` CLI) — those still fall
-- back to the old lead+campaign idempotency check in application code
-- (see agent_16_inbox.classify_reply), just no longer enforced by the DB.
DROP INDEX IF EXISTS uniq_outreach_replies_lead_campaign;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE outreach_replies ADD COLUMN IF NOT EXISTS thread_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outreach_replies_message_id
    ON outreach_replies(message_id) WHERE message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Agent 22 — Meeting Booking Agent (PDF Phase 5 — CONVERT)
--
-- One row per meeting proposed/booked via Cal.com. calcom_booking_uid is set
-- once a prospect actually confirms a slot (Agent 22's sync step polls
-- Cal.com for this); until then a row exists in status='proposed' purely so
-- the CRM can show "meeting proposed, awaiting confirmation."
--
-- PDF business rules encoded here: reschedule_count + max 2 reschedules
-- before moving to nurture (status='moved_to_nurture'); status='no_show'
-- distinct from 'cancelled' so no-show recovery rate (PDF success metric)
-- can be measured separately from ordinary cancellations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
    id BIGSERIAL PRIMARY KEY,
    reply_id BIGINT REFERENCES outreach_replies(id) ON DELETE CASCADE,
    lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE,
    deal_id UUID,                      -- CRM deals.id (UUID) — nullable, set if/when Agent 24 has already qualified this lead
    calcom_booking_uid TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',  -- proposed | confirmed | completed | no_show | cancelled | moved_to_nurture
    proposed_slots JSONB DEFAULT '[]'::jsonb, -- the >=3 ISO times offered, for audit / no re-proposing the same slots
    scheduled_at TIMESTAMPTZ,          -- set once confirmed
    attendee_timezone TEXT,
    agenda TEXT,
    reschedule_count INTEGER NOT NULL DEFAULT 0,
    proposed_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reply_id BIGINT REFERENCES outreach_replies(id) ON DELETE CASCADE;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS calcom_booking_uid TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'proposed';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS proposed_slots JSONB DEFAULT '[]'::jsonb;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS attendee_timezone TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS agenda TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_meetings_reply_id ON meetings(reply_id);
CREATE INDEX IF NOT EXISTS idx_meetings_lead_id ON meetings(lead_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);

-- ---------------------------------------------------------------------------
-- Agent 23 — Pre-Meeting Brief Agent (PDF Phase 5 — CONVERT)
--
-- One row per confirmed meeting. Own table, same reasoning as
-- executive_briefs/onboarding_handoffs (each brief type is a distinct
-- artifact with its own shape, not worth cramming into one generic
-- "briefs" table). unusual_context is split out from the general brief
-- text so the CRM can surface it as a standalone flag/badge later (PDF:
-- "must flag if any unusual context exists"), not just buried in prose.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_briefs (
    id BIGSERIAL PRIMARY KEY,
    meeting_id BIGINT REFERENCES meetings(id) ON DELETE CASCADE,
    lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE,
    company_name TEXT,
    brief_text TEXT,
    recent_development TEXT,
    unusual_context TEXT,           -- null when nothing unusual found
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS meeting_id BIGINT REFERENCES meetings(id) ON DELETE CASCADE;
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS brief_text TEXT;
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS recent_development TEXT;
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS unusual_context TEXT;
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE meeting_briefs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_meeting_briefs_meeting_id ON meeting_briefs(meeting_id);
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
-- Per-organization meeting business hours (Agent 22 — Meeting Booking)
-- ---------------------------------------------------------------------------
-- Same reasoning/pattern as product_description above: each org is a
-- genuinely separate client business with its own real working hours, not a
-- platform-wide constant. Previously hardcoded to Mon-Fri 9am-5pm UTC for
-- every org regardless of where they actually are — meant an org outside UTC
-- could get offered slots outside their own working day. Defaults (9, 17,
-- 'UTC', 30) preserve the old global behavior for any org that hasn't set
-- these explicitly, so this is purely additive, not a breaking change.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS meeting_business_start_hour INTEGER DEFAULT 9;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS meeting_business_end_hour INTEGER DEFAULT 17;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS meeting_business_timezone TEXT DEFAULT 'UTC';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS meeting_duration_minutes INTEGER DEFAULT 30;

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

-- ---------------------------------------------------------------------------
-- Agent 39 — Onboarding Handoff (phase4/RETAIN & GROW, PDF Phase 7)
-- ---------------------------------------------------------------------------
-- Own table, same reasoning as deal_proposals/executive_briefs — no FK into
-- the CRM's shared `deals` (owned by postgres, not magnivo_app), deal_id
-- validated in application logic only.
--
-- Honest scope (see agent_39_onboarding_handoff.py docstring for full
-- reasoning): this agent produces the BRIEF (what was promised, success
-- criteria, key stakeholders). It does NOT schedule the sales team's 30-
-- minute handoff call, and it does NOT itself gate onboarding on delivery-
-- team confirmation — those are human coordination steps. The `status` and
-- `quality_rating` columns exist so a future CRM UI can let the delivery
-- team confirm receipt and rate the handoff (PDF rules), but nothing in
-- this codebase sets them automatically — draft-only, same human-review-
-- first pattern as every other messaging/brief agent this session.
CREATE TABLE IF NOT EXISTS onboarding_handoffs (
    id BIGSERIAL PRIMARY KEY,
    deal_id UUID NOT NULL,
    crm_lead_id UUID,
    company_name TEXT,
    handoff_brief TEXT,
    what_was_promised TEXT,
    success_criteria TEXT,
    key_stakeholders JSONB DEFAULT '[]'::jsonb,
    primary_contact_name TEXT,
    primary_contact_email TEXT,
    communication_preference TEXT,
    status TEXT DEFAULT 'draft',          -- draft | delivered | confirmed | held
    held_reason TEXT,
    quality_rating INTEGER,               -- 1-5, set later by delivery team (not by this agent)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS crm_lead_id UUID;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS handoff_brief TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS what_was_promised TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS success_criteria TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS key_stakeholders JSONB DEFAULT '[]'::jsonb;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS primary_contact_name TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS primary_contact_email TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS communication_preference TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS quality_rating INTEGER;
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE onboarding_handoffs ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_onboarding_handoffs_deal_id ON onboarding_handoffs(deal_id);

-- ---------------------------------------------------------------------------
-- Agent 40 — Lead Nurturing (phase4/RETAIN & GROW, PDF Phase 7)
-- ---------------------------------------------------------------------------
-- One row per nurture touch (append-per-touch, not upserted) — this is the
-- history that both enforces "max one touch per month" (check the latest
-- row's next_eligible_at) and "never repeat content within 6 months" (scan
-- content_topic across a lead's own touch history). organization_id is
-- required despite this table's own rows otherwise being scoped by
-- GTM_ORG_ID at read time: _inject_org tags every _post()/_upsert() insert
-- unconditionally (see phase3/connectors/supabase.py), so every table
-- written through those helpers needs this column regardless of its read
-- path — same bug class as the data_quality_reports fix.
CREATE TABLE IF NOT EXISTS nurture_touches (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    lead_id BIGINT NOT NULL REFERENCES leads_raw(id) ON DELETE CASCADE,
    reply_id BIGINT REFERENCES outreach_replies(id) ON DELETE SET NULL,
    touch_number INTEGER NOT NULL DEFAULT 1,
    content_topic TEXT,
    content_text TEXT,
    status TEXT NOT NULL DEFAULT 'draft',   -- draft | converted | paused | opted_out
    held_reason TEXT,
    next_eligible_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads_raw(id) ON DELETE CASCADE;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS reply_id BIGINT REFERENCES outreach_replies(id) ON DELETE SET NULL;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS touch_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS content_topic TEXT;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS next_eligible_at TIMESTAMPTZ;
ALTER TABLE nurture_touches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_nurture_touches_lead_id ON nurture_touches(lead_id);
CREATE INDEX IF NOT EXISTS idx_nurture_touches_status ON nurture_touches(status);

-- ---------------------------------------------------------------------------
-- Agent 41 — Re-engagement (phase4/RETAIN & GROW)
-- ---------------------------------------------------------------------------
-- Population is closed-lost `deals` (owned by the CRM app, not gtm_backend —
-- no FK here, same convention as onboarding_handoffs.deal_id). No FK to
-- `deals` deliberately: this table lives in gtm_backend's schema, `deals`
-- lives in the CRM app's schema; both point at the same physical Postgres
-- instance but are logically separate owners, exactly like onboarding_handoffs.
--
-- Known scope limitation, documented honestly (see agent_41_reengagement.py
-- module docstring): the PDF's "conditions changed" trigger ideally means a
-- fresh buying signal on the account. That's not wired here — buying_signals
-- is keyed to phase1's leads_raw.id, and CRM deals/leads don't currently
-- share a key with leads_raw, so there's no reliable join between the two
-- systems yet. Until that link exists, this agent operationalizes "conditions
-- changed" as a minimum cooling-off period since the deal closed, combined
-- with an LLM gate that must ground the message in the deal's own history
-- (or hold rather than send a hollow "just checking in").
CREATE TABLE IF NOT EXISTS reengagement_touches (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    deal_id UUID NOT NULL,
    crm_lead_id UUID,
    company_name TEXT,
    touch_number INTEGER NOT NULL DEFAULT 1,
    trigger_reason TEXT,
    content_text TEXT,
    status TEXT NOT NULL DEFAULT 'draft',   -- draft | held | opted_out
    held_reason TEXT,
    next_eligible_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS deal_id UUID NOT NULL;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS crm_lead_id UUID;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS touch_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS trigger_reason TEXT;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS next_eligible_at TIMESTAMPTZ;
ALTER TABLE reengagement_touches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_reengagement_touches_deal_id ON reengagement_touches(deal_id);
CREATE INDEX IF NOT EXISTS idx_reengagement_touches_status ON reengagement_touches(status);

-- ---------------------------------------------------------------------------
-- Agent 42 — Champion Tracker (phase4/RETAIN & GROW)
-- ---------------------------------------------------------------------------
-- Population is contacts on WON deals ("previously engaged positively or
-- been customers" — PDF's own rule). No FK to `contacts`/`deals` (CRM-owned
-- tables), same no-FK convention as reengagement_touches/onboarding_handoffs.
--
-- Known scope limitations, documented honestly (see
-- agent_42_champion_tracker.py module docstring):
-- - "Alert within 48 hours of detection" is satisfied by run frequency
--   (this agent should be scheduled to run at least daily), not true
--   real-time push alerting — this codebase has no event/webhook layer.
-- - "Monitor all contacts who have previously engaged positively" is scoped
--   to WON-deal contacts only (verified customers), not the broader set of
--   anyone who "engaged positively" without becoming a customer — that
--   would need a defined signal for "positive engagement" this system
--   doesn't track yet.
-- One row per detected move, upserted-in-spirit via a dedupe check in the
-- agent itself (skips re-flagging the same contact -> same new_company_name
-- pair on a later run).
CREATE TABLE IF NOT EXISTS champion_moves (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    contact_id UUID NOT NULL,
    contact_name TEXT,
    original_company TEXT,
    original_deal_id UUID,
    new_company_name TEXT,
    new_title TEXT,
    is_competitor BOOLEAN DEFAULT FALSE,
    content_text TEXT,
    status TEXT NOT NULL DEFAULT 'detected',   -- detected | competitor_skip | held | drafted
    held_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS contact_id UUID NOT NULL;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS original_company TEXT;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS original_deal_id UUID;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS new_company_name TEXT;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS new_title TEXT;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS is_competitor BOOLEAN DEFAULT FALSE;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'detected';
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE champion_moves ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_champion_moves_contact_id ON champion_moves(contact_id);
CREATE INDEX IF NOT EXISTS idx_champion_moves_status ON champion_moves(status);

-- ---------------------------------------------------------------------------
-- Agent 43 — Expansion & Upsell (phase4/RETAIN & GROW)
-- ---------------------------------------------------------------------------
-- Population is won deals with a confirmed/delivered onboarding_handoffs row
-- (the PDF's own gate: "expansion conversations must only begin after client
-- is successfully onboarded"), past a 60-day cooldown since handoff. One-shot
-- per deal — any existing row here permanently skips future runs. Same
-- documented v1 scope choice as Agent 42 (no periodic re-check cadence yet).
--
-- "Must have evidence of value delivered" is approximated using the
-- onboarding_handoffs.what_was_promised/success_criteria fields already on
-- file — this codebase has no product-usage/analytics integration to
-- measure ACTUAL delivered value, so the LLM works from what was promised at
-- handoff time rather than verified usage data. Documented limitation, see
-- agent_43_expansion_upsell.py module docstring.
CREATE TABLE IF NOT EXISTS expansion_opportunities (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    deal_id UUID NOT NULL,
    contact_id UUID,
    company_name TEXT,
    opportunity_type TEXT,
    content_text TEXT,
    status TEXT NOT NULL DEFAULT 'draft',   -- draft | held
    held_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS deal_id UUID NOT NULL;
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS opportunity_type TEXT;
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE expansion_opportunities ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_expansion_opportunities_deal_id ON expansion_opportunities(deal_id);
CREATE INDEX IF NOT EXISTS idx_expansion_opportunities_status ON expansion_opportunities(status);

-- ---------------------------------------------------------------------------
-- Agent 44 — Referral (phase4/RETAIN & GROW)
-- ---------------------------------------------------------------------------
-- Same onboarding-confirmed gate and one-shot-per-deal pattern as Agent 43.
-- Known scope limitations, documented honestly (see
-- agent_44_referral.py module docstring): the PDF's "follow up within 2
-- weeks if no introduction received" and "send a thank-you and close the
-- loop on outcome" rules are NOT built in v1 — both need a way to track
-- what happened after the ask was sent (did the champion respond? did the
-- introduction happen? did the referred lead convert?), which requires
-- outcome tracking this system doesn't have wired up yet. v1 covers the
-- ask itself: identifying the right moment and drafting a specific,
-- easy-to-forward request.
CREATE TABLE IF NOT EXISTS referral_requests (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    deal_id UUID NOT NULL,
    contact_id UUID,
    company_name TEXT,
    target_description TEXT,
    content_text TEXT,
    forwardable_intro_text TEXT,
    status TEXT NOT NULL DEFAULT 'draft',   -- draft | held
    held_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS deal_id UUID NOT NULL;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS target_description TEXT;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS forwardable_intro_text TEXT;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE referral_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_referral_requests_deal_id ON referral_requests(deal_id);
CREATE INDEX IF NOT EXISTS idx_referral_requests_status ON referral_requests(status);

-- ---------------------------------------------------------------------------
-- Agent 45 — Revenue Intelligence (phase4/RETAIN & GROW)
-- ---------------------------------------------------------------------------
-- Append-only snapshot, same pattern as revenue_forecasts/board_reports —
-- each run is a new row, not an overwrite, so period-over-period comparison
-- stays possible.
--
-- Known scope limitations, documented honestly (see
-- agent_45_revenue_intelligence.py module docstring): the PDF's "win/loss
-- reasons must be captured for every deal" isn't satisfied — `deals` has no
-- loss_reason column anywhere in this codebase, so analysis works from what
-- IS captured (deal value, sales cycle length, company industry) rather than
-- structured win/loss reasons. "Recommendations must feed back into ICP
-- scoring, copywriting, and channel strategy" is intentionally NOT an
-- automated feedback loop — the PDF's own separate rule requires human
-- review before system-wide implementation, so recommendations are surfaced
-- for a human to act on, never auto-applied to other agents' configs.
CREATE TABLE IF NOT EXISTS revenue_intelligence_snapshots (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    closed_deal_count INTEGER NOT NULL DEFAULT 0,
    min_sample_met BOOLEAN NOT NULL DEFAULT FALSE,
    win_rate NUMERIC,
    avg_deal_size_won NUMERIC,
    avg_deal_size_lost NUMERIC,
    avg_sales_cycle_days_won NUMERIC,
    segment_breakdown JSONB DEFAULT '{}'::jsonb,
    key_insights JSONB DEFAULT '[]'::jsonb,
    recommendations JSONB DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS closed_deal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS min_sample_met BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS win_rate NUMERIC;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS avg_deal_size_won NUMERIC;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS avg_deal_size_lost NUMERIC;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS avg_sales_cycle_days_won NUMERIC;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS segment_breakdown JSONB DEFAULT '{}'::jsonb;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS key_insights JSONB DEFAULT '[]'::jsonb;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS recommendations JSONB DEFAULT '[]'::jsonb;
ALTER TABLE revenue_intelligence_snapshots ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_revenue_intelligence_snapshots_generated_at ON revenue_intelligence_snapshots(generated_at);

-- ---------------------------------------------------------------------------
-- Agent 32 — CRM Sync (phase4/MANAGE & REPORT)
-- ---------------------------------------------------------------------------
-- Scoped honestly, not to the PDF's full spec (see agent_32_crm_sync.py
-- module docstring for the full reasoning): most of "log every touchpoint /
-- auto-update deal stage" is already covered by Agents 14/16/24 writing
-- directly to the CRM's own tables in real time. This table exists for the
-- genuinely NEW piece — a data-hygiene audit that FLAGS problems (duplicate
-- contacts, stale deals, unverifiable contacts) for a human to review and
-- fix. Never auto-merges or auto-deletes anything (PDF's own rule: "data
-- must never be deleted — only archived with a reason"; duplicates "must be
-- flagged and merged" but auto-merging real CRM records is exactly the kind
-- of destructive action this whole session's human-review-first pattern
-- exists to avoid).
--
-- One row per detected issue, upserted on (flag_type, dedupe_key) so re-runs
-- refresh existing flags instead of piling up duplicates of the same issue.
-- dedupe_key is computed by the agent: deal_id for stale_deal, crm_lead_id
-- for invalid_contact, a sorted-joined string of the duplicate lead ids for
-- duplicate_contact.
CREATE TABLE IF NOT EXISTS crm_sync_flags (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID,
    flag_type TEXT NOT NULL,          -- duplicate_contact | stale_deal | invalid_contact
    dedupe_key TEXT NOT NULL,
    crm_lead_id UUID,
    deal_id UUID,
    related_lead_ids JSONB DEFAULT '[]'::jsonb,
    details TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_note TEXT
);

ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS flag_type TEXT;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS crm_lead_id UUID;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS related_lead_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE crm_sync_flags ADD COLUMN IF NOT EXISTS resolved_note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_sync_flags_type_key ON crm_sync_flags(flag_type, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_crm_sync_flags_resolved_at ON crm_sync_flags(resolved_at);

-- ---------------------------------------------------------------------------
-- Organization-supplied API keys (BYO key / model choice feature)
-- ---------------------------------------------------------------------------
-- Lets a client organization supply their OWN SerpAPI key and pick their own
-- LLM (via OpenRouter, one connector covering 300+ models) instead of always
-- riding the platform's shared keys. Motivated by a real production incident:
-- the platform's shared SerpAPI+Serper quota both ran out simultaneously,
-- silently degrading search-dependent agents for every org at once. A
-- client with their own key is isolated from that — their quota is theirs
-- alone, and their exhaustion doesn't affect anyone else.
--
-- One row per (organization_id, provider). provider is 'serpapi' or
-- 'openrouter'. encrypted_key is the raw API key encrypted at rest via
-- pgcrypto's pgp_sym_encrypt, keyed off the API_KEY_ENCRYPTION_SECRET env
-- var (server-side only, never stored in this table or sent to the browser).
-- model is only meaningful for provider='openrouter' (e.g.
-- "anthropic/claude-haiku-4.5", "deepseek/deepseek-v4-flash") — null means
-- "use the platform's default model choice".
--
-- Missing extension: pgp_sym_encrypt/decrypt require the pgcrypto extension.
-- Apply once per database: CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- (Needs a role with CREATE privilege — same ownership caveat as every other
-- schema apply this session: run this line separately if the app role lacks
-- permission, using a superuser/rds-superuser connection.)
CREATE TABLE IF NOT EXISTS organization_api_keys (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL,
    provider TEXT NOT NULL,           -- 'serpapi' | 'openrouter'
    encrypted_key BYTEA NOT NULL,
    model TEXT,                       -- openrouter only; null = platform default model
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE organization_api_keys ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE organization_api_keys ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE organization_api_keys ADD COLUMN IF NOT EXISTS encrypted_key BYTEA;
ALTER TABLE organization_api_keys ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE organization_api_keys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE organization_api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_organization_api_keys_org_provider ON organization_api_keys(organization_id, provider);
