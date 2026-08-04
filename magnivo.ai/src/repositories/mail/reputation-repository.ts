import pool from '@/lib/db'
import type { DomainReputation, MailboxReputation, ReputationLevel, ReputationSource, ReputationDashboardStats } from '@/types/deliverability'

type DomainReputationRow = {
  id: string
  organization_id: string
  domain_id: string
  source: ReputationSource
  reputation_score: number
  reputation_level: ReputationLevel
  sending_volume: number | null
  bounce_rate: number | null
  complaint_rate: number | null
  open_rate: number | null
  metadata: Record<string, unknown>
  recorded_at: string
  created_at: string
}

function mapDomainReputationRow(row: DomainReputationRow): DomainReputation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    source: row.source,
    reputationScore: row.reputation_score,
    reputationLevel: row.reputation_level,
    sendingVolume: row.sending_volume,
    bounceRate: row.bounce_rate !== null ? Number(row.bounce_rate) : null,
    complaintRate: row.complaint_rate !== null ? Number(row.complaint_rate) : null,
    openRate: row.open_rate !== null ? Number(row.open_rate) : null,
    metadata: row.metadata || {},
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
  }
}

type MailboxReputationRow = {
  id: string
  organization_id: string
  mailbox_id: string
  domain_id: string
  source: ReputationSource
  reputation_score: number
  reputation_level: ReputationLevel
  sending_volume: number | null
  bounce_rate: number | null
  complaint_rate: number | null
  metadata: Record<string, unknown>
  recorded_at: string
  created_at: string
}

function mapMailboxReputationRow(row: MailboxReputationRow): MailboxReputation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    mailboxId: row.mailbox_id,
    domainId: row.domain_id,
    source: row.source,
    reputationScore: row.reputation_score,
    reputationLevel: row.reputation_level,
    sendingVolume: row.sending_volume,
    bounceRate: row.bounce_rate !== null ? Number(row.bounce_rate) : null,
    complaintRate: row.complaint_rate !== null ? Number(row.complaint_rate) : null,
    metadata: row.metadata || {},
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
  }
}

export async function findDomainReputationsByOrg(orgId: string, limit: number = 100): Promise<DomainReputation[]> {
  const result = await pool.query<DomainReputationRow>(
    `SELECT DISTINCT ON (domain_id) * FROM public.mail_domain_reputation
     WHERE organization_id = $1
     ORDER BY domain_id, recorded_at DESC
     LIMIT $2`,
    [orgId, limit]
  )
  return result.rows.map(mapDomainReputationRow)
}

export async function findDomainReputationHistory(domainId: string, limit: number = 30): Promise<DomainReputation[]> {
  const result = await pool.query<DomainReputationRow>(
    `SELECT * FROM public.mail_domain_reputation
     WHERE domain_id = $1
     ORDER BY recorded_at DESC
     LIMIT $2`,
    [domainId, limit]
  )
  return result.rows.map(mapDomainReputationRow)
}

export async function findMailboxReputations(orgId: string, domainId?: string): Promise<MailboxReputation[]> {
  if (domainId) {
    const result = await pool.query<MailboxReputationRow>(
      `SELECT DISTINCT ON (mailbox_id) * FROM public.mail_mailbox_reputation
       WHERE organization_id = $1 AND domain_id = $2
       ORDER BY mailbox_id, recorded_at DESC`,
      [orgId, domainId]
    )
    return result.rows.map(mapMailboxReputationRow)
  }
  const result = await pool.query<MailboxReputationRow>(
    `SELECT DISTINCT ON (mailbox_id) * FROM public.mail_mailbox_reputation
     WHERE organization_id = $1
     ORDER BY mailbox_id, recorded_at DESC`,
    [orgId]
  )
  return result.rows.map(mapMailboxReputationRow)
}

export async function insertDomainReputation(data: {
  organizationId: string
  domainId: string
  source: ReputationSource
  reputationScore: number
  reputationLevel: ReputationLevel
  sendingVolume?: number
  bounceRate?: number
  complaintRate?: number
  openRate?: number
}): Promise<DomainReputation> {
  const result = await pool.query<DomainReputationRow>(
    `INSERT INTO public.mail_domain_reputation
      (organization_id, domain_id, source, reputation_score, reputation_level, sending_volume, bounce_rate, complaint_rate, open_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [data.organizationId, data.domainId, data.source, data.reputationScore, data.reputationLevel, data.sendingVolume ?? null, data.bounceRate ?? null, data.complaintRate ?? null, data.openRate ?? null]
  )
  return mapDomainReputationRow(result.rows[0])
}

export async function insertMailboxReputation(data: {
  organizationId: string
  mailboxId: string
  domainId: string
  source: ReputationSource
  reputationScore: number
  reputationLevel: ReputationLevel
  sendingVolume?: number
  bounceRate?: number
  complaintRate?: number
}): Promise<MailboxReputation> {
  const result = await pool.query<MailboxReputationRow>(
    `INSERT INTO public.mail_mailbox_reputation
      (organization_id, mailbox_id, domain_id, source, reputation_score, reputation_level, sending_volume, bounce_rate, complaint_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [data.organizationId, data.mailboxId, data.domainId, data.source, data.reputationScore, data.reputationLevel, data.sendingVolume ?? null, data.bounceRate ?? null, data.complaintRate ?? null]
  )
  return mapMailboxReputationRow(result.rows[0])
}

export async function getReputationDashboardStats(orgId: string): Promise<ReputationDashboardStats> {
  const totalResult = await pool.query(
    `SELECT COUNT(DISTINCT domain_id)::int AS total FROM public.mail_domain_reputation WHERE organization_id = $1`,
    [orgId]
  )

  const avgResult = await pool.query(
    `SELECT ROUND(AVG(reputation_score))::int AS avg_score
     FROM (SELECT DISTINCT ON (domain_id) reputation_score
           FROM public.mail_domain_reputation
           WHERE organization_id = $1
           ORDER BY domain_id, recorded_at DESC) sub`,
    [orgId]
  )

  const trendResult = await pool.query(
    `SELECT domain_id,
            first_value(reputation_score) OVER (PARTITION BY domain_id ORDER BY recorded_at DESC) AS current_score,
            last_value(reputation_score) OVER (PARTITION BY domain_id ORDER BY recorded_at DESC
              ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS first_score
     FROM public.mail_domain_reputation
     WHERE organization_id = $1`,
    [orgId]
  )

  let improvingDomains = 0
  let decliningDomains = 0
  for (const row of trendResult.rows) {
    if (row.current_score > row.first_score) improvingDomains++
    else if (row.current_score < row.first_score) decliningDomains++
  }

  const recentResult = await pool.query<DomainReputationRow>(
    `SELECT DISTINCT ON (domain_id) * FROM public.mail_domain_reputation
     WHERE organization_id = $1
     ORDER BY domain_id, recorded_at DESC
     LIMIT 10`,
    [orgId]
  )

  return {
    domainsTracked: totalResult.rows[0]?.total ?? 0,
    avgReputationScore: avgResult.rows[0]?.avg_score ?? 50,
    improvingDomains,
    decliningDomains,
    recentEntries: recentResult.rows.map(mapDomainReputationRow),
  }
}
