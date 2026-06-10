-- Support Google Sheet / campaign import: email + UTM metadata on leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS contact_person TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New',
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS campaign TEXT,
  ADD COLUMN IF NOT EXISTS grade_level TEXT,
  ADD COLUMN IF NOT EXISTS demo_date DATE,
  ADD COLUMN IF NOT EXISTS demo_time_slot TEXT,
  ADD COLUMN IF NOT EXISTS utm_metadata JSONB DEFAULT '{}'::jsonb;
