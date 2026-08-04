import pool from '@/lib/db'
import type { TrackingDomain, TrackingDomainStatus } from '@/types/deliverability'

type TrackingDomainRow = {
  id: string
  organization_id: string
  domain_id: string
  tracking_domain: string
  cname_target: string | null
  status: TrackingDomainStatus
  last_verified_at: string | null
  expires_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapTrackingDomainRow(row: TrackingDomainRow): TrackingDomain {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    trackingDomain: row.tracking_domain,
    cnameTarget: row.cname_target,
    status: row.status,
    lastVerifiedAt: row.last_verified_at,
    expiresAt: row.expires_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findTrackingDomainsByOrg(orgId: string): Promise<TrackingDomain[]> {
  const result = await pool.query<TrackingDomainRow>(
    `SELECT * FROM public.mail_tracking_domains
     WHERE organization_id = $1
     ORDER BY tracking_domain ASC`,
    [orgId]
  )
  return result.rows.map(mapTrackingDomainRow)
}

export async function findTrackingDomainsByDomain(domainId: string): Promise<TrackingDomain[]> {
  const result = await pool.query<TrackingDomainRow>(
    `SELECT * FROM public.mail_tracking_domains
     WHERE domain_id = $1
     ORDER BY tracking_domain ASC`,
    [domainId]
  )
  return result.rows.map(mapTrackingDomainRow)
}

export async function findTrackingDomainById(id: string, orgId?: string): Promise<TrackingDomain | null> {
  const result = orgId
    ? await pool.query<TrackingDomainRow>(
        `SELECT * FROM public.mail_tracking_domains WHERE id = $1 AND organization_id = $2`,
        [id, orgId]
      )
    : await pool.query<TrackingDomainRow>(
        `SELECT * FROM public.mail_tracking_domains WHERE id = $1`,
        [id]
      )
  return result.rows[0] ? mapTrackingDomainRow(result.rows[0]) : null
}

export async function findTrackingDomainByNameGlobal(trackingDomain: string): Promise<TrackingDomain | null> {
  const result = await pool.query<TrackingDomainRow>(
    `SELECT * FROM public.mail_tracking_domains WHERE LOWER(tracking_domain) = LOWER($1) LIMIT 1`,
    [trackingDomain]
  )
  return result.rows[0] ? mapTrackingDomainRow(result.rows[0]) : null
}

export async function insertTrackingDomain(data: {
  organizationId: string
  domainId: string
  trackingDomain: string
  cnameTarget?: string | null
}): Promise<TrackingDomain> {
  const result = await pool.query<TrackingDomainRow>(
    `INSERT INTO public.mail_tracking_domains
      (organization_id, domain_id, tracking_domain, cname_target)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.organizationId, data.domainId, data.trackingDomain, data.cnameTarget ?? null]
  )
  return mapTrackingDomainRow(result.rows[0])
}

export async function updateTrackingDomain(id: string, data: {
  status?: TrackingDomainStatus
  cnameTarget?: string | null
  lastVerifiedAt?: string
}, orgId?: string): Promise<TrackingDomain | null> {
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

  if (orgId) {
    values.push(id, orgId)
    const result = await pool.query<TrackingDomainRow>(
      `UPDATE public.mail_tracking_domains
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
       RETURNING *`,
      values
    )
    return result.rows[0] ? mapTrackingDomainRow(result.rows[0]) : null
  }

  values.push(id)
  const result = await pool.query<TrackingDomainRow>(
    `UPDATE public.mail_tracking_domains
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapTrackingDomainRow(result.rows[0]) : null
}

export async function deleteTrackingDomain(id: string, orgId?: string): Promise<boolean> {
  const result = orgId
    ? await pool.query(
        `DELETE FROM public.mail_tracking_domains WHERE id = $1 AND organization_id = $2`,
        [id, orgId]
      )
    : await pool.query(
        `DELETE FROM public.mail_tracking_domains WHERE id = $1`,
        [id]
      )
  return (result.rowCount ?? 0) > 0
}
