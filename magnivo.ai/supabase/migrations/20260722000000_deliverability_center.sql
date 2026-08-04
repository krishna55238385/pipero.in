-- ============================================================
-- DNS Verification & Deliverability Center
-- ============================================================

-- 1. Domains ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_deliverability_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  health_score INTEGER NOT NULL DEFAULT 0 CHECK (health_score >= 0 AND health_score <= 100),
  health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('excellent', 'good', 'fair', 'poor', 'unknown')),
  spf_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (spf_status IN ('unverified', 'valid', 'invalid', 'missing')),
  dkim_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (dkim_status IN ('unverified', 'valid', 'invalid', 'missing')),
  dmarc_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (dmarc_status IN ('unverified', 'valid', 'invalid', 'missing')),
  tracking_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (tracking_status IN ('unverified', 'valid', 'invalid', 'missing')),
  return_path_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (return_path_status IN ('unverified', 'valid', 'invalid', 'missing')),
  dkim_selector TEXT NOT NULL DEFAULT 'default',
  dkim_cname_target TEXT,
  spf_raw TEXT,
  dmarc_raw TEXT,
  dmarc_policy TEXT,
  tracking_domain TEXT,
  tracking_cname_target TEXT,
  return_path_domain TEXT,
  return_path_cname_target TEXT,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  check_interval_hours INTEGER NOT NULL DEFAULT 24,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, domain)
);
ALTER TABLE public.mail_deliverability_domains DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_deliverability_domains_org_id ON public.mail_deliverability_domains(organization_id);
CREATE INDEX IF NOT EXISTS idx_deliverability_domains_next_check ON public.mail_deliverability_domains(next_check_at) WHERE next_check_at IS NOT NULL;

-- 2. DNS Records (cache of verified DNS records) ------------------------------
CREATE TABLE IF NOT EXISTS public.mail_dns_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (record_type IN ('TXT', 'CNAME', 'MX', 'A')),
  record_name TEXT NOT NULL,
  record_value TEXT NOT NULL,
  ttl INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_dns_records DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_dns_records_domain_id ON public.mail_dns_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_dns_records_type ON public.mail_dns_records(record_type);

-- 3. Verification History -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_verification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  previous_status TEXT,
  new_status TEXT,
  action TEXT NOT NULL,
  actor_user_id UUID,
  actor_email TEXT,
  verified_by TEXT NOT NULL DEFAULT 'manual' CHECK (verified_by IN ('manual', 'auto', 'monitoring', 'bulk')),
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'success', 'failure')),
  error_message TEXT,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_verification_history DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_verification_history_domain_id ON public.mail_verification_history(domain_id);
CREATE INDEX IF NOT EXISTS idx_verification_history_org_id ON public.mail_verification_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_verification_history_created_at ON public.mail_verification_history(created_at DESC);

-- 4. Tracking Domains ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_tracking_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  tracking_domain TEXT NOT NULL,
  cname_target TEXT,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified', 'verified', 'failed', 'expired')),
  last_verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, tracking_domain)
);
ALTER TABLE public.mail_tracking_domains DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tracking_domains_org_id ON public.mail_tracking_domains(organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_domains_domain_id ON public.mail_tracking_domains(domain_id);

-- 5. Monitoring Notifications -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_deliverability_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('spf_break', 'dkim_expired', 'dmarc_removed', 'tracking_stopped', 'health_degraded', 'dns_timeout')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'critical')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  previous_value TEXT,
  new_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_deliverability_notifications DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_deliverability_notifications_org_id ON public.mail_deliverability_notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_deliverability_notifications_domain_id ON public.mail_deliverability_notifications(domain_id);
CREATE INDEX IF NOT EXISTS idx_deliverability_notifications_unread ON public.mail_deliverability_notifications(organization_id, is_read) WHERE is_read = FALSE;

-- 6. Bulk Verification Jobs ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_bulk_verification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  actor_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_domains INTEGER NOT NULL DEFAULT 0,
  completed_domains INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_bulk_verification_jobs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bulk_verification_jobs_org_id ON public.mail_bulk_verification_jobs(organization_id);
