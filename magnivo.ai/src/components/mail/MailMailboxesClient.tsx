'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { MailTableSkeleton } from '@/components/mail/MailSkeleton'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { getMailboxesPaginated } from '@/app/actions/mail'
import { useMailFiltersStore } from '@/stores/mail-filters'
import type { MailboxTableRow, MailboxHealth, MailboxStatus, MailboxVerificationStatus, WarmupStatus, AuthType, MailUserPermissions } from '@/types/mail'
import { MailboxOverviewStats } from '@/components/mail/dashboard/mailbox-overview-stats'
import { MailboxFilterBar } from '@/components/mail/dashboard/mailbox-filter-bar'
import { MailboxDataTable } from '@/components/mail/dashboard/mailbox-data-table'
import { MailboxPagination } from '@/components/mail/dashboard/mailbox-pagination'
import { MailboxBulkActionBar } from '@/components/mail/dashboard/mailbox-bulk-action-bar'
import { MailboxDetailDrawer } from '@/components/mail/dashboard/mailbox-detail-drawer'
import { MailboxEmptyState } from '@/components/mail/dashboard/mailbox-empty-state'

type MailMailboxesClientProps = {
  isLoading?: boolean
  userPermissions?: MailUserPermissions
}

export default function MailMailboxesClient({ isLoading: initialLoading = false, userPermissions }: MailMailboxesClientProps) {
  const [mailboxes, setMailboxes] = useState<MailboxTableRow[]>([])
  const [loading, setLoading] = useState(!initialLoading)
  const [statsRefreshKey, setStatsRefreshKey] = useState(0)
  const mountedRef = useRef(true)

  const {
    dashboardSearch, dashboardStatus, dashboardProvider, dashboardHealth,
    dashboardPoolId, dashboardWarmupStatus, dashboardSortBy, dashboardSortDirection,
    dashboardPagination, setDashboardPagination, setDrawer,
  } = useMailFiltersStore()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getMailboxesPaginated({
        search: dashboardSearch || undefined,
        status: dashboardStatus === 'all' ? undefined : dashboardStatus,
        provider: dashboardProvider === 'all' ? undefined : dashboardProvider,
        health: dashboardHealth === 'all' ? undefined : dashboardHealth,
        poolId: dashboardPoolId === 'all' ? undefined : dashboardPoolId,
        warmupStatus: dashboardWarmupStatus === 'all' ? undefined : dashboardWarmupStatus,
        sortBy: dashboardSortBy,
        sortDirection: dashboardSortDirection,
        page: dashboardPagination.page,
        pageSize: dashboardPagination.pageSize,
      })

      const rows: MailboxTableRow[] = result.mailboxes.map((m) => ({
        id: m.id,
        email: m.email,
        displayName: m.display_name,
        provider: m.provider,
        poolId: m.pool_id,
        poolName: m.pool_name,
        healthScore: m.health_score,
        healthStatus: m.health_status as MailboxHealth,
        mailboxStatus: m.mailbox_status as MailboxStatus,
        verificationStatus: m.verification_status as MailboxVerificationStatus,
        warmupStatus: m.warmup_status as WarmupStatus,
        dailyLimit: m.daily_limit,
        currentDailyUsage: m.current_daily_usage,
        authType: m.auth_type as AuthType,
        createdAt: m.created_at,
      }))

      if (!mountedRef.current) return
      setMailboxes(rows)
      setDashboardPagination({
        total: result.total,
        totalPages: result.totalPages,
        page: result.page,
        pageSize: result.pageSize,
      })
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [
    dashboardSearch, dashboardStatus, dashboardProvider, dashboardHealth,
    dashboardPoolId, dashboardWarmupStatus, dashboardSortBy, dashboardSortDirection,
    dashboardPagination.page, dashboardPagination.pageSize, setDashboardPagination,
  ])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!initialLoading) fetchData()
  }, [fetchData, initialLoading])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleRowClick(id: string) {
    setDrawer({ open: true, mailboxId: id })
  }

  function handleActionComplete() {
    fetchData()
    setStatsRefreshKey((k) => k + 1)
  }

  const hasActiveFilters =
    dashboardSearch !== '' ||
    dashboardStatus !== 'all' ||
    dashboardProvider !== 'all' ||
    dashboardHealth !== 'all' ||
    dashboardPoolId !== 'all' ||
    dashboardWarmupStatus !== 'all'

  const showEmptyState = !loading && mailboxes.length === 0 && !hasActiveFilters
  const showNoResults = !loading && mailboxes.length === 0 && hasActiveFilters

  if (initialLoading) {
    return (
      <div className="space-y-6">
        <MailPageHeader
          title="Mailboxes"
          description="Manage your connected email accounts"
        />
        <MailTableSkeleton />
      </div>
    )
  }

  const canWrite = userPermissions?.canWrite !== false

  return (
    <div className="space-y-6">
      <MailPageHeader
        title="Mailboxes"
        description="Manage your connected email accounts"
        actions={
          canWrite ? (
            <Link href="/mail/mailboxes/add">
              <Button>
                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Add Mailbox
              </Button>
            </Link>
          ) : undefined
        }
      />

      <MailboxOverviewStats refreshKey={statsRefreshKey} />

      <div className="space-y-4">
        <MailboxFilterBar />

        <MailboxBulkActionBar onComplete={handleActionComplete} userPermissions={userPermissions} />

        {showEmptyState ? (
          <MailboxEmptyState
            type="no-mailboxes"
            onAction={canWrite ? () => { window.location.href = '/mail/mailboxes/add' } : undefined}
          />
        ) : showNoResults ? (
          <MailboxEmptyState type="no-results" />
        ) : (
          <>
            {loading ? (
              <MailTableSkeleton />
            ) : (
              <MailboxDataTable mailboxes={mailboxes} onRowClick={handleRowClick} />
            )}
            <MailboxPagination />
          </>
        )}
      </div>

      <MailboxDetailDrawer onComplete={handleActionComplete} userPermissions={userPermissions} />
    </div>
  )
}
