-- ============================================================================
-- GTM <-> CRM bridge
-- ----------------------------------------------------------------------------
--  * Bridge columns that link the CRM's UUID entities back to their AI origin.
--  * phase_runs: job-status table the trigger service writes and the UI polls.
--  * gtm_promote_lead(): fans a denormalized leads_raw row out into the CRM's
--    normalized companies + contacts + leads (idempotent, keyed by leads_raw_id).
--  * Auto-promote trigger for hot leads (per user decision).
-- Idempotent — safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Bridge columns on existing CRM tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS leads_raw_id BIGINT REFERENCES public.leads_raw(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bounce_status TEXT,
    -- lead_score is referenced by the app (create-lead-record.ts) and by
    -- gtm_promote_lead() but no base migration created it — add it here.
    -- health_score/tags are likewise referenced by some CRM views.
    ADD COLUMN IF NOT EXISTS lead_score INTEGER,
    ADD COLUMN IF NOT EXISTS health_score INTEGER,
    ADD COLUMN IF NOT EXISTS tags TEXT[];
CREATE INDEX IF NOT EXISTS idx_leads_leads_raw_id ON public.leads(leads_raw_id);
-- One CRM lead per AI lead (per org). Partial unique index ignores manual leads.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_leads_org_leads_raw_id
    ON public.leads(organization_id, leads_raw_id) WHERE leads_raw_id IS NOT NULL;

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS domain TEXT,
    ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
    ADD COLUMN IF NOT EXISTS size_estimate TEXT;

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
    ADD COLUMN IF NOT EXISTS role_type TEXT,
    ADD COLUMN IF NOT EXISTS seniority TEXT,
    ADD COLUMN IF NOT EXISTS reports_to TEXT,
    ADD COLUMN IF NOT EXISTS email_confidence TEXT;

-- ---------------------------------------------------------------------------
-- phase_runs — one row per pipeline invocation kicked off from the dashboard
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phase_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,                 -- phase1 | phase2 | phase3
    command TEXT,                        -- the CLI command executed
    icp_id BIGINT,
    params JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued', -- queued | running | succeeded | failed | cancelled
    logs TEXT DEFAULT '',
    error TEXT,
    result JSONB,
    triggered_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phase_runs_org_id ON public.phase_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_phase_runs_status ON public.phase_runs(status);
CREATE INDEX IF NOT EXISTS idx_phase_runs_phase ON public.phase_runs(phase);
CREATE INDEX IF NOT EXISTS idx_phase_runs_created_at ON public.phase_runs(created_at DESC);
ALTER TABLE public.phase_runs DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- gtm_promote_lead(): denormalized leads_raw -> CRM companies/contacts/leads.
-- Returns the CRM lead UUID. Idempotent: re-running updates the same records.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gtm_promote_lead(p_lead_id BIGINT, p_org UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    r            public.leads_raw%ROWTYPE;
    v_company_id UUID;
    v_contact_id UUID;
    v_lead_id    UUID;
    v_temp       TEXT;
    v_status     TEXT;
    v_location   TEXT;
BEGIN
    SELECT * INTO r FROM public.leads_raw WHERE id = p_lead_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF p_org IS NULL THEN
        p_org := r.organization_id;
    END IF;
    IF p_org IS NULL THEN
        RAISE NOTICE 'gtm_promote_lead: leads_raw % has no organization_id, skipping', p_lead_id;
        RETURN NULL;
    END IF;

    ------------------------------------------------------------------ company
    SELECT id INTO v_company_id
    FROM public.companies
    WHERE organization_id = p_org AND LOWER(name) = LOWER(r.company_name)
    LIMIT 1;

    IF v_company_id IS NULL THEN
        INSERT INTO public.companies
            (organization_id, name, website, industry, phone, address, domain, linkedin_url, size_estimate)
        VALUES
            (p_org, r.company_name, COALESCE(r.company_website, r.company_domain), r.company_industry,
             r.company_phone, r.company_address, r.company_domain, r.company_linkedin_url, r.company_size)
        RETURNING id INTO v_company_id;
    ELSE
        UPDATE public.companies SET
            website       = COALESCE(website, r.company_website, r.company_domain),
            industry      = COALESCE(industry, r.company_industry),
            phone         = COALESCE(phone, r.company_phone),
            address       = COALESCE(address, r.company_address),
            domain        = COALESCE(domain, r.company_domain),
            linkedin_url  = COALESCE(linkedin_url, r.company_linkedin_url),
            size_estimate = COALESCE(size_estimate, r.company_size),
            updated_at    = NOW()
        WHERE id = v_company_id;
    END IF;

    ------------------------------------------------------------------ contact
    IF r.contact_email IS NOT NULL AND r.contact_email <> '' THEN
        SELECT id INTO v_contact_id
        FROM public.contacts
        WHERE organization_id = p_org AND LOWER(email) = LOWER(r.contact_email)
        LIMIT 1;
    END IF;

    IF v_contact_id IS NULL AND r.contact_name IS NOT NULL AND r.contact_name <> '' THEN
        SELECT id INTO v_contact_id
        FROM public.contacts
        WHERE organization_id = p_org
          AND LOWER(name) = LOWER(r.contact_name)
          AND company_id IS NOT DISTINCT FROM v_company_id
        LIMIT 1;
    END IF;

    IF v_contact_id IS NULL AND (COALESCE(r.contact_name, '') <> '' OR COALESCE(r.contact_email, '') <> '') THEN
        INSERT INTO public.contacts
            (organization_id, company_id, name, email, title, linkedin_url, email_confidence)
        VALUES
            (p_org, v_company_id, COALESCE(NULLIF(r.contact_name, ''), r.contact_email),
             r.contact_email, r.contact_title, r.contact_linkedin_url,
             CASE WHEN r.verified THEN 'verified' ELSE 'pattern' END)
        RETURNING id INTO v_contact_id;
    ELSIF v_contact_id IS NOT NULL THEN
        UPDATE public.contacts SET
            company_id   = COALESCE(company_id, v_company_id),
            email        = COALESCE(email, r.contact_email),
            title        = COALESCE(title, r.contact_title),
            linkedin_url = COALESCE(linkedin_url, r.contact_linkedin_url),
            updated_at   = NOW()
        WHERE id = v_contact_id;
    END IF;

    --------------------------------------------------------------------- lead
    v_temp := CASE WHEN r.score_tier IN ('hot', 'warm', 'cold') THEN r.score_tier ELSE 'cold' END;

    SELECT label INTO v_status
    FROM public.lead_statuses
    WHERE organization_id = p_org
    ORDER BY sort_order ASC
    LIMIT 1;
    v_status := COALESCE(v_status, 'New');

    v_location := NULLIF(
        TRIM(BOTH ', ' FROM CONCAT_WS(', ', NULLIF(r.company_city, ''), NULLIF(r.company_state, ''), NULLIF(r.company_country, ''))),
        '');

    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE organization_id = p_org AND leads_raw_id = p_lead_id
    LIMIT 1;

    IF v_lead_id IS NULL THEN
        INSERT INTO public.leads
            (organization_id, name, contact_person, phone_number, email, location, industry,
             temperature, source, lead_score, status, company_id, contact_id, leads_raw_id,
             verified, bounce_status)
        VALUES
            (p_org, r.company_name, COALESCE(r.contact_name, ''), COALESCE(r.company_phone, ''),
             r.contact_email, COALESCE(v_location, ''), COALESCE(r.company_industry, ''),
             v_temp, COALESCE(r.source, 'GTM Pipeline'), r.icp_score, v_status,
             v_company_id, v_contact_id, p_lead_id, COALESCE(r.verified, FALSE), r.bounce_status)
        RETURNING id INTO v_lead_id;
    ELSE
        UPDATE public.leads SET
            company_id    = COALESCE(company_id, v_company_id),
            contact_id    = COALESCE(contact_id, v_contact_id),
            email         = COALESCE(email, r.contact_email),
            -- never blank an existing (NOT NULL) phone; only overwrite with a real value
            phone_number  = COALESCE(NULLIF(r.company_phone, ''), phone_number),
            temperature   = v_temp,
            lead_score    = COALESCE(r.icp_score, lead_score),
            verified      = COALESCE(r.verified, verified),
            bounce_status = COALESCE(r.bounce_status, bounce_status)
        WHERE id = v_lead_id;
    END IF;

    RETURN v_lead_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Auto-promote hot leads (user opted in). Fires when a leads_raw row becomes
-- 'hot'. Skips existing customers. The promote function is idempotent so this
-- never duplicates a CRM lead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gtm_autopromote_hot_lead()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.score_tier = 'hot'
       AND NEW.organization_id IS NOT NULL
       AND COALESCE(NEW.is_existing_customer, FALSE) = FALSE THEN
        PERFORM public.gtm_promote_lead(NEW.id, NEW.organization_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autopromote_hot_lead ON public.leads_raw;
CREATE TRIGGER trg_autopromote_hot_lead
    AFTER INSERT OR UPDATE OF score_tier ON public.leads_raw
    FOR EACH ROW
    EXECUTE FUNCTION public.gtm_autopromote_hot_lead();
