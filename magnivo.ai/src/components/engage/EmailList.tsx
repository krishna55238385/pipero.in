'use client'

import { Search, Star } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { EngageEmailSummary, InterestStatus } from '@/types/engage'

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
  threadMeta?: Record<string, EmailRowMeta>
}) {
  return (
    <div className="h-full flex flex-col rounded-xl border border-border/30 bg-card overflow-hidden">
      <div className="p-3 border-b border-border/15 space-y-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => onBoxChange('inbox')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer ${
              box === 'inbox' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Inbox
          </button>
          <button
            type="button"
            onClick={() => onBoxChange('sent')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer ${
              box === 'sent' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
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
            className="pl-9 rounded-lg border-border/30"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={unreadOnly ? 'default' : 'ghost'}
            onClick={onToggleUnread}
            className="h-7 text-xs"
          >
            Unread
          </Button>
          <Button
            type="button"
            size="sm"
            variant={starredOnly ? 'default' : 'ghost'}
            onClick={onToggleStarred}
            className="h-7 text-xs"
          >
            <Star className="h-3.5 w-3.5 mr-1" /> Starred
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border/20 p-3 animate-shimmer">
                <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                <div className="h-2.5 bg-muted rounded w-2/3 mb-2" />
                <div className="h-2 bg-muted rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : !emails.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">No emails found</p>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="p-1.5 space-y-px">
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
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150 cursor-pointer ${
                    active ? 'bg-primary/8 border border-primary/15' : 'hover:bg-accent/50 border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[13px] truncate ${email.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                      {email.direction === 'sent' ? `To: ${email.to || '(unknown)'}` : email.from}
                    </p>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatListDate(email.date)}</span>
                  </div>
                  <p className={`text-[13px] truncate mt-0.5 ${email.unread ? 'font-medium text-foreground' : 'text-foreground/70'}`}>{email.subject}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{email.snippet}</p>
                  {showBounced || showStatus || showCampaign ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {showBounced ? (
                        <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                          Bounced
                        </span>
                      ) : null}
                      {showStatus ? (
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {STATUS_LABELS[m!.interestStatus]}
                        </span>
                      ) : null}
                      {showCampaign ? (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground truncate max-w-[140px]">
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
