'use client'

import type { ReactNode } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Download, RefreshCw, Search } from 'lucide-react'

export type EngageStat = {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
}

export function EngageStatGrid({ stats }: { stats: EngageStat[] }) {
  return (
    <div className={cn('grid gap-3', stats.length > 4 ? 'grid-cols-2 lg:grid-cols-4 xl:grid-cols-6' : 'grid-cols-2 lg:grid-cols-4')}>
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="py-3 px-4">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p
              className={cn(
                'text-2xl font-bold tabular-nums mt-1',
                s.tone === 'good' && 'text-emerald-600',
                s.tone === 'warn' && 'text-amber-600',
                s.tone === 'bad' && 'text-red-600'
              )}
            >
              {s.value}
            </p>
            {s.hint && <p className="text-[10px] text-muted-foreground mt-0.5">{s.hint}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function EngageToolbar({
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  onRefresh,
  onExport,
  filters,
  actions,
}: {
  search?: string
  onSearch?: (v: string) => void
  searchPlaceholder?: string
  onRefresh?: () => void
  onExport?: () => void
  filters?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSearch && (
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={searchPlaceholder}
            value={search || ''}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      )}
      {filters}
      <div className="flex-1" />
      {onRefresh && (
        <Button size="sm" variant="outline" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      )}
      {onExport && (
        <Button size="sm" variant="outline" onClick={onExport}>
          <Download className="h-3.5 w-3.5 mr-1" /> Export
        </Button>
      )}
      {actions}
    </div>
  )
}

export function EngageProductShell({
  title,
  description,
  stats,
  toolbar,
  children,
  actions,
}: {
  title: string
  description: string
  stats?: EngageStat[]
  toolbar?: ReactNode
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <MailPageHeader title={title} description={description} />
        {actions}
      </div>
      {stats && stats.length > 0 && <EngageStatGrid stats={stats} />}
      {toolbar}
      {children}
    </div>
  )
}

export function EngageEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground border rounded-lg">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs mt-1 max-w-md">{description}</p>
    </div>
  )
}

export function EngageLoading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
      ))}
    </div>
  )
}
