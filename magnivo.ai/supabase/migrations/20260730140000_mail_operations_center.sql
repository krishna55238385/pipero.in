-- ============================================================
-- Mail operations: API keys, outbound webhooks, webhook delivery logs
-- Additive only. Apply as table owner.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mail_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['mail.read']::text[],
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_api_keys DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_api_keys_org ON public.mail_api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_api_keys_prefix ON public.mail_api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS public.mail_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  events TEXT[] NOT NULL DEFAULT ARRAY['send.completed', 'bounce', 'complaint', 'unsubscribe']::text[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_webhooks DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_webhooks_org ON public.mail_webhooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_webhooks_active ON public.mail_webhooks(organization_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.mail_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  webhook_id UUID NOT NULL REFERENCES public.mail_webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status_code INTEGER,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  request_body JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_body TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_webhook_logs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_webhook_logs_org ON public.mail_webhook_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_webhook_logs_webhook ON public.mail_webhook_logs(webhook_id, created_at DESC);

ALTER TABLE public.mail_org_settings
  ADD COLUMN IF NOT EXISTS business_hours_start INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS business_hours_end INTEGER NOT NULL DEFAULT 17,
  ADD COLUMN IF NOT EXISTS default_timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS rotation_strategy TEXT NOT NULL DEFAULT 'round_robin',
  ADD COLUMN IF NOT EXISTS hourly_send_limit INTEGER NOT NULL DEFAULT 50;
