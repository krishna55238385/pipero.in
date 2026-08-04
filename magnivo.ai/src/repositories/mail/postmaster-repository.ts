import pool from '@/lib/db'
import type { PostmasterDomain, PostmasterMetrics, PostmasterConnectionStatus, PostmasterDomainStatus, PostmasterDashboardStats } from '@/types/deliverability'

type PostmasterDomainRow = {
  id: string
  organization_id: string
  domain_id: string | null
  postmaster_domain: string
  connection_status: PostmasterConnectionStatus
  domain_verification_status: PostmasterDomainStatus
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  last_sync_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapPostmasterDomainRow(row: PostmasterDomainRow): PostmasterDomain {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    postmasterDomain: row.postmaster_domain,
    connectionStatus: row.connection_status,
    domainVerificationStatus: row.domain_verification_status,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    lastSyncAt: row.last_sync_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findPostmasterDomainsByOrg(orgId: string): Promise<PostmasterDomain[]> {
  const result = await pool.query<PostmasterDomainRow>(
    `SELECT * FROM public.mail_postmaster_domains
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapPostmasterDomainRow)
}

export async function findPostmasterDomainById(id: string, orgId: string): Promise<PostmasterDomain | null> {
  const result = await pool.query<PostmasterDomainRow>(
    `SELECT * FROM public.mail_postmaster_domains
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapPostmasterDomainRow(result.rows[0]) : null
}

export async function findPostmasterDomainByName(orgId: string, domain: string): Promise<PostmasterDomain | null> {
  const result = await pool.query<PostmasterDomainRow>(
    `SELECT * FROM public.mail_postmaster_domains
     WHERE organization_id = $1 AND LOWER(postmaster_domain) = LOWER($2)`,
    [orgId, domain]
  )
  return result.rows[0] ? mapPostmasterDomainRow(result.rows[0]) : null
}

export async function insertPostmasterDomain(data: {
  organizationId: string
  domainId?: string
  postmasterDomain: string
}): Promise<PostmasterDomain> {
  const result = await pool.query<PostmasterDomainRow>(
    `INSERT INTO public.mail_postmaster_domains
      (organization_id, domain_id, postmaster_domain)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.organizationId, data.domainId ?? null, data.postmasterDomain]
  )
  return mapPostmasterDomainRow(result.rows[0])
}

export async function updatePostmasterDomain(id: string, orgId: string, data: {
  connectionStatus?: PostmasterConnectionStatus
  domainVerificationStatus?: PostmasterDomainStatus
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: string | null
  lastSyncAt?: string
}): Promise<PostmasterDomain | null> {
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

  const result = await pool.query<PostmasterDomainRow>(
    `UPDATE public.mail_postmaster_domains
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapPostmasterDomainRow(result.rows[0]) : null
}

export async function deletePostmasterDomain(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_postmaster_domains
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function insertMetrics(data: {
  postmasterDomainId: string
  organizationId: string
  spamComplaintRate: number
  ipReputation?: string
  domainReputation?: string
  authenticationSuccess: number
  dkimSuccessRate: number
  spfSuccessRate: number
  dmarcSuccessRate: number
  userReportedSpam: number
  date: string
}): Promise<PostmasterMetrics> {
  const result = await pool.query(
    `INSERT INTO public.mail_postmaster_metrics
      (postmaster_domain_id, organization_id, spam_complaint_rate, ip_reputation, domain_reputation, authentication_success, dkim_success_rate, spf_success_rate, dmarc_success_rate, user_reported_spam, date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (postmaster_domain_id, date) DO UPDATE SET
       spam_complaint_rate = EXCLUDED.spam_complaint_rate,
       ip_reputation = EXCLUDED.ip_reputation,
       domain_reputation = EXCLUDED.domain_reputation,
       authentication_success = EXCLUDED.authentication_success,
       dkim_success_rate = EXCLUDED.dkim_success_rate,
       spf_success_rate = EXCLUDED.spf_success_rate,
       dmarc_success_rate = EXCLUDED.dmarc_success_rate,
       user_reported_spam = EXCLUDED.user_reported_spam
     RETURNING *`,
    [data.postmasterDomainId, data.organizationId, data.spamComplaintRate, data.ipReputation ?? null, data.domainReputation ?? null, data.authenticationSuccess, data.dkimSuccessRate, data.spfSuccessRate, data.dmarcSuccessRate, data.userReportedSpam, data.date]
  )
  return result.rows[0]
}

export async function getMetricsHistory(postmasterDomainId: string, limit: number = 30): Promise<PostmasterMetrics[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_postmaster_metrics
     WHERE postmaster_domain_id = $1
     ORDER BY date DESC
     LIMIT $2`,
    [postmasterDomainId, limit]
  )
  return result.rows
}

export async function getPostmasterDashboardStats(orgId: string): Promise<PostmasterDashboardStats> {
  const connectedResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_postmaster_domains
     WHERE organization_id = $1 AND connection_status = 'connected'`,
    [orgId]
  )
  const verifiedResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_postmaster_domains
     WHERE organization_id = $1 AND domain_verification_status = 'verified'`,
    [orgId]
  )
  const lastSyncResult = await pool.query(
    `SELECT MAX(last_sync_at) AS last_sync FROM public.mail_postmaster_domains
     WHERE organization_id = $1`,
    [orgId]
  )
  const avgSpamResult = await pool.query(
    `SELECT ROUND(AVG(m.spam_complaint_rate)::numeric, 4) AS avg_rate
     FROM public.mail_postmaster_metrics m
     JOIN public.mail_postmaster_domains d ON m.postmaster_domain_id = d.id
     WHERE d.organization_id = $1`,
    [orgId]
  )
  const avgAuthResult = await pool.query(
    `SELECT ROUND(AVG(m.authentication_success)::numeric, 4) AS avg_rate
     FROM public.mail_postmaster_metrics m
     JOIN public.mail_postmaster_domains d ON m.postmaster_domain_id = d.id
     WHERE d.organization_id = $1`,
    [orgId]
  )
  const repBreakdownResult = await pool.query(
    `SELECT domain_reputation AS level, COUNT(*)::int AS count
     FROM (SELECT DISTINCT ON (d.id) m.domain_reputation
           FROM public.mail_postmaster_metrics m
           JOIN public.mail_postmaster_domains d ON m.postmaster_domain_id = d.id
           WHERE d.organization_id = $1
           ORDER BY d.id, m.date DESC) sub
     WHERE domain_reputation IS NOT NULL
     GROUP BY domain_reputation`,
    [orgId]
  )

  return {
    domainsConnected: connectedResult.rows[0]?.count ?? 0,
    domainsVerified: verifiedResult.rows[0]?.count ?? 0,
    lastSyncAt: lastSyncResult.rows[0]?.last_sync ?? null,
    avgSpamComplaintRate: Number(avgSpamResult.rows[0]?.avg_rate ?? 0),
    avgAuthSuccessRate: Number(avgAuthResult.rows[0]?.avg_rate ?? 0),
    domainReputationBreakdown: repBreakdownResult.rows,
  }
}
