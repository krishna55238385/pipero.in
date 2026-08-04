-- ============================================================
-- Dead-Letter Queue — send jobs that exhausted retry attempts
-- Additive only. Apply as table owner.
-- ============================================================

-- 1. Add 'dead_letter' to mail_send_jobs status CHECK constraint
ALTER TABLE public.mail_send_jobs
  DROP CONSTRAINT IF EXISTS mail_send_jobs_status_check;
ALTER TABLE public.mail_send_jobs
  ADD CONSTRAINT mail_send_jobs_status_check
  CHECK (status IN (
    'pending', 'processing', 'sent', 'failed', 'cancelled', 'deferred', 'dead_letter'
  ));

-- 2. Add DLQ-related actions to mailbox_audit_log CHECK constraint
ALTER TABLE public.mailbox_audit_log
  DROP CONSTRAINT IF EXISTS mailbox_audit_log_action_check;
ALTER TABLE public.mailbox_audit_log
  ADD CONSTRAINT mailbox_audit_log_action_check
  CHECK (action IN (
    'enabled', 'disabled', 'archived', 'restored', 'soft_deleted',
    'verified', 'verification_failed', 'reconnect_attempted',
    'reconnect_succeeded', 'reconnect_failed', 'bulk_action',
    'created', 'updated',
    'dead_letter_move', 'dead_letter_replay', 'dead_letter_purge'
  ));

-- 3. Dead-letter queue table
CREATE TABLE IF NOT EXISTS public.mail_send_jobs_dlq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  original_job_id UUID NOT NULL,
  mailbox_id UUID,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  moved_to_dlq_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  replayed_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_send_jobs_dlq DISABLE ROW LEVEL SECURITY;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_dlq_org
  ON public.mail_send_jobs_dlq(organization_id, moved_to_dlq_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_dlq_org_unreplayed
  ON public.mail_send_jobs_dlq(organization_id)
  WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_dlq_original_job
  ON public.mail_send_jobs_dlq(original_job_id);
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_dlq_moved_at
  ON public.mail_send_jobs_dlq(moved_to_dlq_at)
  WHERE replayed_at IS NULL;
