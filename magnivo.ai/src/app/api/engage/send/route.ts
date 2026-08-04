import { NextRequest, NextResponse } from 'next/server'
import { getValidGmailAccessToken } from '@/app/actions/engage'
import { getMessageSummaryById, sendEmail } from '@/lib/gmail'
import { summaryToRow, type MailboxRow } from '@/lib/engage-sync'
import { createClient } from '@/lib/supabase/server'
import { loadAttachments } from '@/lib/engage-attachments'
import type { ComposePayload } from '@/types/engage'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ComposePayload
    if (!body?.to || !body?.subject || !body?.bodyHtml) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const recipient = String(body.to).toLowerCase().trim()
    const supabase = await createClient()

    // Resolve org + (optional) AI lead, and enforce the unsubscribe suppression
    // list before any send — opt-outs must be honored regardless of UI.
    let orgId: string | undefined
    let leadRawId: number | null = null
    try {
      const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
      orgId = org?.id
      if (recipient) {
        const { data: unsub } = await supabase
          .from('outreach_unsubscribes')
          .select('email')
          .eq('email', recipient)
          .limit(1)
        if (unsub && unsub.length) {
          return NextResponse.json(
            { ok: false, error: 'Recipient has unsubscribed — send suppressed.' },
            { status: 409 },
          )
        }
      }
      if (orgId && recipient) {
        const { data: lr } = await supabase
          .from('leads_raw')
          .select('id')
          .eq('organization_id', orgId)
          .ilike('contact_email', recipient)
          .limit(1)
        leadRawId = lr?.[0]?.id ?? null
      }
    } catch (e) {
      // If the suppression check itself fails we still proceed with the send,
      // but we never silently send to a known opt-out (handled above).
      console.error('[engage/send] suppression check failed:', e instanceof Error ? e.message : e)
    }

    const accessToken = await getValidGmailAccessToken()
    const attachments = await loadAttachments(supabase, body.attachments ?? [])

    // RFC 8058 one-click unsubscribe on every send
    let headers = { ...(body.headers || {}) }
    if (orgId && recipient) {
      try {
        const { isSuppressed, createUnsubscribeToken, buildListUnsubscribeHeaders } = await import(
          '@/services/mail/suppression-service'
        )
        if (await isSuppressed(orgId, recipient)) {
          return NextResponse.json(
            { ok: false, error: 'Recipient is on the suppression list — send blocked.' },
            { status: 409 },
          )
        }
        const token = await createUnsubscribeToken(orgId, recipient)
        const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.magnivo.ai'
        const unsubUrl = `${base}/api/track/unsubscribe?token=${encodeURIComponent(token)}`
        headers = { ...headers, ...buildListUnsubscribeHeaders(unsubUrl) }
        if (!/unsubscribe/i.test(body.bodyHtml)) {
          body.bodyHtml = `${body.bodyHtml}<br/><p style="font-size:12px;color:#64748b"><a href="${unsubUrl}">Unsubscribe</a></p>`
        }
      } catch (e) {
        console.error('[engage/send] unsubscribe header failed:', e instanceof Error ? e.message : e)
      }
    }

    const sent = await sendEmail(accessToken, { ...body, headers }, attachments)
    if (!sent?.id) {
      return NextResponse.json({ ok: false, error: 'Gmail did not return a message id' }, { status: 502 })
    }

    // Mirror the sent message into engage_emails so it shows up in the Sent
    // box immediately. Fetch the real summary from Gmail so threading/labels
    // are accurate (the send response's threadId can be missing).
    let threadId = sent.threadId ?? body.threadId ?? sent.id
    try {
      let mbQuery = supabase
        .from('engage_mailboxes')
        .select('*')
        .order('connected_at', { ascending: false })
        .limit(1)
      if (orgId) mbQuery = mbQuery.eq('organization_id', orgId)
      const { data: mailbox } = await mbQuery.maybeSingle()
      if (mailbox) {
        const mb = mailbox as MailboxRow
        let row
        try {
          const summary = await getMessageSummaryById(accessToken, sent.id)
          threadId = summary.threadId || threadId
          row = summaryToRow(mb, summary)
        } catch {
          // Gmail metadata fetch failed — fall back to what we know locally.
          const nowIso = new Date().toISOString()
          row = {
            mailbox_id: mb.id,
            organization_id: mb.organization_id,
            user_id: mb.user_id,
            gmail_message_id: sent.id,
            gmail_thread_id: threadId,
            from_email: mb.email,
            to_email: recipient,
            subject: body.subject,
            snippet: body.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
            date_header: nowIso,
            received_at: nowIso,
            unread: false,
            starred: false,
            label_ids: ['SENT'],
            direction: 'sent' as const,
            updated_at: nowIso,
          }
        }
        const { error: mirrorError } = await supabase
          .from('engage_emails')
          .upsert(row, { onConflict: 'mailbox_id,gmail_message_id' })
        if (mirrorError) console.error('[engage/send] sent mirror failed:', mirrorError.message)
      }
    } catch (e) {
      console.error('[engage/send] sent mirror failed:', e instanceof Error ? e.message : e)
    }

    // Log the send so analytics (sent count / reply correlation) see it.
    if (orgId) {
      try {
        const { error: logError } = await supabase.from('outreach_log').insert({
          organization_id: orgId,
          lead_id: leadRawId,
          contact_email: recipient,
          campaign_id: 'manual',
          channel: 'email',
          variant_subject: body.subject,
          status: 'sent',
          sent_at: new Date().toISOString(),
          message_id: sent.id,
          thread_id: threadId,
        })
        if (logError) console.error('[engage/send] outreach_log insert failed:', logError.message)
      } catch (logErr) {
        console.error('[engage/send] outreach_log insert failed:', logErr instanceof Error ? logErr.message : logErr)
      }
    }

    return NextResponse.json({ ok: true, id: sent.id, threadId })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'send_failed'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
