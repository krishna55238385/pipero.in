'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMailFiltersStore } from '@/stores/mail-filters'

export function MailboxPagination() {
  const { dashboardPagination, setDashboardPage, setDashboardPageSize } = useMailFiltersStore()
  const { page, pageSize, total, totalPages } = dashboardPagination

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  if (total === 0) return null

  return (
    <div className="flex items-center justify-between gap-4 px-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          Showing {start}–{end} of {total}
        </span>
        <Select value={String(pageSize)} onValueChange={(v) => setDashboardPageSize(Number(v))}>
          <SelectTrigger className="h-8 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map((s) => (
              <SelectItem key={s} value={String(s)}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => setDashboardPage(1)}>
          <ChevronsLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => setDashboardPage(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[80px] text-center text-sm font-medium">
          {page} / {totalPages}
        </span>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => setDashboardPage(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => setDashboardPage(totalPages)}>
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
