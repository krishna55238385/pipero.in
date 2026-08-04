import pool from '@/lib/db'
import type { SndsDomain, SndsMetrics, SndsConnectionStatus, SndsDashboardStats } from '@/types/deliverability'

type SndsDomainRow = {
  id: string
  organization_id: string
  domain_id: string | null
  snds_domain: string
  connection_status: SndsConnectionStatus
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  last_sync_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapSndsDomainRow(row: SndsDomainRow): SndsDomain {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    sndsDomain: row.snds_domain,
    connectionStatus: row.connection_status,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    lastSyncAt: row.last_sync_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findSndsDomainsByOrg(orgId: string): Promise<SndsDomain[]> {
  const result = await pool.query<SndsDomainRow>(
    `SELECT * FROM public.mail_snds_domains
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapSndsDomainRow)
}

export async function findSndsDomainById(id: string, orgId: string): Promise<SndsDomain | null> {
  const result = await pool.query<SndsDomainRow>(
    `SELECT * FROM public.mail_snds_domains
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapSndsDomainRow(result.rows[0]) : null
}

export async function findSndsDomainByName(orgId: string, domain: string): Promise<SndsDomain | null> {
  const result = await pool.query<SndsDomainRow>(
    `SELECT * FROM public.mail_snds_domains
     WHERE organization_id = $1 AND LOWER(snds_domain) = LOWER($2)`,
    [orgId, domain]
  )
  return result.rows[0] ? mapSndsDomainRow(result.rows[0]) : null
}

export async function insertSndsDomain(data: {
  organizationId: string
  domainId?: string
  sndsDomain: string
}): Promise<SndsDomain> {
  const result = await pool.query<SndsDomainRow>(
    `INSERT INTO public.mail_snds_domains
      (organization_id, domain_id, snds_domain)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.organizationId, data.domainId ?? null, data.sndsDomain]
  )
  return mapSndsDomainRow(result.rows[0])
}

export async function updateSndsDomain(id: string, orgId: string, data: {
  connectionStatus?: SndsConnectionStatus
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: string | null
  lastSyncAt?: string
}): Promise<SndsDomain | null> {
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

  const result = await pool.query<SndsDomainRow>(
    `UPDATE public.mail_snds_domains
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapSndsDomainRow(result.rows[0]) : null
}

export async function deleteSndsDomain(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_snds_domains
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function insertSndsMetrics(data: {
  sndsDomainId: string
  organizationId: string
  spamComplaintRate: number
  trapHits: number
  ipReputation?: string
  malwareCount: number
  networkSpamCount: number
  date: string
}): Promise<SndsMetrics> {
  const result = await pool.query(
    `INSERT INTO public.mail_snds_metrics
      (snds_domain_id, organization_id, spam_complaint_rate, trap_hits, ip_reputation, malware_count, network_spam_count, date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (snds_domain_id, date) DO UPDATE SET
       spam_complaint_rate = EXCLUDED.spam_complaint_rate,
       trap_hits = EXCLUDED.trap_hits,
       ip_reputation = EXCLUDED.ip_reputation,
       malware_count = EXCLUDED.malware_count,
       network_spam_count = EXCLUDED.network_spam_count
     RETURNING *`,
    [data.sndsDomainId, data.organizationId, data.spamComplaintRate, data.trapHits, data.ipReputation ?? null, data.malwareCount, data.networkSpamCount, data.date]
  )
  return result.rows[0]
}

export async function getSndsMetricsHistory(sndsDomainId: string, limit: number = 30): Promise<SndsMetrics[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_snds_metrics
     WHERE snds_domain_id = $1
     ORDER BY date DESC
     LIMIT $2`,
    [sndsDomainId, limit]
  )
  return result.rows
}

export async function getSndsDashboardStats(orgId: string): Promise<SndsDashboardStats> {
  const connectedResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_snds_domains
     WHERE organization_id = $1 AND connection_status = 'connected'`,
    [orgId]
  )
  const lastSyncResult = await pool.query(
    `SELECT MAX(last_sync_at) AS last_sync FROM public.mail_snds_domains
     WHERE organization_id = $1`,
    [orgId]
  )
  const avgComplaintResult = await pool.query(
    `SELECT ROUND(AVG(m.spam_complaint_rate)::numeric, 4) AS avg_rate
     FROM public.mail_snds_metrics m
     JOIN public.mail_snds_domains d ON m.snds_domain_id = d.id
     WHERE d.organization_id = $1`,
    [orgId]
  )
  const trapHitsResult = await pool.query(
    `SELECT COALESCE(SUM(m.trap_hits), 0)::int AS total
     FROM public.mail_snds_metrics m
     JOIN public.mail_snds_domains d ON m.snds_domain_id = d.id
     WHERE d.organization_id = $1`,
    [orgId]
  )
  const recentResult = await pool.query(
    `SELECT m.* FROM public.mail_snds_metrics m
     JOIN public.mail_snds_domains d ON m.snds_domain_id = d.id
     WHERE d.organization_id = $1
     ORDER BY m.date DESC
     LIMIT 10`,
    [orgId]
  )

  return {
    domainsConnected: connectedResult.rows[0]?.count ?? 0,
    lastSyncAt: lastSyncResult.rows[0]?.last_sync ?? null,
    avgComplaintRate: Number(avgComplaintResult.rows[0]?.avg_rate ?? 0),
    totalTrapHits: trapHitsResult.rows[0]?.total ?? 0,
    recentMetrics: recentResult.rows,
  }
}
