'use client'

import { Badge } from '@/components/ui/badge'
import type { DialerLead } from '@/components/dialer/types'

function statusClass(status: DialerLead['status']) {
  if (status === 'Hot') return 'bg-red-500/15 text-red-500 border-red-500/30'
  if (status === 'Warm') return 'bg-amber-500/15 text-amber-500 border-amber-500/30'
  return 'bg-sky-500/15 text-sky-500 border-sky-500/30'
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
}

export default function LeadCard({
  lead,
  active,
  onClick,
}: {
  lead: DialerLead
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-3 transition-all duration-200 ${
        active
          ? 'border-blue-500/40 bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]'
          : 'border-border hover:border-blue-400/30 hover:bg-accent/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-3">
          <div className={`h-9 w-9 rounded-full border grid place-items-center text-xs font-semibold ${
            active ? 'bg-blue-500/10 border-blue-500/30 text-blue-600' : 'bg-muted/40'
          }`}>
            {initials(lead.name)}
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{lead.name}</p>
            <p className="text-xs text-muted-foreground truncate">{lead.company}</p>
            <p className="text-[11px] text-muted-foreground truncate">{lead.title}</p>
          </div>
        </div>
        <Badge variant="outline" className={statusClass(lead.status)}>{lead.status}</Badge>
      </div>
      <p className="text-sm mt-2 font-mono text-muted-foreground">{lead.phone}</p>
    </button>
  )
}

