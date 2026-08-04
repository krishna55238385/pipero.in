-- ============================================================
-- Mail Module: mailbox pools, mailboxes, OAuth/SMTP/IMAP configs
-- ============================================================

-- Enums as CHECK constraints (project convention: no PostgreSQL ENUM types)

-- 1. Mailbox Pools -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mailbox_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  daily_pool_limit INTEGER NOT NULL DEFAULT 500,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE public.mailbox_pools DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mailbox_pools_org_id ON public.mailbox_pools(organization_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_pools_status ON public.mailbox_pools(status);

-- 2. Mailboxes ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pool_id UUID REFERENCES public.mailbox_pools(id) ON DELETE SET NULL,
  provider TEXT NOT NULL
    CHECK (provider IN ('gmail', 'outlook', 'zoho', 'custom')),
  auth_type TEXT NOT NULL DEFAULT 'oauth'
    CHECK (auth_type IN ('oauth', 'smtp', 'imap')),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  provider_account_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  daily_limit INTEGER NOT NULL DEFAULT 50,
  current_daily_usage INTEGER NOT NULL DEFAULT 0,
  health_score INTEGER CHECK (health_score >= 0 AND health_score <= 100),
  health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('excellent', 'good', 'fair', 'poor', 'unknown')),
  mailbox_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (mailbox_status IN ('connected', 'disconnected', 'warming', 'error', 'suspended')),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'failed')),
  warmup_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (warmup_status IN ('idle', 'warming', 'paused', 'completed', 'error')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, email)
);
ALTER TABLE public.mail_mailboxes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_org_id ON public.mail_mailboxes(organization_id);
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_pool_id ON public.mail_mailboxes(pool_id);
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_email ON public.mail_mailboxes(email);
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_status ON public.mail_mailboxes(mailbox_status);

-- 3. OAuth Configuration -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mailbox_oauth_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('gmail', 'outlook', 'zoho')),
  provider_account_id TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  encrypted_access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT NOT NULL DEFAULT '',
  last_rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_id, provider)
);
ALTER TABLE public.mailbox_oauth_configs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_mailbox_id ON public.mailbox_oauth_configs(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_org_id ON public.mailbox_oauth_configs(organization_id);

-- 4. SMTP Configuration ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mailbox_smtp_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  encryption TEXT NOT NULL DEFAULT 'starttls'
    CHECK (encryption IN ('none', 'ssl', 'starttls')),
  username TEXT NOT NULL,
  encrypted_password_reference TEXT NOT NULL,
  authentication_type TEXT NOT NULL DEFAULT 'password'
    CHECK (authentication_type IN ('password', 'oauth2', 'ntlm')),
  validation_status TEXT NOT NULL DEFAULT 'unvalidated'
    CHECK (validation_status IN ('unvalidated', 'valid', 'invalid')),
  last_validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_id)
);
ALTER TABLE public.mailbox_smtp_configs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mailbox_smtp_mailbox_id ON public.mailbox_smtp_configs(mailbox_id);

-- 5. IMAP Configuration ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mailbox_imap_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 993,
  ssl BOOLEAN NOT NULL DEFAULT TRUE,
  authentication TEXT NOT NULL DEFAULT 'password'
    CHECK (authentication IN ('password', 'oauth2')),
  validation_status TEXT NOT NULL DEFAULT 'unvalidated'
    CHECK (validation_status IN ('unvalidated', 'valid', 'invalid')),
  last_validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_id)
);
ALTER TABLE public.mailbox_imap_configs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mailbox_imap_mailbox_id ON public.mailbox_imap_configs(mailbox_id);

-- 6. Mailbox Pool Members (junction) -----------------------------------------
CREATE TABLE IF NOT EXISTS public.mailbox_pool_members (
  pool_id UUID NOT NULL REFERENCES public.mailbox_pools(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_id, mailbox_id)
);
ALTER TABLE public.mailbox_pool_members DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pool_members_mailbox_id ON public.mailbox_pool_members(mailbox_id);
