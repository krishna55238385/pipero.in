-- Instantly-style per-lead interest status inside a campaign (Lead / Interested /
-- Meeting booked / … ), plus the detected email provider for the Leads table.
-- Positive statuses (interested, meeting_booked, meeting_completed, won) are the
-- "opportunities" surfaced in campaign analytics.
ALTER TABLE public.engage_campaign_recipients
  ADD COLUMN IF NOT EXISTS interest_status TEXT NOT NULL DEFAULT 'lead'
    CHECK (interest_status IN (
      'lead','interested','meeting_booked','meeting_completed','won',
      'no_show','out_of_office','wrong_person','not_interested'
    )),
  ADD COLUMN IF NOT EXISTS email_provider TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
