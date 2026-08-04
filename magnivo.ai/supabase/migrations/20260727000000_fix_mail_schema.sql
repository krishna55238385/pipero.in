-- ============================================================
-- Mail Schema Fix Migration
-- Fixes all missing columns, constraints, indexes, and FKs
-- that cause "relation does not exist" and runtime SQL errors.
-- ============================================================

-- 1. Add missing columns to mail_mailboxes ------------------------------------
-- These columns are used by the repository code but were never added
-- to the original migration (20260721000000_mail_module_core.sql).
ALTER TABLE public.mail_mailboxes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verification_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS last_verification_result TEXT;

-- 2. Update mailbox_status CHECK constraint to include 'archived' and 'deleted' -
-- The original constraint only allowed:
--   'connected', 'disconnected', 'warming', 'error', 'suspended'
-- But the repository code sets 'archived' and 'deleted' values.
ALTER TABLE public.mail_mailboxes
  DROP CONSTRAINT IF EXISTS mail_mailboxes_mailbox_status_check;
ALTER TABLE public.mail_mailboxes
  ADD CONSTRAINT mail_mailboxes_mailbox_status_check
  CHECK (mailbox_status IN ('connected', 'disconnected', 'warming', 'error', 'suspended', 'archived', 'deleted'));

-- 3. Add indexes for new mail_mailboxes columns ------------------------------
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_deleted_at
  ON public.mail_mailboxes(deleted_at)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_archived_at
  ON public.mail_mailboxes(archived_at)
  WHERE archived_at IS NOT NULL;

-- 4. Add UNIQUE constraint for mail_dns_records ON CONFLICT ------------------
-- The repository code uses ON CONFLICT (domain_id, record_type, record_name)
-- but the original migration did not create a unique constraint on those columns.
-- First remove any duplicate rows that would violate the new constraint.
DELETE FROM public.mail_dns_records a
  USING public.mail_dns_records b
  WHERE a.id < b.id
    AND a.domain_id IS NOT NULL
    AND a.record_type IS NOT NULL
    AND a.record_name IS NOT NULL
    AND a.domain_id = b.domain_id
    AND a.record_type = b.record_type
    AND a.record_name = b.record_name;
ALTER TABLE public.mail_dns_records
  DROP CONSTRAINT IF EXISTS mail_dns_records_unique_record;
ALTER TABLE public.mail_dns_records
  ADD CONSTRAINT mail_dns_records_unique_record
  UNIQUE (domain_id, record_type, record_name);

-- 5. Add missing foreign keys for warmup execution engine --------------------
-- The warmup_execution_engine migration (20240722000000) could not add these
-- FK constraints because mail_warmup_configs and mail_mailboxes are created
-- in later migrations (20260721xx+). Add them here now that all tables exist.

-- 5a. warmup_jobs.config_id -> mail_warmup_configs(id)
ALTER TABLE public.warmup_jobs
  DROP CONSTRAINT IF EXISTS warmup_jobs_config_id_fkey;
ALTER TABLE public.warmup_jobs
  ADD CONSTRAINT warmup_jobs_config_id_fkey
  FOREIGN KEY (config_id) REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE;

-- 5b. warmup_jobs.mailbox_id -> mail_mailboxes(id)
ALTER TABLE public.warmup_jobs
  DROP CONSTRAINT IF EXISTS warmup_jobs_mailbox_id_fkey;
ALTER TABLE public.warmup_jobs
  ADD CONSTRAINT warmup_jobs_mailbox_id_fkey
  FOREIGN KEY (mailbox_id) REFERENCES public.mail_mailboxes(id);

-- 5c. warmup_executions.config_id -> mail_warmup_configs(id)
ALTER TABLE public.warmup_executions
  DROP CONSTRAINT IF EXISTS warmup_executions_config_id_fkey;
ALTER TABLE public.warmup_executions
  ADD CONSTRAINT warmup_executions_config_id_fkey
  FOREIGN KEY (config_id) REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE;

-- 6. Verify all indexes exist for the mail module ----------------------------

-- mail_mailboxes indexes (ensure all present)
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_org_id ON public.mail_mailboxes(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_pool_id ON public.mail_mailboxes(pool_id);
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_email ON public.mail_mailboxes(email);
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_status ON public.mail_mailboxes(mailbox_status);
-- Note: unique constraint on (organization_id, email) is already in the original migration

-- mailbox_pools indexes
CREATE INDEX IF NOT EXISTS idx_mailbox_pools_org_id ON public.mailbox_pools(organization_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_pools_status ON public.mailbox_pools(status);

-- mailbox_pool_members indexes
CREATE INDEX IF NOT EXISTS idx_pool_members_mailbox_id ON public.mailbox_pool_members(mailbox_id);

-- mailbox_oauth_configs indexes
CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_mailbox_id ON public.mailbox_oauth_configs(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_org_id ON public.mailbox_oauth_configs(organization_id);

-- mailbox_smtp_configs indexes
CREATE INDEX IF NOT EXISTS idx_mailbox_smtp_mailbox_id ON public.mailbox_smtp_configs(mailbox_id);

-- mailbox_imap_configs indexes
CREATE INDEX IF NOT EXISTS idx_mailbox_imap_mailbox_id ON public.mailbox_imap_configs(mailbox_id);

-- mail_deliverability_domains indexes
CREATE INDEX IF NOT EXISTS idx_deliverability_domains_org_id ON public.mail_deliverability_domains(organization_id);
CREATE INDEX IF NOT EXISTS idx_deliverability_domains_next_check ON public.mail_deliverability_domains(next_check_at) WHERE next_check_at IS NOT NULL;

-- mail_dns_records indexes
CREATE INDEX IF NOT EXISTS idx_dns_records_domain_id ON public.mail_dns_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_dns_records_type ON public.mail_dns_records(record_type);

-- mail_verification_history indexes
CREATE INDEX IF NOT EXISTS idx_verification_history_domain_id ON public.mail_verification_history(domain_id);
CREATE INDEX IF NOT EXISTS idx_verification_history_org_id ON public.mail_verification_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_verification_history_created_at ON public.mail_verification_history(created_at DESC);

-- mail_tracking_domains indexes
CREATE INDEX IF NOT EXISTS idx_tracking_domains_org_id ON public.mail_tracking_domains(organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_domains_domain_id ON public.mail_tracking_domains(domain_id);

-- mail_deliverability_notifications indexes
CREATE INDEX IF NOT EXISTS idx_deliverability_notifications_org_id ON public.mail_deliverability_notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_deliverability_notifications_domain_id ON public.mail_deliverability_notifications(domain_id);
CREATE INDEX IF NOT EXISTS idx_deliverability_notifications_unread ON public.mail_deliverability_notifications(organization_id, is_read) WHERE is_read = FALSE;

-- mail_bulk_verification_jobs indexes
CREATE INDEX IF NOT EXISTS idx_bulk_verification_jobs_org_id ON public.mail_bulk_verification_jobs(organization_id);

-- mailbox_pool_rules indexes
CREATE INDEX IF NOT EXISTS idx_pool_rules_pool_id ON public.mailbox_pool_rules(pool_id);

-- mailbox_pool_analytics indexes
CREATE INDEX IF NOT EXISTS idx_pool_analytics_pool_date ON public.mailbox_pool_analytics(pool_id, date DESC);

-- mail_warmup_configs indexes
CREATE INDEX IF NOT EXISTS idx_warmup_configs_org_id ON public.mail_warmup_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_warmup_configs_mailbox_id ON public.mail_warmup_configs(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_warmup_configs_status ON public.mail_warmup_configs(status);
CREATE INDEX IF NOT EXISTS idx_warmup_configs_stage ON public.mail_warmup_configs(stage);

-- mail_warmup_stages indexes
CREATE INDEX IF NOT EXISTS idx_warmup_stages_config_id ON public.mail_warmup_stages(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_stages_day ON public.mail_warmup_stages(config_id, day_number);

-- mail_warmup_daily_stats indexes
CREATE INDEX IF NOT EXISTS idx_warmup_stats_config_date ON public.mail_warmup_daily_stats(config_id, date DESC);

-- mail_warmup_events indexes
CREATE INDEX IF NOT EXISTS idx_warmup_events_config_id ON public.mail_warmup_events(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_events_type ON public.mail_warmup_events(event_type);
CREATE INDEX IF NOT EXISTS idx_warmup_events_created ON public.mail_warmup_events(created_at DESC);

-- mail_warmup_history indexes
CREATE INDEX IF NOT EXISTS idx_warmup_history_config_id ON public.mail_warmup_history(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_history_created ON public.mail_warmup_history(created_at DESC);

-- mail_warmup_templates indexes
CREATE INDEX IF NOT EXISTS idx_warmup_templates_org_id ON public.mail_warmup_templates(organization_id);

-- mail_warmup_exceptions indexes
CREATE INDEX IF NOT EXISTS idx_warmup_exceptions_config_id ON public.mail_warmup_exceptions(config_id);

-- mail_warmup_graduations indexes
CREATE INDEX IF NOT EXISTS idx_warmup_graduations_config_id ON public.mail_warmup_graduations(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_graduations_mailbox_id ON public.mail_warmup_graduations(mailbox_id);

-- mail_warmup_notifications indexes
CREATE INDEX IF NOT EXISTS idx_warmup_notifications_config_id ON public.mail_warmup_notifications(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_notifications_unread ON public.mail_warmup_notifications(config_id, is_read) WHERE is_read = FALSE;

-- mail_return_paths indexes
CREATE INDEX IF NOT EXISTS idx_return_paths_org_id ON public.mail_return_paths(organization_id);
CREATE INDEX IF NOT EXISTS idx_return_paths_domain_id ON public.mail_return_paths(domain_id);

-- mail_return_path_audit indexes
CREATE INDEX IF NOT EXISTS idx_return_path_audit_return_path_id ON public.mail_return_path_audit(return_path_id);

-- mail_dkim_selectors indexes
CREATE INDEX IF NOT EXISTS idx_dkim_selectors_org_id ON public.mail_dkim_selectors(organization_id);
CREATE INDEX IF NOT EXISTS idx_dkim_selectors_domain_id ON public.mail_dkim_selectors(domain_id);

-- mail_dkim_selector_history indexes
CREATE INDEX IF NOT EXISTS idx_dkim_history_selector_id ON public.mail_dkim_selector_history(selector_id);

-- mail_blacklist_checks indexes
CREATE INDEX IF NOT EXISTS idx_blacklist_checks_org_id ON public.mail_blacklist_checks(organization_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_checks_domain_id ON public.mail_blacklist_checks(domain_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_checks_name ON public.mail_blacklist_checks(blacklist_name);

-- mail_domain_reputation indexes
CREATE INDEX IF NOT EXISTS idx_domain_reputation_org_id ON public.mail_domain_reputation(organization_id);
CREATE INDEX IF NOT EXISTS idx_domain_reputation_domain_id ON public.mail_domain_reputation(domain_id);
CREATE INDEX IF NOT EXISTS idx_domain_reputation_recorded_at ON public.mail_domain_reputation(recorded_at DESC);

-- mail_mailbox_reputation indexes
CREATE INDEX IF NOT EXISTS idx_mailbox_reputation_org_id ON public.mail_mailbox_reputation(organization_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_reputation_mailbox_id ON public.mail_mailbox_reputation(mailbox_id);

-- mail_complaint_records indexes
CREATE INDEX IF NOT EXISTS idx_complaint_records_org_id ON public.mail_complaint_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_complaint_records_domain_id ON public.mail_complaint_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_complaint_records_status ON public.mail_complaint_records(status);

-- mail_bounce_records indexes
CREATE INDEX IF NOT EXISTS idx_bounce_records_org_id ON public.mail_bounce_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_bounce_records_domain_id ON public.mail_bounce_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_bounce_records_recipient ON public.mail_bounce_records(recipient_email);
CREATE INDEX IF NOT EXISTS idx_bounce_records_type ON public.mail_bounce_records(bounce_type);
CREATE INDEX IF NOT EXISTS idx_bounce_records_suppressed ON public.mail_bounce_records(suppressed) WHERE suppressed = TRUE;

-- mail_postmaster_domains indexes
CREATE INDEX IF NOT EXISTS idx_postmaster_domains_org_id ON public.mail_postmaster_domains(organization_id);

-- mail_postmaster_metrics indexes
CREATE INDEX IF NOT EXISTS idx_postmaster_metrics_org_id ON public.mail_postmaster_metrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_postmaster_metrics_date ON public.mail_postmaster_metrics(date DESC);

-- mail_snds_domains indexes
CREATE INDEX IF NOT EXISTS idx_snds_domains_org_id ON public.mail_snds_domains(organization_id);

-- mail_snds_metrics indexes
CREATE INDEX IF NOT EXISTS idx_snds_metrics_org_id ON public.mail_snds_metrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_snds_metrics_date ON public.mail_snds_metrics(date DESC);

-- mail_tracking_tokens indexes
CREATE INDEX IF NOT EXISTS idx_tracking_tokens_org_id ON public.mail_tracking_tokens(organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_tokens_token ON public.mail_tracking_tokens(token);
CREATE INDEX IF NOT EXISTS idx_tracking_tokens_campaign_id ON public.mail_tracking_tokens(campaign_id);

-- mail_tracking_pixel_events indexes
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_org_id ON public.mail_tracking_pixel_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_token_id ON public.mail_tracking_pixel_events(tracking_token_id);
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_campaign_id ON public.mail_tracking_pixel_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracking_pixel_events_created_at ON public.mail_tracking_pixel_events(created_at DESC);

-- mail_click_events indexes
CREATE INDEX IF NOT EXISTS idx_click_events_org_id ON public.mail_click_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_click_events_token_id ON public.mail_click_events(tracking_token_id);
CREATE INDEX IF NOT EXISTS idx_click_events_campaign_id ON public.mail_click_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_click_events_created_at ON public.mail_click_events(created_at DESC);

-- mail_monitoring_jobs indexes
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_org_id ON public.mail_monitoring_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_status ON public.mail_monitoring_jobs(status);
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_next_retry ON public.mail_monitoring_jobs(next_retry_at) WHERE next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_type ON public.mail_monitoring_jobs(job_type);

-- mail_monitoring_config indexes
CREATE INDEX IF NOT EXISTS idx_monitoring_config_org_id ON public.mail_monitoring_config(organization_id);

-- mail_email_suppressions indexes
CREATE INDEX IF NOT EXISTS idx_suppressions_org_id ON public.mail_email_suppressions(organization_id);
CREATE INDEX IF NOT EXISTS idx_suppressions_email ON public.mail_email_suppressions(email);

-- mailbox_audit_log indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON public.mailbox_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_mailbox_id ON public.mailbox_audit_log(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.mailbox_audit_log(created_at DESC);
