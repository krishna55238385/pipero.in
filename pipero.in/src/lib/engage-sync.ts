import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getMessageSummaryById,
  listHistoryMessageIds,
  listInboxMessages,
  parseEmailAddress,
  refreshAccessToken,
  startGmailWatch,
} from '@/lib/gmail'
import type { EngageEmailSummary } from '@/types/engage'

// Shared Gmail<->DB sync helpers. Every code path that writes engage_emails
// (inbox refresh, push webhook, watch bootstrap, campaign worker, send mirror)
// must go through summaryToRow so direction/labels are classified identically.

export type MailboxRow = {
  id: string
  user_id: string
  organization_id: string
  email: string
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  gmail_history_id: string | null
  gmail_watch_expiration: string | null
  last_synced_at: string | null
}

// Loosely typed on purpose: callers pass either the cookie-scoped server
// client or the service-role client.
type Db = SupabaseClient

export function directionOf(summary: Pick<EngageEmailSummary, 'from' | 'labelIds'>, mailboxEmail: string): 'sent' | 'received' {
  // Gmail's own SENT label is authoritative; fall back to exact address
  // comparison (never substring matching — that's how sent mail leaked into
  // the inbox view before).
  if (summary.labelIds?.includes('SENT')) return 'sent'
  const from = parseEmailAddress(summary.from || '')
  return from && from === mailboxEmail.trim().toLowerCase() ? 'sent' : 'received'
}

function safeReceivedAt(date: string): string {
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export function summaryToRow(mailbox: Pick<MailboxRow, 'id' | 'organization_id' | 'user_id' | 'email'>, e: EngageEmailSummary) {
  return {
    mailbox_id: mailbox.id,
    organization_id: mailbox.organization_id,
    user_id: mailbox.user_id,
    gmail_message_id: e.id,
    gmail_thread_id: e.threadId,
    from_email: e.from,
    to_email: e.to ?? '',
    subject: e.subject,
    snippet: e.snippet,
    date_header: e.date,
    received_at: safeReceivedAt(e.date),
    unread: e.unread,
    starred: e.starred,
    label_ids: e.labelIds ?? [],
    direction: directionOf(e, mailbox.email),
    updated_at: new Date().toISOString(),
  }
}

/** Token refresh that works without a request context (webhook/worker). */
export async function getMailboxAccessToken(supabase: Db, mailbox: MailboxRow): Promise<string> {
  const exp = mailbox.expires_at ? new Date(mailbox.expires_at).getTime() : 0
  const soon = Date.now() + 30_000
  if (mailbox.access_token && exp > soon) return mailbox.access_token
  if (!mailbox.refresh_token) throw new Error('Gmail refresh token missing for mailbox')

  const refreshed = await refreshAccessToken(mailbox.refresh_token)
  const expiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString()
  await supabase
    .from('engage_mailboxes')
    .update({
      access_token: refreshed.access_token,
      token_type: refreshed.token_type ?? 'Bearer',
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mailbox.id)
  return refreshed.access_token
}

export async function upsertEmailSummaries(supabase: Db, mailbox: MailboxRow, summaries: EngageEmailSummary[]) {
  if (!summaries.length) return
  const rows = summaries.filter((s) => s.id && s.threadId).map((s) => summaryToRow(mailbox, s))
  const { error } = await supabase
    .from('engage_emails')
    .upsert(rows, { onConflict: 'mailbox_id,gmail_message_id' })
  if (error) throw new Error(`engage_emails upsert failed: ${error.message}`)
}

/**
 * Full (paginated) pull from Gmail into engage_emails. Used for the initial
 * backfill and as the polling fallback whenever the push watch is not active.
 */
export async function syncMailboxEmails(
  supabase: Db,
  mailbox: MailboxRow,
  accessToken: string,
  opts?: { maxResults?: number },
) {
  const summaries = await listInboxMessages(accessToken, { maxResults: opts?.maxResults ?? 100 })
  await upsertEmailSummaries(supabase, mailbox, summaries)
  await supabase
    .from('engage_mailboxes')
    .update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', mailbox.id)
  await detectReplies(supabase, mailbox)
  return summaries.length
}

/** Incremental sync from a Gmail history cursor (used by the push webhook). */
export async function syncMailboxFromHistory(supabase: Db, mailbox: MailboxRow, accessToken: string) {
  let latestHistoryId = mailbox.gmail_history_id
  if (mailbox.gmail_history_id) {
    try {
      const history = await listHistoryMessageIds(accessToken, mailbox.gmail_history_id)
      latestHistoryId = history.latestHistoryId || latestHistoryId
      if (history.messageIds.length > 0) {
        const details = await Promise.all(
          history.messageIds.slice(0, 100).map((id) => getMessageSummaryById(accessToken, id)),
        )
        await upsertEmailSummaries(supabase, mailbox, details)
      }
    } catch {
      // History cursor too old/invalid — fall back to a snapshot pull.
      await syncMailboxEmails(supabase, mailbox, accessToken)
    }
  } else {
    await syncMailboxEmails(supabase, mailbox, accessToken)
  }

  await supabase
    .from('engage_mailboxes')
    .update({
      gmail_history_id: latestHistoryId,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', mailbox.id)
  await detectReplies(supabase, mailbox)
}

/** Re-registers the push watch when missing or expiring within 24h. */
export async function renewWatchIfNeeded(supabase: Db, mailbox: MailboxRow, accessToken: string) {
  const exp = mailbox.gmail_watch_expiration ? new Date(mailbox.gmail_watch_expiration).getTime() : 0
  if (exp > Date.now() + 24 * 3600 * 1000) return false
  try {
    const watch = await startGmailWatch(accessToken)
    await supabase
      .from('engage_mailboxes')
      .update({
        gmail_history_id: watch.historyId ?? mailbox.gmail_history_id ?? null,
        gmail_watch_expiration: watch.expiration ? new Date(Number(watch.expiration)).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mailbox.id)
    return true
  } catch (e) {
    // Pub/Sub topic may not be configured in this environment — polling sync
    // still keeps the unibox fresh, so this is non-fatal.
    console.error('[engage-sync] watch renewal failed:', e instanceof Error ? e.message : e)
    return false
  }
}

function classifyReply(text: string): string {
  const t = text.toLowerCase()
  if (/(out of office|auto.?reply|automatic reply|on leave|vacation)/.test(t)) return 'auto_reply'
  if (/(not interested|no thanks|stop emailing|remove me|unsubscribe|don't contact)/.test(t)) return 'not_interested'
  if (/(wrong person|not the right)/.test(t)) return 'wrong_person'
  if (/(interested|sounds good|let'?s (talk|chat|connect)|book a|schedule|call me|demo|pricing|tell me more)/.test(t)) return 'interested'
  return 'unknown'
}

// A received message is a BOUNCE / delivery-failure notification (from the mail
// system), NOT a human reply. These must never be counted as replies or shown
// as conversations — they come from mailer-daemon/postmaster or carry the
// standard DSN subjects.
export function isBounceMessage(fromEmail: string, subject: string): boolean {
  const from = (fromEmail || '').toLowerCase()
  if (/mailer-daemon|postmaster|no-?reply@.*(mail|google)/.test(from)) return true
  const s = (subject || '').toLowerCase()
  return /(delivery status notification|undeliverable|mail delivery (failed|subsystem)|message blocked|returned mail|delivery (failure|incomplete)|failure notice|address not found)/.test(s)
}

/**
 * Correlates received messages with threads we sent in (composer, campaigns,
 * GTM Agent 14) and records them as replies — this is what powers reply rate
 * and stop-on-reply.
 */
export async function detectReplies(supabase: Db, mailbox: MailboxRow) {
  const { data: received } = await supabase
    .from('engage_emails')
    .select('gmail_message_id, gmail_thread_id, from_email, snippet, subject, received_at')
    .eq('mailbox_id', mailbox.id)
    .eq('direction', 'received')
    .order('received_at', { ascending: false })
    .limit(300)
  if (!received?.length) return

  const threadIds = Array.from(new Set(received.map((r) => String(r.gmail_thread_id))))

  // Threads we initiated, from any send path.
  const [sentRes, logRes, recipientsRes] = await Promise.all([
    supabase
      .from('engage_emails')
      .select('gmail_thread_id')
      .eq('mailbox_id', mailbox.id)
      .eq('direction', 'sent')
      .in('gmail_thread_id', threadIds),
    supabase
      .from('outreach_log')
      .select('thread_id, campaign_id, lead_id')
      .in('thread_id', threadIds),
    supabase
      .from('engage_campaign_recipients')
      .select('gmail_thread_id, campaign_id, lead_id')
      .in('gmail_thread_id', threadIds),
  ])

  const sentThreads = new Set((sentRes.data ?? []).map((r) => String(r.gmail_thread_id)))
  const logByThread = new Map<string, { campaign_id: string | null; lead_id: number | null }>()
  for (const row of logRes.data ?? []) {
    if (row.thread_id) logByThread.set(String(row.thread_id), { campaign_id: row.campaign_id, lead_id: row.lead_id })
  }
  for (const row of recipientsRes.data ?? []) {
    if (row.gmail_thread_id && !logByThread.has(String(row.gmail_thread_id))) {
      logByThread.set(String(row.gmail_thread_id), { campaign_id: String(row.campaign_id), lead_id: row.lead_id })
    }
  }

  // Only received mail in a thread we sent in counts. Then split out bounces
  // (mailer-daemon / delivery-failure) — those are NOT replies.
  const inOurThreads = received.filter(
    (r) => sentThreads.has(String(r.gmail_thread_id)) || logByThread.has(String(r.gmail_thread_id)),
  )
  const bounces = inOurThreads.filter((r) => isBounceMessage(String(r.from_email ?? ''), String(r.subject ?? '')))
  const replies = inOurThreads.filter((r) => !isBounceMessage(String(r.from_email ?? ''), String(r.subject ?? '')))

  // A bounce means the address is dead — stop that recipient's sequence and mark
  // it bounced (but do NOT record it as a reply or a conversation).
  if (bounces.length) {
    const bouncedThreads = Array.from(new Set(bounces.map((r) => String(r.gmail_thread_id))))
    await supabase
      .from('engage_campaign_recipients')
      .update({ status: 'stopped', last_error: 'bounced', updated_at: new Date().toISOString() })
      .in('gmail_thread_id', bouncedThreads)
      .in('status', ['pending', 'in_progress'])
  }

  if (!replies.length) return

  // Dedup against already-recorded replies (partial unique index on
  // gmail_message_id; PostgREST can't upsert onto it, so filter first).
  const msgIds = replies.map((r) => String(r.gmail_message_id))
  const { data: existing } = await supabase
    .from('outreach_replies')
    .select('gmail_message_id')
    .in('gmail_message_id', msgIds)
  const seen = new Set((existing ?? []).map((r) => String(r.gmail_message_id)))

  const fresh = replies.filter((r) => !seen.has(String(r.gmail_message_id)))
  if (fresh.length) {
    const rows = fresh.map((r) => {
      const ctx = logByThread.get(String(r.gmail_thread_id))
      return {
        organization_id: mailbox.organization_id,
        lead_id: ctx?.lead_id ?? null,
        email: parseEmailAddress(String(r.from_email ?? '')),
        campaign_id: ctx?.campaign_id ?? null,
        classification: classifyReply(`${r.subject ?? ''} ${r.snippet ?? ''}`),
        replied_at: r.received_at ?? new Date().toISOString(),
        gmail_message_id: String(r.gmail_message_id),
        thread_id: String(r.gmail_thread_id),
      }
    })
    const { error } = await supabase.from('outreach_replies').insert(rows)
    if (error) console.error('[engage-sync] reply insert failed:', error.message)
  }

  // Stop-on-reply: flip campaign recipients whose thread got an answer.
  const repliedThreads = Array.from(new Set(replies.map((r) => String(r.gmail_thread_id))))
  await supabase
    .from('engage_campaign_recipients')
    .update({ status: 'replied', updated_at: new Date().toISOString() })
    .in('gmail_thread_id', repliedThreads)
    .in('status', ['pending', 'in_progress'])
}
