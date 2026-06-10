'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ConversationThread } from '@/types/engage'

function formatWhen(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}

function sentimentVariant(sentiment: string | null) {
  const s = (sentiment ?? '').toLowerCase()
  if (s.includes('pos')) return 'default' as const
  if (s.includes('neg')) return 'destructive' as const
  return 'secondary' as const
}

function urgencyVariant(urgency: string | null) {
  const u = (urgency ?? '').toLowerCase()
  if (u === 'high') return 'destructive' as const
  if (u === 'medium') return 'default' as const
  return 'secondary' as const
}

export default function ConversationsClient({
  conversations,
}: {
  conversations: ConversationThread[]
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    conversations[0]?.id ?? null
  )

  if (conversations.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Conversations</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No conversations yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Threads appear here when a lead replies. Connect your inbox in Engage
              Settings to start receiving conversations.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const selected =
    conversations.find((c) => c.id === selectedId) ?? conversations[0]

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Conversations</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Thread list */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <ul className="divide-y">
              {conversations.map((c) => {
                const isActive = c.id === selected.id
                const last = c.messages[c.messages.length - 1]
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        'flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                        isActive && 'bg-muted'
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {c.leadName}
                        </span>
                        {c.unreadCount > 0 ? (
                          <Badge className="shrink-0">{c.unreadCount}</Badge>
                        ) : null}
                      </div>
                      {last ? (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {last.content || `[${last.messageType}]`}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No messages yet
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatWhen(c.lastCustomerMessageAt || c.createdAt)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        {/* Selected thread */}
        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div>
                <p className="text-sm font-semibold">{selected.leadName}</p>
                {selected.leadPhone ? (
                  <p className="text-xs text-muted-foreground">
                    {selected.leadPhone}
                  </p>
                ) : null}
              </div>
              {selected.insight ? (
                <div className="flex flex-wrap gap-1.5">
                  {selected.insight.intent ? (
                    <Badge variant="outline">
                      Intent: {selected.insight.intent}
                    </Badge>
                  ) : null}
                  {selected.insight.sentiment ? (
                    <Badge variant={sentimentVariant(selected.insight.sentiment)}>
                      {selected.insight.sentiment}
                    </Badge>
                  ) : null}
                  {selected.insight.urgency ? (
                    <Badge variant={urgencyVariant(selected.insight.urgency)}>
                      {selected.insight.urgency} urgency
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>

            {selected.messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No messages in this thread yet.
              </p>
            ) : (
              <div className="space-y-3">
                {selected.messages.map((m) => {
                  const inbound = m.senderType === 'user'
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        'flex flex-col',
                        inbound ? 'items-start' : 'items-end'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                          inbound
                            ? 'bg-muted text-foreground'
                            : 'bg-primary text-primary-foreground'
                        )}
                      >
                        {m.content || (
                          <span className="italic opacity-80">
                            [{m.messageType}]
                          </span>
                        )}
                      </div>
                      <span className="mt-1 text-[11px] text-muted-foreground">
                        {m.senderType} · {formatWhen(m.createdAt)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {selected.insight?.suggestedReply ? (
              <div className="rounded-xl border bg-muted/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  AI suggested reply
                </p>
                <p className="mt-1 text-sm">{selected.insight.suggestedReply}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
