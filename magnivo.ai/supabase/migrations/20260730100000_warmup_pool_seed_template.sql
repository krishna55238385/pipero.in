-- Magnivo warmup-only pool seed template (ops use — replace placeholders before running)
-- Domains must be dedicated warmup infrastructure, never client campaign-sending domains.

-- Allow cancelled warmup when mailbox disconnects mid-ramp (PRD §15)
ALTER TABLE public.mail_warmup_configs DROP CONSTRAINT IF EXISTS mail_warmup_configs_status_check;
ALTER TABLE public.mail_warmup_configs ADD CONSTRAINT mail_warmup_configs_status_check
  CHECK (status IN (
    'draft', 'pending', 'running', 'paused', 'completed', 'graduated', 'disabled', 'failed', 'cancelled'
  ));

-- Partner 1: replace WARMUP_DOMAIN_1, WARMUP_MAILBOX_1, SMTP_HOST_1, ENCRYPTED_SMTP_PASSWORD_1
INSERT INTO public.mail_warmup_pool_mailboxes (
  email, domain, provider, auth_type,
  smtp_host, smtp_port, encrypted_smtp_password,
  imap_host, imap_port, encrypted_imap_password,
  is_warmup_only, health_status, daily_capacity, metadata
)
SELECT
  'WARMUP_MAILBOX_1@WARMUP_DOMAIN_1',
  'WARMUP_DOMAIN_1',
  'custom',
  'smtp',
  'SMTP_HOST_1',
  587,
  'ENCRYPTED_SMTP_PASSWORD_1',
  'IMAP_HOST_1',
  993,
  'ENCRYPTED_IMAP_PASSWORD_1',
  TRUE,
  'healthy',
  50,
  '{"seed": "magnivo-warmup-pool", "slot": 1}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.mail_warmup_pool_mailboxes WHERE email = 'WARMUP_MAILBOX_1@WARMUP_DOMAIN_1'
);

-- Partner 2
INSERT INTO public.mail_warmup_pool_mailboxes (
  email, domain, provider, auth_type,
  smtp_host, smtp_port, encrypted_smtp_password,
  imap_host, imap_port, encrypted_imap_password,
  is_warmup_only, health_status, daily_capacity, metadata
)
SELECT
  'WARMUP_MAILBOX_2@WARMUP_DOMAIN_2',
  'WARMUP_DOMAIN_2',
  'custom',
  'smtp',
  'SMTP_HOST_2',
  587,
  'ENCRYPTED_SMTP_PASSWORD_2',
  'IMAP_HOST_2',
  993,
  'ENCRYPTED_IMAP_PASSWORD_2',
  TRUE,
  'healthy',
  50,
  '{"seed": "magnivo-warmup-pool", "slot": 2}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.mail_warmup_pool_mailboxes WHERE email = 'WARMUP_MAILBOX_2@WARMUP_DOMAIN_2'
);

-- Partner 3
INSERT INTO public.mail_warmup_pool_mailboxes (
  email, domain, provider, auth_type,
  smtp_host, smtp_port, encrypted_smtp_password,
  imap_host, imap_port, encrypted_imap_password,
  is_warmup_only, health_status, daily_capacity, metadata
)
SELECT
  'WARMUP_MAILBOX_3@WARMUP_DOMAIN_3',
  'WARMUP_DOMAIN_3',
  'custom',
  'smtp',
  'SMTP_HOST_3',
  587,
  'ENCRYPTED_SMTP_PASSWORD_3',
  'IMAP_HOST_3',
  993,
  'ENCRYPTED_IMAP_PASSWORD_3',
  TRUE,
  'healthy',
  50,
  '{"seed": "magnivo-warmup-pool", "slot": 3}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.mail_warmup_pool_mailboxes WHERE email = 'WARMUP_MAILBOX_3@WARMUP_DOMAIN_3'
);

-- Partner 4
INSERT INTO public.mail_warmup_pool_mailboxes (
  email, domain, provider, auth_type,
  smtp_host, smtp_port, encrypted_smtp_password,
  imap_host, imap_port, encrypted_imap_password,
  is_warmup_only, health_status, daily_capacity, metadata
)
SELECT
  'WARMUP_MAILBOX_4@WARMUP_DOMAIN_4',
  'WARMUP_DOMAIN_4',
  'custom',
  'smtp',
  'SMTP_HOST_4',
  587,
  'ENCRYPTED_SMTP_PASSWORD_4',
  'IMAP_HOST_4',
  993,
  'ENCRYPTED_IMAP_PASSWORD_4',
  TRUE,
  'healthy',
  50,
  '{"seed": "magnivo-warmup-pool", "slot": 4}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.mail_warmup_pool_mailboxes WHERE email = 'WARMUP_MAILBOX_4@WARMUP_DOMAIN_4'
);
