-- ============================================================
-- Workspace governance: team roles, lifecycle grace, unified audit,
-- webhook delivery queue, warmup pool tenant isolation (PRD §6.8)
-- Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mail_workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  mail_role TEXT NOT NULL DEFAULT 'member'
    CHECK (mail_role IN ('viewer', 'member', 'manager', 'admin')),
  can_launch_campaigns BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);
ALTER TABLE public.mail_workspace_members DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_workspace_members_org
  ON public.mail_workspace_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_workspace_members_email
  ON public.mail_workspace_members(organization_id, lower(email));

CREATE TABLE IF NOT EXISTS public.mail_workspace_lifecycle (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'grace', 'suspended', 'pending_delete')),
  grace_ends_at TIMESTAMPTZ,
  scheduled_purge_at TIMESTAMPTZ,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_workspace_lifecycle DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mail_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_email TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_audit_events DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_audit_events_org_created
  ON public.mail_audit_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_audit_events_entity
  ON public.mail_audit_events(organization_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_mail_audit_events_action
  ON public.mail_audit_events(organization_id, action);

CREATE TABLE IF NOT EXISTS public.mail_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  webhook_id UUID NOT NULL REFERENCES public.mail_webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mail_webhook_deliveries DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_webhook_deliveries_due
  ON public.mail_webhook_deliveries(next_attempt_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_mail_webhook_deliveries_org
  ON public.mail_webhook_deliveries(organization_id, created_at DESC);

ALTER TABLE public.mail_warmup_pool_mailboxes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mail_warmup_pool_mailboxes_org
  ON public.mail_warmup_pool_mailboxes(organization_id)
  WHERE organization_id IS NOT NULL;
