'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { embedText, generateText, renderTemplateVariables } from '@/lib/llm'

type OrgContext = { orgId: string; userId: string | null }

function logSupabaseError(context: string, error: unknown) {
  const e = error as any
  const summary = {
    message: e?.message,
    details: e?.details,
    hint: e?.hint,
    code: e?.code,
    status: e?.status,
  }
  // Use warning level so expected DB bootstrap states don't surface as runtime "Console Error".
  console.warn(context, summary)
}

function isMissingRelation(error: unknown) {
  const e = error as any
  const msg = typeof e?.message === 'string' ? e.message.toLowerCase() : ''
  return (
    e?.code === '42P01' ||
    e?.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  )
}

function migrationRequiredMessage(entityName: string) {
  return `${entityName} is not available yet. Run the latest Supabase migration: 20240603000000_content_intelligence_library.sql`
}

function friendlyDbError(entityName: string, error: unknown) {
  if (isMissingRelation(error)) return migrationRequiredMessage(entityName)
  const e = error as any
  return e?.message || `Failed to process ${entityName}`
}

async function getOrgContext(): Promise<OrgContext | null> {
  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
  const orgId = org?.id
  if (!orgId) return null

  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return { orgId, userId: user.id }
  if (isMockAuth) {
    const { data: anyUser } = await supabase.from('users').select('id').eq('organization_id', orgId).limit(1).single()
    return { orgId, userId: anyUser?.id ?? null }
  }
  return { orgId, userId: null }
}

function normalizeBodyText(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function contentToEmbeddingText(item: {
  title: string
  description?: string | null
  content_body: unknown
  tags?: string[] | null
  persona?: string | null
  industry?: string | null
  funnel_stage?: string | null
  content_type?: string | null
}) {
  const parts = [
    `title: ${item.title}`,
    item.description ? `description: ${item.description}` : '',
    item.content_type ? `type: ${item.content_type}` : '',
    item.funnel_stage ? `stage: ${item.funnel_stage}` : '',
    item.persona ? `persona: ${item.persona}` : '',
    item.industry ? `industry: ${item.industry}` : '',
    item.tags?.length ? `tags: ${item.tags.join(', ')}` : '',
    `body: ${normalizeBodyText(item.content_body)}`,
  ].filter(Boolean)
  return parts.join('\n')
}

export type ContentType =
  | 'email_template'
  | 'whatsapp_script'
  | 'call_script'
  | 'playbook'
  | 'case_study'
  | 'ad_creative'
  | 'pitch_deck'
  | 'media'

export type FunnelStage = 'awareness' | 'consideration' | 'conversion'

export type ContentLibraryItem = {
  id: string
  title: string
  description: string | null
  content_body: any
  content_type: ContentType
  tags: string[]
  funnel_stage: FunnelStage
  persona: string | null
  industry: string | null
  current_version: number
  performance_metrics: Record<string, unknown>
  created_at: string
  updated_at: string
}

export async function createContentItem(input: {
  title: string
  description?: string
  content_body: any
  content_type: ContentType
  tags?: string[]
  funnel_stage: FunnelStage
  persona?: string
  industry?: string
  media?: Record<string, unknown>
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  const now = new Date().toISOString()
  const base = {
    organization_id: ctx.orgId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    content_body: input.content_body ?? {},
    content_type: input.content_type,
    tags: input.tags?.filter(Boolean) ?? [],
    funnel_stage: input.funnel_stage,
    persona: input.persona?.trim() || null,
    industry: input.industry?.trim() || null,
    created_by: ctx.userId,
    current_version: 1,
    performance_metrics: { usage_count: 0, opened: 0, replied: 0, converted: 0 },
    media: input.media ?? {},
    updated_at: now,
  }

  const embedding = await embedText(contentToEmbeddingText(base), 'content_ai')

  const { data: created, error } = await supabase
    .from('content_library')
    .insert({ ...base, embedding })
    .select('*')
    .single()

  if (error) {
    logSupabaseError('createContentItem error', error)
    return { error: friendlyDbError('Content library', error) }
  }

  await supabase.from('content_versions').insert({
    organization_id: ctx.orgId,
    content_id: created.id,
    version: 1,
    title: created.title,
    description: created.description,
    content_body: created.content_body,
    tags: created.tags,
    funnel_stage: created.funnel_stage,
    persona: created.persona,
    industry: created.industry,
    created_by: ctx.userId,
    change_summary: 'Initial version',
  })

  revalidatePath('/content')
  revalidatePath('/')
  return { success: true, data: created as ContentLibraryItem }
}

export async function updateContentItem(contentId: string, updates: {
  title?: string
  description?: string
  content_body?: any
  tags?: string[]
  funnel_stage?: FunnelStage
  persona?: string
  industry?: string
  change_summary?: string
  is_archived?: boolean
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  const { data: existing, error: fetchErr } = await supabase
    .from('content_library')
    .select('*')
    .eq('id', contentId)
    .eq('organization_id', ctx.orgId)
    .single()

  if (fetchErr || !existing) {
    if (fetchErr) logSupabaseError('updateContentItem fetch error', fetchErr)
    return { error: fetchErr ? friendlyDbError('Content library', fetchErr) : 'Not found' }
  }

  const nextVersion = Number(existing.current_version || 1) + 1
  const next = {
    title: updates.title?.trim() ?? existing.title,
    description: updates.description?.trim() ?? existing.description,
    content_body: updates.content_body ?? existing.content_body,
    tags: updates.tags ?? existing.tags,
    funnel_stage: updates.funnel_stage ?? existing.funnel_stage,
    persona: updates.persona ?? existing.persona,
    industry: updates.industry ?? existing.industry,
    is_archived: updates.is_archived ?? existing.is_archived,
  }

  const embedding = await embedText(contentToEmbeddingText({
    ...next,
    content_type: existing.content_type,
  }), 'content_ai')

  const { data: updated, error: updateErr } = await supabase
    .from('content_library')
    .update({
      ...next,
      current_version: nextVersion,
      embedding,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contentId)
    .eq('organization_id', ctx.orgId)
    .select('*')
    .single()

  if (updateErr) {
    logSupabaseError('updateContentItem update error', updateErr)
    return { error: friendlyDbError('Content library', updateErr) }
  }

  await supabase.from('content_versions').insert({
    organization_id: ctx.orgId,
    content_id: contentId,
    version: nextVersion,
    title: updated.title,
    description: updated.description,
    content_body: updated.content_body,
    tags: updated.tags,
    funnel_stage: updated.funnel_stage,
    persona: updated.persona,
    industry: updated.industry,
    created_by: ctx.userId,
    change_summary: updates.change_summary?.trim() || 'Updated',
  })

  revalidatePath('/content')
  revalidatePath(`/content/${contentId}`)
  return { success: true, data: updated as ContentLibraryItem }
}

export async function getContentItems(params: {
  q?: string
  content_type?: ContentType | 'all'
  persona?: string | 'all'
  industry?: string | 'all'
  funnel_stage?: FunnelStage | 'all'
  tags?: string[]
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return []

  let query = supabase
    .from('content_library')
    .select('*')
    .eq('organization_id', ctx.orgId)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })

  if (params.content_type && params.content_type !== 'all') query = query.eq('content_type', params.content_type)
  if (params.persona && params.persona !== 'all') query = query.eq('persona', params.persona)
  if (params.industry && params.industry !== 'all') query = query.eq('industry', params.industry)
  if (params.funnel_stage && params.funnel_stage !== 'all') query = query.eq('funnel_stage', params.funnel_stage)
  if (params.tags?.length) query = query.contains('tags', params.tags)

  if (params.q) {
    // lightweight keyword search (AI semantic search is separate)
    query = query.or(`title.ilike.%${params.q}%,description.ilike.%${params.q}%`)
  }

  const { data, error } = await query
  if (error) {
    if (isMissingRelation(error)) {
      logSupabaseError('content_library table missing. Run latest Supabase migrations.', error)
      return []
    }
    logSupabaseError('getContentItems error', error)
    return []
  }
  return (data || []) as ContentLibraryItem[]
}

export async function getContentDetail(contentId: string) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return null

  const [contentRes, versionsRes, usageRes] = await Promise.all([
    supabase.from('content_library').select('*').eq('id', contentId).eq('organization_id', ctx.orgId).single(),
    supabase.from('content_versions').select('*').eq('content_id', contentId).eq('organization_id', ctx.orgId).order('version', { ascending: false }),
    supabase.from('content_usage_logs').select('event_type, channel, created_at').eq('content_id', contentId).eq('organization_id', ctx.orgId),
  ])

  if (contentRes.error) {
    logSupabaseError('getContentDetail error', contentRes.error)
    return null
  }
  const usage = usageRes.data || []
  const summary = usage.reduce((acc: any, row: any) => {
    const k = row.event_type
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  return {
    content: contentRes.data as ContentLibraryItem,
    versions: versionsRes.data || [],
    usage_summary: summary,
  }
}

export async function semanticSearchContent(params: {
  query: string
  threshold?: number
  limit?: number
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return []

  const embedding = await embedText(params.query, 'content_ai')
  const { data, error } = await supabase.rpc('match_content_library', {
    query_embedding: embedding,
    match_threshold: params.threshold ?? 0.2,
    match_count: params.limit ?? 12,
    org_id: ctx.orgId,
  })
  if (error) {
    logSupabaseError('semanticSearchContent error', error)
    return []
  }
  return data || []
}

export async function logContentUsage(input: {
  content_id: string
  version?: number
  channel: 'email' | 'whatsapp' | 'call' | 'ads' | 'other'
  event_type: 'executed' | 'opened' | 'clicked' | 'replied' | 'converted'
  context?: Record<string, unknown>
  lead_id?: string
  contact_id?: string
  company_id?: string
  metadata?: Record<string, unknown>
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  const { error } = await supabase.from('content_usage_logs').insert({
    organization_id: ctx.orgId,
    content_id: input.content_id,
    version: input.version ?? null,
    used_by: ctx.userId,
    lead_id: input.lead_id ?? null,
    contact_id: input.contact_id ?? null,
    company_id: input.company_id ?? null,
    channel: input.channel,
    event_type: input.event_type,
    context: input.context ?? {},
    metadata: input.metadata ?? {},
  })
  if (error) {
    logSupabaseError('logContentUsage error', error)
    return { error: friendlyDbError('Content usage logs', error) }
  }

  // update aggregated metrics (best-effort)
  try {
    const { data: item } = await supabase.from('content_library').select('performance_metrics').eq('id', input.content_id).eq('organization_id', ctx.orgId).single()
    const metrics = (item?.performance_metrics || {}) as any
    metrics.usage_count = Number(metrics.usage_count || 0) + (input.event_type === 'executed' ? 1 : 0)
    metrics.opened = Number(metrics.opened || 0) + (input.event_type === 'opened' ? 1 : 0)
    metrics.replied = Number(metrics.replied || 0) + (input.event_type === 'replied' ? 1 : 0)
    metrics.converted = Number(metrics.converted || 0) + (input.event_type === 'converted' ? 1 : 0)
    await supabase.from('content_library').update({ performance_metrics: metrics, updated_at: new Date().toISOString() }).eq('id', input.content_id).eq('organization_id', ctx.orgId)
  } catch {}

  revalidatePath('/content')
  revalidatePath(`/content/${input.content_id}`)
  return { success: true }
}

export async function generatePersonalizedContent(input: {
  content_id: string
  variables: Record<string, string>
  goal?: string
  complexity?: 'fast' | 'pro'
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  const { data: item, error } = await supabase
    .from('content_library')
    .select('id, title, description, content_type, content_body, tags, funnel_stage, persona, industry, current_version')
    .eq('id', input.content_id)
    .eq('organization_id', ctx.orgId)
    .single()

  if (error || !item) {
    if (error) logSupabaseError('generatePersonalizedContent error', error)
    return { error: error ? friendlyDbError('Content library', error) : 'Content not found' }
  }

  const bodyText = normalizeBodyText(item.content_body)
  const templated = renderTemplateVariables(bodyText, input.variables)
  const prompt = [
    `You are an expert sales/content operator. Generate personalized content based on a template.`,
    `Content type: ${item.content_type}`,
    `Title: ${item.title}`,
    item.description ? `Description: ${item.description}` : '',
    item.persona ? `Persona: ${item.persona}` : '',
    item.industry ? `Industry: ${item.industry}` : '',
    `Funnel stage: ${item.funnel_stage}`,
    input.goal ? `Goal: ${input.goal}` : '',
    `Template (already variable-filled):`,
    templated,
    `Return only the final content. No commentary.`,
  ].filter(Boolean).join('\n')

  const text = await generateText(prompt, 'content_ai')

  return { success: true, content: text, used_template_version: item.current_version }
}

export async function askContentAI(input: {
  content_id: string
  question: string
  mode?: 'flash' | 'pro'
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  const { data: item, error } = await supabase
    .from('content_library')
    .select('id, title, description, content_type, content_body, tags, funnel_stage, persona, industry')
    .eq('id', input.content_id)
    .eq('organization_id', ctx.orgId)
    .single()

  if (error || !item) {
    if (error) logSupabaseError('askContentAI error', error)
    return { error: error ? friendlyDbError('Content library', error) : 'Content not found' }
  }

  const body = item.content_body || {}
  const extractedText =
    (typeof body?.extracted_text === 'string' ? body.extracted_text : '') ||
    normalizeBodyText(body)

  const uploadedAssets = Array.isArray(body?.uploaded_assets) ? body.uploaded_assets : []
  const assetsSummary = uploadedAssets
    .map((a: any, idx: number) => `Asset ${idx + 1}: ${a?.name || 'file'} (${a?.mime_type || 'unknown'})\nSummary: ${a?.summary || ''}\nExtracted: ${a?.extracted_text || ''}`)
    .join('\n\n')

  const prompt = [
    'You are a content operations AI assistant for a CRM Content Library.',
    'Answer the user question ONLY using the provided content context and uploaded document context.',
    'If context is insufficient, say what is missing and suggest next action.',
    '',
    `Title: ${item.title}`,
    item.description ? `Description: ${item.description}` : '',
    `Type: ${item.content_type}`,
    item.persona ? `Persona: ${item.persona}` : '',
    item.industry ? `Industry: ${item.industry}` : '',
    `Funnel stage: ${item.funnel_stage}`,
    '',
    'Content context:',
    extractedText,
    '',
    assetsSummary ? `Uploaded assets context:\n${assetsSummary}` : '',
    '',
    `Question: ${input.question}`,
    '',
    'Return concise, actionable answer.',
  ].filter(Boolean).join('\n')

  const answer = await generateText(prompt, 'content_ai')

  return { success: true, answer }
}

export async function recommendContent(input: {
  tags?: string[]
  persona?: string
  industry?: string
  funnel_stage?: FunnelStage
  limit?: number
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return []

  // Heuristic recommendations: filter + order by converted/replied/usage_count
  let query = supabase
    .from('content_library')
    .select('id, title, description, content_type, tags, persona, industry, funnel_stage, performance_metrics, updated_at')
    .eq('organization_id', ctx.orgId)
    .eq('is_archived', false)

  if (input.persona) query = query.eq('persona', input.persona)
  if (input.industry) query = query.eq('industry', input.industry)
  if (input.funnel_stage) query = query.eq('funnel_stage', input.funnel_stage)
  if (input.tags?.length) query = query.contains('tags', input.tags)

  const { data, error } = await query.limit(Math.max(24, input.limit ?? 8))
  if (error) {
    logSupabaseError('recommendContent error', error)
    return []
  }

  const scored = (data || []).map((row: any) => {
    const m = row.performance_metrics || {}
    const usage = Number(m.usage_count || 0)
    const replied = Number(m.replied || 0)
    const converted = Number(m.converted || 0)
    const score = converted * 5 + replied * 2 + usage
    return { ...row, score }
  }).sort((a: any, b: any) => b.score - a.score)

  return scored.slice(0, input.limit ?? 8)
}

// Playbooks
export async function createPlaybook(input: {
  title: string
  description?: string
  tags?: string[]
  funnel_stage: FunnelStage
  persona?: string
  industry?: string
}) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  const { data, error } = await supabase.from('playbooks').insert({
    organization_id: ctx.orgId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    tags: input.tags ?? [],
    funnel_stage: input.funnel_stage,
    persona: input.persona || null,
    industry: input.industry || null,
    created_by: ctx.userId,
    updated_at: new Date().toISOString(),
  }).select('*').single()

  if (error) {
    logSupabaseError('createPlaybook error', error)
    return { error: friendlyDbError('Playbooks', error) }
  }
  revalidatePath('/content/playbooks')
  return { success: true, data }
}

export async function getPlaybooks() {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return []
  const { data, error } = await supabase.from('playbooks').select('*').eq('organization_id', ctx.orgId).order('updated_at', { ascending: false })
  if (error) {
    logSupabaseError('getPlaybooks error', error)
    return []
  }
  return data || []
}

export async function getPlaybookDetail(playbookId: string) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return null
  const [pb, steps] = await Promise.all([
    supabase.from('playbooks').select('*').eq('id', playbookId).eq('organization_id', ctx.orgId).single(),
    supabase.from('playbook_steps').select('*').eq('playbook_id', playbookId).eq('organization_id', ctx.orgId).order('step_order', { ascending: true }),
  ])
  if (pb.error) {
    logSupabaseError('getPlaybookDetail playbook error', pb.error)
    return null
  }
  if (steps.error) {
    logSupabaseError('getPlaybookDetail steps error', steps.error)
  }
  return { playbook: pb.data, steps: steps.data || [] }
}

export async function upsertPlaybookSteps(playbookId: string, steps: Array<{
  id?: string
  step_order: number
  step_type: 'send_email' | 'send_whatsapp' | 'wait' | 'assign_task'
  title: string
  config: Record<string, unknown>
  content_id?: string | null
}>) {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  // Simple strategy: delete existing and re-insert in order (safe for v1 builder)
  const { error: delErr } = await supabase
    .from('playbook_steps')
    .delete()
    .eq('playbook_id', playbookId)
    .eq('organization_id', ctx.orgId)
  if (delErr) {
    logSupabaseError('upsertPlaybookSteps delete error', delErr)
    return { error: friendlyDbError('Playbook steps', delErr) }
  }

  const { error: insErr } = await supabase.from('playbook_steps').insert(
    steps.map(s => ({
      organization_id: ctx.orgId,
      playbook_id: playbookId,
      step_order: s.step_order,
      step_type: s.step_type,
      title: s.title,
      config: s.config ?? {},
      content_id: s.content_id ?? null,
      updated_at: new Date().toISOString(),
    }))
  )
  if (insErr) {
    logSupabaseError('upsertPlaybookSteps insert error', insErr)
    return { error: friendlyDbError('Playbook steps', insErr) }
  }

  await supabase.from('playbooks').update({ updated_at: new Date().toISOString() }).eq('id', playbookId).eq('organization_id', ctx.orgId)
  revalidatePath(`/content/playbooks/${playbookId}`)
  return { success: true }
}

export async function runPlaybookManually(input: {
  playbook_id: string
  lead_id?: string
  contact_id?: string
  company_id?: string
  variables?: Record<string, string>
}) {
  // Webhook-ready: this returns an execution plan. A workflow engine (n8n) can call this and execute steps.
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organization found' }

  const detail = await getPlaybookDetail(input.playbook_id)
  if (!detail) return { error: 'Playbook not found' }

  // Log that playbook was executed (as usage against any content steps)
  for (const step of detail.steps) {
    if (step.content_id) {
      await logContentUsage({
        content_id: step.content_id,
        channel: step.step_type === 'send_email' ? 'email' : step.step_type === 'send_whatsapp' ? 'whatsapp' : 'other',
        event_type: 'executed',
        context: { playbook_id: input.playbook_id, step_id: step.id, variables: input.variables || {} },
        lead_id: input.lead_id,
        contact_id: input.contact_id,
        company_id: input.company_id,
      })
    }
  }

  return {
    success: true,
    execution_plan: {
      playbook: detail.playbook,
      steps: detail.steps,
      target: { lead_id: input.lead_id, contact_id: input.contact_id, company_id: input.company_id },
      variables: input.variables || {},
    }
  }
}

