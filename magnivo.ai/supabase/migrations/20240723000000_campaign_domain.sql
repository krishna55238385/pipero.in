-- ============================================================
-- Campaign Domain Tables
-- ============================================================

-- Campaign folders for organizing campaigns
CREATE TABLE IF NOT EXISTS public.campaign_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  parent_id UUID REFERENCES public.campaign_folders(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaign_folders_org ON public.campaign_folders(organization_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_folders_org_name ON public.campaign_folders(organization_id, name) WHERE deleted_at IS NULL;

-- Campaign tags
CREATE TABLE IF NOT EXISTS public.campaign_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_tags_org_name ON public.campaign_tags(organization_id, name);

-- Campaign labels
CREATE TABLE IF NOT EXISTS public.campaign_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#10b981',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_labels_org_name ON public.campaign_labels(organization_id, name);

-- Core campaign table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.campaign_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'stopped', 'completed', 'archived', 'failed')),
  subject TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  preview_text TEXT DEFAULT '',
  from_name TEXT DEFAULT '',
  from_email TEXT DEFAULT '',
  reply_to TEXT DEFAULT '',
  pool_id UUID,
  timezone TEXT DEFAULT 'UTC',
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'scheduled', 'api', 'webhook')),
  owner_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_paused_at TIMESTAMPTZ,
  recipient_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  bounce_count INTEGER DEFAULT 0,
  unsubscribe_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org_status ON public.campaigns(organization_id, status) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_campaigns_org_folder ON public.campaigns(organization_id, folder_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_campaigns_org_owner ON public.campaigns(organization_id, owner_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_campaigns_pool ON public.campaigns(pool_id) WHERE pool_id IS NOT NULL AND is_deleted = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_org_folder_name ON public.campaigns(organization_id, folder_id, name) WHERE is_deleted = FALSE AND folder_id IS NOT NULL;

-- Campaign tag junction
CREATE TABLE IF NOT EXISTS public.campaign_tag_junction (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.campaign_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, tag_id)
);

-- Campaign label junction
CREATE TABLE IF NOT EXISTS public.campaign_label_junction (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES public.campaign_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, label_id)
);

-- Campaign versions for rollback
CREATE TABLE IF NOT EXISTS public.campaign_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}',
  change_summary TEXT DEFAULT '',
  actor_user_id TEXT,
  actor_email TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_versions_campaign ON public.campaign_versions(campaign_id, version_number DESC);

-- Campaign schedule
CREATE TABLE IF NOT EXISTS public.campaign_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT,
  recurrence_end_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_schedules_campaign ON public.campaign_schedules(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_schedules_active ON public.campaign_schedules(scheduled_at) WHERE is_active = TRUE;

-- Campaign settings
CREATE TABLE IF NOT EXISTS public.campaign_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  open_tracking BOOLEAN DEFAULT TRUE,
  click_tracking BOOLEAN DEFAULT TRUE,
  unsubscribe_link BOOLEAN DEFAULT TRUE,
  send_window_start INTEGER DEFAULT 9,
  send_window_end INTEGER DEFAULT 17,
  max_sends_per_day INTEGER DEFAULT 100,
  throttle_ms INTEGER DEFAULT 0,
  ab_test_enabled BOOLEAN DEFAULT FALSE,
  ab_test_percentage INTEGER DEFAULT 50,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign statistics
CREATE TABLE IF NOT EXISTS public.campaign_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  sent INTEGER DEFAULT 0,
  delivered INTEGER DEFAULT 0,
  opened INTEGER DEFAULT 0,
  clicked INTEGER DEFAULT 0,
  replied INTEGER DEFAULT 0,
  bounced INTEGER DEFAULT 0,
  unsubscribed INTEGER DEFAULT 0,
  complaints INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_campaign_statistics_campaign ON public.campaign_statistics(campaign_id, date DESC);

-- Campaign history (audit trail)
CREATE TABLE IF NOT EXISTS public.campaign_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email TEXT,
  previous_status TEXT,
  new_status TEXT,
  change_summary TEXT DEFAULT '',
  previous_data JSONB,
  new_data JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_history_campaign ON public.campaign_history(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_history_org ON public.campaign_history(organization_id, created_at DESC);

-- Campaign events (system events)
CREATE TABLE IF NOT EXISTS public.campaign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email TEXT,
  previous_status TEXT,
  new_status TEXT,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign ON public.campaign_events(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_org ON public.campaign_events(organization_id, created_at DESC);

-- Campaign goals
CREATE TABLE IF NOT EXISTS public.campaign_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('open_rate', 'click_rate', 'reply_rate', 'bounce_rate', 'custom')),
  target_value NUMERIC NOT NULL DEFAULT 0,
  current_value NUMERIC NOT NULL DEFAULT 0,
  is_met BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_goals_campaign ON public.campaign_goals(campaign_id);

-- Campaign templates
CREATE TABLE IF NOT EXISTS public.campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  subject TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  preview_text TEXT DEFAULT '',
  from_name TEXT DEFAULT '',
  from_email TEXT DEFAULT '',
  settings JSONB DEFAULT '{}',
  is_system BOOLEAN DEFAULT FALSE,
  use_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaign_templates_org ON public.campaign_templates(organization_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_templates_org_name ON public.campaign_templates(organization_id, name) WHERE deleted_at IS NULL;

-- Campaign attachments
CREATE TABLE IF NOT EXISTS public.campaign_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_attachments_campaign ON public.campaign_attachments(campaign_id);

-- Campaign metadata (extensible key-value store)
CREATE TABLE IF NOT EXISTS public.campaign_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (campaign_id, key)
);

CREATE INDEX IF NOT EXISTS idx_campaign_metadata_campaign ON public.campaign_metadata(campaign_id);

-- Sequences (multi-step campaigns)
CREATE TABLE IF NOT EXISTS public.campaign_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign ON public.campaign_sequences(campaign_id);

-- Sequence steps
CREATE TABLE IF NOT EXISTS public.campaign_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES public.campaign_sequences(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  subject TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  delay_days INTEGER DEFAULT 0,
  delay_hours INTEGER DEFAULT 0,
  condition_type TEXT,
  condition_config JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_sequence_steps_seq ON public.campaign_sequence_steps(sequence_id, step_number);

-- Campaign nodes (flow builder)
CREATE TABLE IF NOT EXISTS public.campaign_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('start', 'email', 'wait', 'condition', 'split', 'goal', 'webhook', 'delay', 'exit')),
  label TEXT DEFAULT '',
  position_x NUMERIC DEFAULT 0,
  position_y NUMERIC DEFAULT 0,
  config JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_nodes_campaign ON public.campaign_nodes(campaign_id);

-- Node edges (connections between nodes)
CREATE TABLE IF NOT EXISTS public.campaign_node_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES public.campaign_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES public.campaign_nodes(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_node_edges_campaign ON public.campaign_node_edges(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_node_edges_source ON public.campaign_node_edges(source_node_id);

-- Node conditions
CREATE TABLE IF NOT EXISTS public.campaign_node_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.campaign_nodes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_node_conditions_node ON public.campaign_node_conditions(node_id);

-- Campaign variants (A/B testing)
CREATE TABLE IF NOT EXISTS public.campaign_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  variant_type TEXT NOT NULL CHECK (variant_type IN ('A', 'B', 'C')),
  name TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  percentage INTEGER DEFAULT 33,
  is_winner BOOLEAN DEFAULT FALSE,
  sent_count INTEGER DEFAULT 0,
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  bounce_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_variants_campaign ON public.campaign_variants(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_variants_campaign_type ON public.campaign_variants(campaign_id, variant_type);
