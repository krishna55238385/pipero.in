import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMailboxAccessToken, syncMailboxFromHistory, type MailboxRow } from '@/lib/engage-sync'

function decodePushData(input: string) {
  const raw = Buffer.from(input, 'base64').toString('utf8')
  return JSON.parse(raw) as { emailAddress?: string; historyId?: string }
}

export async function POST(req: NextRequest) {
  try {
    const verifyToken = process.env.ENGAGE_GMAIL_WEBHOOK_TOKEN
    if (verifyToken) {
      const token = req.nextUrl.searchParams.get('token')
      if (token !== verifyToken) return NextResponse.json({ ok: false }, { status: 401 })
    }

    const body = (await req.json()) as { message?: { data?: string } }
    const encoded = body?.message?.data
    if (!encoded) return NextResponse.json({ ok: true })

    const payload = decodePushData(encoded)
    const email = payload.emailAddress
    if (!email) return NextResponse.json({ ok: true })

    const supabase = await createClient()
    const { data: mailbox, error } = await supabase
      .from('engage_mailboxes')
      .select('*')
      .eq('provider', 'gmail')
      .eq('email', email)
      .limit(1)
      .maybeSingle()
    if (error || !mailbox) return NextResponse.json({ ok: true })

    const mb = mailbox as MailboxRow
    const accessToken = await getMailboxAccessToken(supabase, mb)
    await syncMailboxFromHistory(supabase, mb, accessToken)

    try {
      const { data: received } = await supabase
        .from('engage_emails')
        .select('gmail_message_id, gmail_thread_id, from_email, to_email, subject, snippet, direction')
        .eq('mailbox_id', mb.id)
        .eq('direction', 'received')
        .order('received_at', { ascending: false })
        .limit(50)
      if (received?.length) {
        const { bridgeEngageEmailsForMailbox } = await import('@/services/mail/inbox-bridge-service')
        await bridgeEngageEmailsForMailbox(mb.organization_id, mb.email, received.map((row) => ({
          gmailThreadId: String(row.gmail_thread_id),
          gmailMessageId: String(row.gmail_message_id),
          fromEmail: String(row.from_email ?? ''),
          toEmail: String(row.to_email ?? ''),
          subject: String(row.subject ?? ''),
          snippet: String(row.snippet ?? ''),
          direction: 'received' as const,
        })))
      }
    } catch (bridgeErr) {
      console.error('[engage/webhook] mail bridge failed:', bridgeErr instanceof Error ? bridgeErr.message : bridgeErr)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    // Pub/Sub should receive 2xx to avoid endless retries for malformed payloads.
    console.error('[engage/webhook] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: true })
  }
}
