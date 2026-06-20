-- Content Intelligence & Execution Library
-- Adds content library + versioning + usage logs + playbooks + pgvector semantic search

-- Enable pgvector (Supabase supports this extension)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums (implemented as CHECK constraints for portability)

CREATE TABLE IF NOT EXISTS public.content_library (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  -- body stored as JSON (supports rich text formats)
  content_body JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_type TEXT NOT NULL CHECK (
    content_type IN (
      'email_template',
      'whatsapp_script',
      'call_script',
      'playbook',
      'case_study',
      'ad_creative',
      'pitch_deck',
      'media'
    )
  ),
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  funnel_stage TEXT NOT NULL DEFAULT 'awareness' CHECK (funnel_stage IN ('awareness', 'consideration', 'conversion')),
  persona TEXT,
  industry TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- version pointer (latest)
  current_version INTEGER NOT NULL DEFAULT 1,
  -- computed/aggregated metrics
  performance_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- semantic embedding of title+description+body summary
  embedding vector(768),
  -- optional media stored in Supabase Storage; keep metadata here
  media JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.content_versions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES public.content_library(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content_body JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  funnel_stage TEXT NOT NULL DEFAULT 'awareness' CHECK (funnel_stage IN ('awareness', 'consideration', 'conversion')),
  persona TEXT,
  industry TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  change_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(content_id, version)
);

CREATE TABLE IF NOT EXISTS public.content_usage_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES public.content_library(id) ON DELETE CASCADE,
  version INTEGER,
  used_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'call', 'ads', 'other')),
  -- execution context (variables, recipient, etc.)
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- outcome tracking (can be updated later)
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'executed',
      'opened',
      'clicked',
      'replied',
      'converted'
    )
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.playbooks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  funnel_stage TEXT NOT NULL DEFAULT 'awareness' CHECK (funnel_stage IN ('awareness', 'consideration', 'conversion')),
  persona TEXT,
  industry TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.playbook_steps (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  playbook_id UUID NOT NULL REFERENCES public.playbooks(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('send_email', 'send_whatsapp', 'wait', 'assign_task')),
  title TEXT NOT NULL,
  -- configuration schema depends on step_type
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- optionally link to content_library for send steps
  content_id UUID REFERENCES public.content_library(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(playbook_id, step_order)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_library_org_id ON public.content_library(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_library_type ON public.content_library(content_type);
CREATE INDEX IF NOT EXISTS idx_content_library_stage ON public.content_library(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_content_library_persona ON public.content_library(persona);
CREATE INDEX IF NOT EXISTS idx_content_library_industry ON public.content_library(industry);
CREATE INDEX IF NOT EXISTS idx_content_library_tags ON public.content_library USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_content_versions_content_id ON public.content_versions(content_id);
CREATE INDEX IF NOT EXISTS idx_content_usage_content_id ON public.content_usage_logs(content_id);
CREATE INDEX IF NOT EXISTS idx_content_usage_org_id ON public.content_usage_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_playbooks_org_id ON public.playbooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_playbook_steps_playbook_id ON public.playbook_steps(playbook_id);

-- Vector index for semantic search
CREATE INDEX IF NOT EXISTS idx_content_library_embedding ON public.content_library USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Semantic search function
CREATE OR REPLACE FUNCTION public.match_content_library(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  org_id uuid
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  content_type text,
  funnel_stage text,
  persona text,
  industry text,
  tags text[],
  performance_metrics jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.title,
    c.description,
    c.content_type,
    c.funnel_stage,
    c.persona,
    c.industry,
    c.tags,
    c.performance_metrics,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.content_library c
  WHERE c.organization_id = org_id
    AND c.is_archived = false
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Keep consistent with local/dev posture in this repo (RLS bypassed).
ALTER TABLE public.content_library DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_usage_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbooks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbook_steps DISABLE ROW LEVEL SECURITY;

