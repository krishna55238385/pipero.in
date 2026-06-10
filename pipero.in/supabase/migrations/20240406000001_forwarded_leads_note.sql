-- Add note column to forwarded_leads for optional forwarding context
ALTER TABLE public.forwarded_leads
ADD COLUMN IF NOT EXISTS note TEXT;

-- Add lead_id column to activity_logs if it doesn't exist
ALTER TABLE public.activity_logs
ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE;
