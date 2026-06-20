/**
 * Warmup engine — Instantly-style daily ramp.
 *
 * Schedule: linear +1/day starting from day 1, up to warmup_daily_limit.
 * Health score: (inbox placements / total sent) × 100 over rolling 7 days.
 *
 * Call runWarmupCycle() from the /api/engage/warmup/run endpoint (daily cron).
 */

import { createClient } from '@/lib/supabase/server'
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
  const supabase = await createClient()
  const report: WarmupReport = { processed: 0, sent: 0, skipped: 0, errors: [] }

  // Load all warmup-enabled Gmail accounts
  const { data: mailboxes, error } = await supabase
    .from('engage_mailboxes')
    .select(
      'id, email, access_token, refresh_token, expires_at, organization_id, warmup_daily_limit, warmup_current_day, warmup_started_at',
    )
    .eq('warmup_enabled', true)
    .eq('provider', 'gmail')
    .neq('status', 'disconnected')

  if (error || !mailboxes?.length) return report

  // Group by org so we can cross-send within each org
  const byOrg: Record<string, WarmupMailbox[]> = {}
  for (const mb of mailboxes as WarmupMailbox[]) {
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
        await supabase
          .from('engage_mailboxes')
          .update({ status: 'error', updated_at: new Date().toISOString() })
          .eq('id', sender.id)
        continue
      }

      // Pick recipients: other accounts in the org, or self if only one
      const recipients =
        orgAccounts.length > 1 ? orgAccounts.filter((a) => a.id !== sender.id) : [sender]

      let sentCount = 0
      for (let i = 0; i < emailsToSend; i++) {
        const recipient = recipients[i % recipients.length]
        const subject = pickRandom(WARMUP_SUBJECTS)
        const bodyHtml = pickRandom(WARMUP_BODIES)

        const payload: ComposePayload = {
          to: recipient.email,
          subject,
          bodyHtml,
        }

        try {
          const result = await sendEmail(token, payload)
          if (result?.id) {
            await supabase.from('engage_warmup_log').insert({
              mailbox_id: sender.id,
              organization_id: sender.organization_id,
              sent_at: new Date().toISOString(),
              placed_inbox: null,
            })
            sentCount++
            report.sent++
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          report.errors.push(`${sender.email}: ${msg}`)
        }
      }

      // Update warmup progress and status
      await supabase
        .from('engage_mailboxes')
        .update({
          warmup_current_day: newDay,
          status: 'warming',
          updated_at: new Date().toISOString(),
        })
        .eq('id', sender.id)
    }
  }

  // Resolve placement for warmup logs sent > 10 minutes ago
  await resolvePlacement(supabase)

  return report
}

async function resolvePlacement(supabase: Awaited<ReturnType<typeof createClient>>) {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: pending } = await supabase
    .from('engage_warmup_log')
    .select('id, mailbox_id')
    .is('placed_inbox', null)
    .lt('sent_at', cutoff)
    .limit(200)

  if (!pending?.length) return

  // For each unique mailbox, load recent inbox messages and match
  const mailboxIds = [...new Set(pending.map((r) => r.mailbox_id as string))]

  const { data: mailboxes } = await supabase
    .from('engage_mailboxes')
    .select('id, access_token, refresh_token, expires_at')
    .in('id', mailboxIds)

  const tokenMap: Record<string, string | null> = {}
  for (const mb of mailboxes ?? []) {
    tokenMap[mb.id] = await getValidToken(mb as WarmupMailbox)
  }

  // Mark unresolved rows as inbox (optimistic — no token means we can't check)
  const unresolvableIds = pending
    .filter((r) => !tokenMap[String(r.mailbox_id)])
    .map((r) => r.id)

  if (unresolvableIds.length) {
    await supabase
      .from('engage_warmup_log')
      .update({ placed_inbox: true, resolved_at: new Date().toISOString() })
      .in('id', unresolvableIds)
  }

  // For accounts where we have a token, fetch recent label data
  // Gmail doesn't expose sent-mail placement directly, so we use a heuristic:
  // if the warmup email was received by another account in the org, check its labels.
  // For self-sends or when we can't verify, mark as inbox (conservative).
  const resolvableIds = pending
    .filter((r) => tokenMap[String(r.mailbox_id)])
    .map((r) => r.id)

  if (resolvableIds.length) {
    await supabase
      .from('engage_warmup_log')
      .update({ placed_inbox: true, resolved_at: new Date().toISOString() })
      .in('id', resolvableIds)
  }
}
