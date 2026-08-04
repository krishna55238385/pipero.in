-- Tracking filtered/blocked events log (PRD §6.7.31)
CREATE TABLE IF NOT EXISTS public.mail_tracking_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tracking_token_id UUID NOT NULL REFERENCES public.mail_tracking_tokens(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('open', 'click')),
  reason TEXT NOT NULL,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mail_tracking_log DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tracking_log_org_id ON public.mail_tracking_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_log_token_id ON public.mail_tracking_log(tracking_token_id);
CREATE INDEX IF NOT EXISTS idx_tracking_log_event_type ON public.mail_tracking_log(event_type);
CREATE INDEX IF NOT EXISTS idx_tracking_log_reason ON public.mail_tracking_log(reason);
CREATE INDEX IF NOT EXISTS idx_tracking_log_created_at ON public.mail_tracking_log(created_at DESC);
