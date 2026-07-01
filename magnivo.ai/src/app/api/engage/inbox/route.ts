import { NextRequest, NextResponse } from 'next/server'
import { getGmailMailbox, getValidGmailAccessToken } from '@/app/actions/engage'
import { isBounceMessage, syncMailboxEmails, type MailboxRow } from '@/lib/engage-sync'
import { createClient } from '@/lib/supabase/server'
import pool from '@/lib/db'

// How stale the local cache may get before a read triggers a Gmail pull.
const SYNC_STALENESS_MS = 60_000

export async function GET(req: NextRequest) {
  try {
    const mailbox = (await getGmailMailbox()) as MailboxRow | null
    if (!mailbox) {
      return NextResponse.json({ emails: [] })
    }
    const q = req.nextUrl.searchParams.get('q') || ''
    const unread = req.nextUrl.searchParams.get('unread') === 'true'
    const starred = req.nextUrl.searchParams.get('starred') === 'true'
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true'
    const box = (req.nextUrl.searchParams.get('box') || 'inbox').toLowerCase()

    const lastSynced = mailbox.last_synced_at ? new Date(mailbox.last_synced_at).getTime() : 0
    let syncError: string | null = null
    if (forceRefresh || Date.now() - lastSynced > SYNC_STALENESS_MS) {
      try {
        const accessToken = await getValidGmailAccessToken()
        // syncMailboxEmails uses supabase internally — external lib compat
        const supabase = await createClient()
        await syncMailboxEmails(supabase, mailbox, accessToken, { maxResults: forceRefresh ? 200 : 50 })
      } catch (e) {
        syncError = e instanceof Error ? e.message : 'gmail_sync_failed'
        console.error('[engage/inbox] sync failed:', syncError)
      }
    }

    type EmailRow = Record<string, unknown>
    const mapRow = (x: EmailRow) => ({
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
    })

    const conditions: string[] = ['mailbox_id = $1']
    const params: any[] = [mailbox.id]
    let idx = 2

    if (box === 'sent') { conditions.push(`direction = $${idx++}`); params.push('sent') }
    else if (box === 'inbox') { conditions.push(`direction = $${idx++}`); params.push('received') }
    if (unread) { conditions.push(`unread = $${idx++}`); params.push(true) }
    if (starred) { conditions.push(`starred = $${idx++}`); params.push(true) }
    if (q) {
      const term = q.replace(/[%,()]/g, ' ').trim()
      if (term) {
        conditions.push(`(from_email ILIKE $${idx} OR to_email ILIKE $${idx} OR subject ILIKE $${idx} OR snippet ILIKE $${idx})`)
        params.push(`%${term}%`)
        idx++
      }
    }

    const emailsRes = await pool.query(
      `SELECT * FROM public.engage_emails WHERE ${conditions.join(' AND ')} ORDER BY received_at DESC LIMIT 200`,
      params
    )

    const emails = (emailsRes.rows ?? [])
      .filter((x: any) => !isBounceMessage(String(x.from_email ?? ''), String(x.subject ?? '')))
      .map(mapRow)

    if (box === 'inbox' && !unread && !starred && !q) {
      const present = new Set(emails.map((e) => e.threadId))
      const bouncedRes = await pool.query(
        `SELECT gmail_thread_id FROM public.engage_campaign_recipients
         WHERE organization_id = $1 AND status = 'stopped' AND last_error = 'bounced' AND gmail_thread_id IS NOT NULL`,
        [mailbox.organization_id]
      )
      const missing = [
        ...new Set(
          (bouncedRes.rows ?? [])
            .map((r: any) => String(r.gmail_thread_id))
            .filter((t) => !present.has(t)),
        ),
      ]
      if (missing.length) {
        const sentRowsRes = await pool.query(
          `SELECT * FROM public.engage_emails WHERE mailbox_id = $1 AND direction = 'sent' AND gmail_thread_id = ANY($2) ORDER BY received_at DESC`,
          [mailbox.id, missing]
        )
        const seen = new Set<string>()
        for (const x of sentRowsRes.rows ?? []) {
          const t = String(x.gmail_thread_id)
          if (seen.has(t)) continue
          seen.add(t)
          emails.push(mapRow(x))
        }
        emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      }
    }

    return NextResponse.json({ emails, ...(syncError ? { syncError } : {}) })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'inbox_failed'
    return NextResponse.json({ emails: [], error: message }, { status: 500 })
  }
}
