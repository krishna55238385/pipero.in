import { NextRequest, NextResponse } from 'next/server'
import { getGmailMailbox, getValidGmailAccessToken } from '@/app/actions/engage'
import { getThreadById, markThreadRead } from '@/lib/gmail'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const { threadId } = await ctx.params
    const accessToken = await getValidGmailAccessToken()
    const thread = await getThreadById(accessToken, threadId)

    // Opening a thread marks it read — in Gmail and in the local cache — so
    // the unread filter/badge reflects what the user has actually seen.
    try {
      await markThreadRead(accessToken, threadId)
      const supabase = await createClient()
      const mailbox = await getGmailMailbox()
      if (mailbox) {
        await supabase
          .from('engage_emails')
          .update({ unread: false, updated_at: new Date().toISOString() })
          .eq('mailbox_id', mailbox.id)
          .eq('gmail_thread_id', threadId)
      }
    } catch (e) {
      console.error('[engage/thread] mark-read failed:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ thread })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'thread_failed'
    return NextResponse.json({ thread: null, error: message }, { status: 500 })
  }
}
