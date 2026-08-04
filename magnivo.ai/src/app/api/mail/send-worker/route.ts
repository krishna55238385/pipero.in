import { NextRequest, NextResponse } from 'next/server'
import { processSendQueue } from '@/services/mail/send-dispatcher'

/**
 * Campaign send queue worker — invoked by cron / gtm_service pinger.
 * Secured by CRON_SECRET when set.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.ENGAGE_WORKER_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = await req.json().catch(() => ({})) as { orgId?: string }
    const result = await processSendQueue(body.orgId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker failed'
    console.error('[mail/send-worker]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
