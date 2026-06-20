import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
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

    const supabase = createServiceClient()
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

    return NextResponse.json({ ok: true })
  } catch (e) {
    // Pub/Sub should receive 2xx to avoid endless retries for malformed payloads.
    console.error('[engage/webhook] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: true })
  }
}
