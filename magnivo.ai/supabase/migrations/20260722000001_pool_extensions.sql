-- ============================================================
-- Mailbox Pool Extensions
-- ============================================================

-- 1. Extend mailbox_pools with strategy and settings columns ---
ALTER TABLE public.mailbox_pools
  ADD COLUMN IF NOT EXISTS sending_strategy TEXT NOT NULL DEFAULT 'standard'
    CHECK (sending_strategy IN ('standard', 'throttled', 'aggressive', 'conservative')),
  ADD COLUMN IF NOT EXISTS rotation_strategy TEXT NOT NULL DEFAULT 'round_robin'
    CHECK (rotation_strategy IN ('round_robin', 'weighted', 'least_used', 'random', 'priority', 'adaptive')),
  ADD COLUMN IF NOT EXISTS max_concurrent_sends INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- 2. Extend pool membership junction with role and weight ---
ALTER TABLE public.mailbox_pool_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'primary'
    CHECK (role IN ('primary', 'backup', 'disabled')),
  ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

-- 3. Create pool rules table ---
CREATE TABLE IF NOT EXISTS public.mailbox_pool_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.mailbox_pools(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  min_health_score INTEGER DEFAULT NULL,
  min_warmup_day INTEGER DEFAULT NULL,
  allowed_providers TEXT[] DEFAULT NULL,
  allowed_domains TEXT[] DEFAULT NULL,
  max_usage_percent INTEGER DEFAULT NULL,
  daily_limit_override INTEGER DEFAULT NULL,
  hourly_limit INTEGER DEFAULT NULL,
  cooldown_minutes INTEGER DEFAULT NULL,
  business_hours_only BOOLEAN NOT NULL DEFAULT FALSE,
  weekend_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pool_id)
);
ALTER TABLE public.mailbox_pool_rules DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pool_rules_pool_id ON public.mailbox_pool_rules(pool_id);

-- 4. Create pool analytics table ---
CREATE TABLE IF NOT EXISTS public.mailbox_pool_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.mailbox_pools(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_delivered INTEGER NOT NULL DEFAULT 0,
  total_bounced INTEGER NOT NULL DEFAULT 0,
  total_complained INTEGER NOT NULL DEFAULT 0,
  avg_health_score NUMERIC(5,2) DEFAULT NULL,
  active_mailboxes INTEGER NOT NULL DEFAULT 0,
  capacity_used_percent NUMERIC(5,2) DEFAULT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pool_id, date)
);
ALTER TABLE public.mailbox_pool_analytics DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pool_analytics_pool_date ON public.mailbox_pool_analytics(pool_id, date DESC);
