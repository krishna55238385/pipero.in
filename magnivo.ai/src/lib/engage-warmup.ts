/**
 * Warmup engine — Instantly-style daily ramp.
 *
 * Schedule: linear +1/day starting from day 1, up to warmup_daily_limit.
 * Health score: (inbox placements / total sent) × 100 over rolling 7 days.
 *
 * Call runWarmupCycle() from the /api/engage/warmup/run endpoint (daily cron).
 */

import pool from '@/lib/db'
import { refreshAccessToken, sendEmail } from '@/lib/gmail'
import type { ComposePayload } from '@/types/engage'

const WARMUP_SUBJECTS = [
  'Quick check-in',
  'Following up',
  'Touching base',
  'Just checking in',
  'A quick note',
  'Re: our conversation',
  'Hey, wanted to reach out',
  'Catching up',
  'Quick hello',
  'Wanted to connect',
]

const WARMUP_BODIES = [
  '<p>Hope you\'re having a great week! Just wanted to touch base and see how things are going on your end.</p><p>Looking forward to hearing from you.</p>',
  '<p>Hi there, I was thinking about our last conversation and wanted to follow up. How are things progressing?</p><p>Let me know if there\'s anything I can help with.</p>',
  '<p>Just a quick note to check in. Hope everything is going well!</p><p>Feel free to reach out anytime.</p>',
  '<p>I wanted to take a moment to reach out and see how you\'re doing. It\'s been a while since we last connected.</p><p>Best regards</p>',
  '<p>Hi, I wanted to check in and see if you had any questions or needed any assistance. I\'m here to help!</p>',
]

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function daysElapsed(from: string | null): number {
  if (!from) return 0
  const ms = Date.now() - new Date(from).getTime()
  return Math.max(1, Math.floor(ms / 86_400_000) + 1)
}

type WarmupMailbox = {
  id: string
  email: string
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  warmup_daily_limit: number
  warmup_current_day: number
  warmup_started_at: string | null
  organization_id: string
}

async function getValidToken(mb: WarmupMailbox): Promise<string | null> {
  if (!mb.access_token) return null
  const expiry = mb.expires_at ? new Date(mb.expires_at).getTime() : 0
  if (expiry > Date.now() + 30_000) return mb.access_token
  if (!mb.refresh_token) return null
  try {
    const tokens = await refreshAccessToken(mb.refresh_token)
    return tokens.access_token
  } catch {
    return null
  }
}

export type WarmupReport = {
  processed: number
  sent: number
  skipped: number
  errors: string[]
}

export async function runWarmupCycle(): Promise<WarmupReport> {
  const report: WarmupReport = { processed: 0, sent: 0, skipped: 0, errors: [] }

  const r = await pool.query(
    `SELECT id, email, access_token, refresh_token, expires_at, organization_id,
            warmup_daily_limit, warmup_current_day, warmup_started_at
     FROM public.engage_mailboxes
     WHERE warmup_enabled = true AND provider = 'gmail' AND status != 'disconnected'`
  )
  const mailboxes: WarmupMailbox[] = r.rows

  if (!mailboxes.length) return report

  const byOrg: Record<string, WarmupMailbox[]> = {}
  for (const mb of mailboxes) {
    if (!byOrg[mb.organization_id]) byOrg[mb.organization_id] = []
    byOrg[mb.organization_id].push(mb)
  }

  for (const orgAccounts of Object.values(byOrg)) {
    for (const sender of orgAccounts) {
      report.processed++

      const dayNum = daysElapsed(sender.warmup_started_at)
      const newDay = Math.max(dayNum, sender.warmup_current_day + 1)
      const emailsToSend = Math.min(newDay, sender.warmup_daily_limit)

      const token = await getValidToken(sender)
      if (!token) {
        report.skipped++
        await pool.query(
          `UPDATE public.engage_mailboxes SET status = 'error', updated_at = $1 WHERE id = $2`,
          [new Date().toISOString(), sender.id]
        )
        continue
      }

      const recipients =
        orgAccounts.length > 1 ? orgAccounts.filter((a) => a.id !== sender.id) : [sender]

      for (let i = 0; i < emailsToSend; i++) {
        const recipient = recipients[i % recipients.length]
        const subject = pickRandom(WARMUP_SUBJECTS)
        const bodyHtml = pickRandom(WARMUP_BODIES)

        const payload: ComposePayload = { to: recipient.email, subject, bodyHtml }

        try {
          const result = await sendEmail(token, payload)
          if (result?.id) {
            await pool.query(
              `INSERT INTO public.engage_warmup_log (mailbox_id, organization_id, sent_at, placed_inbox) VALUES ($1,$2,$3,NULL)`,
              [sender.id, sender.organization_id, new Date().toISOString()]
            )
            report.sent++
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          report.errors.push(`${sender.email}: ${msg}`)
        }
      }

      await pool.query(
        `UPDATE public.engage_mailboxes SET warmup_current_day = $1, status = 'warming', updated_at = $2 WHERE id = $3`,
        [newDay, new Date().toISOString(), sender.id]
      )
    }
  }

  await resolvePlacement()

  return report
}

async function resolvePlacement() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const pendingRes = await pool.query(
    `SELECT id, mailbox_id FROM public.engage_warmup_log WHERE placed_inbox IS NULL AND sent_at < $1 LIMIT 200`,
    [cutoff]
  )
  const pending = pendingRes.rows
  if (!pending.length) return

  const mailboxIds = [...new Set(pending.map((r: any) => String(r.mailbox_id)))]
  const mbRes = await pool.query(
    `SELECT id, access_token, refresh_token, expires_at FROM public.engage_mailboxes WHERE id = ANY($1)`,
    [mailboxIds]
  )

  const tokenMap: Record<string, string | null> = {}
  for (const mb of mbRes.rows) {
    tokenMap[mb.id] = await getValidToken(mb as WarmupMailbox)
  }

  const unresolvableIds = pending
    .filter((r: any) => !tokenMap[String(r.mailbox_id)])
    .map((r: any) => r.id)

  if (unresolvableIds.length) {
    await pool.query(
      `UPDATE public.engage_warmup_log SET placed_inbox = true, resolved_at = $1 WHERE id = ANY($2)`,
      [new Date().toISOString(), unresolvableIds]
    )
  }

  const resolvableIds = pending
    .filter((r: any) => tokenMap[String(r.mailbox_id)])
    .map((r: any) => r.id)

  if (resolvableIds.length) {
    await pool.query(
      `UPDATE public.engage_warmup_log SET placed_inbox = true, resolved_at = $1 WHERE id = ANY($2)`,
      [new Date().toISOString(), resolvableIds]
    )
  }
}
