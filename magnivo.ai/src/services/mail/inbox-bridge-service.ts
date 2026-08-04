import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'
import {
  ingestInboundMessage,
  type InboxThread,
} from './inbox-service'

export type EngageThreadBridgeInput = {
  providerThreadId: string
  mailboxEmail: string
  fromEmail: string
  toEmails: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  providerMessageId?: string
  direction: 'received' | 'sent'
  leadId?: string | null
  campaignId?: string | null
}

async function resolveMailMailboxId(orgId: string, mailboxEmail: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM public.mail_mailboxes
     WHERE organization_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL
     LIMIT 1`,
    [orgId, mailboxEmail.trim()]
  )
  return result.rows[0]?.id ?? null
}

/**
 * Mirrors an Engage inbox thread into mail_inbox_threads/messages when a matching
 * mail_mailbox exists for the same org + email address.
 */
export async function bridgeEngageThreadToMail(
  orgId: string,
  engageThread: EngageThreadBridgeInput
): Promise<MailApiResult<InboxThread | null>> {
  if (engageThread.direction !== 'received') {
    return { success: true, data: null }
  }

  try {
    const mailboxId = await resolveMailMailboxId(orgId, engageThread.mailboxEmail)
    if (!mailboxId) {
      return { success: true, data: null }
    }

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM public.mail_inbox_threads
       WHERE organization_id = $1 AND mailbox_id = $2 AND provider_thread_id = $3
       LIMIT 1`,
      [orgId, mailboxId, engageThread.providerThreadId]
    )
    if (existing.rows[0]) {
      return { success: true, data: null }
    }

    return ingestInboundMessage({
      organizationId: orgId,
      mailboxId,
      fromEmail: engageThread.fromEmail,
      toEmails: engageThread.toEmails,
      subject: engageThread.subject,
      bodyText: engageThread.bodyText,
      bodyHtml: engageThread.bodyHtml,
      providerThreadId: engageThread.providerThreadId,
      providerMessageId: engageThread.providerMessageId,
      campaignId: engageThread.campaignId ?? undefined,
      leadId: engageThread.leadId ?? undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Migration not applied yet — Engage inbox still works from engage_emails
    if (/mail_inbox_threads|does not exist|undefined_table/i.test(message)) {
      return { success: true, data: null }
    }
    return { success: false, error: message }
  }
}

export async function bridgeEngageEmailsForMailbox(
  orgId: string,
  mailboxEmail: string,
  emails: Array<{
    gmailThreadId: string
    gmailMessageId: string
    fromEmail: string
    toEmail: string
    subject: string
    snippet: string
    direction: 'sent' | 'received'
    leadId?: string | null
    campaignId?: string | null
  }>
): Promise<{ bridged: number }> {
  let bridged = 0
  const seenThreads = new Set<string>()

  for (const email of emails) {
    if (email.direction !== 'received') continue
    if (seenThreads.has(email.gmailThreadId)) continue
    seenThreads.add(email.gmailThreadId)

    const result = await bridgeEngageThreadToMail(orgId, {
      providerThreadId: email.gmailThreadId,
      mailboxEmail,
      fromEmail: email.fromEmail,
      toEmails: [email.toEmail].filter(Boolean),
      subject: email.subject,
      bodyText: email.snippet,
      providerMessageId: email.gmailMessageId,
      direction: 'received',
      leadId: email.leadId,
      campaignId: email.campaignId,
    })
    if (result.success && result.data) bridged++
  }

  return { bridged }
}
