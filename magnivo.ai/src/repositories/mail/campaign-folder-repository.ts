import pool from '@/lib/db'
import type { CampaignFolder } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignFolderRow = {
  id: string
  organization_id: string
  name: string
  description: string
  parent_id: string | null
  sort_order: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignFolderRow): CampaignFolder {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findFolderById(id: string, orgId: string): Promise<CampaignFolder | null> {
  const result = await pool.query<CampaignFolderRow>(
    `SELECT * FROM public.campaign_folders WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findFoldersByOrg(orgId: string): Promise<CampaignFolder[]> {
  const result = await pool.query<CampaignFolderRow>(
    `SELECT * FROM public.campaign_folders WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC`,
    [orgId]
  )
  return result.rows.map(mapRow)
}

export async function insertFolder(data: {
  organizationId: string
  name: string
  description?: string
  parentId?: string | null
  sortOrder?: number
  metadata?: Record<string, unknown>
}): Promise<CampaignFolder> {
  const result = await pool.query<CampaignFolderRow>(
    `INSERT INTO public.campaign_folders
      (organization_id, name, description, parent_id, sort_order, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      data.organizationId,
      data.name,
      data.description ?? '',
      data.parentId ?? null,
      data.sortOrder ?? 0,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateFolder(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<CampaignFolder | null> {
  const fieldMap: Record<string, string> = {
    name: 'name', description: 'description', parentId: 'parent_id',
    sortOrder: 'sort_order', metadata: 'metadata',
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
    return findFolderById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<CampaignFolderRow>(
    `UPDATE public.campaign_folders SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function softDeleteFolder(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.campaign_folders SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function countCampaignsInFolder(folderId: string, orgId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.campaigns
     WHERE folder_id = $1 AND organization_id = $2 AND is_deleted = FALSE`,
    [folderId, orgId]
  )
  return result.rows[0]?.count ?? 0
}
