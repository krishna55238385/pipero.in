-- ============================================================
-- Mail lead lists + membership (PRD §6.5 / §13.D enrollment)
-- Additive only. Apply as table owner.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mail_lead_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  member_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE public.mail_lead_lists DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_lead_lists_org ON public.mail_lead_lists(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_lead_lists_name ON public.mail_lead_lists(organization_id, lower(name));

CREATE TABLE IF NOT EXISTS public.mail_lead_list_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES public.mail_lead_lists(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.mail_leads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (list_id, lead_id)
);
ALTER TABLE public.mail_lead_list_members DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_lead_list_members_list ON public.mail_lead_list_members(list_id);
CREATE INDEX IF NOT EXISTS idx_mail_lead_list_members_lead ON public.mail_lead_list_members(lead_id);
CREATE INDEX IF NOT EXISTS idx_mail_lead_list_members_org ON public.mail_lead_list_members(organization_id);

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS lead_list_id UUID REFERENCES public.mail_lead_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_lead_list
  ON public.campaigns(lead_list_id)
  WHERE lead_list_id IS NOT NULL;
