'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { MailTableSkeleton } from '@/components/mail/MailSkeleton'
import { Button } from '@/components/ui/button'
import { CalendarDays, LayoutList, Plus, HeartPulse } from 'lucide-react'
import { listWarmupsAction, getWarmupDashboardAction, getWarmupPermissionsAction } from '@/app/actions/mail'
import { useWarmupFiltersStore } from '@/stores/warmup-filters'
import type { WarmupConfigResponse, WarmupDashboardStats, MailUserPermissions } from '@/types/mail'
import { WarmupOverviewStats } from '@/components/mail/warmup/WarmupOverviewStats'
import { WarmupFilterBar } from '@/components/mail/warmup/WarmupFilterBar'
import { WarmupDataTable } from '@/components/mail/warmup/WarmupDataTable'
import { WarmupPagination } from '@/components/mail/warmup/WarmupPagination'
import { WarmupBulkActionBar } from '@/components/mail/warmup/WarmupBulkActionBar'
import { WarmupDetailDrawer } from '@/components/mail/warmup/WarmupDetailDrawer'
import { WarmupCreateEditDialog } from '@/components/mail/warmup/WarmupCreateEditDialog'
import { WarmupEmptyState } from '@/components/mail/warmup/WarmupEmptyState'
import { WarmupCharts } from '@/components/mail/warmup/WarmupCharts'
import { WarmupCalendar } from '@/components/mail/warmup/WarmupCalendar'
import { WarmupPartnerHealth } from '@/components/mail/warmup/WarmupPartnerHealth'

type WarmupDashboardClientProps = {
  isLoading?: boolean
}

type ViewTab = 'table' | 'calendar' | 'partners'

export default function WarmupDashboardClient({ isLoading: initialLoading = false }: WarmupDashboardClientProps) {
  const [configs, setConfigs] = useState<WarmupConfigResponse[]>([])
  const [loading, setLoading] = useState(!initialLoading)
  const [statsRefreshKey, setStatsRefreshKey] = useState(0)
  const [dashboardStats, setDashboardStats] = useState<WarmupDashboardStats | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [view, setView] = useState<ViewTab>('table')
  const [scheduleEdit, setScheduleEdit] = useState<WarmupConfigResponse | null>(null)
  const [permissions, setPermissions] = useState<MailUserPermissions>({
    canRead: true,
    canWrite: true,
    canManage: true,
    canAdmin: false,
  })
  const mountedRef = useRef(true)

  const {
    search, status, stage, health, provider,
    sortBy, sortDirection,
    pagination, setPagination, setDrawer,
  } = useWarmupFiltersStore()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchDashboardStats = useCallback(async () => {
    try {
      const [s, perms] = await Promise.all([
        getWarmupDashboardAction(),
        getWarmupPermissionsAction(),
      ])
      if (mountedRef.current) {
        setDashboardStats(s)
        setPermissions(perms)
      }
    } catch {
      // silent
    }
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listWarmupsAction({
        status: status === 'all' ? undefined : status,
        search: search || undefined,
        sortBy,
        sortDirection,
        page: pagination.page,
        pageSize: view === 'calendar' || view === 'partners' ? 100 : pagination.pageSize,
      })

      if (!mountedRef.current) return
      setConfigs(result.configs)
      setPagination({
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
    search, status, stage, health, provider,
    sortBy, sortDirection,
    pagination.page, pagination.pageSize, setPagination, view,
  ])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!initialLoading) {
      fetchData()
      fetchDashboardStats()
    }
  }, [fetchData, fetchDashboardStats, initialLoading])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleRowClick(id: string) {
    setDrawer({ open: true, configId: id })
  }

  function handleActionComplete() {
    fetchData()
    fetchDashboardStats()
    setStatsRefreshKey((k) => k + 1)
    setScheduleEdit(null)
  }

  const hasActiveFilters =
    search !== '' ||
    status !== 'all' ||
    stage !== 'all' ||
    health !== 'all' ||
    provider !== 'all'

  const showEmptyState = !loading && configs.length === 0 && !hasActiveFilters
  const showNoResults = !loading && configs.length === 0 && hasActiveFilters

  if (initialLoading) {
    return (
      <div className="space-y-6">
        <MailPageHeader
          title="Warmup"
          description="Monitor and manage email warmup processes"
        />
        <MailTableSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <MailPageHeader
        title="Warmup"
        description="Monitor and manage email warmup processes"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-md border overflow-hidden">
              <Button
                size="sm"
                variant={view === 'table' ? 'default' : 'ghost'}
                className="rounded-none"
                onClick={() => setView('table')}
              >
                <LayoutList className="h-3.5 w-3.5 mr-1" /> Table
              </Button>
              <Button
                size="sm"
                variant={view === 'calendar' ? 'default' : 'ghost'}
                className="rounded-none"
                onClick={() => setView('calendar')}
              >
                <CalendarDays className="h-3.5 w-3.5 mr-1" /> Calendar
              </Button>
              <Button
                size="sm"
                variant={view === 'partners' ? 'default' : 'ghost'}
                className="rounded-none"
                onClick={() => setView('partners')}
              >
                <HeartPulse className="h-3.5 w-3.5 mr-1" /> Partners
              </Button>
            </div>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              disabled={!permissions.canManage}
              title={!permissions.canManage ? 'Manage permission required' : undefined}
            >
              <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Start Warmup
            </Button>
          </div>
        }
      />

      <WarmupOverviewStats refreshKey={statsRefreshKey} />

      {dashboardStats && <WarmupCharts stats={dashboardStats} />}

      {view === 'calendar' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={configs.length === 0}
              onClick={() => setScheduleEdit(configs.find((c) => c.status === 'running') || configs[0] || null)}
            >
              Edit schedule
            </Button>
          </div>
          <WarmupCalendar configs={configs} onSelect={handleRowClick} />
        </div>
      )}

      {view === 'partners' && (
        <WarmupPartnerHealth configs={configs} stats={dashboardStats} />
      )}

      {view === 'table' && (
        <div className="space-y-4">
          <WarmupFilterBar />

          <WarmupBulkActionBar onComplete={handleActionComplete} />

          {showEmptyState ? (
            <WarmupEmptyState
              type="no-warmups"
              onAction={() => setCreateDialogOpen(true)}
            />
          ) : showNoResults ? (
            <WarmupEmptyState type="no-results" />
          ) : (
            <>
              {loading ? (
                <MailTableSkeleton />
              ) : (
                <WarmupDataTable configs={configs} onRowClick={handleRowClick} />
              )}
              <WarmupPagination />
            </>
          )}
        </div>
      )}

      <WarmupDetailDrawer
        onComplete={handleActionComplete}
        userPermissions={permissions}
      />

      <WarmupCreateEditDialog
        open={createDialogOpen || !!scheduleEdit}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false)
            setScheduleEdit(null)
          } else if (!scheduleEdit) {
            setCreateDialogOpen(true)
          }
        }}
        editingConfig={scheduleEdit}
        onComplete={handleActionComplete}
      />
    </div>
  )
}
