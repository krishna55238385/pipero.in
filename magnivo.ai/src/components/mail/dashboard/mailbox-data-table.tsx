'use client'

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMailFiltersStore } from '@/stores/mail-filters'
import type { MailboxTableRow, MailboxSortField } from '@/types/mail'

const HEALTH_BADGE_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  excellent: { label: 'Excellent', variant: 'default' },
  good: { label: 'Good', variant: 'default' },
  fair: { label: 'Fair', variant: 'secondary' },
  poor: { label: 'Poor', variant: 'destructive' },
  unknown: { label: 'Unknown', variant: 'outline' },
}

const STATUS_BADGE_MAP: Record<string, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20' },
  disconnected: { label: 'Disconnected', className: 'bg-muted text-muted-foreground' },
  warming: { label: 'Warming', className: 'bg-blue-600/10 text-blue-700 border-blue-600/20' },
  error: { label: 'Error', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  suspended: { label: 'Suspended', className: 'bg-amber-600/10 text-amber-700 border-amber-600/20' },
  pending: { label: 'Pending', className: 'bg-yellow-600/10 text-yellow-700 border-yellow-600/20' },
  testing: { label: 'Testing', className: 'bg-indigo-600/10 text-indigo-700 border-indigo-600/20' },
  disabled: { label: 'Disabled', className: 'bg-gray-600/10 text-gray-700 border-gray-600/20' },
  archived: { label: 'Archived', className: 'bg-slate-600/10 text-slate-700 border-slate-600/20' },
  deleted: { label: 'Deleted', className: 'bg-red-600/10 text-red-700 border-red-600/20' },
  reconnect_required: { label: 'Reconnect Required', className: 'bg-orange-600/10 text-orange-700 border-orange-600/20' },
  oauth_expired: { label: 'OAuth Expired', className: 'bg-orange-600/10 text-orange-700 border-orange-600/20' },
  smtp_failed: { label: 'SMTP Failed', className: 'bg-red-600/10 text-red-700 border-red-600/20' },
  imap_failed: { label: 'IMAP Failed', className: 'bg-red-600/10 text-red-700 border-red-600/20' },
  verification_failed: { label: 'Verification Failed', className: 'bg-red-600/10 text-red-700 border-red-600/20' },
  pending_dns: { label: 'Pending DNS Setup', className: 'bg-amber-600/10 text-amber-800 border-amber-600/20' },
  pending_warmup: { label: 'Pending Warmup', className: 'bg-sky-600/10 text-sky-800 border-sky-600/20' },
  at_risk: { label: 'At Risk', className: 'bg-rose-600/10 text-rose-800 border-rose-600/20' },
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  zoho: 'Zoho',
  custom: 'Custom',
}

const WARMUP_LABELS: Record<string, string> = {
  idle: 'Idle',
  warming: 'Warming',
  paused: 'Paused',
  completed: 'Completed',
  error: 'Error',
}

function SortButton({ field, label }: { field: MailboxSortField; label: string }) {
  const { dashboardSortBy, dashboardSortDirection, setDashboardSort } = useMailFiltersStore()
  const isActive = dashboardSortBy === field
  const direction = isActive ? dashboardSortDirection : undefined

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-1 text-xs font-medium"
      onClick={() =>
        setDashboardSort(
          field,
          isActive && direction === 'asc' ? 'desc' : 'asc'
        )
      }
    >
      {label}
      {isActive ? (
        direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 text-muted-foreground/50" />
      )}
    </Button>
  )
}

type MailboxDataTableProps = {
  mailboxes: MailboxTableRow[]
  onRowClick: (id: string) => void
}

export function MailboxDataTable({ mailboxes, onRowClick }: MailboxDataTableProps) {
  const { selectedMailboxIds, toggleMailboxSelection, toggleAllMailboxSelection } = useMailFiltersStore()

  const allIds = mailboxes.map((m) => m.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedMailboxIds.has(id))
  const someSelected = allIds.some((id) => selectedMailboxIds.has(id)) && !allSelected

  return (
    <div className="rounded-lg border border-border/20">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={() => toggleAllMailboxSelection(allIds)}
              />
            </TableHead>
            <TableHead><SortButton field="email" label="Email" /></TableHead>
            <TableHead><SortButton field="displayName" label="Name" /></TableHead>
            <TableHead><SortButton field="provider" label="Provider" /></TableHead>
            <TableHead><SortButton field="mailboxStatus" label="Status" /></TableHead>
            <TableHead><SortButton field="healthScore" label="Health" /></TableHead>
            <TableHead><SortButton field="warmupStatus" label="Warmup" /></TableHead>
            <TableHead className="text-right"><SortButton field="dailyLimit" label="Limit" /></TableHead>
            <TableHead className="text-right"><SortButton field="currentDailyUsage" label="Usage" /></TableHead>
            <TableHead><SortButton field="createdAt" label="Created" /></TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {mailboxes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">
                No mailboxes found.
              </TableCell>
            </TableRow>
          ) : (
            mailboxes.map((m) => {
              const healthBadge = HEALTH_BADGE_MAP[m.healthStatus] ?? HEALTH_BADGE_MAP.unknown
              const statusBadge = STATUS_BADGE_MAP[m.mailboxStatus] ?? STATUS_BADGE_MAP.disconnected
              const isSelected = selectedMailboxIds.has(m.id)

              return (
                <TableRow
                  key={m.id}
                  data-state={isSelected ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => onRowClick(m.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleMailboxSelection(m.id)}
                    />
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm font-medium">{m.email}</TableCell>
                  <TableCell className="max-w-[140px] truncate text-sm text-muted-foreground">{m.displayName || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{PROVIDER_LABELS[m.provider] ?? m.provider}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}>
                      {statusBadge.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={healthBadge.variant} className="text-xs">
                      {m.healthScore != null ? `${m.healthScore}` : ''} {healthBadge.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {WARMUP_LABELS[m.warmupStatus] ?? m.warmupStatus}
                  </TableCell>
                  <TableCell className="text-right text-sm">{m.dailyLimit}</TableCell>
                  <TableCell className="text-right text-sm">
                    <span className={m.currentDailyUsage >= m.dailyLimit ? 'text-destructive font-medium' : ''}>
                      {m.currentDailyUsage}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => onRowClick(m.id)}
                    >
                      <span className="sr-only">Open details</span>
                      <span className="text-muted-foreground">...</span>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
