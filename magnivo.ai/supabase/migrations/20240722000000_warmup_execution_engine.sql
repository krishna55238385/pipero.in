-- ============================================================
-- Warmup Execution Engine Tables
-- NOTE: FK references to mail_warmup_configs and mail_mailboxes
-- are added in 20260727000000_fix_mail_schema.sql because those
-- tables are created in later migrations (20260721xx+).
-- ============================================================

-- Scheduler state (singleton per org, but we use a shared singleton)
CREATE TABLE IF NOT EXISTS public.warmup_scheduler_state (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('stopped', 'running', 'paused')),
  last_heartbeat TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_run_duration_ms INTEGER,
  configs_processed INTEGER DEFAULT 0,
  jobs_created INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.warmup_scheduler_state (id, status) VALUES ('singleton', 'stopped')
ON CONFLICT (id) DO NOTHING;

-- Warmup jobs
-- FK constraints for config_id and mailbox_id are added separately
-- in the fix migration to avoid ordering issues.
CREATE TABLE IF NOT EXISTS public.warmup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'retrying', 'cancelled', 'skipped')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  error_category TEXT,
  target_sends INTEGER NOT NULL DEFAULT 0,
  completed_sends INTEGER DEFAULT 0,
  failed_sends INTEGER DEFAULT 0,
  mailbox_id UUID NOT NULL,
  pool_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warmup_jobs_org_status ON public.warmup_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_warmup_jobs_config ON public.warmup_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_jobs_scheduled ON public.warmup_jobs(scheduled_at) WHERE status IN ('pending', 'queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_warmup_jobs_mailbox ON public.warmup_jobs(mailbox_id);

-- Warmup executions
-- FK constraint for config_id is added separately in the fix migration.
CREATE TABLE IF NOT EXISTS public.warmup_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.warmup_jobs(id) ON DELETE CASCADE,
  config_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'failed', 'skipped')),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  smtp_message_id TEXT,
  duration_ms INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warmup_executions_job ON public.warmup_executions(job_id);
CREATE INDEX IF NOT EXISTS idx_warmup_executions_config ON public.warmup_executions(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_executions_org_date ON public.warmup_executions(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_warmup_executions_status ON public.warmup_executions(status) WHERE status IN ('pending', 'sent', 'failed');

-- Warmup audit log
CREATE TABLE IF NOT EXISTS public.warmup_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email TEXT,
  config_id UUID,
  job_id UUID,
  execution_id UUID,
  previous_status TEXT,
  new_status TEXT,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warmup_audit_org ON public.warmup_audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warmup_audit_config ON public.warmup_audit_log(config_id);
