'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { getSessionUser } from '@/lib/auth'
import { embedText, generateText, renderTemplateVariables } from '@/lib/llm'

type OrgContext = { orgId: string; userId: string | null }

function logDbError(context: string, error: unknown) {
  const e = error as any
  console.warn(context, { message: e?.message, details: e?.details, hint: e?.hint, code: e?.code, status: e?.status })
}

function isMissingRelation(error: unknown) {
  const e = error as any
  const msg = typeof e?.message === 'string' ? e.message.toLowerCase() : ''
  return e?.code === '42P01' || e?.code === 'PGRST205' || msg.includes('does not exist') || msg.includes('could not find the table') || msg.includes('schema cache')
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
  try {
    const session = await getSessionUser()
    const orgId = session?.orgId
    if (!orgId) return null
    return { orgId, userId: session?.userId ?? null }
  } catch { return null }
}

function normalizeBodyText(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  try { return JSON.stringify(input) } catch { return String(input) }
}

function contentToEmbeddingText(item: {
  title: string; description?: string | null; content_body: unknown; tags?: string[] | null
  persona?: string | null; industry?: string | null; funnel_stage?: string | null; content_type?: string | null
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

export type ContentType = 'email_template' | 'whatsapp_script' | 'call_script' | 'playbook' | 'case_study' | 'ad_creative' | 'pitch_deck' | 'media'
export type FunnelStage = 'awareness' | 'consideration' | 'conversion'

export type ContentLibraryItem = {
  id: string; title: string; description: string | null; content_body: any; content_type: ContentType
  tags: string[]; funnel_stage: FunnelStage; persona: string | null; industry: string | null
  current_version: number; performance_metrics: Record<string, unknown>; created_at: string; updated_at: string
}

export async function createContentItem(input: {
  title: string; description?: string; content_body: any; content_type: ContentType; tags?: string[]
  funnel_stage: FunnelStage; persona?: string; industry?: string; media?: Record<string, unknown>
}) {
  try {
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

    const r = await pool.query(
      `INSERT INTO public.content_library
       (organization_id, title, description, content_body, content_type, tags, funnel_stage, persona, industry, created_by, current_version, performance_metrics, media, updated_at, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [base.organization_id, base.title, base.description, JSON.stringify(base.content_body), base.content_type,
       JSON.stringify(base.tags), base.funnel_stage, base.persona, base.industry, base.created_by,
       base.current_version, JSON.stringify(base.performance_metrics), JSON.stringify(base.media), base.updated_at, embedding])
    const created = r.rows[0]

    await pool.query(
      `INSERT INTO public.content_versions (organization_id, content_id, version, title, description, content_body, tags, funnel_stage, persona, industry, created_by, change_summary)
       VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'Initial version')`,
      [ctx.orgId, created.id, created.title, created.description, JSON.stringify(created.content_body),
       JSON.stringify(created.tags), created.funnel_stage, created.persona, created.industry, ctx.userId])

    revalidatePath('/content'); revalidatePath('/')
    return { success: true, data: created as ContentLibraryItem }
  } catch (err: any) {
    logDbError('createContentItem error', err)
    return { error: friendlyDbError('Content library', err) }
  }
}

export async function updateContentItem(contentId: string, updates: {
  title?: string; description?: string; content_body?: any; tags?: string[]; funnel_stage?: FunnelStage
  persona?: string; industry?: string; change_summary?: string; is_archived?: boolean
}) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return { error: 'No organization found' }

    const existRes = await pool.query(
      'SELECT * FROM public.content_library WHERE id = $1 AND organization_id = $2 LIMIT 1', [contentId, ctx.orgId])
    const existing = existRes.rows[0]
    if (!existing) return { error: 'Not found' }

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

    const embedding = await embedText(contentToEmbeddingText({ ...next, content_type: existing.content_type }), 'content_ai')

    const updRes = await pool.query(
      `UPDATE public.content_library SET title=$1, description=$2, content_body=$3, tags=$4, funnel_stage=$5,
       persona=$6, industry=$7, is_archived=$8, current_version=$9, embedding=$10, updated_at=$11
       WHERE id=$12 AND organization_id=$13 RETURNING *`,
      [next.title, next.description, JSON.stringify(next.content_body), JSON.stringify(next.tags), next.funnel_stage,
       next.persona, next.industry, next.is_archived, nextVersion, embedding, new Date().toISOString(), contentId, ctx.orgId])
    const updated = updRes.rows[0]

    await pool.query(
      `INSERT INTO public.content_versions (organization_id, content_id, version, title, description, content_body, tags, funnel_stage, persona, industry, created_by, change_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [ctx.orgId, contentId, nextVersion, updated.title, updated.description, JSON.stringify(updated.content_body),
       JSON.stringify(updated.tags), updated.funnel_stage, updated.persona, updated.industry, ctx.userId,
       updates.change_summary?.trim() || 'Updated'])

    revalidatePath('/content'); revalidatePath(`/content/${contentId}`)
    return { success: true, data: updated as ContentLibraryItem }
  } catch (err: any) {
    logDbError('updateContentItem error', err)
    return { error: friendlyDbError('Content library', err) }
  }
}

export async function getContentItems(params: {
  q?: string; content_type?: ContentType | 'all'; persona?: string | 'all'
  industry?: string | 'all'; funnel_stage?: FunnelStage | 'all'; tags?: string[]
}) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return []

    const values: any[] = [ctx.orgId]
    const conditions: string[] = ['organization_id = $1', 'is_archived = false']

    if (params.content_type && params.content_type !== 'all') { values.push(params.content_type); conditions.push(`content_type = $${values.length}`) }
    if (params.persona && params.persona !== 'all') { values.push(params.persona); conditions.push(`persona = $${values.length}`) }
    if (params.industry && params.industry !== 'all') { values.push(params.industry); conditions.push(`industry = $${values.length}`) }
    if (params.funnel_stage && params.funnel_stage !== 'all') { values.push(params.funnel_stage); conditions.push(`funnel_stage = $${values.length}`) }
    if (params.tags?.length) { values.push(JSON.stringify(params.tags)); conditions.push(`tags @> $${values.length}`) }
    if (params.q) {
      values.push(`%${params.q}%`); const n = values.length
      conditions.push(`(title ILIKE $${n} OR description ILIKE $${n})`)
    }

    const r = await pool.query(
      `SELECT * FROM public.content_library WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`, values)
    return r.rows as ContentLibraryItem[]
  } catch (err: any) {
    if (isMissingRelation(err)) { logDbError('content_library table missing. Run latest migrations.', err); return [] }
    logDbError('getContentItems error', err); return []
  }
}

export async function getContentDetail(contentId: string) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return null

    const [contentRes, versionsRes, usageRes] = await Promise.all([
      pool.query('SELECT * FROM public.content_library WHERE id = $1 AND organization_id = $2 LIMIT 1', [contentId, ctx.orgId]),
      pool.query('SELECT * FROM public.content_versions WHERE content_id = $1 AND organization_id = $2 ORDER BY version DESC', [contentId, ctx.orgId]),
      pool.query('SELECT event_type, channel, created_at FROM public.content_usage_logs WHERE content_id = $1 AND organization_id = $2', [contentId, ctx.orgId])
    ])

    if (!contentRes.rows[0]) return null
    const usage = usageRes.rows
    const summary = usage.reduce((acc: any, row: any) => {
      const k = row.event_type; acc[k] = (acc[k] || 0) + 1; return acc
    }, {})

    return {
      content: contentRes.rows[0] as ContentLibraryItem,
      versions: versionsRes.rows,
      usage_summary: summary,
    }
  } catch (err: any) { logDbError('getContentDetail error', err); return null }
}

export async function semanticSearchContent(params: { query: string; threshold?: number; limit?: number }) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return []

    const embedding = await embedText(params.query, 'content_ai')
    const r = await pool.query('SELECT * FROM match_content_library($1, $2, $3, $4)', [
      embedding, params.threshold ?? 0.2, params.limit ?? 12, ctx.orgId])
    return r.rows
  } catch (err: any) { logDbError('semanticSearchContent error', err); return [] }
}

export async function logContentUsage(input: {
  content_id: string; version?: number; channel: 'email' | 'whatsapp' | 'call' | 'ads' | 'other'
  event_type: 'executed' | 'opened' | 'clicked' | 'replied' | 'converted'
  context?: Record<string, unknown>; lead_id?: string; contact_id?: string; company_id?: string; metadata?: Record<string, unknown>
}) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return { error: 'No organization found' }

    await pool.query(
      `INSERT INTO public.content_usage_logs (organization_id, content_id, version, used_by, lead_id, contact_id, company_id, channel, event_type, context, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ctx.orgId, input.content_id, input.version ?? null, ctx.userId, input.lead_id ?? null,
       input.contact_id ?? null, input.company_id ?? null, input.channel, input.event_type,
       JSON.stringify(input.context ?? {}), JSON.stringify(input.metadata ?? {})])

    try {
      const itemRes = await pool.query(
        'SELECT performance_metrics FROM public.content_library WHERE id = $1 AND organization_id = $2 LIMIT 1',
        [input.content_id, ctx.orgId])
      const metrics = (itemRes.rows[0]?.performance_metrics || {}) as any
      metrics.usage_count = Number(metrics.usage_count || 0) + (input.event_type === 'executed' ? 1 : 0)
      metrics.opened = Number(metrics.opened || 0) + (input.event_type === 'opened' ? 1 : 0)
      metrics.replied = Number(metrics.replied || 0) + (input.event_type === 'replied' ? 1 : 0)
      metrics.converted = Number(metrics.converted || 0) + (input.event_type === 'converted' ? 1 : 0)
      await pool.query(
        'UPDATE public.content_library SET performance_metrics = $1, updated_at = $2 WHERE id = $3 AND organization_id = $4',
        [JSON.stringify(metrics), new Date().toISOString(), input.content_id, ctx.orgId])
    } catch {}

    revalidatePath('/content'); revalidatePath(`/content/${input.content_id}`)
    return { success: true }
  } catch (err: any) {
    logDbError('logContentUsage error', err)
    return { error: friendlyDbError('Content usage logs', err) }
  }
}

export async function generatePersonalizedContent(input: {
  content_id: string; variables: Record<string, string>; goal?: string; complexity?: 'fast' | 'pro'
}) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return { error: 'No organization found' }

    const r = await pool.query(
      'SELECT id, title, description, content_type, content_body, tags, funnel_stage, persona, industry, current_version FROM public.content_library WHERE id = $1 AND organization_id = $2 LIMIT 1',
      [input.content_id, ctx.orgId])
    const item = r.rows[0]
    if (!item) return { error: 'Content not found' }

    const bodyText = normalizeBodyText(item.content_body)
    const templated = renderTemplateVariables(bodyText, input.variables)
    const prompt = [
      `You are an expert sales/content operator. Generate personalized content based on a template.`,
      `Content type: ${item.content_type}`, `Title: ${item.title}`,
      item.description ? `Description: ${item.description}` : '',
      item.persona ? `Persona: ${item.persona}` : '',
      item.industry ? `Industry: ${item.industry}` : '',
      `Funnel stage: ${item.funnel_stage}`,
      input.goal ? `Goal: ${input.goal}` : '',
      `Template (already variable-filled):`, templated,
      `Return only the final content. No commentary.`,
    ].filter(Boolean).join('\n')

    const text = await generateText(prompt, 'content_ai')
    return { success: true, content: text, used_template_version: item.current_version }
  } catch (err: any) {
    logDbError('generatePersonalizedContent error', err)
    return { error: friendlyDbError('Content library', err) }
  }
}

export async function askContentAI(input: { content_id: string; question: string; mode?: 'flash' | 'pro' }) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return { error: 'No organization found' }

    const r = await pool.query(
      'SELECT id, title, description, content_type, content_body, tags, funnel_stage, persona, industry FROM public.content_library WHERE id = $1 AND organization_id = $2 LIMIT 1',
      [input.content_id, ctx.orgId])
    const item = r.rows[0]
    if (!item) return { error: 'Content not found' }

    const body = item.content_body || {}
    const extractedText = (typeof body?.extracted_text === 'string' ? body.extracted_text : '') || normalizeBodyText(body)
    const uploadedAssets = Array.isArray(body?.uploaded_assets) ? body.uploaded_assets : []
    const assetsSummary = uploadedAssets
      .map((a: any, idx: number) => `Asset ${idx + 1}: ${a?.name || 'file'} (${a?.mime_type || 'unknown'})\nSummary: ${a?.summary || ''}\nExtracted: ${a?.extracted_text || ''}`)
      .join('\n\n')

    const prompt = [
      'You are a content operations AI assistant for a CRM Content Library.',
      'Answer the user question ONLY using the provided content context and uploaded document context.',
      'If context is insufficient, say what is missing and suggest next action.',
      '', `Title: ${item.title}`,
      item.description ? `Description: ${item.description}` : '',
      `Type: ${item.content_type}`,
      item.persona ? `Persona: ${item.persona}` : '',
      item.industry ? `Industry: ${item.industry}` : '',
      `Funnel stage: ${item.funnel_stage}`, '',
      'Content context:', extractedText, '',
      assetsSummary ? `Uploaded assets context:\n${assetsSummary}` : '',
      '', `Question: ${input.question}`, '', 'Return concise, actionable answer.',
    ].filter(Boolean).join('\n')

    const answer = await generateText(prompt, 'content_ai')
    return { success: true, answer }
  } catch (err: any) {
    logDbError('askContentAI error', err)
    return { error: friendlyDbError('Content library', err) }
  }
}

export async function recommendContent(input: {
  tags?: string[]; persona?: string; industry?: string; funnel_stage?: FunnelStage; limit?: number
}) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return []

    const values: any[] = [ctx.orgId]
    const conditions: string[] = ['organization_id = $1', 'is_archived = false']

    if (input.persona) { values.push(input.persona); conditions.push(`persona = $${values.length}`) }
    if (input.industry) { values.push(input.industry); conditions.push(`industry = $${values.length}`) }
    if (input.funnel_stage) { values.push(input.funnel_stage); conditions.push(`funnel_stage = $${values.length}`) }
    if (input.tags?.length) { values.push(JSON.stringify(input.tags)); conditions.push(`tags @> $${values.length}`) }
    values.push(Math.max(24, input.limit ?? 8))

    const r = await pool.query(
      `SELECT id, title, description, content_type, tags, persona, industry, funnel_stage, performance_metrics, updated_at
       FROM public.content_library WHERE ${conditions.join(' AND ')} LIMIT $${values.length}`, values)

    const scored = r.rows.map((row: any) => {
      const m = row.performance_metrics || {}
      const score = Number(m.converted || 0) * 5 + Number(m.replied || 0) * 2 + Number(m.usage_count || 0)
      return { ...row, score }
    }).sort((a: any, b: any) => b.score - a.score)

    return scored.slice(0, input.limit ?? 8)
  } catch (err: any) { logDbError('recommendContent error', err); return [] }
}

// ─── Playbooks ─────────────────────────────────────────────────────────────────

export async function createPlaybook(input: {
  title: string; description?: string; tags?: string[]
  funnel_stage: FunnelStage; persona?: string; industry?: string
}) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return { error: 'No organization found' }

    const r = await pool.query(
      `INSERT INTO public.playbooks (organization_id, title, description, tags, funnel_stage, persona, industry, created_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [ctx.orgId, input.title.trim(), input.description?.trim() || null, JSON.stringify(input.tags ?? []),
       input.funnel_stage, input.persona || null, input.industry || null, ctx.userId, new Date().toISOString()])

    revalidatePath('/content/playbooks')
    return { success: true, data: r.rows[0] }
  } catch (err: any) {
    logDbError('createPlaybook error', err)
    return { error: friendlyDbError('Playbooks', err) }
  }
}

export async function getPlaybooks() {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return []
    const r = await pool.query(
      'SELECT * FROM public.playbooks WHERE organization_id = $1 ORDER BY updated_at DESC', [ctx.orgId])
    return r.rows
  } catch (err: any) { logDbError('getPlaybooks error', err); return [] }
}

export async function getPlaybookDetail(playbookId: string) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return null
    const [pbRes, stepsRes] = await Promise.all([
      pool.query('SELECT * FROM public.playbooks WHERE id = $1 AND organization_id = $2 LIMIT 1', [playbookId, ctx.orgId]),
      pool.query('SELECT * FROM public.playbook_steps WHERE playbook_id = $1 AND organization_id = $2 ORDER BY step_order ASC', [playbookId, ctx.orgId])
    ])
    if (!pbRes.rows[0]) return null
    return { playbook: pbRes.rows[0], steps: stepsRes.rows }
  } catch (err: any) { logDbError('getPlaybookDetail error', err); return null }
}

export async function upsertPlaybookSteps(playbookId: string, steps: Array<{
  id?: string; step_order: number; step_type: 'send_email' | 'send_whatsapp' | 'wait' | 'assign_task'
  title: string; config: Record<string, unknown>; content_id?: string | null
}>) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return { error: 'No organization found' }

    await pool.query(
      'DELETE FROM public.playbook_steps WHERE playbook_id = $1 AND organization_id = $2', [playbookId, ctx.orgId])

    for (const s of steps) {
      await pool.query(
        `INSERT INTO public.playbook_steps (organization_id, playbook_id, step_order, step_type, title, config, content_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ctx.orgId, playbookId, s.step_order, s.step_type, s.title, JSON.stringify(s.config ?? {}), s.content_id ?? null, new Date().toISOString()])
    }

    await pool.query(
      'UPDATE public.playbooks SET updated_at = $1 WHERE id = $2 AND organization_id = $3',
      [new Date().toISOString(), playbookId, ctx.orgId])

    revalidatePath(`/content/playbooks/${playbookId}`)
    return { success: true }
  } catch (err: any) {
    logDbError('upsertPlaybookSteps error', err)
    return { error: friendlyDbError('Playbook steps', err) }
  }
}

export async function runPlaybookManually(input: {
  playbook_id: string; lead_id?: string; contact_id?: string; company_id?: string; variables?: Record<string, string>
}) {
  try {
    const ctx = await getOrgContext()
    if (!ctx) return { error: 'No organization found' }

    const detail = await getPlaybookDetail(input.playbook_id)
    if (!detail) return { error: 'Playbook not found' }

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
        playbook: detail.playbook, steps: detail.steps,
        target: { lead_id: input.lead_id, contact_id: input.contact_id, company_id: input.company_id },
        variables: input.variables || {},
      }
    }
  } catch (err: any) { return { error: err.message } }
}
