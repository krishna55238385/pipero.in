import pool from '@/lib/db'
import type { BounceRecord, BounceType, BounceCategory, BounceDashboardStats } from '@/types/deliverability'

type BounceRecordRow = {
  id: string
  organization_id: string
  domain_id: string
  mailbox_id: string | null
  campaign_id: string | null
  recipient_email: string
  bounce_type: BounceType
  bounce_category: BounceCategory
  smtp_code: string | null
  diagnostic_code: string | null
  retry_count: number
  next_retry_at: string | null
  suppressed: boolean
  metadata: Record<string, unknown>
  created_at: string
}

function mapBounceRow(row: BounceRecordRow): BounceRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    mailboxId: row.mailbox_id,
    campaignId: row.campaign_id,
    recipientEmail: row.recipient_email,
    bounceType: row.bounce_type,
    bounceCategory: row.bounce_category,
    smtpCode: row.smtp_code,
    diagnosticCode: row.diagnostic_code,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    suppressed: row.suppressed,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

export async function findBouncesByOrg(orgId: string, limit: number = 50): Promise<BounceRecord[]> {
  const result = await pool.query<BounceRecordRow>(
    `SELECT * FROM public.mail_bounce_records
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [orgId, limit]
  )
  return result.rows.map(mapBounceRow)
}

export async function findBouncesByMailbox(mailboxId: string, limit: number = 50): Promise<BounceRecord[]> {
  const result = await pool.query<BounceRecordRow>(
    `SELECT * FROM public.mail_bounce_records
     WHERE mailbox_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [mailboxId, limit]
  )
  return result.rows.map(mapBounceRow)
}

export async function findBounceById(id: string, orgId: string): Promise<BounceRecord | null> {
  const result = await pool.query<BounceRecordRow>(
    `SELECT * FROM public.mail_bounce_records
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapBounceRow(result.rows[0]) : null
}

export async function findBounceByRecipient(orgId: string, recipientEmail: string): Promise<BounceRecord | null> {
  const result = await pool.query<BounceRecordRow>(
    `SELECT * FROM public.mail_bounce_records
     WHERE organization_id = $1 AND recipient_email = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [orgId, recipientEmail]
  )
  return result.rows[0] ? mapBounceRow(result.rows[0]) : null
}

export async function findRetriableBounces(orgId: string): Promise<BounceRecord[]> {
  const result = await pool.query<BounceRecordRow>(
    `SELECT * FROM public.mail_bounce_records
     WHERE organization_id = $1 AND suppressed = FALSE AND bounce_type = 'soft'
       AND next_retry_at IS NOT NULL AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT 50`,
    [orgId]
  )
  return result.rows.map(mapBounceRow)
}

export async function insertBounce(data: {
  organizationId: string
  domainId: string
  mailboxId?: string
  campaignId?: string
  recipientEmail: string
  bounceType: BounceType
  bounceCategory: BounceCategory
  smtpCode?: string
  diagnosticCode?: string
}): Promise<BounceRecord> {
  const shouldSuppress = data.bounceType === 'hard'
  const nextRetryAt = data.bounceType === 'soft'
    ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
    : null

  const result = await pool.query<BounceRecordRow>(
    `INSERT INTO public.mail_bounce_records
      (organization_id, domain_id, mailbox_id, campaign_id, recipient_email, bounce_type, bounce_category, smtp_code, diagnostic_code, suppressed, next_retry_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [data.organizationId, data.domainId, data.mailboxId ?? null, data.campaignId ?? null, data.recipientEmail, data.bounceType, data.bounceCategory, data.smtpCode ?? null, data.diagnosticCode ?? null, shouldSuppress, nextRetryAt]
  )
  return mapBounceRow(result.rows[0])
}

export async function updateBounce(id: string, data: {
  retryCount?: number
  nextRetryAt?: string | null
  suppressed?: boolean
}): Promise<BounceRecord | null> {
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

  values.push(id)

  const result = await pool.query<BounceRecordRow>(
    `UPDATE public.mail_bounce_records
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapBounceRow(result.rows[0]) : null
}

export async function suppressEmail(orgId: string, email: string, reason: string, sourceId?: string): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_email_suppressions (organization_id, email, reason, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, email) DO NOTHING`,
    [orgId, email, reason, sourceId ?? null]
  )
}

export async function isEmailSuppressed(orgId: string, email: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM public.mail_email_suppressions
     WHERE organization_id = $1 AND email = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [orgId, email]
  )
  return (result.rowCount ?? 0) > 0
}

export async function getSuppressionCount(orgId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_email_suppressions
     WHERE organization_id = $1`,
    [orgId]
  )
  return result.rows[0]?.count ?? 0
}

export async function getBounceDashboardStats(orgId: string): Promise<BounceDashboardStats> {
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_bounce_records WHERE organization_id = $1`,
    [orgId]
  )
  const hardResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_bounce_records
     WHERE organization_id = $1 AND bounce_type = 'hard'`,
    [orgId]
  )
  const softResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_bounce_records
     WHERE organization_id = $1 AND bounce_type = 'soft'`,
    [orgId]
  )
  const unknownResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_bounce_records
     WHERE organization_id = $1 AND bounce_type = 'unknown'`,
    [orgId]
  )
  const suppressionCount = await getSuppressionCount(orgId)
  const recentResult = await pool.query<BounceRecordRow>(
    `SELECT * FROM public.mail_bounce_records
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [orgId]
  )

  return {
    totalBounces: totalResult.rows[0]?.count ?? 0,
    hardBounces: hardResult.rows[0]?.count ?? 0,
    softBounces: softResult.rows[0]?.count ?? 0,
    unknownBounces: unknownResult.rows[0]?.count ?? 0,
    suppressionCount,
    recentBounces: recentResult.rows.map(mapBounceRow),
  }
}
