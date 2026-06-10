-- ============================================================================
-- GA4 / website-visitor signals (meeting ask: "who visited our website")
-- ----------------------------------------------------------------------------
-- ga4_connections: per-org GA4 property config. The Service-Account credentials
--   themselves live in the Python service env (GA4_SA_JSON secret on Render) —
--   we only store the property id + display config here, never the private key.
-- website_visitor_signals: visitor activity rows produced by the GA4 ingest
--   worker. When a row can be matched to a known company/lead (by domain) the
--   worker also writes a buying_signals row of type 'website_visit'.
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ga4_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id TEXT NOT NULL,            -- GA4 numeric property id, e.g. "123456789"
    measurement_id TEXT,                  -- "G-XXXXXXX" (display only)
    website_url TEXT,
    sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    lookback_days INTEGER NOT NULL DEFAULT 7,
    status TEXT NOT NULL DEFAULT 'connected',  -- connected | error | disabled
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_ga4_connections_org_id ON public.ga4_connections(organization_id);
ALTER TABLE public.ga4_connections DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.website_visitor_signals (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'ga4',   -- ga4 | reverse_ip | manual
    -- identity (best-effort; aggregate GA4 rows may only have region/source)
    company_name TEXT,
    company_domain TEXT,
    matched_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    matched_lead_id BIGINT REFERENCES public.leads_raw(id) ON DELETE SET NULL,
    -- grouping dimension + label (e.g. dimension='landingPage', label='/pricing')
    dimension TEXT,
    dimension_value TEXT,
    region TEXT,
    country TEXT,
    channel TEXT,                         -- GA4 default channel group
    -- metrics
    sessions INTEGER DEFAULT 0,
    engaged_sessions INTEGER DEFAULT 0,
    page_views INTEGER DEFAULT 0,
    avg_engagement_seconds NUMERIC DEFAULT 0,
    top_pages JSONB DEFAULT '[]'::jsonb,
    visitor_score INTEGER DEFAULT 0,      -- 0-100 heat
    signal_strength TEXT DEFAULT 'low',   -- high | medium | low
    window_start DATE,
    window_end DATE,
    raw JSONB DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One row per (org, source, dimension_value, window_end) — re-sync is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_website_visitor_signals
    ON public.website_visitor_signals(organization_id, source, COALESCE(dimension_value, ''), COALESCE(window_end, DATE '1970-01-01'));
CREATE INDEX IF NOT EXISTS idx_website_visitor_signals_org_id ON public.website_visitor_signals(organization_id);
CREATE INDEX IF NOT EXISTS idx_website_visitor_signals_company ON public.website_visitor_signals(matched_company_id);
CREATE INDEX IF NOT EXISTS idx_website_visitor_signals_lead ON public.website_visitor_signals(matched_lead_id);
CREATE INDEX IF NOT EXISTS idx_website_visitor_signals_strength ON public.website_visitor_signals(signal_strength);
CREATE INDEX IF NOT EXISTS idx_website_visitor_signals_last_seen ON public.website_visitor_signals(last_seen_at DESC);
ALTER TABLE public.website_visitor_signals DISABLE ROW LEVEL SECURITY;
