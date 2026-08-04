-- ============================================================
-- Scheduled analytics / export reports (PRD §6.7.32 Export center)
-- Additive only. Apply as table owner.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mail_scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL
    CHECK (report_type IN ('campaigns', 'mailboxes', 'leads', 'analytics_raw', 'placement', 'usage')),
  cadence TEXT NOT NULL
    CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  recipients TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  format TEXT NOT NULL DEFAULT 'csv'
    CHECK (format IN ('csv')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  created_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mail_scheduled_reports DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mail_scheduled_reports_org
  ON public.mail_scheduled_reports(organization_id);

CREATE INDEX IF NOT EXISTS idx_mail_scheduled_reports_due
  ON public.mail_scheduled_reports(next_run_at)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mail_scheduled_reports_type
  ON public.mail_scheduled_reports(organization_id, report_type);
