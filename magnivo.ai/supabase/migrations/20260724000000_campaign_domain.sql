-- ============================================================
-- Campaign Domain — Database Migration
-- ============================================================

-- Campaign Folders
CREATE TABLE IF NOT EXISTS public.campaign_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id UUID REFERENCES public.campaign_folders(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_campaign_folders_org ON public.campaign_folders(organization_id);
CREATE INDEX idx_campaign_folders_parent ON public.campaign_folders(parent_id);

-- Campaign Tags
CREATE TABLE IF NOT EXISTS public.campaign_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_tags_org ON public.campaign_tags(organization_id);
CREATE UNIQUE INDEX idx_campaign_tags_org_name ON public.campaign_tags(organization_id, name);

-- Campaign Labels
CREATE TABLE IF NOT EXISTS public.campaign_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_labels_org ON public.campaign_labels(organization_id);
CREATE UNIQUE INDEX idx_campaign_labels_org_name ON public.campaign_labels(organization_id, name);

-- Campaigns (core table — expand existing if present)
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.campaign_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  preview_text TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  pool_id UUID,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  owner_id UUID,
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_paused_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  bounce_count INTEGER NOT NULL DEFAULT 0,
  unsubscribe_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_org ON public.campaigns(organization_id);
CREATE INDEX idx_campaigns_folder ON public.campaigns(folder_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);
CREATE INDEX idx_campaigns_owner ON public.campaigns(owner_id);
CREATE INDEX idx_campaigns_pool ON public.campaigns(pool_id);
CREATE INDEX idx_campaigns_is_deleted ON public.campaigns(is_deleted);

-- Campaign Tag Junction
CREATE TABLE IF NOT EXISTS public.campaign_campaign_tags (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.campaign_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, tag_id)
);

-- Campaign Label Junction
CREATE TABLE IF NOT EXISTS public.campaign_campaign_labels (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES public.campaign_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, label_id)
);

-- Campaign Versions
CREATE TABLE IF NOT EXISTS public.campaign_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}',
  change_summary TEXT NOT NULL DEFAULT '',
  actor_user_id UUID,
  actor_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_versions_campaign ON public.campaign_versions(campaign_id);
CREATE UNIQUE INDEX idx_campaign_versions_campaign_number ON public.campaign_versions(campaign_id, version_number);

-- Campaign Schedules
CREATE TABLE IF NOT EXISTS public.campaign_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT,
  recurrence_end_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_schedules_campaign ON public.campaign_schedules(campaign_id);

-- Campaign Settings
CREATE TABLE IF NOT EXISTS public.campaign_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  open_tracking BOOLEAN NOT NULL DEFAULT TRUE,
  click_tracking BOOLEAN NOT NULL DEFAULT TRUE,
  unsubscribe_link BOOLEAN NOT NULL DEFAULT TRUE,
  send_window_start INTEGER NOT NULL DEFAULT 9,
  send_window_end INTEGER NOT NULL DEFAULT 17,
  max_sends_per_day INTEGER NOT NULL DEFAULT 100,
  throttle_ms INTEGER NOT NULL DEFAULT 0,
  ab_test_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ab_test_percentage INTEGER NOT NULL DEFAULT 50,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_campaign_settings_campaign ON public.campaign_settings(campaign_id);

-- Campaign Statistics
CREATE TABLE IF NOT EXISTS public.campaign_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  clicked INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  complaints INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_campaign_statistics_campaign_date ON public.campaign_statistics(campaign_id, date);
CREATE INDEX idx_campaign_statistics_org ON public.campaign_statistics(organization_id);

-- Campaign History
CREATE TABLE IF NOT EXISTS public.campaign_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id UUID,
  actor_email TEXT,
  previous_status TEXT,
  new_status TEXT,
  change_summary TEXT NOT NULL DEFAULT '',
  previous_data JSONB,
  new_data JSONB,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_history_campaign ON public.campaign_history(campaign_id);
CREATE INDEX idx_campaign_history_org ON public.campaign_history(organization_id);

-- Campaign Events
CREATE TABLE IF NOT EXISTS public.campaign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id UUID,
  actor_email TEXT,
  previous_status TEXT,
  new_status TEXT,
  message TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_events_campaign ON public.campaign_events(campaign_id);
CREATE INDEX idx_campaign_events_org ON public.campaign_events(organization_id);

-- Campaign Goals
CREATE TABLE IF NOT EXISTS public.campaign_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  target_value NUMERIC NOT NULL DEFAULT 0,
  current_value NUMERIC NOT NULL DEFAULT 0,
  is_met BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_goals_campaign ON public.campaign_goals(campaign_id);

-- Campaign Templates
CREATE TABLE IF NOT EXISTS public.campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  preview_text TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  settings JSONB NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  use_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_campaign_templates_org ON public.campaign_templates(organization_id);

-- Campaign Attachments
CREATE TABLE IF NOT EXISTS public.campaign_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_attachments_campaign ON public.campaign_attachments(campaign_id);

-- Campaign Metadata
CREATE TABLE IF NOT EXISTS public.campaign_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_metadata_campaign ON public.campaign_metadata(campaign_id);
CREATE UNIQUE INDEX idx_campaign_metadata_campaign_key ON public.campaign_metadata(campaign_id, key);

-- Campaign Sequences
CREATE TABLE IF NOT EXISTS public.campaign_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_sequences_campaign ON public.campaign_sequences(campaign_id);

-- Campaign Sequence Steps
CREATE TABLE IF NOT EXISTS public.campaign_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES public.campaign_sequences(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  delay_days INTEGER NOT NULL DEFAULT 0,
  delay_hours INTEGER NOT NULL DEFAULT 0,
  condition_type TEXT,
  condition_config JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_sequence_steps_sequence ON public.campaign_sequence_steps(sequence_id);

-- Campaign Nodes
CREATE TABLE IF NOT EXISTS public.campaign_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  position_x NUMERIC NOT NULL DEFAULT 0,
  position_y NUMERIC NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_nodes_campaign ON public.campaign_nodes(campaign_id);

-- Campaign Node Edges
CREATE TABLE IF NOT EXISTS public.campaign_node_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES public.campaign_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES public.campaign_nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_node_edges_campaign ON public.campaign_node_edges(campaign_id);
CREATE INDEX idx_campaign_node_edges_source ON public.campaign_node_edges(source_node_id);
CREATE INDEX idx_campaign_node_edges_target ON public.campaign_node_edges(target_node_id);

-- Campaign Node Conditions
CREATE TABLE IF NOT EXISTS public.campaign_node_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.campaign_nodes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_node_conditions_node ON public.campaign_node_conditions(node_id);

-- Campaign Variants
CREATE TABLE IF NOT EXISTS public.campaign_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  variant_type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  percentage NUMERIC NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  sent_count INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  bounce_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_variants_campaign ON public.campaign_variants(campaign_id);
