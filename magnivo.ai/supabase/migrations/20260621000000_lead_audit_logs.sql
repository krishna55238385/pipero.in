-- ============================================================================
-- Lead audit logs — append-only event trail for lead-management actions
-- (status changes, routing, dedupe dismiss, AI enrich, etc.). Written by
-- logLeadEvent() in src/app/actions/lead-management.ts; read by the Lead Logs
-- page. Audit writes must never fail, so lead/user refs are plain UUIDs (no FK).
-- RLS disabled to match project convention. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lead_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID,
    event_type TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    performed_by UUID,
    target_user_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_audit_logs_org ON public.lead_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_audit_logs_lead ON public.lead_audit_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_audit_logs_event_type ON public.lead_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_lead_audit_logs_created_at ON public.lead_audit_logs(created_at DESC);
ALTER TABLE public.lead_audit_logs DISABLE ROW LEVEL SECURITY;
