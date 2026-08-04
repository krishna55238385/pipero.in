-- ============================================================
-- Microsoft Graph Webhook Subscriptions
-- PRD §7.08 — Graph webhooks for Outlook mailbox notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mail_graph_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mail_mailboxes(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  client_state TEXT NOT NULL,
  resource TEXT NOT NULL,
  expiration_date_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_notification_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, mailbox_id)
);

ALTER TABLE public.mail_graph_subscriptions DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mail_graph_subscriptions_sub_id
  ON public.mail_graph_subscriptions(subscription_id);

CREATE INDEX IF NOT EXISTS idx_mail_graph_subscriptions_expiration
  ON public.mail_graph_subscriptions(expiration_date_time)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_mail_graph_subscriptions_status
  ON public.mail_graph_subscriptions(status);

-- Add Graph notification URL to the webhook endpoint list comment
COMMENT ON TABLE public.mail_graph_subscriptions IS
  'Microsoft Graph webhook subscriptions for Outlook mailbox notifications. Notification URL: {APP_URL}/api/webhooks/microsoft/graph';
