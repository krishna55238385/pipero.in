import pool from '@/lib/db'
import type { CampaignLabel } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignLabelRow = {
  id: string
  organization_id: string
  name: string
  color: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignLabelRow): CampaignLabel {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findLabelById(id: string, orgId: string): Promise<CampaignLabel | null> {
  const result = await pool.query<CampaignLabelRow>(
    `SELECT * FROM public.campaign_labels WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findLabelsByOrg(orgId: string): Promise<CampaignLabel[]> {
  const result = await pool.query<CampaignLabelRow>(
    `SELECT * FROM public.campaign_labels WHERE organization_id = $1 ORDER BY name ASC`,
    [orgId]
  )
  return result.rows.map(mapRow)
}

export async function insertLabel(data: {
  organizationId: string
  name: string
  color?: string
  metadata?: Record<string, unknown>
}): Promise<CampaignLabel> {
  const result = await pool.query<CampaignLabelRow>(
    `INSERT INTO public.campaign_labels (organization_id, name, color, metadata)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [
      data.organizationId,
      data.name,
      data.color ?? '#8b5cf6',
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateLabel(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<CampaignLabel | null> {
  const fieldMap: Record<string, string> = {
    name: 'name', color: 'color', metadata: 'metadata',
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
    return findLabelById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<CampaignLabelRow>(
    `UPDATE public.campaign_labels SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function deleteLabel(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.campaign_labels WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}
