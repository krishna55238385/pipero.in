import { NextResponse } from 'next/server'
import { getEngageSequences } from '@/app/actions/engage'

export async function GET() {
  try {
    const sequences = await getEngageSequences()
    return NextResponse.json({ sequences })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'failed'
    return NextResponse.json({ sequences: [], error: message }, { status: 500 })
  }
}

