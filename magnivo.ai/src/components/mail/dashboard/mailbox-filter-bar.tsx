'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useMailFiltersStore } from '@/stores/mail-filters'
import type { MailboxProvider, MailboxStatus, MailboxHealth, WarmupStatus } from '@/types/mail'

export function MailboxFilterBar() {
  const {
    dashboardSearch, dashboardStatus, dashboardProvider, dashboardHealth, dashboardWarmupStatus,
    setDashboardSearch, setDashboardStatus, setDashboardProvider, setDashboardHealth, setDashboardWarmupStatus,
    resetDashboardFilters,
  } = useMailFiltersStore()

  const hasActiveFilters =
    dashboardSearch !== '' ||
    dashboardStatus !== 'all' ||
    dashboardProvider !== 'all' ||
    dashboardHealth !== 'all' ||
    dashboardWarmupStatus !== 'all'

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email or name..."
          value={dashboardSearch}
          onChange={(e) => setDashboardSearch(e.target.value)}
          className="h-9 pl-9 text-sm"
        />
        {dashboardSearch && (
          <button
            onClick={() => setDashboardSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={dashboardProvider} onValueChange={(v: string) => setDashboardProvider(v as MailboxProvider | 'all')}>
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

        <Select value={dashboardStatus} onValueChange={(v: string) => setDashboardStatus(v as MailboxStatus | 'all')}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="connected">Connected</SelectItem>
            <SelectItem value="disconnected">Disconnected</SelectItem>
            <SelectItem value="warming">Warming</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="testing">Testing</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="reconnect_required">Reconnect Required</SelectItem>
            <SelectItem value="oauth_expired">OAuth Expired</SelectItem>
            <SelectItem value="smtp_failed">SMTP Failed</SelectItem>
            <SelectItem value="imap_failed">IMAP Failed</SelectItem>
            <SelectItem value="verification_failed">Verification Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={dashboardHealth} onValueChange={(v: string) => setDashboardHealth(v as MailboxHealth | 'all')}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Health" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Health</SelectItem>
            <SelectItem value="excellent">Excellent</SelectItem>
            <SelectItem value="good">Good</SelectItem>
            <SelectItem value="fair">Fair</SelectItem>
            <SelectItem value="poor">Poor</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>

        <Select value={dashboardWarmupStatus} onValueChange={(v: string) => setDashboardWarmupStatus(v as WarmupStatus | 'all')}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Warmup" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Warmup</SelectItem>
            <SelectItem value="idle">Idle</SelectItem>
            <SelectItem value="warming">Warming</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetDashboardFilters}
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
