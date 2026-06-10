-- Create user_targets table
CREATE TABLE IF NOT EXISTS public.user_targets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    month_year TEXT NOT NULL, -- Format: 'YYYY-MM'
    revenue_target NUMERIC(12, 2) DEFAULT 0,
    leads_target INT DEFAULT 0,
    tasks_target INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(user_id, month_year)
);

-- Enable RLS
ALTER TABLE public.user_targets ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view targets in their organization
CREATE POLICY "Users can view org targets" 
    ON public.user_targets FOR SELECT USING (organization_id = (SELECT organization_id FROM public.users WHERE id = auth.uid()));

-- RLS Policy: Admins can manage targets in their organization
CREATE POLICY "Admins can manage org targets" 
    ON public.user_targets FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Temporarily disable RLS for local dev bypass if needed (matching other V2 tables)
ALTER TABLE public.user_targets DISABLE ROW LEVEL SECURITY;
