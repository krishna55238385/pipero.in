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
import { Progress } from '@/components/ui/progress'
import { useWarmupFiltersStore, type WarmupSortField } from '@/stores/warmup-filters'
import type { WarmupConfigResponse } from '@/types/mail'

const STATUS_BADGE_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-600/10 text-slate-700 border-slate-600/20' },
  pending: { label: 'Pending', className: 'bg-yellow-600/10 text-yellow-700 border-yellow-600/20' },
  running: { label: 'Running', className: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20' },
  paused: { label: 'Paused', className: 'bg-amber-600/10 text-amber-700 border-amber-600/20' },
  completed: { label: 'Completed', className: 'bg-blue-600/10 text-blue-700 border-blue-600/20' },
  graduated: { label: 'Graduated', className: 'bg-violet-600/10 text-violet-700 border-violet-600/20' },
  disabled: { label: 'Disabled', className: 'bg-gray-600/10 text-gray-700 border-gray-600/20' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive border-destructive/20' },
}

const STAGE_BADGE_MAP: Record<string, { label: string; className: string }> = {
  initial: { label: 'Initial', className: 'bg-orange-600/10 text-orange-700 border-orange-600/20' },
  learning: { label: 'Learning', className: 'bg-blue-600/10 text-blue-700 border-blue-600/20' },
  growing: { label: 'Growing', className: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20' },
  established: { label: 'Established', className: 'bg-violet-600/10 text-violet-700 border-violet-600/20' },
  graduated: { label: 'Graduated', className: 'bg-cyan-600/10 text-cyan-700 border-cyan-600/20' },
}

const HEALTH_BADGE_MAP: Record<string, { label: string; className: string }> = {
  excellent: { label: 'Excellent', className: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20' },
  healthy: { label: 'Healthy', className: 'bg-blue-600/10 text-blue-700 border-blue-600/20' },
  warning: { label: 'Warning', className: 'bg-amber-600/10 text-amber-700 border-amber-600/20' },
  critical: { label: 'Critical', className: 'bg-destructive/10 text-destructive border-destructive/20' },
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  zoho: 'Zoho',
  custom: 'Custom',
}

function SortButton({ field, label }: { field: WarmupSortField; label: string }) {
  const { sortBy, sortDirection, setSort } = useWarmupFiltersStore()
  const isActive = sortBy === field
  const direction = isActive ? sortDirection : undefined

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-1 text-xs font-medium"
      onClick={() =>
        setSort(
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

type WarmupDataTableProps = {
  configs: WarmupConfigResponse[]
  onRowClick: (id: string) => void
}

export function WarmupDataTable({ configs, onRowClick }: WarmupDataTableProps) {
  const { selectedIds, toggleSelection, toggleAllSelection } = useWarmupFiltersStore()

  const allIds = configs.map((c) => c.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id))
  const someSelected = allIds.some((id) => selectedIds.has(id)) && !allSelected

  return (
    <div className="rounded-lg border border-border/20">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={() => toggleAllSelection(allIds)}
              />
            </TableHead>
            <TableHead><SortButton field="email" label="Email" /></TableHead>
            <TableHead><SortButton field="status" label="Status" /></TableHead>
            <TableHead><SortButton field="stage" label="Stage" /></TableHead>
            <TableHead><SortButton field="health" label="Health" /></TableHead>
            <TableHead className="text-right"><SortButton field="currentDay" label="Day" /></TableHead>
            <TableHead>Progress</TableHead>
            <TableHead className="text-right"><SortButton field="currentDailyTarget" label="Daily Target" /></TableHead>
            <TableHead className="text-right"><SortButton field="maxDailySends" label="Max Sends" /></TableHead>
            <TableHead><SortButton field="createdAt" label="Created" /></TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {configs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">
                No warmup configurations found.
              </TableCell>
            </TableRow>
          ) : (
            configs.map((c) => {
              const statusBadge = STATUS_BADGE_MAP[c.status] ?? STATUS_BADGE_MAP.draft
              const stageBadge = STAGE_BADGE_MAP[c.stage] ?? STAGE_BADGE_MAP.initial
              const healthBadge = HEALTH_BADGE_MAP[c.health] ?? HEALTH_BADGE_MAP.healthy
              const isSelected = selectedIds.has(c.id)
              const progress = c.totalDays > 0 ? Math.round((c.currentDay / c.totalDays) * 100) : 0

              return (
                <TableRow
                  key={c.id}
                  data-state={isSelected ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => onRowClick(c.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelection(c.id)}
                    />
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm font-medium">
                    {c.mailboxEmail}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {PROVIDER_LABELS[c.mailboxProvider] ?? c.mailboxProvider}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}>
                      {statusBadge.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${stageBadge.className}`}>
                      {stageBadge.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${healthBadge.className}`}>
                      {healthBadge.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {c.currentDay} / {c.totalDays}
                  </TableCell>
                  <TableCell className="w-[120px]">
                    <div className="flex items-center gap-2">
                      <Progress value={progress} className="h-1.5" />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">{c.currentDailyTarget}</TableCell>
                  <TableCell className="text-right text-sm">{c.maxDailySends}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => onRowClick(c.id)}
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
