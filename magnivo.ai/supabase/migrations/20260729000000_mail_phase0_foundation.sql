-- ============================================================
-- Phase 0: Mail module foundation — status sync, IMAP secrets,
-- Engage token encryption columns, usage counters prep
-- ============================================================

-- 1. Align mailbox_status with TypeScript MailboxStatus + PRD states
ALTER TABLE public.mail_mailboxes
  DROP CONSTRAINT IF EXISTS mail_mailboxes_mailbox_status_check;
ALTER TABLE public.mail_mailboxes
  ADD CONSTRAINT mail_mailboxes_mailbox_status_check
  CHECK (mailbox_status IN (
    'pending',
    'testing',
    'connected',
    'disconnected',
    'warming',
    'error',
    'suspended',
    'disabled',
    'archived',
    'deleted',
    'reconnect_required',
    'oauth_expired',
    'smtp_failed',
    'imap_failed',
    'verification_failed',
    'pending_dns',
    'pending_warmup',
    'at_risk'
  ));

-- 2. DNS / warmup gate columns
ALTER TABLE public.mail_mailboxes
  ADD COLUMN IF NOT EXISTS dns_risk_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dns_risk_override_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dns_risk_override_by UUID,
  ADD COLUMN IF NOT EXISTS consecutive_send_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconnect_notified_at TIMESTAMPTZ;

-- 3. IMAP encrypted password (was missing — credentials only lived on SMTP)
ALTER TABLE public.mailbox_imap_configs
  ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS encrypted_password_reference TEXT;

-- 4. Engage mailboxes — additive encrypted token columns (keep legacy columns for BC)
ALTER TABLE public.engage_mailboxes
  ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS tokens_encrypted_at TIMESTAMPTZ;

-- 5. Cross-org duplicate abuse review log
CREATE TABLE IF NOT EXISTS public.mail_abuse_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  other_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  mailbox_id UUID,
  event_type TEXT NOT NULL DEFAULT 'cross_org_duplicate'
    CHECK (event_type IN ('cross_org_duplicate', 'rate_abuse', 'credential_reuse')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_abuse_review_events DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_abuse_review_email ON public.mail_abuse_review_events(email);
CREATE INDEX IF NOT EXISTS idx_mail_abuse_review_org ON public.mail_abuse_review_events(organization_id);

-- 6. Mailbox usage counters (billing-ready from day one)
CREATE TABLE IF NOT EXISTS public.mail_mailbox_usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sends INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0,
  unsubscribes INTEGER NOT NULL DEFAULT 0,
  warmup_sends INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_id, usage_date)
);
ALTER TABLE public.mail_mailbox_usage_daily DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_usage_org_date ON public.mail_mailbox_usage_daily(organization_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_mail_usage_mailbox ON public.mail_mailbox_usage_daily(mailbox_id);

-- 7. In-app mail notifications
CREATE TABLE IF NOT EXISTS public.mail_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID REFERENCES public.mail_mailboxes(id) ON DELETE SET NULL,
  user_id UUID,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_notifications DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_notifications_org_unread
  ON public.mail_notifications(organization_id, is_read)
  WHERE is_read = FALSE;
