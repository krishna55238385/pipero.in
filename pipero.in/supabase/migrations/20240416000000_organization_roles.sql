-- Migration: organization_roles table for Advanced Permissions Engine

CREATE TABLE IF NOT EXISTS public.organization_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT false, -- True for default 'admin' and 'user' roles to prevent deletion
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb, -- Stores the granular toggle states
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

-- Trigger for updated_at
CREATE TRIGGER update_organization_roles_updated_at
    BEFORE UPDATE ON public.organization_roles
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- RLS
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;

-- Admins can manage roles
CREATE POLICY "Admins can manage organization roles" ON public.organization_roles
    FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid()
        AND users.organization_id = organization_roles.organization_id
        AND users.role IN ('admin', 'super_admin')
      )
    );

-- Everyone can read roles to determine access
CREATE POLICY "Users can view roles for their org" ON public.organization_roles
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid()
        AND users.organization_id = organization_roles.organization_id
      )
    );

-- Temporarily bypass RLS for local dev
ALTER TABLE public.organization_roles DISABLE ROW LEVEL SECURITY;
