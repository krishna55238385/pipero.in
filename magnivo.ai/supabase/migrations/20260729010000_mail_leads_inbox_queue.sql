-- ============================================================
-- Mail module expansion: leads, settings, sub-accounts, inbox,
-- enrollments, send queue, unsubscribe tokens, warmup pool
-- ============================================================

-- Sub-accounts (agency hierarchy)
CREATE TABLE IF NOT EXISTS public.mail_sub_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE public.mail_sub_accounts DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_sub_accounts_org ON public.mail_sub_accounts(organization_id);

ALTER TABLE public.mail_mailboxes
  ADD COLUMN IF NOT EXISTS sub_account_id UUID REFERENCES public.mail_sub_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.mailbox_pools
  ADD COLUMN IF NOT EXISTS sub_account_id UUID REFERENCES public.mail_sub_accounts(id) ON DELETE SET NULL;

-- Org mail settings
CREATE TABLE IF NOT EXISTS public.mail_org_settings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_signature TEXT,
  tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  open_tracking BOOLEAN NOT NULL DEFAULT TRUE,
  click_tracking BOOLEAN NOT NULL DEFAULT TRUE,
  unsubscribe_link BOOLEAN NOT NULL DEFAULT TRUE,
  daily_send_limit INTEGER NOT NULL DEFAULT 500,
  warmup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  physical_address TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  retention_days INTEGER NOT NULL DEFAULT 365,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_org_settings DISABLE ROW LEVEL SECURITY;

-- Mail leads (outreach-specific, separate from CRM leads)
CREATE TABLE IF NOT EXISTS public.mail_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sub_account_id UUID REFERENCES public.mail_sub_accounts(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'replied', 'interested', 'meeting_booked', 'won', 'lost', 'suppressed', 'invalid')),
  source TEXT NOT NULL DEFAULT 'manual',
  verified_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verified_status IN ('unverified', 'valid', 'invalid', 'risky', 'catch_all', 'no_mx')),
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  suppression_reason TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, email)
);
ALTER TABLE public.mail_leads DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_leads_org ON public.mail_leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_leads_email ON public.mail_leads(email);
CREATE INDEX IF NOT EXISTS idx_mail_leads_status ON public.mail_leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_mail_leads_suppressed ON public.mail_leads(organization_id) WHERE suppressed = TRUE;

-- Campaign enrollments
CREATE TABLE IF NOT EXISTS public.mail_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.mail_leads(id) ON DELETE CASCADE,
  mailbox_id UUID REFERENCES public.mail_mailboxes(id) ON DELETE SET NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'bounced', 'unsubscribed', 'replied', 'failed')),
  pause_reason TEXT,
  next_send_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, lead_id)
);
ALTER TABLE public.mail_enrollments DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_enrollments_org ON public.mail_enrollments(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_enrollments_next ON public.mail_enrollments(status, next_send_at)
  WHERE status = 'active';

-- Send jobs queue
CREATE TABLE IF NOT EXISTS public.mail_send_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES public.mail_enrollments(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.mail_leads(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'deferred')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  provider_message_id TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_send_jobs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_due
  ON public.mail_send_jobs(status, next_attempt_at)
  WHERE status IN ('pending', 'deferred');
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_mailbox
  ON public.mail_send_jobs(mailbox_id, status);

-- Signed unsubscribe tokens (tenant-safe)
CREATE TABLE IF NOT EXISTS public.mail_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  lead_id UUID REFERENCES public.mail_leads(id) ON DELETE SET NULL,
  campaign_id UUID,
  token_hash TEXT NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_unsubscribe_tokens DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_unsub_tokens_org ON public.mail_unsubscribe_tokens(organization_id, email);

-- Inbox threads (unified inbox)
CREATE TABLE IF NOT EXISTS public.mail_inbox_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  campaign_id UUID,
  lead_id UUID REFERENCES public.mail_leads(id) ON DELETE SET NULL,
  provider_thread_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  classification TEXT NOT NULL DEFAULT 'needs_human_review'
    CHECK (classification IN (
      'interested', 'not_interested', 'ooo', 'unsubscribe_request',
      'needs_human_review', 'bounce', 'other'
    )),
  classification_manual BOOLEAN NOT NULL DEFAULT FALSE,
  suggested_reply TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'archived', 'suppressed')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unread_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_inbox_threads DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_inbox_threads_org ON public.mail_inbox_threads(organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_inbox_threads_mailbox ON public.mail_inbox_threads(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_mail_inbox_threads_class ON public.mail_inbox_threads(organization_id, classification);

CREATE TABLE IF NOT EXISTS public.mail_inbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.mail_inbox_threads(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  provider_message_id TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound')),
  from_email TEXT NOT NULL DEFAULT '',
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_inbox_messages DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_inbox_messages_thread ON public.mail_inbox_messages(thread_id, received_at);

-- Warmup pool (Magnivo-owned partner mailboxes)
CREATE TABLE IF NOT EXISTS public.mail_warmup_pool_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'custom',
  auth_type TEXT NOT NULL DEFAULT 'smtp',
  encrypted_smtp_password TEXT,
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  imap_host TEXT,
  imap_port INTEGER DEFAULT 993,
  encrypted_imap_password TEXT,
  is_warmup_only BOOLEAN NOT NULL DEFAULT TRUE,
  health_status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (health_status IN ('healthy', 'degraded', 'blacklisted', 'disabled')),
  daily_capacity INTEGER NOT NULL DEFAULT 50,
  current_daily_usage INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_warmup_pool_mailboxes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_pool_health ON public.mail_warmup_pool_mailboxes(health_status)
  WHERE health_status = 'healthy';

CREATE TABLE IF NOT EXISTS public.mail_warmup_pool_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  pool_mailbox_id UUID NOT NULL REFERENCES public.mail_warmup_pool_mailboxes(id) ON DELETE CASCADE,
  config_id UUID,
  execution_id UUID,
  direction TEXT NOT NULL CHECK (direction IN ('client_to_pool', 'pool_to_client')),
  subject TEXT NOT NULL DEFAULT '',
  placed_in TEXT NOT NULL DEFAULT 'unknown'
    CHECK (placed_in IN ('inbox', 'spam', 'unknown')),
  opened BOOLEAN NOT NULL DEFAULT FALSE,
  replied BOOLEAN NOT NULL DEFAULT FALSE,
  spam_rescued BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_warmup_pool_interactions DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_interactions_client
  ON public.mail_warmup_pool_interactions(client_mailbox_id, created_at DESC);

-- Extend suppressions uniqueness for org+email
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_suppressions_org_email
  ON public.mail_email_suppressions(organization_id, email);

-- Global uniqueness for tracking domains (tenant isolation)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_tracking_domains_name_global
  ON public.mail_tracking_domains (LOWER(tracking_domain));
