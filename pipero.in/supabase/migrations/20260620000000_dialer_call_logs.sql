-- ============================================================================
-- Dialer: Call Logs table for recording and analyzing phone calls
-- ============================================================================
-- This table stores call activity: outbound and inbound calls, transcripts,
-- AI-generated summaries, and coaching scorecards.
--
-- Design:
--   * Nullable lead_ref (TEXT): references a leads_raw id (BIGSERIAL, stored as
--     text) or a CRM leads id, or null for unknown/external callers.
--   * organization_id nullable for multi-tenant isolation; org filtering is
--     enforced in the server-action layer (RLS disabled, project convention).
--   * ai_summary JSONB stores the AI-generated summary from summarizeDialerCall().
--   * scorecard JSONB stores call-quality metrics (talk_ratio, clarity, etc.).
--   * recording_url is nullable; populated by external recording integrations.
--   * Indexes on organization_id and created_at for efficient querying.
--   * RLS disabled to match project convention.
--
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_ref TEXT,                  -- leads_raw id (as text) / CRM lead id / external; nullable
    lead_name TEXT,
    company TEXT,
    phone TEXT,
    direction TEXT,                 -- 'outbound' | 'inbound'
    status TEXT,                    -- outcome: 'connected' | 'no_answer' | 'voicemail' | 'failed'
    duration_seconds INTEGER DEFAULT 0,
    transcript TEXT,
    ai_summary JSONB,               -- { overview, key_points[], objections[], next_steps[], sentiment, risk_flags[] }
    scorecard JSONB,                -- { talk_ratio, clarity, empathy, sentiment, risk_flags[], next_step_set }
    recording_url TEXT,
    notes TEXT,
    tags TEXT[],
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    ai_generated_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safety net: backfill columns if an older partial version of the table exists.
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS lead_ref TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS lead_name TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS direction TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS duration_seconds INTEGER DEFAULT 0;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS ai_summary JSONB;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS scorecard JSONB;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_call_logs_org_id ON public.call_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON public.call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_started_at ON public.call_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_ref ON public.call_logs(lead_ref);

ALTER TABLE public.call_logs DISABLE ROW LEVEL SECURITY;
