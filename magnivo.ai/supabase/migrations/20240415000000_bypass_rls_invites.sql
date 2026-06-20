-- Disable RLS on organization_invites to match local dev bypass setup
ALTER TABLE public.organization_invites DISABLE ROW LEVEL SECURITY;
