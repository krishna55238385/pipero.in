'use client'

import { Search, Star } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { EngageEmailSummary, InterestStatus } from '@/types/engage'

// Friendly labels for the interest-status chip shown on each row.
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

export type EmailRowMeta = {
  campaignId: string | null
  campaignName: string | null
  interestStatus: InterestStatus
  bounced?: boolean
}

// Time-only is misleading for older messages; show time for today, otherwise a
// short date (with year when not the current year).
function formatListDate(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export default function EmailList({
  emails,
  activeThreadId,
  box,
  onBoxChange,
  search,
  onSearchChange,
  unreadOnly,
  starredOnly,
  onToggleUnread,
  onToggleStarred,
  onSelect,
  loading,
  threadMeta,
}: {
  emails: EngageEmailSummary[]
  activeThreadId: string | null
  box: 'inbox' | 'sent'
  onBoxChange: (next: 'inbox' | 'sent') => void
  search: string
  onSearchChange: (v: string) => void
  unreadOnly: boolean
  starredOnly: boolean
  onToggleUnread: () => void
  onToggleStarred: () => void
  onSelect: (email: EngageEmailSummary) => void
  loading?: boolean
  // Per-thread campaign/interest metadata for the Unibox chips (optional).
  threadMeta?: Record<string, EmailRowMeta>
}) {
  return (
    <div className="h-full flex flex-col rounded-2xl border bg-card">
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
          <button
            type="button"
            onClick={() => onBoxChange('inbox')}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              box === 'inbox' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Inbox
          </button>
          <button
            type="button"
            onClick={() => onBoxChange('sent')}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              box === 'sent' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Sent
          </button>
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search emails"
            className="pl-9 rounded-xl"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant={unreadOnly ? 'default' : 'outline'} onClick={onToggleUnread}>
            Unread
          </Button>
          <Button type="button" size="sm" variant={starredOnly ? 'default' : 'outline'} onClick={onToggleStarred}>
            <Star className="h-4 w-4 mr-2" /> Starred
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-3 animate-pulse">
                <div className="h-4 bg-muted rounded w-1/2 mb-2" />
                <div className="h-3 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : !emails.length ? (
          <div className="text-sm text-muted-foreground text-center py-12">No emails found</div>
        ) : (
          <div className="p-2 space-y-1.5">
            {emails.map((email) => {
              const active = email.threadId === activeThreadId
              const m = threadMeta?.[email.threadId]
              const showBounced = Boolean(m?.bounced)
              const showStatus = m && m.interestStatus !== 'lead'
              const showCampaign = Boolean(m?.campaignName)
              return (
                <button
                  key={email.id}
                  type="button"
                  onClick={() => onSelect(email)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    active ? 'bg-blue-500/10 border-blue-500/30' : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm truncate ${email.unread ? 'font-semibold' : 'font-medium'}`}>
                      {email.direction === 'sent' ? `To: ${email.to || '(unknown)'}` : email.from}
                    </p>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatListDate(email.date)}</span>
                  </div>
                  <p className={`text-sm truncate ${email.unread ? 'font-medium' : ''}`}>{email.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">{email.snippet}</p>
                  {showBounced || showStatus || showCampaign ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {showBounced ? (
                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                          Bounced
                        </span>
                      ) : null}
                      {showStatus ? (
                        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                          {STATUS_LABELS[m!.interestStatus]}
                        </span>
                      ) : null}
                      {showCampaign ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground truncate max-w-[140px]">
                          {m!.campaignName}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

