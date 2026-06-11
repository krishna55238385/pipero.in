import { NextRequest, NextResponse } from 'next/server'
import { runWarmupCycle } from '@/lib/engage-warmup'

export const maxDuration = 120

function authorized(req: NextRequest) {
  const expected = process.env.ENGAGE_WORKER_TOKEN
  if (!expected) return process.env.NODE_ENV !== 'production'
  const provided = req.headers.get('x-worker-token') || req.nextUrl.searchParams.get('token')
  return provided === expected
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const report = await runWarmupCycle()
    return NextResponse.json({ ok: true, report })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'warmup_failed'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
