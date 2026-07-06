-- Fix organization_invites for the post-Supabase (RDS + Clerk) architecture.
-- invited_by previously referenced auth.users(id), which no Clerk-created
-- public.users row ever matches, breaking every insert. Point it at
-- public.users instead. Also add the UNIQUE constraint on token (needed for
-- reliable single-row lookup by the invite-acceptance API) and an
-- accepted_at timestamp for auditability.

ALTER TABLE public.organization_invites
  DROP CONSTRAINT IF EXISTS organization_invites_invited_by_fkey;

ALTER TABLE public.organization_invites
  ALTER COLUMN invited_by DROP NOT NULL;

ALTER TABLE public.organization_invites
  ADD CONSTRAINT organization_invites_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.organization_invites
  ADD CONSTRAINT organization_invites_token_key UNIQUE (token);

ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE;
