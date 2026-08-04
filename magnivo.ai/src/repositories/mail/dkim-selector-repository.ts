import pool from '@/lib/db'
import type { DkimSelector, DkimSelectorStatus } from '@/types/deliverability'

type DkimSelectorRow = {
  id: string
  organization_id: string
  domain_id: string
  selector: string
  status: DkimSelectorStatus
  public_key: string | null
  key_length: number | null
  last_verified_at: string | null
  expires_at: string | null
  rotated_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapDkimSelectorRow(row: DkimSelectorRow): DkimSelector {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    selector: row.selector,
    status: row.status,
    publicKey: row.public_key,
    keyLength: row.key_length,
    lastVerifiedAt: row.last_verified_at,
    expiresAt: row.expires_at,
    rotatedAt: row.rotated_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findSelectorsByOrg(orgId: string): Promise<DkimSelector[]> {
  const result = await pool.query<DkimSelectorRow>(
    `SELECT * FROM public.mail_dkim_selectors
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapDkimSelectorRow)
}

export async function findSelectorsByDomain(domainId: string): Promise<DkimSelector[]> {
  const result = await pool.query<DkimSelectorRow>(
    `SELECT * FROM public.mail_dkim_selectors
     WHERE domain_id = $1
     ORDER BY status ASC, created_at DESC`,
    [domainId]
  )
  return result.rows.map(mapDkimSelectorRow)
}

export async function findActiveSelector(domainId: string): Promise<DkimSelector | null> {
  const result = await pool.query<DkimSelectorRow>(
    `SELECT * FROM public.mail_dkim_selectors
     WHERE domain_id = $1 AND status = 'active'
     LIMIT 1`,
    [domainId]
  )
  return result.rows[0] ? mapDkimSelectorRow(result.rows[0]) : null
}

export async function findSelectorById(id: string, orgId: string): Promise<DkimSelector | null> {
  const result = await pool.query<DkimSelectorRow>(
    `SELECT * FROM public.mail_dkim_selectors
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapDkimSelectorRow(result.rows[0]) : null
}

export async function findSelectorByName(domainId: string, selector: string): Promise<DkimSelector | null> {
  const result = await pool.query<DkimSelectorRow>(
    `SELECT * FROM public.mail_dkim_selectors
     WHERE domain_id = $1 AND selector = $2`,
    [domainId, selector]
  )
  return result.rows[0] ? mapDkimSelectorRow(result.rows[0]) : null
}

export async function insertSelector(data: {
  organizationId: string
  domainId: string
  selector: string
  publicKey?: string
  keyLength?: number
}): Promise<DkimSelector> {
  const result = await pool.query<DkimSelectorRow>(
    `INSERT INTO public.mail_dkim_selectors
      (organization_id, domain_id, selector, public_key, key_length)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.organizationId, data.domainId, data.selector, data.publicKey ?? null, data.keyLength ?? null]
  )
  return mapDkimSelectorRow(result.rows[0])
}

export async function updateSelector(id: string, orgId: string, data: {
  status?: DkimSelectorStatus
  publicKey?: string | null
  keyLength?: number | null
  lastVerifiedAt?: string
  rotatedAt?: string
}): Promise<DkimSelector | null> {
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

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<DkimSelectorRow>(
    `UPDATE public.mail_dkim_selectors
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapDkimSelectorRow(result.rows[0]) : null
}

export async function deleteSelector(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_dkim_selectors
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function deactivateAllSelectors(domainId: string): Promise<void> {
  await pool.query(
    `UPDATE public.mail_dkim_selectors SET status = 'inactive', updated_at = NOW()
     WHERE domain_id = $1 AND status = 'active'`,
    [domainId]
  )
}

export async function insertSelectorHistory(data: {
  selectorId: string
  domainId: string
  organizationId: string
  action: string
  previousSelector?: string
  newSelector?: string
  keyLength?: number
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_dkim_selector_history
      (selector_id, domain_id, organization_id, action, previous_selector, new_selector, key_length)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [data.selectorId, data.domainId, data.organizationId, data.action, data.previousSelector ?? null, data.newSelector ?? null, data.keyLength ?? null]
  )
}

export async function getSelectorHistory(selectorId: string, limit: number = 50): Promise<unknown[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_dkim_selector_history
     WHERE selector_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [selectorId, limit]
  )
  return result.rows
}
