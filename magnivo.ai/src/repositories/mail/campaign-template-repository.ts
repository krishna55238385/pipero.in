import pool from '@/lib/db'
import type { CampaignTemplate } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignTemplateRow = {
  id: string
  organization_id: string
  name: string
  description: string
  category: string
  subject: string
  body_html: string
  body_text: string
  preview_text: string
  from_name: string
  from_email: string
  settings: Record<string, unknown>
  is_system: boolean
  use_count: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignTemplateRow): CampaignTemplate {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    category: row.category,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    previewText: row.preview_text,
    fromName: row.from_name,
    fromEmail: row.from_email,
    settings: row.settings || {},
    isSystem: row.is_system,
    useCount: row.use_count,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findTemplateById(id: string, orgId: string): Promise<CampaignTemplate | null> {
  const result = await pool.query<CampaignTemplateRow>(
    `SELECT * FROM public.campaign_templates WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findTemplatesByOrg(orgId: string): Promise<CampaignTemplate[]> {
  const result = await pool.query<CampaignTemplateRow>(
    `SELECT * FROM public.campaign_templates WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name ASC`,
    [orgId]
  )
  return result.rows.map(mapRow)
}

export async function insertTemplate(data: {
  organizationId: string
  name: string
  description?: string
  category?: string
  subject?: string
  bodyHtml?: string
  bodyText?: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  settings?: Record<string, unknown>
  isSystem?: boolean
  metadata?: Record<string, unknown>
}): Promise<CampaignTemplate> {
  const result = await pool.query<CampaignTemplateRow>(
    `INSERT INTO public.campaign_templates
      (organization_id, name, description, category, subject, body_html, body_text,
       preview_text, from_name, from_email, settings, is_system, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      data.organizationId,
      data.name,
      data.description ?? '',
      data.category ?? 'general',
      data.subject ?? '',
      data.bodyHtml ?? '',
      data.bodyText ?? '',
      data.previewText ?? '',
      data.fromName ?? '',
      data.fromEmail ?? '',
      JSON.stringify(data.settings ?? {}),
      data.isSystem ?? false,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateTemplate(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<CampaignTemplate | null> {
  const fieldMap: Record<string, string> = {
    name: 'name', description: 'description', category: 'category',
    subject: 'subject', bodyHtml: 'body_html', bodyText: 'body_text',
    previewText: 'preview_text', fromName: 'from_name', fromEmail: 'from_email',
    settings: 'settings', metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = data[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(
        key === 'metadata' || key === 'settings' ? JSON.stringify(val) : val
      )
    }
  }

  if (setClauses.length === 0) {
    return findTemplateById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<CampaignTemplateRow>(
    `UPDATE public.campaign_templates SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function softDeleteTemplate(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.campaign_templates SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function incrementTemplateUseCount(id: string): Promise<void> {
  await pool.query(
    `UPDATE public.campaign_templates SET use_count = use_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [id]
  )
}
