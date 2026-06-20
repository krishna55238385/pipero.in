-- Phase 2: Deals Pipeline Extended Fields
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS close_date DATE,
  ADD COLUMN IF NOT EXISTS probability INTEGER DEFAULT 50 CHECK (probability >= 0 AND probability <= 100),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE;

-- Index for assigned_to lookups
CREATE INDEX IF NOT EXISTS idx_deals_assigned_to ON public.deals(assigned_to);
