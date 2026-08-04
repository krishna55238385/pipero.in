-- Allow Zoho OAuth mailboxes in Engage accounts (additive)
ALTER TABLE public.engage_mailboxes
  DROP CONSTRAINT IF EXISTS engage_mailboxes_provider_check;

ALTER TABLE public.engage_mailboxes
  ADD CONSTRAINT engage_mailboxes_provider_check
  CHECK (provider = ANY (ARRAY['gmail'::text, 'smtp'::text, 'microsoft'::text, 'zoho'::text]));
