import { NextResponse } from 'next/server'
import { getGmailMailbox } from '@/app/actions/engage'

export async function GET() {
  try {
    const mailbox = await getGmailMailbox()
    return NextResponse.json({ mailbox })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'failed'
    return NextResponse.json({ mailbox: null, error: message }, { status: 200 })
  }
}

