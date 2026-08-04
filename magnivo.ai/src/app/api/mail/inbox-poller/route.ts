import { NextRequest, NextResponse } from 'next/server'
import { pollImapInboxes } from '@/services/mail/imap-inbox-poller'

export async function POST(req: NextRequest) {
  try {
    const secret =
      process.env.CRON_SECRET ||
      process.env.ENGAGE_WORKER_SECRET ||
      process.env.MAIL_WORKER_SECRET
    if (secret) {
      const auth = req.headers.get('authorization') || ''
      const token = auth.replace(/^Bearer\s+/i, '')
      if (token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = (await req.json().catch(() => ({}))) as { orgId?: string }
    const result = await pollImapInboxes(body.orgId)
    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'imap_poll_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
