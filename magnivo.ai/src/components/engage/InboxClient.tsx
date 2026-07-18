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

type Mailbox = { email?: string } | null

const EMPTY_META: UniboxMeta = { byThread: {}, campaigns: [], mailboxes: [], statusCounts: {} }

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

  const [meta, setMeta] = useState<UniboxMeta>(EMPTY_META)
  const [scope, setScope] = useState<InboxScope>('campaigns')
  const [activeStatus, setActiveStatus] = useState<InterestStatus | null>(null)
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
  const [activeMailbox, setActiveMailbox] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const changeScope = useCallback((next: InboxScope) => {
    setScope(next)
    if (next !== 'campaigns') {
      setActiveStatus(null)
      setActiveCampaignId(null)
    }
  }, [])

  const canUseInbox = Boolean(mailboxEmail)

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

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/engage/unibox-meta', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) setMeta(data as UniboxMeta)
    } catch {
      // noop
    }
  }, [])

  useEffect(() => {
    loadInbox()
  }, [canUseInbox, unreadOnly, starredOnly, box, loadInbox])

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
      refreshMailbox()
      loadInbox()
      loadMeta()
      if (activeThreadId) loadThread(activeThreadId)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [canUseInbox, activeThreadId, refreshMailbox, loadInbox, loadMeta, loadThread])

  const subtitle = useMemo(() => {
    if (!canUseInbox) return 'Connect Gmail in Engage Settings to view your inbox.'
    return mailboxEmail ? `Connected: ${mailboxEmail}` : ''
  }, [mailboxEmail, canUseInbox])

  const threadMeta = meta.byThread as Record<string, EmailRowMeta>

  const scopeCounts = useMemo<Record<InboxScope, number>>(() => {
    let campaigns = 0
    for (const e of emails) if (meta.byThread[e.threadId]) campaigns += 1
    return { all: emails.length, campaigns, others: emails.length - campaigns }
  }, [emails, meta.byThread])

  const filteredEmails = useMemo(() => {
    const mailbox = activeMailbox?.toLowerCase() ?? null
    return emails.filter((email) => {
      const tm = meta.byThread[email.threadId]
      const isCampaignMail = Boolean(tm)
      if (scope === 'campaigns' && !isCampaignMail) return false
      if (scope === 'others' && isCampaignMail) return false
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

  const activeThreadStatus: InterestStatus =
    (activeThreadId ? meta.byThread[activeThreadId]?.interestStatus : undefined) ?? 'lead'
  const canSetStatus = Boolean(activeThreadId && meta.byThread[activeThreadId])

  const handleThreadStatusChange = useCallback(
    async (status: InterestStatus) => {
      if (!activeThreadId) return
      setSavingStatus(true)
      try {
        await setThreadInterest(activeThreadId, status)
        await loadMeta()
      } catch {
        // noop
      } finally {
        setSavingStatus(false)
      }
    },
    [activeThreadId, loadMeta],
  )

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Engage Inbox</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="xl:hidden"
            onClick={() => setMobileFiltersOpen(true)}
            disabled={!canUseInbox}
          >
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            Filters
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => loadInbox({ refresh: true })} disabled={!canUseInbox || loadingList}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loadingList ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setSeedSubject('')
              setSeedBody('')
              setComposeOpen(true)
            }}
            disabled={!canUseInbox}
          >
            <MailPlus className="h-4 w-4 mr-1" />
            Compose
          </Button>
        </div>
      </div>

      {syncError ? <p className="text-xs text-amber-500">Gmail sync issue: {syncError}</p> : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {/* Horizontal Filters */}
      <div className="hidden xl:block">
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
      </div>

      {/* Mobile filters slide-over */}
      {mobileFiltersOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col bg-background shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-border/20 px-4 py-3">
              <span className="text-sm font-semibold">Filters</span>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
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
            </div>
          </div>
        </div>
      ) : null}

      {/* Main content: list + thread */}
      <div className="flex flex-1 min-h-0">
        {/* Mobile: single pane */}
        <div className="flex flex-1 min-h-0 flex-col xl:hidden">
          {activeThreadId ? (
            <div className="flex flex-1 min-h-0 flex-col gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit shrink-0"
                onClick={() => { setActiveThreadId(null); setThread(null) }}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to inbox
              </Button>
              <div className="min-h-0 flex-1">
                <ThreadContent
                  activeThreadId={activeThreadId}
                  activeThreadStatus={activeThreadStatus}
                  canSetStatus={canSetStatus}
                  savingStatus={savingStatus}
                  handleThreadStatusChange={handleThreadStatusChange}
                  thread={thread}
                  loadingThread={loadingThread}
                  loadThread={loadThread}
                  loadInbox={loadInbox}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <EmailList
                emails={filteredEmails}
                threadMeta={threadMeta}
                activeThreadId={activeThreadId}
                box={box}
                onBoxChange={(next) => { setBox(next); setActiveThreadId(null); setThread(null) }}
                search={search}
                onSearchChange={setSearch}
                unreadOnly={unreadOnly}
                starredOnly={starredOnly}
                onToggleUnread={() => setUnreadOnly((v) => !v)}
                onToggleStarred={() => setStarredOnly((v) => !v)}
                onSelect={(email) => { setActiveThreadId(email.threadId); loadThread(email.threadId) }}
                loading={loadingList}
              />
            </div>
          )}
        </div>

        {/* Desktop: resizable list | thread */}
        <div className="hidden xl:flex xl:flex-1 xl:min-h-0">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="engage-inbox-panels"
            className="gap-0"
          >
            <ResizablePanel defaultSize={35} minSize={25}>
              <div className="h-full pr-1">
                <EmailList
                  emails={filteredEmails}
                  threadMeta={threadMeta}
                  activeThreadId={activeThreadId}
                  box={box}
                  onBoxChange={(next) => { setBox(next); setActiveThreadId(null); setThread(null) }}
                  search={search}
                  onSearchChange={setSearch}
                  unreadOnly={unreadOnly}
                  starredOnly={starredOnly}
                  onToggleUnread={() => setUnreadOnly((v) => !v)}
                  onToggleStarred={() => setStarredOnly((v) => !v)}
                  onSelect={(email) => { setActiveThreadId(email.threadId); loadThread(email.threadId) }}
                  loading={loadingList}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={65} minSize={30}>
              <div className="h-full pl-1">
                <ThreadContent
                  activeThreadId={activeThreadId}
                  activeThreadStatus={activeThreadStatus}
                  canSetStatus={canSetStatus}
                  savingStatus={savingStatus}
                  handleThreadStatusChange={handleThreadStatusChange}
                  thread={thread}
                  loadingThread={loadingThread}
                  loadThread={loadThread}
                  loadInbox={loadInbox}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      <ComposeModal
        open={composeOpen}
        onOpenChange={(next) => {
          setComposeOpen(next)
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

function ThreadContent({
  activeThreadId,
  activeThreadStatus,
  canSetStatus,
  savingStatus,
  handleThreadStatusChange,
  thread,
  loadingThread,
  loadThread,
  loadInbox,
}: {
  activeThreadId: string | null
  activeThreadStatus: InterestStatus
  canSetStatus: boolean
  savingStatus: boolean
  handleThreadStatusChange: (status: InterestStatus) => Promise<void>
  thread: EngageThread | null
  loadingThread: boolean
  loadThread: (threadId: string) => Promise<void>
  loadInbox: () => Promise<void>
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {activeThreadId ? (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border/30 bg-card/50 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Lead status</span>
          <select
            value={activeThreadStatus}
            disabled={!canSetStatus || savingStatus}
            onChange={(e) => handleThreadStatusChange(e.target.value as InterestStatus)}
            className="ml-auto rounded-lg border border-border/30 bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 cursor-pointer"
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
        {activeThreadId ? (
          <EmailThread
            thread={thread}
            loading={loadingThread}
            onReplied={() => {
              if (activeThreadId) loadThread(activeThreadId)
              loadInbox()
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center rounded-xl bg-muted/20">
            <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">Select a conversation</p>
            <p className="text-xs text-muted-foreground mt-1">Choose an email from the list to view it here</p>
          </div>
        )}
      </div>
    </div>
  )
}
