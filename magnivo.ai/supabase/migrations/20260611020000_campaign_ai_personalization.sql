-- Campaigns can now AI-personalize a unique email per lead (vs static template
-- merge). personalize_mode picks the writing mode; ai_instruction is the
-- optional one-line goal the AI follows on top of the chosen template.
ALTER TABLE public.engage_campaigns
  ADD COLUMN IF NOT EXISTS personalize_mode TEXT NOT NULL DEFAULT 'template'
    CHECK (personalize_mode IN ('template', 'ai')),
  ADD COLUMN IF NOT EXISTS ai_instruction TEXT;
