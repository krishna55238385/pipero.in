import { NextRequest, NextResponse } from 'next/server'
import { getGmailMailbox, getValidGmailAccessToken } from '@/app/actions/engage'
import { getThreadById, markThreadRead } from '@/lib/gmail'
import pool from '@/lib/db'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const { threadId } = await ctx.params
    const accessToken = await getValidGmailAccessToken()
    const thread = await getThreadById(accessToken, threadId)

    // Opening a thread marks it read — in Gmail and in the local cache — so
    // the unread filter/badge reflects what the user has actually seen.
    try {
      await markThreadRead(accessToken, threadId)
      const mailbox = await getGmailMailbox()
      if (mailbox) {
        await pool.query(
          `UPDATE public.engage_emails SET unread = false, updated_at = $1 WHERE mailbox_id = $2 AND gmail_thread_id = $3`,
          [new Date().toISOString(), mailbox.id, threadId]
        )
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
