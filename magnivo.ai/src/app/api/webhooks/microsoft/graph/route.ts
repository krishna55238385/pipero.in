import { NextRequest, NextResponse } from 'next/server'
import { processGraphNotification } from '@/services/mail/graph-webhook-service'

export async function GET(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (!validationToken) {
    return new NextResponse('Missing validationToken', { status: 400 })
  }
  return new NextResponse(validationToken, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { value: notifications, clientState } = body as {
      value?: unknown[]
      clientState?: string
    }

    const result = await processGraphNotification(undefined, notifications)
    if (!('ok' in result) || !result.ok) {
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[graph-webhook] POST error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true })
  }
}
