-- ============================================================
-- Deliverability Infrastructure Expansion
-- ============================================================

-- 1. Return Paths ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_return_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  return_path_domain TEXT NOT NULL,
  cname_target TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'failed', 'expired', 'rotating')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, return_path_domain)
);
ALTER TABLE public.mail_return_paths DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_return_paths_org_id ON public.mail_return_paths(organization_id);
CREATE INDEX IF NOT EXISTS idx_return_paths_domain_id ON public.mail_return_paths(domain_id);

-- 2. Return Path Audit History --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_return_path_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_path_id UUID NOT NULL REFERENCES public.mail_return_paths(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id UUID,
  actor_email TEXT,
  previous_value TEXT,
  new_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_return_path_audit DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_return_path_audit_return_path_id ON public.mail_return_path_audit(return_path_id);

-- 3. DKIM Selectors -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_dkim_selectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  selector TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('active', 'inactive', 'pending', 'expired', 'failed')),
  public_key TEXT,
  key_length INTEGER,
  last_verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, domain_id, selector)
);
ALTER TABLE public.mail_dkim_selectors DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_dkim_selectors_org_id ON public.mail_dkim_selectors(organization_id);
CREATE INDEX IF NOT EXISTS idx_dkim_selectors_domain_id ON public.mail_dkim_selectors(domain_id);

-- 4. DKIM Selector History ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_dkim_selector_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selector_id UUID NOT NULL REFERENCES public.mail_dkim_selectors(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  previous_selector TEXT,
  new_selector TEXT,
  key_length INTEGER,
  verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_dkim_selector_history DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_dkim_history_selector_id ON public.mail_dkim_selector_history(selector_id);

-- 5. Blacklist Checks -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_blacklist_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  blacklist_name TEXT NOT NULL
    CHECK (blacklist_name IN ('spamhaus', 'barracuda', 'uceprotect', 'spamcop', 'surbl', 'multirbl')),
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('clean', 'listed', 'unknown', 'timeout')),
  ip INET,
  listed_at TIMESTAMPTZ,
  delisted_at TIMESTAMPTZ,
  check_result TEXT,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_blacklist_checks DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_blacklist_checks_org_id ON public.mail_blacklist_checks(organization_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_checks_domain_id ON public.mail_blacklist_checks(domain_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_checks_name ON public.mail_blacklist_checks(blacklist_name);

-- 6. Domain Reputation ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_domain_reputation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'internal'
    CHECK (source IN ('google_postmaster', 'microsoft_snds', 'internal', 'manual')),
  reputation_score INTEGER NOT NULL DEFAULT 50 CHECK (reputation_score >= 0 AND reputation_score <= 100),
  reputation_level TEXT NOT NULL DEFAULT 'unknown'
    CHECK (reputation_level IN ('excellent', 'good', 'fair', 'poor', 'unknown')),
  sending_volume INTEGER,
  bounce_rate NUMERIC(5,4),
  complaint_rate NUMERIC(5,4),
  open_rate NUMERIC(5,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_domain_reputation DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_domain_reputation_org_id ON public.mail_domain_reputation(organization_id);
CREATE INDEX IF NOT EXISTS idx_domain_reputation_domain_id ON public.mail_domain_reputation(domain_id);
CREATE INDEX IF NOT EXISTS idx_domain_reputation_recorded_at ON public.mail_domain_reputation(recorded_at DESC);

-- 7. Mailbox Reputation ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_mailbox_reputation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'internal'
    CHECK (source IN ('google_postmaster', 'microsoft_snds', 'internal', 'manual')),
  reputation_score INTEGER NOT NULL DEFAULT 50 CHECK (reputation_score >= 0 AND reputation_score <= 100),
  reputation_level TEXT NOT NULL DEFAULT 'unknown'
    CHECK (reputation_level IN ('excellent', 'good', 'fair', 'poor', 'unknown')),
  sending_volume INTEGER,
  bounce_rate NUMERIC(5,4),
  complaint_rate NUMERIC(5,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_mailbox_reputation DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mailbox_reputation_org_id ON public.mail_mailbox_reputation(organization_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_reputation_mailbox_id ON public.mail_mailbox_reputation(mailbox_id);

-- 8. Complaint Records ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_complaint_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  mailbox_id UUID REFERENCES public.mail_mailboxes(id) ON DELETE SET NULL,
  campaign_id UUID,
  complaint_type TEXT NOT NULL DEFAULT 'spam',
  source TEXT NOT NULL DEFAULT 'postmaster',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'investigating', 'resolved', 'dismissed')),
  auto_paused_mailbox BOOLEAN NOT NULL DEFAULT FALSE,
  notified_workspace BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_complaint_records DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_complaint_records_org_id ON public.mail_complaint_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_complaint_records_domain_id ON public.mail_complaint_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_complaint_records_status ON public.mail_complaint_records(status);

-- 9. Bounce Records -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_bounce_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES public.mail_deliverability_domains(id) ON DELETE CASCADE,
  mailbox_id UUID REFERENCES public.mail_mailboxes(id) ON DELETE SET NULL,
  campaign_id UUID,
  recipient_email TEXT NOT NULL,
  bounce_type TEXT NOT NULL
    CHECK (bounce_type IN ('hard', 'soft', 'unknown')),
  bounce_category TEXT NOT NULL DEFAULT 'other'
    CHECK (bounce_category IN ('invalid_email', 'mailbox_full', 'domain_not_found', 'rejected', 'timeout', 'content_rejected', 'too_many_recipients', 'network_error', 'other')),
  smtp_code TEXT,
  diagnostic_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_bounce_records DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bounce_records_org_id ON public.mail_bounce_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_bounce_records_domain_id ON public.mail_bounce_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_bounce_records_recipient ON public.mail_bounce_records(recipient_email);
CREATE INDEX IF NOT EXISTS idx_bounce_records_type ON public.mail_bounce_records(bounce_type);
CREATE INDEX IF NOT EXISTS idx_bounce_records_suppressed ON public.mail_bounce_records(suppressed) WHERE suppressed = TRUE;

-- 10. Google Postmaster Domains -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_postmaster_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID REFERENCES public.mail_deliverability_domains(id) ON DELETE SET NULL,
  postmaster_domain TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('disconnected', 'connected', 'error', 'pending_verification')),
  domain_verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (domain_verification_status IN ('pending', 'verified', 'failed')),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, postmaster_domain)
);
ALTER TABLE public.mail_postmaster_domains DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_postmaster_domains_org_id ON public.mail_postmaster_domains(organization_id);

-- 11. Postmaster Metrics --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_postmaster_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postmaster_domain_id UUID NOT NULL REFERENCES public.mail_postmaster_domains(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  spam_complaint_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  ip_reputation TEXT,
  domain_reputation TEXT,
  authentication_success NUMERIC(5,4) NOT NULL DEFAULT 0,
  dkim_success_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  spf_success_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  dmarc_success_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  user_reported_spam INTEGER NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (postmaster_domain_id, date)
);
ALTER TABLE public.mail_postmaster_metrics DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_postmaster_metrics_org_id ON public.mail_postmaster_metrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_postmaster_metrics_date ON public.mail_postmaster_metrics(date DESC);

-- 12. Microsoft SNDS Domains ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_snds_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id UUID REFERENCES public.mail_deliverability_domains(id) ON DELETE SET NULL,
  snds_domain TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('disconnected', 'connected', 'error')),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, snds_domain)
);
ALTER TABLE public.mail_snds_domains DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_snds_domains_org_id ON public.mail_snds_domains(organization_id);

-- 13. SNDS Metrics --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_snds_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snds_domain_id UUID NOT NULL REFERENCES public.mail_snds_domains(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  spam_complaint_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  trap_hits INTEGER NOT NULL DEFAULT 0,
  ip_reputation TEXT,
  malware_count INTEGER NOT NULL DEFAULT 0,
  network_spam_count INTEGER NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snds_domain_id, date)
);
ALTER TABLE public.mail_snds_metrics DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_snds_metrics_org_id ON public.mail_snds_metrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_snds_metrics_date ON public.mail_snds_metrics(date DESC);

-- 14. Tracking Tokens -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_tracking_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id UUID,
  mailbox_id UUID REFERENCES public.mail_mailboxes(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  token_type TEXT NOT NULL CHECK (token_type IN ('open', 'click')),
  recipient_email TEXT,
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_tracking_tokens DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tracking_tokens_org_id ON public.mail_tracking_tokens(organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_tokens_token ON public.mail_tracking_tokens(token);
CREATE INDEX IF NOT EXISTS idx_tracking_tokens_campaign_id ON public.mail_tracking_tokens(campaign_id);

-- 15. Tracking Pixel Events -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_tracking_pixel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tracking_token_id UUID NOT NULL REFERENCES public.mail_tracking_tokens(id) ON DELETE CASCADE,
  campaign_id UUID,
  mailbox_id UUID REFERENCES public.mail_mailboxes(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  user_agent TEXT,
  ip_address INET,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_tracking_pixel_events DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_org_id ON public.mail_tracking_pixel_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_token_id ON public.mail_tracking_pixel_events(tracking_token_id);
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_campaign_id ON public.mail_tracking_pixel_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_created_at ON public.mail_tracking_pixel_events(created_at DESC);

-- 16. Click Events --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_click_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tracking_token_id UUID NOT NULL REFERENCES public.mail_tracking_tokens(id) ON DELETE CASCADE,
  campaign_id UUID,
  mailbox_id UUID REFERENCES public.mail_mailboxes(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  original_url TEXT NOT NULL,
  redirect_url TEXT,
  user_agent TEXT,
  ip_address INET,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_click_events DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_click_events_org_id ON public.mail_click_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_click_events_token_id ON public.mail_click_events(tracking_token_id);
CREATE INDEX IF NOT EXISTS idx_click_events_campaign_id ON public.mail_click_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_click_events_created_at ON public.mail_click_events(created_at DESC);

-- 17. Monitoring Jobs -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_monitoring_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL
    CHECK (job_type IN ('dns_verification', 'blacklist_check', 'reputation_check', 'postmaster_sync', 'snds_sync', 'cleanup')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  domain_id UUID REFERENCES public.mail_deliverability_domains(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_monitoring_jobs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_org_id ON public.mail_monitoring_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_status ON public.mail_monitoring_jobs(status);
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_next_retry ON public.mail_monitoring_jobs(next_retry_at) WHERE next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_type ON public.mail_monitoring_jobs(job_type);

-- 18. Monitoring Config ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_monitoring_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dns_verification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  blacklist_check_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reputation_monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  postmaster_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  snds_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dns_check_interval_hours INTEGER NOT NULL DEFAULT 24,
  blacklist_check_interval_hours INTEGER NOT NULL DEFAULT 12,
  reputation_check_interval_hours INTEGER NOT NULL DEFAULT 6,
  postmaster_sync_interval_hours INTEGER NOT NULL DEFAULT 24,
  snds_sync_interval_hours INTEGER NOT NULL DEFAULT 24,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);
ALTER TABLE public.mail_monitoring_config DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_monitoring_config_org_id ON public.mail_monitoring_config(organization_id);

-- 19. Email Suppressions --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'hard_bounce'
    CHECK (reason IN ('hard_bounce', 'complaint', 'unsubscribe', 'manual')),
  source TEXT,
  bounce_record_id UUID REFERENCES public.mail_bounce_records(id) ON DELETE SET NULL,
  complaint_record_id UUID REFERENCES public.mail_complaint_records(id) ON DELETE SET NULL,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, email)
);
ALTER TABLE public.mail_email_suppressions DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_suppressions_org_id ON public.mail_email_suppressions(organization_id);
CREATE INDEX IF NOT EXISTS idx_suppressions_email ON public.mail_email_suppressions(email);
