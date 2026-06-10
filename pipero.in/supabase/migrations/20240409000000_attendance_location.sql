-- Add location to attendance table
ALTER TABLE public.attendance
ADD COLUMN IF NOT EXISTS location JSONB;
