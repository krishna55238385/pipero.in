-- ============================================================
-- Warmup Engine: Complete backend foundation
-- ============================================================

-- 1. Warmup Configurations -------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'running', 'paused', 'completed', 'graduated', 'disabled', 'failed')),
  stage TEXT NOT NULL DEFAULT 'initial'
    CHECK (stage IN ('initial', 'learning', 'growing', 'established', 'graduated')),
  health TEXT NOT NULL DEFAULT 'healthy'
    CHECK (health IN ('excellent', 'healthy', 'warning', 'critical')),

  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL,
  paused_at TIMESTAMPTZ DEFAULT NULL,
  resumed_at TIMESTAMPTZ DEFAULT NULL,
  graduated_at TIMESTAMPTZ DEFAULT NULL,

  current_day INTEGER NOT NULL DEFAULT 0,
  total_days INTEGER NOT NULL DEFAULT 30,

  initial_sends INTEGER NOT NULL DEFAULT 2,
  max_daily_sends INTEGER NOT NULL DEFAULT 40,
  daily_increase INTEGER NOT NULL DEFAULT 2,
  current_daily_target INTEGER NOT NULL DEFAULT 2,

  weekend_sending BOOLEAN NOT NULL DEFAULT TRUE,
  business_hours_start INTEGER NOT NULL DEFAULT 9,
  business_hours_end INTEGER NOT NULL DEFAULT 17,
  timezone TEXT NOT NULL DEFAULT 'UTC',

  min_delay_ms INTEGER NOT NULL DEFAULT 30000,
  max_delay_ms INTEGER NOT NULL DEFAULT 300000,
  randomization_factor NUMERIC(3,2) NOT NULL DEFAULT 0.20,

  reply_simulation BOOLEAN NOT NULL DEFAULT TRUE,
  read_simulation BOOLEAN NOT NULL DEFAULT TRUE,
  spam_rescue BOOLEAN NOT NULL DEFAULT TRUE,
  open_simulation BOOLEAN NOT NULL DEFAULT TRUE,
  click_simulation BOOLEAN NOT NULL DEFAULT FALSE,

  target_health_score INTEGER NOT NULL DEFAULT 80,
  graduation_threshold INTEGER NOT NULL DEFAULT 85,
  pause_threshold INTEGER NOT NULL DEFAULT 30,
  resume_threshold INTEGER NOT NULL DEFAULT 50,

  pause_reason TEXT DEFAULT NULL,
  failure_reason TEXT DEFAULT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, mailbox_id)
);
ALTER TABLE public.mail_warmup_configs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_configs_org_id ON public.mail_warmup_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_warmup_configs_mailbox_id ON public.mail_warmup_configs(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_warmup_configs_status ON public.mail_warmup_configs(status);
CREATE INDEX IF NOT EXISTS idx_warmup_configs_stage ON public.mail_warmup_configs(stage);

-- 2. Warmup Stages -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  stage TEXT NOT NULL
    CHECK (stage IN ('initial', 'learning', 'growing', 'established', 'graduated')),
  day_number INTEGER NOT NULL,
  target_sends INTEGER NOT NULL,
  actual_sends INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  bounce_count INTEGER NOT NULL DEFAULT 0,

  health_score INTEGER CHECK (health_score >= 0 AND health_score <= 100),
  reputation_score NUMERIC(5,2) DEFAULT NULL,

  started_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (config_id, day_number)
);
ALTER TABLE public.mail_warmup_stages DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_stages_config_id ON public.mail_warmup_stages(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_stages_day ON public.mail_warmup_stages(config_id, day_number);

-- 3. Warmup Daily Statistics ------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  date DATE NOT NULL DEFAULT CURRENT_DATE,
  day_number INTEGER NOT NULL,
  target_sends INTEGER NOT NULL,
  actual_sends INTEGER NOT NULL DEFAULT 0,
  successful_sends INTEGER NOT NULL DEFAULT 0,
  failed_sends INTEGER NOT NULL DEFAULT 0,
  bounced_sends INTEGER NOT NULL DEFAULT 0,

  replies_received INTEGER NOT NULL DEFAULT 0,
  opens_tracked INTEGER NOT NULL DEFAULT 0,
  clicks_tracked INTEGER NOT NULL DEFAULT 0,
  spam_reports INTEGER NOT NULL DEFAULT 0,

  health_score INTEGER CHECK (health_score >= 0 AND health_score <= 100),
  reputation_score NUMERIC(5,2) DEFAULT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (config_id, date)
);
ALTER TABLE public.mail_warmup_daily_stats DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_stats_config_date ON public.mail_warmup_daily_stats(config_id, date DESC);

-- 4. Warmup Events ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'created', 'started', 'paused', 'resumed', 'graduated',
      'archived', 'deleted', 'updated', 'stage_changed',
      'health_changed', 'configured', 'error', 'reset'
    )),
  previous_status TEXT DEFAULT NULL,
  new_status TEXT DEFAULT NULL,
  previous_stage TEXT DEFAULT NULL,
  new_stage TEXT DEFAULT NULL,
  previous_health TEXT DEFAULT NULL,
  new_health TEXT DEFAULT NULL,

  message TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_warmup_events DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_events_config_id ON public.mail_warmup_events(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_events_type ON public.mail_warmup_events(event_type);
CREATE INDEX IF NOT EXISTS idx_warmup_events_created ON public.mail_warmup_events(created_at DESC);

-- 5. Warmup History --------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  action TEXT NOT NULL
    CHECK (action IN (
      'created', 'started', 'paused', 'resumed', 'graduated',
      'archived', 'deleted', 'updated', 'configured', 'reset'
    )),
  actor_user_id UUID NOT NULL,
  actor_email TEXT NOT NULL,
  previous_config JSONB DEFAULT NULL,
  new_config JSONB DEFAULT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_warmup_history DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_history_config_id ON public.mail_warmup_history(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_history_created ON public.mail_warmup_history(created_at DESC);

-- 6. Warmup Templates -----------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,

  max_daily_sends INTEGER NOT NULL DEFAULT 40,
  daily_increase INTEGER NOT NULL DEFAULT 2,
  initial_sends INTEGER NOT NULL DEFAULT 2,
  total_days INTEGER NOT NULL DEFAULT 30,
  weekend_sending BOOLEAN NOT NULL DEFAULT TRUE,
  business_hours_start INTEGER NOT NULL DEFAULT 9,
  business_hours_end INTEGER NOT NULL DEFAULT 17,
  timezone TEXT NOT NULL DEFAULT 'UTC',

  min_delay_ms INTEGER NOT NULL DEFAULT 30000,
  max_delay_ms INTEGER NOT NULL DEFAULT 300000,
  randomization_factor NUMERIC(3,2) NOT NULL DEFAULT 0.20,

  reply_simulation BOOLEAN NOT NULL DEFAULT TRUE,
  read_simulation BOOLEAN NOT NULL DEFAULT TRUE,
  spam_rescue BOOLEAN NOT NULL DEFAULT TRUE,
  open_simulation BOOLEAN NOT NULL DEFAULT TRUE,
  click_simulation BOOLEAN NOT NULL DEFAULT FALSE,

  target_health_score INTEGER NOT NULL DEFAULT 80,
  graduation_threshold INTEGER NOT NULL DEFAULT 85,
  pause_threshold INTEGER NOT NULL DEFAULT 30,
  resume_threshold INTEGER NOT NULL DEFAULT 50,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, name)
);
ALTER TABLE public.mail_warmup_templates DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_templates_org_id ON public.mail_warmup_templates(organization_id);

-- 7. Warmup Exceptions ----------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  exception_type TEXT NOT NULL
    CHECK (exception_type IN ('skip_day', 'reduce_volume', 'increase_volume', 'pause', 'custom')),
  day_number INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  volume_modifier NUMERIC(5,2) DEFAULT NULL,
  is_applied BOOLEAN NOT NULL DEFAULT FALSE,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_warmup_exceptions DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_exceptions_config_id ON public.mail_warmup_exceptions(config_id);

-- 8. Warmup Graduation Record ----------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_graduations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,

  final_health_score INTEGER NOT NULL,
  final_reputation_score NUMERIC(5,2) DEFAULT NULL,
  total_days INTEGER NOT NULL,
  total_sends INTEGER NOT NULL DEFAULT 0,
  total_successful INTEGER NOT NULL DEFAULT 0,
  total_bounced INTEGER NOT NULL DEFAULT 0,
  graduation_reason TEXT NOT NULL DEFAULT 'threshold_met',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  graduated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_warmup_graduations DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_graduations_config_id ON public.mail_warmup_graduations(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_graduations_mailbox_id ON public.mail_warmup_graduations(mailbox_id);

-- 9. Warmup Notifications -------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_warmup_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.mail_warmup_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('health_warning', 'health_critical', 'graduation_ready', 'graduated', 'paused', 'resumed', 'error', 'milestone')),
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_warmup_notifications DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warmup_notifications_config_id ON public.mail_warmup_notifications(config_id);
CREATE INDEX IF NOT EXISTS idx_warmup_notifications_unread ON public.mail_warmup_notifications(config_id, is_read) WHERE is_read = FALSE;
