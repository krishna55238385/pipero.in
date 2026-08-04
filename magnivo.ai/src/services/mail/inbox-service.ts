import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'

export type InboxThread = {
  id: string
  organizationId: string
  mailboxId: string
  campaignId: string | null
  leadId: string | null
  subject: string
  classification: string
  classificationManual: boolean
  suggestedReply: string | null
  status: string
  lastMessageAt: string
  unreadCount: number
  participants: unknown[]
}

export type InboxMessage = {
  id: string
  threadId: string
  mailboxId: string
  direction: 'inbound' | 'outbound'
  fromEmail: string
  toEmails: string[]
  subject: string
  bodyText: string
  bodyHtml: string
  receivedAt: string
}

function mapThread(row: Record<string, unknown>): InboxThread {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    mailboxId: String(row.mailbox_id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    leadId: row.lead_id ? String(row.lead_id) : null,
    subject: String(row.subject ?? ''),
    classification: String(row.classification ?? 'needs_human_review'),
    classificationManual: Boolean(row.classification_manual),
    suggestedReply: row.suggested_reply ? String(row.suggested_reply) : null,
    status: String(row.status ?? 'open'),
    lastMessageAt: String(row.last_message_at),
    unreadCount: Number(row.unread_count ?? 0),
    participants: Array.isArray(row.participants) ? row.participants : [],
  }
}

export function classifyReplyText(text: string): string {
  const t = text.toLowerCase()
  if (/(out of office|ooo|away from (the )?office|automatic reply)/i.test(t)) return 'ooo'
  if (/(unsubscribe|remove me|stop emailing|opt[- ]?out|do not contact)/i.test(t)) return 'unsubscribe_request'
  if (/(not interested|no thanks|no thank you|pass on this)/i.test(t)) return 'not_interested'
  if (/(interested|let'?s (talk|chat|meet)|book a (call|meeting)|sounds good|tell me more)/i.test(t)) {
    return 'interested'
  }
  if (/(delivery (status )?notification|mail delivery failed|undeliverable|bounce)/i.test(t)) return 'bounce'
  return 'needs_human_review'
}

export function buildSuggestedReply(classification: string, subject: string, bodyText: string): string | null {
  const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 280)
  const topic = subject.replace(/^(re:|fwd:)\s*/gi, '').trim() || 'your note'

  switch (classification) {
    case 'interested':
      return `Thanks for the reply about "${topic}". ${snippet ? `I saw you mentioned: "${snippet.slice(0, 120)}". ` : ''}Happy to share more — what does your calendar look like this week for a 15-minute call?`
    case 'not_interested':
      return `Appreciate you getting back to me about "${topic}". I'll close the loop on my side — if priorities change later, feel free to reach out.`
    case 'ooo':
      return `Thanks for the auto-reply. I'll follow up after you're back in the office.`
    case 'unsubscribe_request':
      return `Understood — I've removed you from future outreach. Sorry for the interruption.`
    case 'needs_human_review':
      return `Thanks for your message about "${topic}". ${snippet ? `Re: "${snippet.slice(0, 100)}" — ` : ''}let me review and get back to you shortly with a thoughtful response.`
    default:
      return null
  }
}

export async function pauseEnrollmentOnReply(orgId: string, leadId: string, reason = 'reply_received'): Promise<number> {
  const result = await pool.query(
    `UPDATE public.mail_enrollments
     SET status = 'paused', pause_reason = $3, updated_at = NOW()
     WHERE organization_id = $1 AND lead_id = $2 AND status = 'active'`,
    [orgId, leadId, reason]
  )
  return result.rowCount ?? 0
}

export async function listInboxThreads(
  orgId: string,
  opts?: { mailboxId?: string; campaignId?: string; classification?: string; search?: string; limit?: number }
): Promise<InboxThread[]> {
  const params: unknown[] = [orgId]
  let where = 'organization_id = $1 AND status != \'archived\''
  if (opts?.mailboxId) {
    params.push(opts.mailboxId)
    where += ` AND mailbox_id = $${params.length}`
  }
  if (opts?.campaignId) {
    params.push(opts.campaignId)
    where += ` AND campaign_id = $${params.length}`
  }
  if (opts?.classification && opts.classification !== 'all') {
    params.push(opts.classification)
    where += ` AND classification = $${params.length}`
  }
  if (opts?.search) {
    params.push(`%${opts.search.toLowerCase()}%`)
    where += ` AND LOWER(subject) LIKE $${params.length}`
  }
  params.push(opts?.limit ?? 50)
  const result = await pool.query(
    `SELECT * FROM public.mail_inbox_threads
     WHERE ${where}
     ORDER BY last_message_at DESC
     LIMIT $${params.length}`,
    params
  )
  return result.rows.map(mapThread)
}

export async function getInboxThread(threadId: string, orgId: string): Promise<{
  thread: InboxThread | null
  messages: InboxMessage[]
}> {
  const threadResult = await pool.query(
    `SELECT * FROM public.mail_inbox_threads WHERE id = $1 AND organization_id = $2`,
    [threadId, orgId]
  )
  if (!threadResult.rows[0]) return { thread: null, messages: [] }
  const messagesResult = await pool.query(
    `SELECT * FROM public.mail_inbox_messages
     WHERE thread_id = $1 AND organization_id = $2
     ORDER BY received_at ASC`,
    [threadId, orgId]
  )
  return {
    thread: mapThread(threadResult.rows[0]),
    messages: messagesResult.rows.map((row) => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      mailboxId: String(row.mailbox_id),
      direction: row.direction as 'inbound' | 'outbound',
      fromEmail: String(row.from_email ?? ''),
      toEmails: (row.to_emails as string[]) ?? [],
      subject: String(row.subject ?? ''),
      bodyText: String(row.body_text ?? ''),
      bodyHtml: String(row.body_html ?? ''),
      receivedAt: String(row.received_at),
    })),
  }
}

export async function ingestInboundMessage(input: {
  organizationId: string
  mailboxId: string
  fromEmail: string
  toEmails: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  providerThreadId?: string
  providerMessageId?: string
  campaignId?: string
  leadId?: string
}): Promise<MailApiResult<InboxThread>> {
  const classification = classifyReplyText(`${input.subject}\n${input.bodyText}`)
  const suggestedReply = buildSuggestedReply(classification, input.subject, input.bodyText)

  let resolvedLeadId = input.leadId ?? null
  if (!resolvedLeadId && input.fromEmail) {
    const lead = await pool.query<{ id: string }>(
      `SELECT id FROM public.mail_leads WHERE organization_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
      [input.organizationId, input.fromEmail]
    )
    resolvedLeadId = lead.rows[0]?.id ?? null
  }

  let threadId: string | null = null
  if (input.providerThreadId) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM public.mail_inbox_threads
       WHERE organization_id = $1 AND mailbox_id = $2 AND provider_thread_id = $3
       LIMIT 1`,
      [input.organizationId, input.mailboxId, input.providerThreadId]
    )
    threadId = existing.rows[0]?.id ?? null
  }

  let thread: InboxThread
  if (threadId) {
    const updated = await pool.query(
      `UPDATE public.mail_inbox_threads
       SET classification = $4,
           suggested_reply = COALESCE($5, suggested_reply),
           unread_count = unread_count + 1,
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [threadId, input.organizationId, input.mailboxId, classification, suggestedReply]
    )
    thread = mapThread(updated.rows[0])
  } else {
    const threadResult = await pool.query(
      `INSERT INTO public.mail_inbox_threads
        (organization_id, mailbox_id, campaign_id, lead_id, provider_thread_id, subject,
         participants, classification, suggested_reply, unread_count, last_message_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,1,NOW())
       RETURNING *`,
      [
        input.organizationId,
        input.mailboxId,
        input.campaignId ?? null,
        resolvedLeadId,
        input.providerThreadId ?? null,
        input.subject,
        JSON.stringify([input.fromEmail, ...input.toEmails]),
        classification,
        suggestedReply,
      ]
    )
    thread = mapThread(threadResult.rows[0])
    threadId = thread.id
  }

  if (!input.providerMessageId || !(await pool.query(
    `SELECT 1 FROM public.mail_inbox_messages
     WHERE organization_id = $1 AND provider_message_id = $2 LIMIT 1`,
    [input.organizationId, input.providerMessageId]
  )).rows[0]) {
    await pool.query(
      `INSERT INTO public.mail_inbox_messages
        (organization_id, thread_id, mailbox_id, provider_message_id, direction,
         from_email, to_emails, subject, body_text, body_html)
       VALUES ($1,$2,$3,$4,'inbound',$5,$6,$7,$8,$9)`,
      [
        input.organizationId,
        threadId,
        input.mailboxId,
        input.providerMessageId ?? null,
        input.fromEmail,
        input.toEmails,
        input.subject,
        input.bodyText,
        input.bodyHtml ?? '',
      ]
    )
  }

  if (resolvedLeadId) {
    await pauseEnrollmentOnReply(input.organizationId, resolvedLeadId, `auto_pause:${classification}`)
    if (classification === 'bounce') {
      await pool.query(
        `UPDATE public.mail_enrollments
         SET status = 'bounced', pause_reason = $3, updated_at = NOW()
         WHERE organization_id = $1 AND lead_id = $2 AND status IN ('active', 'paused')`,
        [input.organizationId, resolvedLeadId, `auto_pause:${classification}`]
      )
    }
  }

  if (classification === 'unsubscribe_request' && input.fromEmail) {
    const { suppressEmail } = await import('./suppression-service')
    await suppressEmail(input.organizationId, input.fromEmail, 'reply_unsubscribe', 'inbox', resolvedLeadId)
  }

  return { success: true, data: thread }
}

export async function ingestInboundReply(input: {
  organizationId: string
  mailboxId: string
  fromEmail: string
  toEmails: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  providerThreadId?: string
  providerMessageId?: string
  campaignId?: string
  leadId?: string
}): Promise<MailApiResult<InboxThread>> {
  return ingestInboundMessage(input)
}

export async function updateThreadClassification(
  threadId: string,
  orgId: string,
  classification: string
): Promise<MailApiResult<InboxThread>> {
  const result = await pool.query(
    `UPDATE public.mail_inbox_threads
     SET classification = $3, classification_manual = TRUE, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [threadId, orgId, classification]
  )
  if (!result.rows[0]) return { success: false, error: 'Thread not found' }
  return { success: true, data: mapThread(result.rows[0]) }
}

export async function bulkUpdateThreads(
  orgId: string,
  threadIds: string[],
  action: 'mark_reviewed' | 'archive' | 'suppress'
): Promise<MailApiResult<number>> {
  if (threadIds.length === 0) return { success: true, data: 0 }
  if (action === 'suppress') {
    const threads = await pool.query(
      `SELECT id, lead_id FROM public.mail_inbox_threads
       WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [orgId, threadIds]
    )
    const { suppressEmail } = await import('./suppression-service')
    for (const t of threads.rows) {
      const msgs = await pool.query(
        `SELECT from_email FROM public.mail_inbox_messages
         WHERE thread_id = $1 AND direction = 'inbound' ORDER BY received_at DESC LIMIT 1`,
        [t.id]
      )
      if (msgs.rows[0]?.from_email) {
        await suppressEmail(orgId, msgs.rows[0].from_email, 'manual_inbox', 'inbox', t.lead_id)
      }
    }
  }
  const status = action === 'archive' ? 'archived' : action === 'suppress' ? 'suppressed' : 'reviewed'
  const result = await pool.query(
    `UPDATE public.mail_inbox_threads
     SET status = $3, updated_at = NOW()
     WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [orgId, threadIds, status]
  )
  return { success: true, data: result.rowCount ?? 0 }
}

export async function regenerateSuggestedReply(
  threadId: string,
  orgId: string
): Promise<MailApiResult<string>> {
  const { thread, messages } = await getInboxThread(threadId, orgId)
  if (!thread) return { success: false, error: 'Thread not found' }
  const lastIn = [...messages].reverse().find((m) => m.direction === 'inbound')
  const classification = thread.classification || classifyReplyText(lastIn?.bodyText || '')
  const suggested = buildSuggestedReply(classification, thread.subject, lastIn?.bodyText || '')
  if (!suggested) return { success: false, error: 'No suggestion for this classification' }
  await pool.query(
    `UPDATE public.mail_inbox_threads
     SET suggested_reply = $3, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [threadId, orgId, suggested]
  )
  return { success: true, data: suggested }
}

/** Send a reply from the thread's mailbox (PRD §6.6.10). */
export async function sendInboxReply(
  threadId: string,
  orgId: string,
  bodyText: string
): Promise<MailApiResult<{ messageId: string }>> {
  const { thread, messages } = await getInboxThread(threadId, orgId)
  if (!thread) return { success: false, error: 'Thread not found' }
  const lastIn = [...messages].reverse().find((m) => m.direction === 'inbound')
  if (!lastIn) return { success: false, error: 'No inbound message to reply to' }

  const mailboxRepo = await import('@/repositories/mail/mailbox-repository')
  const mailbox = await mailboxRepo.findMailboxWithConfigs(thread.mailboxId, orgId)
  if (!mailbox) return { success: false, error: 'Mailbox not found' }

  const subject = thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`
  const to = lastIn.fromEmail

  try {
    if (mailbox.authType === 'oauth' && mailbox.oauthConfig?.encryptedRefreshToken) {
      const { decrypt } = await import('@/lib/encryption')
      const { getOAuthService } = await import('./oauth')
      const refresh = decrypt(mailbox.oauthConfig.encryptedRefreshToken)
      const service = getOAuthService(mailbox.oauthConfig.provider)
      const tokens = await service.refreshToken(refresh)
      if (mailbox.oauthConfig.provider === 'gmail') {
        const { sendEmail } = await import('@/lib/gmail')
        const result = await sendEmail(tokens.accessToken, {
          to,
          subject,
          bodyText,
          bodyHtml: `<p>${bodyText.replace(/\n/g, '<br/>')}</p>`,
        })
        await pool.query(
          `INSERT INTO public.mail_inbox_messages
            (organization_id, thread_id, mailbox_id, direction, from_email, to_emails, subject, body_text, body_html, received_at)
           VALUES ($1,$2,$3,'outbound',$4,$5::text[],$6,$7,$8,NOW())`,
          [
            orgId,
            threadId,
            thread.mailboxId,
            mailbox.email,
            [to],
            subject,
            bodyText,
            `<p>${bodyText.replace(/\n/g, '<br/>')}</p>`,
          ]
        ).catch(() => {})
        return { success: true, data: { messageId: result?.id || 'sent' } }
      }
    }

    if (!mailbox.smtpConfig) return { success: false, error: 'SMTP not configured for reply' }
    const { decrypt } = await import('@/lib/encryption')
    const nodemailer = await import('nodemailer')
    const password = decrypt(mailbox.smtpConfig.encryptedPasswordReference)
    const transport = nodemailer.createTransport({
      host: mailbox.smtpConfig.smtpHost,
      port: mailbox.smtpConfig.smtpPort,
      secure: mailbox.smtpConfig.encryption === 'ssl',
      auth: { user: mailbox.smtpConfig.username, pass: password },
    })
    try {
      const info = await transport.sendMail({
        from: mailbox.email,
        to,
        subject,
        text: bodyText,
        html: `<p>${bodyText.replace(/\n/g, '<br/>')}</p>`,
      })
      await pool.query(
        `INSERT INTO public.mail_inbox_messages
          (organization_id, thread_id, mailbox_id, direction, from_email, to_emails, subject, body_text, body_html, received_at)
         VALUES ($1,$2,$3,'outbound',$4,$5::text[],$6,$7,$8,NOW())`,
        [
          orgId,
          threadId,
          thread.mailboxId,
          mailbox.email,
          [to],
          subject,
          bodyText,
          `<p>${bodyText.replace(/\n/g, '<br/>')}</p>`,
        ]
      ).catch(() => {})
      return { success: true, data: { messageId: info.messageId || 'sent' } }
    } finally {
      transport.close()
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Reply failed' }
  }
}
