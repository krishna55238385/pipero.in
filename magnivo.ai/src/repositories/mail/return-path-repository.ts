import pool from '@/lib/db'
import type { ReturnPath, ReturnPathAuditEntry, ReturnPathStatus } from '@/types/deliverability'

type ReturnPathRow = {
  id: string
  organization_id: string
  domain_id: string
  return_path_domain: string
  cname_target: string | null
  status: ReturnPathStatus
  is_default: boolean
  last_verified_at: string | null
  expires_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapReturnPathRow(row: ReturnPathRow): ReturnPath {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    returnPathDomain: row.return_path_domain,
    cnameTarget: row.cname_target,
    status: row.status,
    isDefault: row.is_default,
    lastVerifiedAt: row.last_verified_at,
    expiresAt: row.expires_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findReturnPathsByOrg(orgId: string): Promise<ReturnPath[]> {
  const result = await pool.query<ReturnPathRow>(
    `SELECT * FROM public.mail_return_paths
     WHERE organization_id = $1
     ORDER BY is_default DESC, return_path_domain ASC`,
    [orgId]
  )
  return result.rows.map(mapReturnPathRow)
}

export async function findReturnPathsByDomain(domainId: string): Promise<ReturnPath[]> {
  const result = await pool.query<ReturnPathRow>(
    `SELECT * FROM public.mail_return_paths
     WHERE domain_id = $1
     ORDER BY is_default DESC, return_path_domain ASC`,
    [domainId]
  )
  return result.rows.map(mapReturnPathRow)
}

export async function findReturnPathById(id: string, orgId: string): Promise<ReturnPath | null> {
  const result = await pool.query<ReturnPathRow>(
    `SELECT * FROM public.mail_return_paths
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapReturnPathRow(result.rows[0]) : null
}

export async function findDefaultReturnPath(domainId: string): Promise<ReturnPath | null> {
  const result = await pool.query<ReturnPathRow>(
    `SELECT * FROM public.mail_return_paths
     WHERE domain_id = $1 AND is_default = TRUE
     LIMIT 1`,
    [domainId]
  )
  return result.rows[0] ? mapReturnPathRow(result.rows[0]) : null
}

export async function insertReturnPath(data: {
  organizationId: string
  domainId: string
  returnPathDomain: string
  cnameTarget?: string
  isDefault?: boolean
}): Promise<ReturnPath> {
  if (data.isDefault) {
    await pool.query(
      `UPDATE public.mail_return_paths SET is_default = FALSE WHERE domain_id = $1`,
      [data.domainId]
    )
  }
  const result = await pool.query<ReturnPathRow>(
    `INSERT INTO public.mail_return_paths
      (organization_id, domain_id, return_path_domain, cname_target, is_default)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.organizationId, data.domainId, data.returnPathDomain, data.cnameTarget ?? null, data.isDefault ?? false]
  )
  return mapReturnPathRow(result.rows[0])
}

export async function updateReturnPath(id: string, orgId: string, data: {
  status?: ReturnPathStatus
  cnameTarget?: string | null
  isDefault?: boolean
  lastVerifiedAt?: string
}): Promise<ReturnPath | null> {
  const setClauses: string[] = []
  const values: (string | number | boolean | null)[] = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      setClauses.push(`${dbKey} = $${paramIndex}`)
      values.push(value as string | number | boolean | null)
      paramIndex++
    }
  }

  if (setClauses.length === 0) return null

  if (data.isDefault) {
    await pool.query(
      `UPDATE public.mail_return_paths SET is_default = FALSE WHERE domain_id = (SELECT domain_id FROM public.mail_return_paths WHERE id = $1)`,
      [id]
    )
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<ReturnPathRow>(
    `UPDATE public.mail_return_paths
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapReturnPathRow(result.rows[0]) : null
}

export async function deleteReturnPath(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_return_paths
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function insertAuditEntry(data: {
  returnPathId: string
  organizationId: string
  action: string
  actorUserId?: string
  actorEmail?: string
  previousValue?: string | null
  newValue?: string | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_return_path_audit
      (return_path_id, organization_id, action, actor_user_id, actor_email, previous_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [data.returnPathId, data.organizationId, data.action, data.actorUserId ?? null, data.actorEmail ?? null, data.previousValue ?? null, data.newValue ?? null]
  )
}

export async function getAuditHistory(returnPathId: string, limit: number = 50): Promise<ReturnPathAuditEntry[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_return_path_audit
     WHERE return_path_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [returnPathId, limit]
  )
  return result.rows
}
