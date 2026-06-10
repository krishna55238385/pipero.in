'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Inbox, Megaphone, Tag } from 'lucide-react'
import { INTEREST_STATUSES, type InterestStatus, type UniboxMeta } from '@/types/engage'

// Friendly labels for the 9 Instantly-style interest statuses.
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

function Section({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open ? <div className="px-2 pb-2 space-y-0.5">{children}</div> : null}
    </div>
  )
}

function RailItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        active ? 'bg-blue-500/10 text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      }`}
    >
      <span className="flex-1 truncate">{label}</span>
      {typeof count === 'number' && count > 0 ? (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
            active ? 'bg-blue-500/20 text-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

export type InboxScope = 'campaigns' | 'others' | 'all'

const SCOPE_LABELS: Record<InboxScope, string> = {
  campaigns: 'Campaigns',
  others: 'Other',
  all: 'All',
}

export default function UniboxRail({
  meta,
  scope,
  scopeCounts,
  onScopeChange,
  activeStatus,
  activeCampaignId,
  activeMailbox,
  onStatusChange,
  onCampaignChange,
  onMailboxChange,
}: {
  meta: UniboxMeta
  scope: InboxScope
  scopeCounts: Record<InboxScope, number>
  onScopeChange: (scope: InboxScope) => void
  activeStatus: InterestStatus | null
  activeCampaignId: string | null
  activeMailbox: string | null
  onStatusChange: (status: InterestStatus | null) => void
  onCampaignChange: (campaignId: string | null) => void
  onMailboxChange: (mailbox: string | null) => void
}) {
  const totalStatuses = Object.values(meta.statusCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="h-full flex flex-col rounded-2xl border bg-card overflow-auto">
      {/* Primary split: campaign mail (the leads you're working on) vs other
          (random Gmail not tied to any campaign) vs all. Two-line layout (label
          over count) so the long "Campaigns" label never collides in the narrow
          rail. */}
      <div className="border-b p-2">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {(['campaigns', 'others', 'all'] as InboxScope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onScopeChange(s)}
              title={
                s === 'campaigns'
                  ? 'Only mail tied to a campaign (your leads)'
                  : s === 'others'
                    ? 'Mail not part of any campaign'
                    : 'All mail'
              }
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 transition-colors ${
                scope === s
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="max-w-full truncate text-[11px] font-medium leading-tight">{SCOPE_LABELS[s]}</span>
              <span className="text-[10px] leading-none tabular-nums opacity-60">{scopeCounts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Status + campaign filters only make sense for campaign mail. */}
      {scope !== 'others' ? (
      <>
      <Section title="Status" icon={<Tag className="h-3.5 w-3.5" />}>
        <RailItem
          label="All"
          count={totalStatuses}
          active={activeStatus === null}
          onClick={() => onStatusChange(null)}
        />
        {INTEREST_STATUSES.map((status) => (
          <RailItem
            key={status}
            label={STATUS_LABELS[status]}
            count={meta.statusCounts[status] ?? 0}
            active={activeStatus === status}
            // Toggle off when re-clicking the active status.
            onClick={() => onStatusChange(activeStatus === status ? null : status)}
          />
        ))}
      </Section>

      <Section title="All Campaigns" icon={<Megaphone className="h-3.5 w-3.5" />}>
        <RailItem
          label="All Campaigns"
          active={activeCampaignId === null}
          onClick={() => onCampaignChange(null)}
        />
        {meta.campaigns.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No campaigns yet</p>
        ) : (
          meta.campaigns.map((c) => (
            <RailItem
              key={c.id}
              label={c.name}
              active={activeCampaignId === c.id}
              onClick={() => onCampaignChange(activeCampaignId === c.id ? null : c.id)}
            />
          ))
        )}
      </Section>
      </>
      ) : null}

      <Section title="All Inboxes" icon={<Inbox className="h-3.5 w-3.5" />}>
        <RailItem
          label="All Inboxes"
          active={activeMailbox === null}
          onClick={() => onMailboxChange(null)}
        />
        {meta.mailboxes.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No inboxes connected</p>
        ) : (
          meta.mailboxes.map((m) => (
            <RailItem
              key={m.email}
              label={m.email}
              active={activeMailbox === m.email}
              onClick={() => onMailboxChange(activeMailbox === m.email ? null : m.email)}
            />
          ))
        )}
      </Section>
    </div>
  )
}
