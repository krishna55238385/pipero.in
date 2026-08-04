-- Per-mailbox hourly send cap (PRD §6.1.33)
ALTER TABLE public.engage_mailboxes
  ADD COLUMN IF NOT EXISTS hourly_send_limit INTEGER NOT NULL DEFAULT 20;

ALTER TABLE public.mail_mailboxes
  ADD COLUMN IF NOT EXISTS hourly_send_limit INTEGER NOT NULL DEFAULT 20;

CREATE INDEX IF NOT EXISTS idx_engage_mailboxes_hourly_limit
  ON public.engage_mailboxes(organization_id, hourly_send_limit);
