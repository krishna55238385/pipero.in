-- ============================================================
-- DBA pack: apply as table OWNER / superuser
-- App role (magnivo_app) cannot ALTER engage_mailboxes.
-- Safe to re-run (IF NOT EXISTS / additive only).
-- ============================================================

-- Engage encrypted token columns (Phase 0)
ALTER TABLE public.engage_mailboxes
  ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS tokens_encrypted_at TIMESTAMPTZ;

-- Allow Zoho OAuth on Engage accounts
ALTER TABLE public.engage_mailboxes
  DROP CONSTRAINT IF EXISTS engage_mailboxes_provider_check;

ALTER TABLE public.engage_mailboxes
  ADD CONSTRAINT engage_mailboxes_provider_check
  CHECK (provider = ANY (ARRAY['gmail'::text, 'smtp'::text, 'microsoft'::text, 'zoho'::text]));

-- Then apply full migrations in order (as owner):
--   20260721000000_mail_module_core.sql
--   20260727000000_fix_mail_schema.sql
--   20260729000000_mail_phase0_foundation.sql
--   20260729010000_mail_leads_inbox_queue.sql
--   20260730160000_engage_mailbox_zoho_provider.sql
