-- ============================================================
-- Email Accounts: warmup, health score, tags, sending limits
-- ============================================================

-- 1. Extend engage_mailboxes with account status, sending limits, warmup config
ALTER TABLE public.engage_mailboxes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'warming', 'error', 'disconnected')),
  ADD COLUMN IF NOT EXISTS daily_send_limit INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS warmup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warmup_daily_limit INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS warmup_reply_rate INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS warmup_open_rate INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS warmup_spam_rescue_pct INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS warmup_mark_important_pct INTEGER NOT NULL DEFAULT 20;

-- 2. Expand provider to support SMTP and Microsoft in future
ALTER TABLE public.engage_mailboxes
  DROP CONSTRAINT IF EXISTS engage_mailboxes_provider_check;
ALTER TABLE public.engage_mailboxes
  ADD CONSTRAINT engage_mailboxes_provider_check
    CHECK (provider IN ('gmail', 'smtp', 'microsoft'));

-- 3. Track which mailbox sent each outreach email (forward-looking)
ALTER TABLE public.outreach_log
  ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES public.engage_mailboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS from_email TEXT;
CREATE INDEX IF NOT EXISTS idx_outreach_log_mailbox_id ON public.outreach_log(mailbox_id);

-- 4. Account tags
CREATE TABLE IF NOT EXISTS public.account_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE public.account_tags DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_account_tags_org_id ON public.account_tags(organization_id);

-- 5. Mailbox <-> tag join
CREATE TABLE IF NOT EXISTS public.mailbox_tags (
  mailbox_id UUID NOT NULL REFERENCES public.engage_mailboxes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.account_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (mailbox_id, tag_id)
);
ALTER TABLE public.mailbox_tags DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mailbox_tags_tag_id ON public.mailbox_tags(tag_id);

-- 6. Warmup log: one row per warmup email sent, records inbox/spam placement
CREATE TABLE IF NOT EXISTS public.engage_warmup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES public.engage_mailboxes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  placed_inbox BOOLEAN,   -- NULL = pending, TRUE = inbox, FALSE = spam
  resolved_at TIMESTAMPTZ
);
ALTER TABLE public.engage_warmup_log DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_log_mailbox_id ON public.engage_warmup_log(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_warmup_log_sent_at    ON public.engage_warmup_log(sent_at);
