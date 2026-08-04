-- ============================================================
-- Domain Management product fields (additive)
-- ============================================================

ALTER TABLE public.mail_deliverability_domains
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'sending'
    CHECK (purpose IN ('sending', 'tracking', 'warmup', 'shared')),
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dns_provider TEXT,
  ADD COLUMN IF NOT EXISTS ownership_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ownership_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mx_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (mx_status IN ('unverified', 'valid', 'invalid', 'missing')),
  ADD COLUMN IF NOT EXISTS bimi_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (bimi_status IN ('unverified', 'valid', 'invalid', 'missing', 'not_configured')),
  ADD COLUMN IF NOT EXISTS bimi_selector TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS bimi_svg_url TEXT,
  ADD COLUMN IF NOT EXISTS bimi_vmc_url TEXT;

CREATE INDEX IF NOT EXISTS idx_deliverability_domains_purpose
  ON public.mail_deliverability_domains(organization_id, purpose);
CREATE INDEX IF NOT EXISTS idx_deliverability_domains_tags
  ON public.mail_deliverability_domains USING GIN (tags);
