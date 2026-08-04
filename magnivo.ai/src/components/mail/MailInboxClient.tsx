'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { MailListSkeleton } from '@/components/mail/MailSkeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Inbox } from 'lucide-react'
import {
  listInboxThreadsAction,
  getInboxThreadAction,
  updateInboxClassificationAction,
  bulkInboxAction,
  regenerateInboxSuggestionAction,
  sendInboxReplyAction,
  getMailboxes,
} from '@/app/actions/mail'
import { listCampaignsAction } from '@/app/actions/campaigns'

type Thread = Awaited<ReturnType<typeof listInboxThreadsAction>>[number]

const CLASSIFICATIONS = [
  'all',
  'interested',
  'not_interested',
  'ooo',
  'unsubscribe_request',
  'needs_human_review',
  'bounce',
] as const

export default function MailInboxClient({ isLoading: initialLoading = false }: { isLoading?: boolean }) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getInboxThreadAction>> | null>(null)
  const [classification, setClassification] = useState<string>('all')
  const [mailboxId, setMailboxId] = useState<string>('all')
  const [campaignId, setCampaignId] = useState<string>('all')
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; email: string }>>([])
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(initialLoading)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyMsg, setReplyMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listInboxThreadsAction({
        classification: classification === 'all' ? undefined : classification,
        mailboxId: mailboxId === 'all' ? undefined : mailboxId,
        campaignId: campaignId === 'all' ? undefined : campaignId,
        search: search || undefined,
      })
      setThreads(data)
    } finally {
      setIsLoading(false)
    }
  }, [classification, search, mailboxId, campaignId])

  useEffect(() => {
    void Promise.all([
      getMailboxes().catch(() => []),
      listCampaignsAction().catch(() => ({ campaigns: [] })),
    ]).then(([mbs, camps]) => {
      setMailboxes((mbs || []).map((m) => ({ id: m.id, email: m.email })))
      setCampaigns((camps.campaigns || []).map((c) => ({ id: c.id, name: c.name })))
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDraft('')
      return
    }
    void getInboxThreadAction(selectedId).then((d) => {
      setDetail(d)
      setDraft(d.thread?.suggestedReply || '')
      setReplyMsg(null)
    })
  }, [selectedId])

  const mailboxLabel = useMemo(() => {
    const map = new Map(mailboxes.map((m) => [m.id, m.email]))
    return (id: string) => map.get(id) || id.slice(0, 8)
  }, [mailboxes])

  if (isLoading && threads.length === 0) {
    return (
      <div className="space-y-6">
        <MailPageHeader title="Inbox" description="Unified replies across connected mailboxes" />
        <MailListSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <MailPageHeader title="Inbox" description="Threaded replies with AI classification and suggested drafts" />

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          className="max-w-xs"
          placeholder="Search subjects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search inbox threads"
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          aria-label="Filter by classification"
        >
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm max-w-[180px]"
          value={mailboxId}
          onChange={(e) => setMailboxId(e.target.value)}
          aria-label="Filter by mailbox"
        >
          <option value="all">All mailboxes</option>
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.email}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm max-w-[180px]"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          aria-label="Filter by campaign"
        >
          <option value="all">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={selected.size === 0}
          onClick={() => void bulkInboxAction([...selected], 'mark_reviewed').then(load)}
        >
          Mark reviewed
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selected.size === 0}
          onClick={() => void bulkInboxAction([...selected], 'suppress').then(load)}
        >
          Suppress
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-0">
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Inbox className="h-12 w-12 mb-3 opacity-40" />
                <p className="text-sm font-medium">Inbox empty</p>
                <p className="text-xs mt-1">Replies from campaigns appear here</p>
              </div>
            ) : (
              <div className="divide-y max-h-[70vh] overflow-auto" role="list" aria-label="Inbox threads">
                {threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 ${selectedId === t.id ? 'bg-muted' : ''}`}
                    onClick={() => setSelectedId(t.id)}
                    aria-current={selectedId === t.id ? 'true' : undefined}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        aria-label={`Select thread ${t.subject || 'untitled'}`}
                        onChange={(e) => {
                          e.stopPropagation()
                          const next = new Set(selected)
                          if (e.target.checked) next.add(t.id)
                          else next.delete(t.id)
                          setSelected(next)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{t.subject || '(no subject)'}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">
                            {t.classification}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {mailboxLabel(t.mailboxId)}
                          </span>
                          {t.unreadCount > 0 && (
                            <span className="text-[10px] text-muted-foreground">{t.unreadCount} unread</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!detail?.thread ? (
              <p className="text-sm text-muted-foreground">Select a thread</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge>{detail.thread.classification}</Badge>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={detail.thread.classification}
                    aria-label="Update classification"
                    onChange={(e) => {
                      void updateInboxClassificationAction(detail.thread!.id, e.target.value).then(() => {
                        void getInboxThreadAction(detail.thread!.id).then(setDetail)
                        void load()
                      })
                    }}
                  >
                    {CLASSIFICATIONS.filter((c) => c !== 'all').map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void regenerateInboxSuggestionAction(detail.thread!.id).then((r) => {
                        if (r.success && r.data) setDraft(r.data)
                        void getInboxThreadAction(detail.thread!.id).then(setDetail)
                      })
                    }
                  >
                    Generate draft
                  </Button>
                </div>
                <div className="space-y-3 max-h-[40vh] overflow-auto">
                  {detail.messages.map((m) => (
                    <div key={m.id} className="rounded-md border p-3 text-sm">
                      <p className="text-xs text-muted-foreground mb-1">
                        {m.direction} · {m.fromEmail} · {new Date(m.receivedAt).toLocaleString()}
                      </p>
                      <p className="whitespace-pre-wrap">{m.bodyText || m.bodyHtml}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-medium">Reply</p>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={5}
                    placeholder="Edit suggested reply before sending…"
                    aria-label="Reply draft"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={replyBusy || !draft.trim()}
                      onClick={() => {
                        setReplyBusy(true)
                        setReplyMsg(null)
                        void sendInboxReplyAction(detail.thread!.id, draft.trim())
                          .then((r) => {
                            if (!r.success) {
                              setReplyMsg(r.error || 'Send failed')
                              return
                            }
                            setReplyMsg('Reply sent')
                            return getInboxThreadAction(detail.thread!.id).then(setDetail)
                          })
                          .finally(() => setReplyBusy(false))
                      }}
                    >
                      {replyBusy ? 'Sending…' : 'Send reply'}
                    </Button>
                    {replyMsg && <p className="text-xs text-muted-foreground">{replyMsg}</p>}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
