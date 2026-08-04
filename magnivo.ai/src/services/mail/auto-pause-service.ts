/**
 * Auto-pause mailboxes when bounce or complaint rates cross thresholds (PRD §6.7).
 */
import pool from '@/lib/db'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'

const COMPLAINT_RATE_THRESHOLD = 0.003 // 0.3%
const SOFT_BOUNCE_RATE_THRESHOLD = 0.05 // 5% soft bounce → pause
const LOOKBACK_SENDS_MIN = 50

export function shouldPauseForBounceRate(
  sends: number,
  bounces: number,
  threshold = SOFT_BOUNCE_RATE_THRESHOLD,
  minSends = LOOKBACK_SENDS_MIN
): boolean {
  if (sends < minSends) return false
  return bounces / sends >= threshold
}

export function shouldPauseForComplaintRate(
  sends: number,
  complaints: number,
  threshold = COMPLAINT_RATE_THRESHOLD,
  minSends = LOOKBACK_SENDS_MIN
): boolean {
  if (sends < minSends) return false
  return complaints / sends > threshold
}

export async function evaluateMailboxDeliverabilityAlerts(
  orgId: string,
  mailboxId: string
): Promise<{ paused: boolean; reason?: string }> {
  const usage = await pool.query<{
    sends: number
    bounces: number
  }>(
    `SELECT COALESCE(SUM(sends),0)::int AS sends, COALESCE(SUM(bounces),0)::int AS bounces
     FROM public.mail_mailbox_usage_daily
     WHERE organization_id = $1 AND mailbox_id = $2
       AND usage_date >= CURRENT_DATE - INTERVAL '7 days'`,
    [orgId, mailboxId]
  )
  const sends = usage.rows[0]?.sends ?? 0
  const bounces = usage.rows[0]?.bounces ?? 0

  if (shouldPauseForBounceRate(sends, bounces)) {
    const bounceRate = sends > 0 ? bounces / sends : 0
    await pauseMailbox(orgId, mailboxId, `bounce_rate_${(bounceRate * 100).toFixed(2)}%`)
    return { paused: true, reason: 'bounce_rate' }
  }

  const complaints = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.mail_complaint_records
     WHERE organization_id = $1 AND mailbox_id = $2
       AND created_at >= NOW() - INTERVAL '7 days'`,
    [orgId, mailboxId]
  ).catch(() => ({ rows: [{ count: 0 }] }))

  const complaintCount = complaints.rows[0]?.count ?? 0
  if (shouldPauseForComplaintRate(sends, complaintCount)) {
    const complaintRate = sends > 0 ? complaintCount / sends : 0
    await pauseMailbox(orgId, mailboxId, `complaint_rate_${(complaintRate * 100).toFixed(3)}%`)
    return { paused: true, reason: 'complaint_rate' }
  }

  return { paused: false }
}

async function pauseMailbox(orgId: string, mailboxId: string, reason: string): Promise<void> {
  await mailboxRepo.transitionMailboxStatus(mailboxId, orgId, 'suspended').catch(() => {})
  await pool.query(
    `INSERT INTO public.mail_notifications
      (organization_id, mailbox_id, type, title, message, severity, metadata)
     VALUES ($1,$2,'auto_pause','Mailbox auto-paused',$3,'critical',$4::jsonb)`,
    [orgId, mailboxId, `Auto-paused: ${reason}`, JSON.stringify({ reason })]
  )
}

export async function evaluateOrgDeliverabilityAlerts(orgId: string): Promise<number> {
  const mailboxes = await mailboxRepo.findMailboxesByOrg(orgId)
  let paused = 0
  for (const m of mailboxes) {
    if (m.deletedAt || m.mailboxStatus === 'suspended') continue
    const result = await evaluateMailboxDeliverabilityAlerts(orgId, m.id)
    if (result.paused) paused++
  }
  return paused
}
