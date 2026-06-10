-- engage_campaigns.audience_lead_ids was declared UUID[] but the audience comes
-- from leads_raw, whose id is BIGINT. Inserting bigint lead ids (e.g. "27") into
-- a UUID[] column threw `invalid input syntax for type uuid`, so no campaign with
-- an audience could ever be created. Convert the column to BIGINT[].
ALTER TABLE public.engage_campaigns ALTER COLUMN audience_lead_ids DROP DEFAULT;
ALTER TABLE public.engage_campaigns
  ALTER COLUMN audience_lead_ids TYPE BIGINT[] USING audience_lead_ids::text[]::bigint[];
ALTER TABLE public.engage_campaigns ALTER COLUMN audience_lead_ids SET DEFAULT '{}';
