import { NextResponse } from 'next/server'
import { registerGmailWatch } from '@/app/actions/engage'

export async function POST() {
  try {
    await registerGmailWatch()
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'watch_start_failed'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

