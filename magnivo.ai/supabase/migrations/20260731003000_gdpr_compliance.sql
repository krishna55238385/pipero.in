-- ============================================================
-- GDPR Data Subject Request (DSR) & Consent Management (PRD §7.11)
-- Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mail_dsr_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL
    CHECK (request_type IN ('access', 'erasure', 'portability', 'rectification', 'restrict_processing')),
  requester_email TEXT NOT NULL,
  requester_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  details TEXT,
  completed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  data_export_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_dsr_requests DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_dsr_requests_org
  ON public.mail_dsr_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_dsr_requests_status
  ON public.mail_dsr_requests(status);
CREATE INDEX IF NOT EXISTS idx_mail_dsr_requests_email
  ON public.mail_dsr_requests(requester_email);

CREATE TABLE IF NOT EXISTS public.mail_consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  consent_type TEXT NOT NULL
    CHECK (consent_type IN ('marketing', 'outreach', 'tracking')),
  status TEXT NOT NULL
    CHECK (status IN ('granted', 'withdrawn')),
  ip_address TEXT,
  user_agent TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_consent_records DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_consent_records_org
  ON public.mail_consent_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_consent_records_email
  ON public.mail_consent_records(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_mail_consent_records_type
  ON public.mail_consent_records(organization_id, consent_type);
CREATE INDEX IF NOT EXISTS idx_mail_consent_records_lookup
  ON public.mail_consent_records(organization_id, LOWER(email), consent_type, status);

CREATE TABLE IF NOT EXISTS public.mail_compliance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_email TEXT,
  target_email TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_compliance_audit_log DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_compliance_audit_org
  ON public.mail_compliance_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_compliance_audit_type
  ON public.mail_compliance_audit_log(organization_id, event_type);
CREATE INDEX IF NOT EXISTS idx_mail_compliance_audit_created
  ON public.mail_compliance_audit_log(organization_id, created_at DESC);
