'use client'

import { INTEREST_STATUSES, type InterestStatus, type UniboxMeta } from '@/types/engage'

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

export type InboxScope = 'campaigns' | 'others' | 'all'

const SCOPE_LABELS: Record<InboxScope, string> = {
  campaigns: 'Campaigns',
  others: 'Other',
  all: 'All',
}

export function FilterPill({
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
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
        active
          ? 'bg-primary text-primary-foreground shadow-xs'
          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <span className="truncate">{label}</span>
      {typeof count === 'number' && count > 0 ? (
        <span className={`shrink-0 text-[10px] tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>
          {count}
        </span>
      ) : null}
    </button>
  )
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
    <div className="flex flex-col gap-3">
      {/* Scope toggle */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-medium text-muted-foreground mr-1">Scope:</span>
        {(['campaigns', 'others', 'all'] as InboxScope[]).map((s) => (
          <FilterPill
            key={s}
            label={SCOPE_LABELS[s]}
            count={scopeCounts[s]}
            active={scope === s}
            onClick={() => onScopeChange(s)}
          />
        ))}
      </div>

      {/* Status filters */}
      {scope !== 'others' && Object.keys(meta.statusCounts).length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Status:</span>
          <FilterPill
            label="All"
            count={totalStatuses}
            active={activeStatus === null}
            onClick={() => onStatusChange(null)}
          />
          {INTEREST_STATUSES.map((status) => {
            const count = meta.statusCounts[status] ?? 0
            if (count === 0) return null
            return (
              <FilterPill
                key={status}
                label={STATUS_LABELS[status]}
                count={count}
                active={activeStatus === status}
                onClick={() => onStatusChange(activeStatus === status ? null : status)}
              />
            )
          })}
        </div>
      )}

      {/* Campaign filters */}
      {scope !== 'others' && meta.campaigns.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Campaign:</span>
          <FilterPill
            label="All Campaigns"
            active={activeCampaignId === null}
            onClick={() => onCampaignChange(null)}
          />
          {meta.campaigns.map((c) => (
            <FilterPill
              key={c.id}
              label={c.name}
              active={activeCampaignId === c.id}
              onClick={() => onCampaignChange(activeCampaignId === c.id ? null : c.id)}
            />
          ))}
        </div>
      )}

      {/* Mailbox filters */}
      {meta.mailboxes.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Inbox:</span>
          <FilterPill
            label="All Inboxes"
            active={activeMailbox === null}
            onClick={() => onMailboxChange(null)}
          />
          {meta.mailboxes.map((m) => (
            <FilterPill
              key={m.email}
              label={m.email}
              active={activeMailbox === m.email}
              onClick={() => onMailboxChange(activeMailbox === m.email ? null : m.email)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
