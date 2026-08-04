import pool from '@/lib/db'
import type { CampaignVariant, VariantType } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignVariantRow = {
  id: string
  campaign_id: string
  organization_id: string
  variant_type: string
  name: string
  subject: string
  body_html: string
  body_text: string
  percentage: number
  is_winner: boolean
  sent_count: number
  open_count: number
  click_count: number
  reply_count: number
  bounce_count: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignVariantRow): CampaignVariant {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    variantType: row.variant_type as VariantType,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    percentage: row.percentage,
    isWinner: row.is_winner,
    sentCount: row.sent_count,
    openCount: row.open_count,
    clickCount: row.click_count,
    replyCount: row.reply_count,
    bounceCount: row.bounce_count,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findVariantsByCampaignId(campaignId: string, orgId: string): Promise<CampaignVariant[]> {
  const result = await pool.query<CampaignVariantRow>(
    `SELECT * FROM public.campaign_variants
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY variant_type ASC`,
    [campaignId, orgId]
  )
  return result.rows.map(mapRow)
}

export async function findVariantById(id: string, orgId: string): Promise<CampaignVariant | null> {
  const result = await pool.query<CampaignVariantRow>(
    `SELECT * FROM public.campaign_variants WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function insertVariant(data: {
  campaignId: string
  organizationId: string
  variantType: string
  name?: string
  subject?: string
  bodyHtml?: string
  bodyText?: string
  percentage?: number
  isWinner?: boolean
  metadata?: Record<string, unknown>
}): Promise<CampaignVariant> {
  const result = await pool.query<CampaignVariantRow>(
    `INSERT INTO public.campaign_variants
      (campaign_id, organization_id, variant_type, name, subject, body_html,
       body_text, percentage, is_winner, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      data.campaignId,
      data.organizationId,
      data.variantType,
      data.name ?? '',
      data.subject ?? '',
      data.bodyHtml ?? '',
      data.bodyText ?? '',
      data.percentage ?? 0,
      data.isWinner ?? false,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateVariant(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<CampaignVariant | null> {
  const fieldMap: Record<string, string> = {
    variantType: 'variant_type', name: 'name', subject: 'subject',
    bodyHtml: 'body_html', bodyText: 'body_text',
    percentage: 'percentage', isWinner: 'is_winner',
    sentCount: 'sent_count', openCount: 'open_count',
    clickCount: 'click_count', replyCount: 'reply_count',
    bounceCount: 'bounce_count', metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = data[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(key === 'metadata' ? JSON.stringify(val) : val)
    }
  }

  if (setClauses.length === 0) {
    return findVariantById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<CampaignVariantRow>(
    `UPDATE public.campaign_variants SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function deleteVariant(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.campaign_variants WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}
