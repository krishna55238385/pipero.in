-- ============================================================
-- Mailbox Audit Log
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mailbox_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN (
      'enabled', 'disabled', 'archived', 'restored', 'soft_deleted',
      'verified', 'verification_failed', 'reconnect_attempted',
      'reconnect_succeeded', 'reconnect_failed', 'bulk_action',
      'created', 'updated'
    )),
  previous_status TEXT,
  new_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mailbox_audit_log DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON public.mailbox_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_mailbox_id ON public.mailbox_audit_log(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.mailbox_audit_log(created_at DESC);
