CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users (Profiles linked to auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    full_name TEXT,
    role TEXT CHECK (role IN ('user', 'admin', 'super_admin')) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Leads
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Deals
CREATE TABLE deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    value NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversations
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    unread_count INT DEFAULT 0,
    last_customer_message_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    sender_type TEXT CHECK (sender_type IN ('user', 'agent', 'bot', 'system')),
    message_type TEXT CHECK (message_type IN ('text', 'template', 'image', 'document', 'audio')),
    content TEXT,
    media_url TEXT,
    interakt_message_id TEXT,
    status TEXT CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'unknown')) DEFAULT 'queued',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI Insights
CREATE TABLE ai_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    intent TEXT,
    sentiment TEXT,
    suggested_reply TEXT,
    urgency TEXT CHECK (urgency IN ('low', 'medium', 'high')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Activity Logs
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_org_id ON users(organization_id);
CREATE INDEX idx_leads_org_id ON leads(organization_id);
CREATE INDEX idx_leads_phone ON leads(phone_number);
CREATE INDEX idx_deals_org_id ON deals(organization_id);
CREATE INDEX idx_conversations_org_id ON conversations(organization_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_org_id ON messages(organization_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Set up RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's org
CREATE OR REPLACE FUNCTION get_current_user_org_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- RLS Policies
CREATE POLICY "Users can view their organization" 
    ON organizations FOR SELECT USING (id = get_current_user_org_id());

CREATE POLICY "Users can view org peers" 
    ON users FOR SELECT USING (organization_id = get_current_user_org_id());

CREATE POLICY "Leads access limited to org"
    ON leads FOR ALL USING (organization_id = get_current_user_org_id());

CREATE POLICY "Deals access limited to org"
    ON deals FOR ALL USING (organization_id = get_current_user_org_id());

CREATE POLICY "Conversations access limited to org"
    ON conversations FOR ALL USING (organization_id = get_current_user_org_id());

CREATE POLICY "Messages access limited to org"
    ON messages FOR ALL USING (organization_id = get_current_user_org_id());

CREATE POLICY "AI Insights access limited to org"
    ON ai_insights FOR ALL USING (organization_id = get_current_user_org_id());

CREATE POLICY "Tasks access limited to org"
    ON tasks FOR ALL USING (organization_id = get_current_user_org_id());

CREATE POLICY "Activity logs access limited to org"
    ON activity_logs FOR ALL USING (organization_id = get_current_user_org_id());
