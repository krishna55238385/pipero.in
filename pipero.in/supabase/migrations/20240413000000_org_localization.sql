-- Add currency and timezone columns to organizations table
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT '(UTC-05:00) Eastern Time',
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
