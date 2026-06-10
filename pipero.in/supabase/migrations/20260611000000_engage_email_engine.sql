-- Engage email engine overhaul:
-- 1) explicit sent/received direction on synced emails (was inferred by substring)
-- 2) gmail message/thread ids on outreach_log so replies can be correlated
-- 3) click tracking table (open/reply already exist)
-- 4) campaign execution engine tables (recipients with per-step state)
-- 5) template attachments
-- 6) daily GTM automation schedule (3 AM scrape -> enrich -> score -> send)

-- 1) engage_emails -------------------------------------------------------------
ALTER TABLE public.engage_emails
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'received'
    CHECK (direction IN ('sent','received')),
  ADD COLUMN IF NOT EXISTS label_ids TEXT[] NOT NULL DEFAULT '{}';

-- Backfill direction for existing rows: compare the bare address inside the
-- raw From header ("Name <addr>") against the connected mailbox address.
UPDATE public.engage_emails e
SET direction = CASE
  WHEN lower(coalesce(nullif(substring(e.from_email FROM '<([^>]+)>'), ''), e.from_email)) = lower(m.email)
  THEN 'sent' ELSE 'received' END
FROM public.engage_mailboxes m
WHERE m.id = e.mailbox_id;

CREATE INDEX IF NOT EXISTS idx_engage_emails_box
  ON public.engage_emails (mailbox_id, direction, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_engage_emails_thread
  ON public.engage_emails (gmail_thread_id);

-- 2) outreach_log gmail correlation -------------------------------------------
ALTER TABLE public.outreach_log
  ADD COLUMN IF NOT EXISTS message_id TEXT,
  ADD COLUMN IF NOT EXISTS thread_id TEXT;
CREATE INDEX IF NOT EXISTS idx_outreach_log_thread ON public.outreach_log (thread_id);

ALTER TABLE public.outreach_replies
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS thread_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_replies_gmail_msg
  ON public.outreach_replies (gmail_message_id) WHERE gmail_message_id IS NOT NULL;

-- 3) click tracking -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_clicks (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID,
  lead_id BIGINT,
  email TEXT NOT NULL DEFAULT '',
  campaign_id TEXT,
  url TEXT NOT NULL DEFAULT '',
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_clicks_org ON public.outreach_clicks (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_clicks_campaign ON public.outreach_clicks (campaign_id);
ALTER TABLE public.outreach_clicks DISABLE ROW LEVEL SECURITY;

-- 4) campaign engine -------------------------------------------------------------
ALTER TABLE public.engage_campaigns
  ADD COLUMN IF NOT EXISTS sequence_id UUID REFERENCES public.engage_sequences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stop_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS open_tracking BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS link_tracking BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS public.engage_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.engage_campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  lead_id BIGINT,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','replied','stopped','failed','skipped')),
  next_run_at TIMESTAMPTZ,
  gmail_thread_id TEXT,
  last_message_id TEXT,
  last_error TEXT,
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS idx_engage_recipients_due
  ON public.engage_campaign_recipients (status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_engage_recipients_campaign
  ON public.engage_campaign_recipients (campaign_id, status);
ALTER TABLE public.engage_campaign_recipients DISABLE ROW LEVEL SECURITY;

-- 5) template attachments --------------------------------------------------------
ALTER TABLE public.engage_templates
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('engage-attachments', 'engage-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 6) daily automation schedule ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gtm_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  icp_id BIGINT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  run_hour INTEGER NOT NULL DEFAULT 3 CHECK (run_hour BETWEEN 0 AND 23),
  run_minute INTEGER NOT NULL DEFAULT 0 CHECK (run_minute BETWEEN 0 AND 59),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  leads_per_day INTEGER NOT NULL DEFAULT 25,
  sender TEXT NOT NULL DEFAULT 'gmail' CHECK (sender IN ('gmail','instantly')),
  auto_send BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_date DATE,
  last_run_status TEXT,
  last_run_log TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.gtm_schedules DISABLE ROW LEVEL SECURITY;
