import pool from '@/lib/db'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export async function isSuppressed(orgId: string, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  const [mailSup, outreachSup] = await Promise.all([
    pool.query(
      `SELECT 1 FROM public.mail_email_suppressions
       WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`,
      [orgId, normalized]
    ),
    pool.query(
      `SELECT 1 FROM public.outreach_unsubscribes
       WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`,
      [orgId, normalized]
    ),
  ])
  return Boolean(mailSup.rows[0] || outreachSup.rows[0])
}

export async function suppressEmail(
  orgId: string,
  email: string,
  reason: string,
  source: string,
  leadId?: string | null,
  campaignId?: string | null
): Promise<void> {
  const normalized = email.trim().toLowerCase()
  await pool.query(
    `INSERT INTO public.mail_email_suppressions (organization_id, email, reason, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, email) DO UPDATE
       SET reason = EXCLUDED.reason, source = EXCLUDED.source`,
    [orgId, normalized, reason, source]
  )
  await pool.query(
    `INSERT INTO public.outreach_unsubscribes
      (email, organization_id, lead_id, campaign_id, unsubscribed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (email) DO UPDATE
       SET organization_id = COALESCE(EXCLUDED.organization_id, outreach_unsubscribes.organization_id),
           unsubscribed_at = NOW()`,
    [normalized, orgId, leadId ?? null, campaignId ?? null]
  )
  await pool.query(
    `UPDATE public.mail_leads
     SET suppressed = TRUE, suppression_reason = $3, status = 'suppressed', updated_at = NOW()
     WHERE organization_id = $1 AND email = $2`,
    [orgId, normalized, reason]
  )
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createUnsubscribeToken(
  orgId: string,
  email: string,
  opts?: { leadId?: string; campaignId?: string; ttlHours?: number }
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const ttlHours = opts?.ttlHours ?? 24 * 365
  await pool.query(
    `INSERT INTO public.mail_unsubscribe_tokens
      (organization_id, email, lead_id, campaign_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval)`,
    [orgId, email.trim().toLowerCase(), opts?.leadId ?? null, opts?.campaignId ?? null, tokenHash, String(ttlHours)]
  )
  return token
}

export async function consumeUnsubscribeToken(token: string): Promise<{
  success: boolean
  organizationId?: string
  email?: string
  leadId?: string | null
  campaignId?: string | null
  error?: string
}> {
  const tokenHash = hashToken(token)
  const result = await pool.query<{
    id: string
    organization_id: string
    email: string
    lead_id: string | null
    campaign_id: string | null
    used_at: string | null
    expires_at: string
  }>(
    `SELECT * FROM public.mail_unsubscribe_tokens WHERE token_hash = $1 LIMIT 1`,
    [tokenHash]
  )
  const row = result.rows[0]
  if (!row) return { success: false, error: 'Invalid token' }
  if (row.used_at) {
    // Idempotent success if already used
    return {
      success: true,
      organizationId: row.organization_id,
      email: row.email,
      leadId: row.lead_id,
      campaignId: row.campaign_id,
    }
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { success: false, error: 'Token expired' }
  }

  // Constant-time compare already via hash lookup; mark used
  await pool.query(
    `UPDATE public.mail_unsubscribe_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`,
    [row.id]
  )
  await suppressEmail(row.organization_id, row.email, 'unsubscribe', 'one_click', row.lead_id, row.campaign_id)
  return {
    success: true,
    organizationId: row.organization_id,
    email: row.email,
    leadId: row.lead_id,
    campaignId: row.campaign_id,
  }
}

export function buildListUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

export type SuppressionEntry = {
  email: string
  reason: string
  source: string
  createdAt: string
}

export async function listSuppressions(
  orgId: string,
  opts?: { search?: string; limit?: number; offset?: number }
): Promise<SuppressionEntry[]> {
  const limit = opts?.limit ?? 100
  const offset = opts?.offset ?? 0
  const params: unknown[] = [orgId]
  let where = 'organization_id = $1'
  if (opts?.search) {
    params.push(`%${opts.search.trim().toLowerCase()}%`)
    where += ` AND LOWER(email) LIKE $${params.length}`
  }
  params.push(limit, offset)
  const result = await pool.query<{
    email: string
    reason: string
    source: string
    suppressed_at: string
  }>(
    `SELECT email, reason, source, suppressed_at
     FROM public.mail_email_suppressions
     WHERE ${where}
     ORDER BY suppressed_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return result.rows.map((row) => ({
    email: row.email,
    reason: row.reason,
    source: row.source,
    createdAt: row.suppressed_at,
  }))
}

export async function removeSuppression(orgId: string, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  const result = await pool.query(
    `DELETE FROM public.mail_email_suppressions
     WHERE organization_id = $1 AND LOWER(email) = $2`,
    [orgId, normalized]
  )
  await pool.query(
    `UPDATE public.mail_leads
     SET suppressed = FALSE, suppression_reason = NULL,
         status = CASE WHEN status = 'suppressed' THEN 'new' ELSE status END,
         updated_at = NOW()
     WHERE organization_id = $1 AND LOWER(email) = $2`,
    [orgId, normalized]
  )
  return (result.rowCount ?? 0) > 0
}

/** Timing-safe helper retained for future raw-token compares */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
