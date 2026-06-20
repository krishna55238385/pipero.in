import { NextResponse } from 'next/server'
import { getUniboxMeta } from '@/app/actions/engage'

// Lightweight read of the Unibox left-rail metadata (status counts, campaigns,
// mailboxes, and per-thread campaign/interest mapping) so the client InboxClient
// can fetch it without importing the server action directly.
export async function GET() {
  try {
    const meta = await getUniboxMeta()
    return NextResponse.json(meta)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unibox_meta_failed'
    return NextResponse.json(
      { byThread: {}, campaigns: [], mailboxes: [], statusCounts: {}, error: message },
      { status: 500 },
    )
  }
}
