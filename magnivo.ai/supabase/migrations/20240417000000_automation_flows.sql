-- Automation Flows Table
CREATE TABLE IF NOT EXISTS automation_flows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL, -- e.g. 'lead_created', 'status_changed'
    conditions JSONB DEFAULT '[]'::jsonb,
    actions JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Automation Runs (Logs) Table
CREATE TABLE IF NOT EXISTS automation_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    flow_id UUID REFERENCES automation_flows(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL, -- The ID of the lead or deal
    entity_type TEXT NOT NULL, -- 'lead' or 'deal'
    status TEXT NOT NULL, -- 'success', 'failed', 'skipped'
    logs JSONB DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE automation_flows;
ALTER PUBLICATION supabase_realtime ADD TABLE automation_runs;
