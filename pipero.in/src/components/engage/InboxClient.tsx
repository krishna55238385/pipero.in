'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, MailPlus, RefreshCw, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmailList, { type EmailRowMeta } from '@/components/engage/EmailList'
import EmailThread from '@/components/engage/EmailThread'
import ComposeModal from '@/components/engage/ComposeModal'
import AIWriterPanel from '@/components/engage/AIWriterPanel'
import UniboxRail, { type InboxScope } from '@/components/engage/UniboxRail'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { INTEREST_STATUSES, type EngageEmailSummary, type EngageThread, type InterestStatus, type UniboxMeta } from '@/types/engage'
import { setThreadInterest } from '@/app/actions/engage'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'

type Mailbox = { email?: string } | null

const EMPTY_META: UniboxMeta = { byThread: {}, campaigns: [], mailboxes: [], statusCounts: {} }

// Friendly labels for the lead-status dropdown on the thread header.
const STATUS_LABELS: Record<InterestStatus, string> = {
  lead: 'Lead',
  interested: 'Interested',
  meeting_booked: 'Meeting booked',
  meeting_completed: 'Meeting completed',
  won: 'Won',
  no_show: 'No show',
  out_of_office: 'Out of office',
  wrong_person: 'Wrong person',
  not_interested: 'Not interested',
}

/** Extract the bare email address out of a `Name <email@x.com>` header value. */
function addressOf(value: string | undefined): string {
  if (!value) return ''
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase()
}

export default function InboxClient({ mailbox }: { mailbox: Mailbox }) {
  const [mailboxEmail, setMailboxEmail] = useState(mailbox?.email || '')
  const [emails, setEmails] = useState<EngageEmailSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [thread, setThread] = useState<EngageThread | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [search, setSearch] = useState('')
  const [box, setBox] = useState<'inbox' | 'sent'>('inbox')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [starredOnly, setStarredOnly] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [seedSubject, setSeedSubject] = useState('')
  const [seedBody, setSeedBody] = useState('')
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')

  // Unibox metadata + active left-rail filters (Instantly-style).
  const [meta, setMeta] = useState<UniboxMeta>(EMPTY_META)
  // Primary split: campaign mail (leads you work) vs other (random Gmail) vs all.
  const [scope, setScope] = useState<InboxScope>('campaigns')
  const [activeStatus, setActiveStatus] = useState<InterestStatus | null>(null)
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
  const [activeMailbox, setActiveMailbox] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)

  // Mobile/tablet (below xl) is a single-pane flow: the email list and the
  // open thread can't sit side-by-side, so we toggle between them. The filter
  // rail lives behind a slide-over sheet. Desktop (xl+) ignores these.
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  // Switching scope clears the status/campaign filters (they only apply to
  // campaign mail, so they'd hide everything in the "Other" bucket).
  const changeScope = useCallback((next: InboxScope) => {
    setScope(next)
    if (next !== 'campaigns') {
      setActiveStatus(null)
      setActiveCampaignId(null)
    }
  }, [])

  const canUseInbox = Boolean(mailboxEmail)

  // Ref always holds the current filters so the ref-stable loader (used by
  // realtime + polling effects) always refetches with up-to-date values
  // instead of closing over stale state.
  const filtersRef = useRef({ box, search, unreadOnly, starredOnly, canUseInbox })
  filtersRef.current = { box, search, unreadOnly, starredOnly, canUseInbox }

  const loadInbox = useCallback(async (opts?: { refresh?: boolean }) => {
    const { box, search, unreadOnly, starredOnly, canUseInbox } = filtersRef.current
    if (!canUseInbox) return
    setError('')
    setLoadingList(true)
    try {
      const url = new URL('/api/engage/inbox', window.location.origin)
      url.searchParams.set('box', box)
      if (search) url.searchParams.set('q', search)
      if (unreadOnly) url.searchParams.set('unread', 'true')
      if (starredOnly) url.searchParams.set('starred', 'true')
      // Only the manual Refresh button forces a deep Gmail sync; polling and
      // realtime refetches stay cheap cache reads.
      if (opts?.refresh) url.searchParams.set('refresh', 'true')
      const res = await fetch(url.toString())
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load inbox')
      setEmails(data.emails || [])
      setSyncError(typeof data?.syncError === 'string' ? data.syncError : '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load inbox')
    } finally {
      setLoadingList(false)
    }
  }, [])

  const refreshMailbox = useCallback(async () => {
    try {
      const res = await fetch('/api/engage/gmail/mailbox', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) {
        setMailboxEmail(data?.mailbox?.email || '')
      }
    } catch {
      // noop
    }
  }, [])

  const loadThread = useCallback(async (threadId: string) => {
    setLoadingThread(true)
    try {
      const res = await fetch(`/api/engage/inbox/${threadId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load thread')
      setThread(data.thread || null)
    } catch {
      setThread(null)
    } finally {
      setLoadingThread(false)
    }
  }, [])

  // Loads the Unibox left-rail metadata (status counts, campaigns, mailboxes,
  // and per-thread campaign/interest mapping) used for the filters + row chips.
  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/engage/unibox-meta', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) setMeta(data as UniboxMeta)
    } catch {
      // noop — rail just renders empty filters
    }
  }, [])

  useEffect(() => {
    loadInbox()
  }, [canUseInbox, unreadOnly, starredOnly, box, loadInbox])

  // Load unibox meta on mount.
  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  useEffect(() => {
    if (!canUseInbox) return
    const t = window.setTimeout(() => {
      loadInbox()
    }, 300)
    return () => window.clearTimeout(t)
  }, [search, canUseInbox, loadInbox])

  useEffect(() => {
    if (!canUseInbox) return
    const timer = window.setInterval(() => {
      // ref-stable loader reads the current box/search/filters from filtersRef
      loadInbox()
      loadMeta()
      if (activeThreadId) loadThread(activeThreadId)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [canUseInbox, activeThreadId, loadInbox, loadMeta, loadThread])

  useEffect(() => {
    const supabase = createSupabaseClient()
    const mailboxChannel = supabase
      .channel('engage-mailbox-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engage_mailboxes' }, async () => {
        await refreshMailbox()
        // ref-stable loader refetches with the current filters
        await loadInbox()
      })
      .subscribe()
    const emailsChannel = supabase
      .channel('engage-emails-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engage_emails' }, async () => {
        // ref-stable loader refetches with the current filters
        await loadInbox()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(mailboxChannel)
      supabase.removeChannel(emailsChannel)
    }
  }, [refreshMailbox, loadInbox])

  const subtitle = useMemo(() => {
    if (!canUseInbox) return 'Connect Gmail in Engage Settings to view your inbox.'
    return mailboxEmail ? `Connected mailbox: ${mailboxEmail}` : ''
  }, [mailboxEmail, canUseInbox])

  // Per-thread campaign/interest map passed to the list for row chips.
  const threadMeta = meta.byThread as Record<string, EmailRowMeta>

  // Counts for the scope toggle (relative to what's currently loaded/synced).
  const scopeCounts = useMemo<Record<InboxScope, number>>(() => {
    let campaigns = 0
    for (const e of emails) if (meta.byThread[e.threadId]) campaigns += 1
    return { all: emails.length, campaigns, others: emails.length - campaigns }
  }, [emails, meta.byThread])

  // Apply the scope split + active Unibox filters (status / campaign / mailbox).
  const filteredEmails = useMemo(() => {
    const mailbox = activeMailbox?.toLowerCase() ?? null
    return emails.filter((email) => {
      const tm = meta.byThread[email.threadId]
      const isCampaignMail = Boolean(tm)
      // Primary scope split.
      if (scope === 'campaigns' && !isCampaignMail) return false
      if (scope === 'others' && isCampaignMail) return false
      // Status/campaign filters only apply to campaign mail.
      if (scope !== 'others') {
        if (activeStatus && (tm?.interestStatus ?? 'lead') !== activeStatus) return false
        if (activeCampaignId && tm?.campaignId !== activeCampaignId) return false
      }
      if (mailbox) {
        const from = addressOf(email.from)
        const to = addressOf(email.to)
        if (from !== mailbox && to !== mailbox) return false
      }
      return true
    })
  }, [emails, meta.byThread, scope, activeStatus, activeCampaignId, activeMailbox])

  // Current interest status for the open thread (defaults to 'lead').
  const activeThreadStatus: InterestStatus =
    (activeThreadId ? meta.byThread[activeThreadId]?.interestStatus : undefined) ?? 'lead'
  // Only threads that map to a campaign recipient can have their status set.
  const canSetStatus = Boolean(activeThreadId && meta.byThread[activeThreadId])

  const handleThreadStatusChange = useCallback(
    async (status: InterestStatus) => {
      if (!activeThreadId) return
      setSavingStatus(true)
      try {
        await setThreadInterest(activeThreadId, status)
        await loadMeta()
      } catch {
        // noop — meta reload keeps UI consistent with the server
      } finally {
        setSavingStatus(false)
      }
    },
    [activeThreadId, loadMeta],
  )

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Engage Inbox</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filters live in the rail on desktop; on mobile/tablet they open in
              a slide-over sheet from this button. */}
          <Button
            type="button"
            variant="outline"
            className="xl:hidden"
            onClick={() => setMobileFiltersOpen(true)}
            disabled={!canUseInbox}
          >
            <SlidersHorizontal className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button type="button" variant="outline" onClick={() => loadInbox({ refresh: true })} disabled={!canUseInbox || loadingList}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loadingList ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            type="button"
            onClick={() => {
              // Plain compose: clear any stale AI-writer seed content
              setSeedSubject('')
              setSeedBody('')
              setComposeOpen(true)
            }}
            disabled={!canUseInbox}
          >
            <MailPlus className="h-4 w-4 mr-2" />
            Compose
          </Button>
        </div>
      </div>

      {syncError ? <p className="text-xs text-amber-500">Gmail sync issue: {syncError}</p> : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {(() => {
        // Shared panel content — defined once and reused across the desktop
        // resizable group and the mobile single-pane flow so there's exactly
        // one set of handlers/state wiring (no duplicated logic).
        const railEl = (
          <UniboxRail
            meta={meta}
            scope={scope}
            scopeCounts={scopeCounts}
            onScopeChange={changeScope}
            activeStatus={activeStatus}
            activeCampaignId={activeCampaignId}
            activeMailbox={activeMailbox}
            onStatusChange={setActiveStatus}
            onCampaignChange={setActiveCampaignId}
            onMailboxChange={setActiveMailbox}
          />
        )

        const listEl = (
          <EmailList
            emails={filteredEmails}
            threadMeta={threadMeta}
            activeThreadId={activeThreadId}
            box={box}
            onBoxChange={(next) => {
              setBox(next)
              setActiveThreadId(null)
              setThread(null)
              setMobileView('list')
            }}
            search={search}
            onSearchChange={setSearch}
            unreadOnly={unreadOnly}
            starredOnly={starredOnly}
            onToggleUnread={() => setUnreadOnly((v) => !v)}
            onToggleStarred={() => setStarredOnly((v) => !v)}
            onSelect={(email) => {
              setActiveThreadId(email.threadId)
              loadThread(email.threadId)
              // On mobile/tablet, tapping a row swaps the list out for the
              // full-width thread; desktop shows both at once.
              setMobileView('thread')
            }}
            loading={loadingList}
          />
        )

        const threadEl = (
          <div className="flex h-full min-h-0 flex-col gap-2">
            {/* Lead-status control for the open thread (Unibox interest label). */}
            {activeThreadId ? (
              <div className="flex shrink-0 items-center gap-2 rounded-xl border bg-card px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Lead status</span>
                <select
                  value={activeThreadStatus}
                  disabled={!canSetStatus || savingStatus}
                  onChange={(e) => handleThreadStatusChange(e.target.value as InterestStatus)}
                  className="ml-auto rounded-lg border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
                  title={canSetStatus ? 'Set the lead interest status' : 'No campaign recipient is linked to this thread'}
                >
                  {INTEREST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="min-h-0 flex-1">
              <EmailThread
                thread={thread}
                loading={loadingThread}
                onReplied={() => {
                  if (activeThreadId) loadThread(activeThreadId)
                  loadInbox()
                }}
              />
            </div>
          </div>
        )

        const aiWriterEl = (
          <AIWriterPanel
            onUse={(subject, bodyHtml) => {
              setSeedSubject(subject)
              setSeedBody(bodyHtml)
              setComposeOpen(true)
            }}
          />
        )

        return (
          <>
            {/* ── Mobile / tablet (below xl): single-pane flow ────────────── */}
            <div className="flex flex-1 min-h-0 flex-col xl:hidden">
              {mobileView === 'list' ? (
                <div className="flex-1 min-h-0">{listEl}</div>
              ) : (
                <div className="flex flex-1 min-h-0 flex-col gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-fit shrink-0"
                    onClick={() => setMobileView('list')}
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to inbox
                  </Button>
                  <div className="min-h-0 flex-1">{threadEl}</div>
                </div>
              )}
            </div>

            {/* Mobile filters slide-over (the desktop rail's contents). */}
            {mobileFiltersOpen ? (
              <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true">
                <div
                  className="absolute inset-0 bg-black/40"
                  onClick={() => setMobileFiltersOpen(false)}
                />
                <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-background shadow-xl">
                  <div className="flex shrink-0 items-center justify-between border-b px-3 py-2.5">
                    <span className="text-sm font-semibold">Filters</span>
                    <button
                      type="button"
                      onClick={() => setMobileFiltersOpen(false)}
                      aria-label="Close filters"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-2">{railEl}</div>
                </div>
              </div>
            ) : null}

            {/* ── Desktop (xl+): drag-to-resize rail | list | thread ──────── */}
            <div className="hidden xl:flex xl:flex-1 xl:min-h-0">
              <ResizablePanelGroup
                direction="horizontal"
                autoSaveId="engage-inbox-panels"
                className="gap-0"
              >
                <ResizablePanel defaultSize={16} minSize={12} maxSize={28}>
                  <div className="h-full pr-1">{railEl}</div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={28} minSize={20}>
                  <div className="h-full px-1">{listEl}</div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={56} minSize={28}>
                  <div className="h-full pl-1">{threadEl}</div>
                </ResizablePanel>
              </ResizablePanelGroup>

              {/* AI writer is a fixed 4th area only on ultra-wide screens; on
                  normal xl it's a clean 3-pane unibox (rail | list | thread).
                  Compose still has built-in AI Generate. */}
              <div className="hidden min-h-0 w-[300px] shrink-0 overflow-auto pl-4 2xl:block">
                {aiWriterEl}
              </div>
            </div>
          </>
        )
      })()}

      <ComposeModal
        open={composeOpen}
        onOpenChange={(next) => {
          setComposeOpen(next)
          // Clear seed content on close so the next plain compose starts fresh
          if (!next) {
            setSeedSubject('')
            setSeedBody('')
          }
        }}
        seedSubject={seedSubject}
        seedBodyHtml={seedBody}
        onSent={loadInbox}
      />
    </div>
  )
}

