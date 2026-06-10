import { NextRequest, NextResponse } from 'next/server'
import { getGmailMailbox, getValidGmailAccessToken } from '@/app/actions/engage'
import { isBounceMessage, syncMailboxEmails, type MailboxRow } from '@/lib/engage-sync'
import { createClient } from '@/lib/supabase/server'

// How stale the local cache may get before a read triggers a Gmail pull.
// Keeps the unibox fresh even when the push webhook isn't configured.
const SYNC_STALENESS_MS = 60_000

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const mailbox = (await getGmailMailbox()) as MailboxRow | null
    if (!mailbox) {
      return NextResponse.json({ emails: [] })
    }
    const q = req.nextUrl.searchParams.get('q') || ''
    const unread = req.nextUrl.searchParams.get('unread') === 'true'
    const starred = req.nextUrl.searchParams.get('starred') === 'true'
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true'
    // box: 'inbox' (received), 'sent', or 'all'.
    const box = (req.nextUrl.searchParams.get('box') || 'inbox').toLowerCase()

    // Sync from Gmail when forced (Refresh button) or when the cache is stale.
    const lastSynced = mailbox.last_synced_at ? new Date(mailbox.last_synced_at).getTime() : 0
    let syncError: string | null = null
    if (forceRefresh || Date.now() - lastSynced > SYNC_STALENESS_MS) {
      try {
        const accessToken = await getValidGmailAccessToken()
        await syncMailboxEmails(supabase, mailbox, accessToken, { maxResults: forceRefresh ? 200 : 50 })
      } catch (e) {
        // Serve cached emails even if Gmail is briefly unreachable, but
        // surface the problem instead of hiding it.
        syncError = e instanceof Error ? e.message : 'gmail_sync_failed'
        console.error('[engage/inbox] sync failed:', syncError)
      }
    }

    let query = supabase
      .from('engage_emails')
      .select('*')
      .eq('mailbox_id', mailbox.id)
      .order('received_at', { ascending: false })
      .limit(200)

    if (box === 'sent' || box === 'inbox') {
      query = query.eq('direction', box === 'sent' ? 'sent' : 'received')
    }
    if (unread) query = query.eq('unread', true)
    if (starred) query = query.eq('starred', true)
    if (q) {
      const term = q.replace(/[%,()]/g, ' ').trim()
      if (term) {
        query = query.or(
          `from_email.ilike.%${term}%,to_email.ilike.%${term}%,subject.ilike.%${term}%,snippet.ilike.%${term}%`,
        )
      }
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const emails = (data ?? [])
      // Hide bounce / delivery-failure notifications (mailer-daemon DSNs) from
      // the unibox — they're system noise. The bounce is already reflected as
      // the lead's "bounced" status on the campaign.
      .filter((x) => !isBounceMessage(String(x.from_email ?? ''), String(x.subject ?? '')))
      .map((x) => ({
        id: String(x.gmail_message_id),
        threadId: String(x.gmail_thread_id),
        from: String(x.from_email ?? ''),
        to: String(x.to_email ?? ''),
        subject: String(x.subject ?? ''),
        snippet: String(x.snippet ?? ''),
        date: String(x.date_header ?? x.received_at ?? new Date().toISOString()),
        unread: Boolean(x.unread),
        starred: Boolean(x.starred),
        direction: (x.direction === 'sent' ? 'sent' : 'received') as 'sent' | 'received',
      }))
    return NextResponse.json({ emails, ...(syncError ? { syncError } : {}) })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'inbox_failed'
    return NextResponse.json({ emails: [], error: message }, { status: 500 })
  }
}
