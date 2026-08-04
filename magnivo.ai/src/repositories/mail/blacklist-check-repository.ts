import pool from '@/lib/db'
import type { BlacklistCheck, BlacklistName, BlacklistStatus, BlacklistOverview, BlacklistDashboardStats } from '@/types/deliverability'

type BlacklistCheckRow = {
  id: string
  organization_id: string
  domain_id: string
  blacklist_name: BlacklistName
  status: BlacklistStatus
  ip: string | null
  listed_at: string | null
  delisted_at: string | null
  check_result: string | null
  duration_ms: number | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapBlacklistCheckRow(row: BlacklistCheckRow): BlacklistCheck {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    blacklistName: row.blacklist_name,
    status: row.status,
    ip: row.ip,
    listedAt: row.listed_at,
    delistedAt: row.delisted_at,
    checkResult: row.check_result,
    durationMs: row.duration_ms,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findChecksByOrg(orgId: string): Promise<BlacklistCheck[]> {
  const result = await pool.query<BlacklistCheckRow>(
    `SELECT * FROM public.mail_blacklist_checks
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapBlacklistCheckRow)
}

export async function findChecksByDomain(domainId: string): Promise<BlacklistCheck[]> {
  const result = await pool.query<BlacklistCheckRow>(
    `SELECT * FROM public.mail_blacklist_checks
     WHERE domain_id = $1
     ORDER BY blacklist_name ASC, created_at DESC`,
    [domainId]
  )
  return result.rows.map(mapBlacklistCheckRow)
}

export async function findLatestCheckByBlacklist(domainId: string, blacklistName: BlacklistName): Promise<BlacklistCheck | null> {
  const result = await pool.query<BlacklistCheckRow>(
    `SELECT * FROM public.mail_blacklist_checks
     WHERE domain_id = $1 AND blacklist_name = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [domainId, blacklistName]
  )
  return result.rows[0] ? mapBlacklistCheckRow(result.rows[0]) : null
}

export async function findListedChecks(orgId: string): Promise<BlacklistCheck[]> {
  const result = await pool.query<BlacklistCheckRow>(
    `SELECT * FROM public.mail_blacklist_checks
     WHERE organization_id = $1 AND status = 'listed'
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapBlacklistCheckRow)
}

export async function insertCheck(data: {
  organizationId: string
  domainId: string
  blacklistName: BlacklistName
  status: BlacklistStatus
  ip?: string
  checkResult?: string
  durationMs?: number
}): Promise<BlacklistCheck> {
  const result = await pool.query<BlacklistCheckRow>(
    `INSERT INTO public.mail_blacklist_checks
      (organization_id, domain_id, blacklist_name, status, ip, check_result, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [data.organizationId, data.domainId, data.blacklistName, data.status, data.ip ?? null, data.checkResult ?? null, data.durationMs ?? null]
  )
  return mapBlacklistCheckRow(result.rows[0])
}

export async function updateCheck(id: string, data: {
  status?: BlacklistStatus
  delistedAt?: string
  checkResult?: string
  durationMs?: number
}): Promise<BlacklistCheck | null> {
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
  values.push(id)

  const result = await pool.query<BlacklistCheckRow>(
    `UPDATE public.mail_blacklist_checks
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapBlacklistCheckRow(result.rows[0]) : null
}

export async function getBlacklistOverview(domainId: string): Promise<BlacklistOverview> {
  const domainResult = await pool.query(
    `SELECT domain, organization_id FROM public.mail_deliverability_domains WHERE id = $1`,
    [domainId]
  )
  const domain = domainResult.rows[0]?.domain ?? ''
  const orgId = domainResult.rows[0]?.organization_id ?? ''

  const checks = await findChecksByDomain(domainId)

  return {
    domainId,
    domain,
    totalChecks: checks.length,
    listedCount: checks.filter(c => c.status === 'listed').length,
    cleanCount: checks.filter(c => c.status === 'clean').length,
    lastCheckedAt: checks.length > 0 ? checks[0].createdAt : null,
    checks,
  }
}

export async function getBlacklistDashboardStats(orgId: string): Promise<BlacklistDashboardStats> {
  const domainCount = await pool.query(
    `SELECT COUNT(DISTINCT domain_id)::int AS count
     FROM public.mail_blacklist_checks WHERE organization_id = $1`,
    [orgId]
  )

  const listedCount = await pool.query(
    `SELECT COUNT(DISTINCT domain_id)::int AS count
     FROM public.mail_blacklist_checks
     WHERE organization_id = $1 AND status = 'listed'`,
    [orgId]
  )

  const unknownCount = await pool.query(
    `SELECT COUNT(DISTINCT domain_id)::int AS count
     FROM public.mail_blacklist_checks
     WHERE organization_id = $1 AND status = 'unknown'`,
    [orgId]
  )

  const recentListings = await pool.query<BlacklistCheckRow>(
    `SELECT * FROM public.mail_blacklist_checks
     WHERE organization_id = $1 AND status = 'listed'
     ORDER BY created_at DESC
     LIMIT 10`,
    [orgId]
  )

  const total = domainCount.rows[0]?.count ?? 0
  const listed = listedCount.rows[0]?.count ?? 0
  const unknown = unknownCount.rows[0]?.count ?? 0

  return {
    totalDomainsChecked: total,
    cleanDomains: total - listed - unknown,
    listedDomains: listed,
    unknownDomains: unknown,
    recentListings: recentListings.rows.map(mapBlacklistCheckRow),
  }
}
