'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EngageThread } from '@/types/engage'

/** Pull the bare address out of a `Name <email@x.com>` header value. */
function emailOf(value: string): string {
  return value.match(/<([^>]+)>/)?.[1]?.trim() || value.trim()
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.split('\n').join('<br>')
}

export default function EmailThread({
  thread,
  loading,
  onReplied,
}: {
  thread: EngageThread | null
  loading?: boolean
  onReplied?: () => void
}) {
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  if (loading) {
    return (
      <div className="h-full rounded-2xl border bg-card p-4 space-y-3 animate-pulse">
        <div className="h-5 bg-muted rounded w-2/3" />
        <div className="h-16 bg-muted rounded" />
        <div className="h-16 bg-muted rounded" />
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="h-full rounded-2xl border bg-card grid place-items-center text-sm text-muted-foreground">
        Select an email thread
      </div>
    )
  }

  const lastMessage = thread.messages[thread.messages.length - 1]
  const replyTo = lastMessage ? emailOf(lastMessage.from) : ''

  const sendReply = async () => {
    if (!reply.trim() || !replyTo) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/engage/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: replyTo,
          subject: replySubject(thread.subject),
          bodyHtml: textToHtml(reply.trim()),
          threadId: thread.id,
          inReplyTo: lastMessage?.messageId,
          references: lastMessage?.messageId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to send reply')
      setReply('')
      onReplied?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send reply')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card overflow-hidden">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold truncate">{thread.subject}</h2>
        <p className="text-xs text-muted-foreground">{thread.messages.length} message(s)</p>
      </div>

      <div className="flex-1 min-h-0 p-4 space-y-3 overflow-auto">
        {thread.messages.map((m) => (
          <div key={m.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{m.from}</p>
                <p className="text-xs text-muted-foreground truncate">to {m.to}</p>
              </div>
              <span className="text-xs text-muted-foreground">{new Date(m.date).toLocaleString()}</span>
            </div>
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-sm"
              dangerouslySetInnerHTML={{ __html: m.bodyHtml || `<pre>${m.bodyText}</pre>` }}
            />
          </div>
        ))}
      </div>

      {/* Reply composer — compact, pinned to the bottom of the (bounded) thread */}
      <div className="shrink-0 border-t bg-muted/30 p-2.5 space-y-1.5">
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={replyTo ? `Reply to ${replyTo}…` : 'Reply…'}
          rows={2}
          className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendReply()
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to send</span>
          <Button type="button" size="sm" onClick={sendReply} disabled={sending || !reply.trim() || !replyTo}>
            <Send className={`h-4 w-4 mr-2 ${sending ? 'animate-pulse' : ''}`} />
            {sending ? 'Sending…' : 'Reply'}
          </Button>
        </div>
      </div>
    </div>
  )
}
