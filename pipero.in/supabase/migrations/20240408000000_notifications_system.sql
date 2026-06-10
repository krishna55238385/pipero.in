-- Drop existing basic notifications table to recreate with enterprise schema
DROP TABLE IF EXISTS public.notifications CASCADE;

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, -- the recipient
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, -- who caused it
    type TEXT NOT NULL, -- 'mentions', 'assigned_lead', 'deal_won', 'task_reminder', 'system_alert'
    title TEXT NOT NULL,
    content TEXT,
    link_url TEXT,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indices for rapid querying
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON public.notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id) WHERE read_at IS NULL;

-- Disable RLS for MVP
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;

-- Enable Realtime for notifications
alter publication supabase_realtime add table notifications;
