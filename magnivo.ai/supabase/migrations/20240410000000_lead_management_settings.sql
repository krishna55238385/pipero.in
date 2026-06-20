-- Lead Statuses
CREATE TABLE IF NOT EXISTS public.lead_statuses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    color TEXT DEFAULT '#94a3b8',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pipeline Stages (for Deals)
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    probability INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lead Routing / Assignment Settings
CREATE TABLE IF NOT EXISTS public.lead_routing_settings (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    assignment_mode TEXT CHECK (assignment_mode IN ('manual', 'round_robin', 'rule_based')) DEFAULT 'manual',
    untouched_reassignment_days INTEGER DEFAULT 3,
    fallback_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lead Routing Rules (for Rule-based Assignment)
CREATE TABLE IF NOT EXISTS public.lead_routing_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    assign_to_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lead Hygiene Settings (Deduplication)
CREATE TABLE IF NOT EXISTS public.lead_hygiene_settings (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    duplicate_fields JSONB NOT NULL DEFAULT '["email", "phone_number"]'::jsonb,
    merge_strategy TEXT CHECK (merge_strategy IN ('auto', 'manual')) DEFAULT 'manual',
    notify_admin BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Duplicate Leads Queue (for manual review)
CREATE TABLE IF NOT EXISTS public.lead_duplicates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    original_lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    duplicate_lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    similarity_score NUMERIC(5,2) DEFAULT 100.0,
    status TEXT CHECK (status IN ('pending', 'merged', 'rejected')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Disable Row Level Security temporarily (we are manually bypassing for local testing based on context)
ALTER TABLE public.lead_statuses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_routing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_routing_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_hygiene_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_duplicates DISABLE ROW LEVEL SECURITY;

-- If 'status' does not exist in leads, add it (using lead_statuses.id eventually)
-- Wait, 'status' does not seem to explicitly exist in initial_schema leads table, but 'temperature' does.
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS status_id UUID REFERENCES public.lead_statuses(id) ON DELETE SET NULL;
