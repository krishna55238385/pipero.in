'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DnsStatusIcon } from './DnsStatusIcon'
import { formatDistanceToNow } from 'date-fns'
import type { VerificationHistoryEntry } from '@/types/deliverability'

type HistoryTimelineProps = {
  entries: VerificationHistoryEntry[]
}

function HistoryEntry({ entry }: { entry: VerificationHistoryEntry }) {
  const recordTypeColors: Record<string, string> = {
    spf: 'bg-blue-500/10 text-blue-600',
    dkim: 'bg-purple-500/10 text-purple-600',
    dmarc: 'bg-orange-500/10 text-orange-600',
    tracking: 'bg-teal-500/10 text-teal-600',
    return_path: 'bg-pink-500/10 text-pink-600',
    full: 'bg-red-500/10 text-red-600',
  }

  const statusToDnsStatus = (status: string | null): 'valid' | 'invalid' | 'missing' | 'unverified' => {
    if (status === 'valid') return 'valid'
    if (status === 'invalid') return 'invalid'
    if (status === 'missing') return 'missing'
    return 'unverified'
  }

  return (
    <div className="flex gap-3 py-2">
      <div className="flex flex-col items-center">
        <div className="w-2 h-2 rounded-full bg-primary/60 mt-1.5" />
        <div className="w-px flex-1 bg-border/50" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-xs ${recordTypeColors[entry.recordType] ?? 'bg-muted/50'}`}>
            {entry.recordType.toUpperCase()}
          </Badge>
          <span className="text-xs text-muted-foreground">{entry.action.replace(/_/g, ' ')}</span>
        </div>

        {entry.previousStatus !== entry.newStatus && entry.newStatus && (
          <div className="flex items-center gap-1.5 text-xs">
            <DnsStatusIcon status={statusToDnsStatus(entry.previousStatus)} size={12} />
            <span className="text-muted-foreground">→</span>
            <DnsStatusIcon status={statusToDnsStatus(entry.newStatus)} size={12} />
            <span className="text-muted-foreground">
              {entry.previousStatus ?? 'none'} → {entry.newStatus}
            </span>
          </div>
        )}

        {entry.errorMessage && (
          <p className="text-xs text-red-500">{entry.errorMessage}</p>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
          {entry.actorEmail && <span>by {entry.actorEmail}</span>}
          {entry.durationMs && <span>({entry.durationMs}ms)</span>}
          <Badge variant="secondary" className="text-[10px] px-1 py-0">{entry.verifiedBy}</Badge>
        </div>
      </div>
    </div>
  )
}

export function HistoryTimeline({
  entries,
  title = 'Verification History',
  emptyMessage = 'No verification history yet. Verify a domain to see results.',
}: HistoryTimelineProps & { title?: string; emptyMessage?: string }) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-0">
          {entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
