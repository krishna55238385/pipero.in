-- Path A (phase-3 "Reach out") runs now create a first-class campaign too, so
-- auto-generated outreach shows up in the campaigns list with full analytics.
-- origin distinguishes auto (AI pipeline) from manual (user-built) campaigns;
-- icp_id links an auto campaign to the ICP it was generated for.
ALTER TABLE public.engage_campaigns
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'auto')),
  ADD COLUMN IF NOT EXISTS icp_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_engage_campaigns_origin ON public.engage_campaigns (organization_id, origin);
