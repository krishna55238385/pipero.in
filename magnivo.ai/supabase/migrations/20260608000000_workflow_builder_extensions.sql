ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS workflow_graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.automation_flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_flow_versions_flow ON public.automation_flow_versions(flow_id, version DESC);

ALTER TABLE public.automation_flow_versions DISABLE ROW LEVEL SECURITY;

