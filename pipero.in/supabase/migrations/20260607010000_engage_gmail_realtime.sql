ALTER TABLE public.engage_mailboxes
  ADD COLUMN IF NOT EXISTS gmail_history_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_watch_expiration TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.engage_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES public.engage_mailboxes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  from_email TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  date_header TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ,
  unread BOOLEAN NOT NULL DEFAULT false,
  starred BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_engage_emails_mailbox ON public.engage_emails(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_engage_emails_org ON public.engage_emails(organization_id);
CREATE INDEX IF NOT EXISTS idx_engage_emails_received ON public.engage_emails(received_at DESC);

ALTER TABLE public.engage_emails DISABLE ROW LEVEL SECURITY;

