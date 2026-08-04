'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useWarmupFiltersStore } from '@/stores/warmup-filters'
import type { WarmupConfigStatus, WarmupStage, WarmupHealth, MailboxProvider } from '@/types/mail'

export function WarmupFilterBar() {
  const {
    search, status, stage, health, provider,
    setSearch, setStatus, setStage, setHealth, setProvider,
    resetFilters,
  } = useWarmupFiltersStore()

  const hasActiveFilters =
    search !== '' ||
    status !== 'all' ||
    stage !== 'all' ||
    health !== 'all' ||
    provider !== 'all'

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-9 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v: string) => setStatus(v as WarmupConfigStatus | 'all')}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="graduated">Graduated</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={stage} onValueChange={(v: string) => setStage(v as WarmupStage | 'all')}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            <SelectItem value="initial">Initial</SelectItem>
            <SelectItem value="learning">Learning</SelectItem>
            <SelectItem value="growing">Growing</SelectItem>
            <SelectItem value="established">Established</SelectItem>
            <SelectItem value="graduated">Graduated</SelectItem>
          </SelectContent>
        </Select>

        <Select value={health} onValueChange={(v: string) => setHealth(v as WarmupHealth | 'all')}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Health" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Health</SelectItem>
            <SelectItem value="excellent">Excellent</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>

        <Select value={provider} onValueChange={(v: string) => setProvider(v as MailboxProvider | 'all')}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            <SelectItem value="gmail">Gmail</SelectItem>
            <SelectItem value="outlook">Outlook</SelectItem>
            <SelectItem value="zoho">Zoho</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="h-9 text-xs text-muted-foreground"
          >
            <X className="mr-1 size-3" />
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
