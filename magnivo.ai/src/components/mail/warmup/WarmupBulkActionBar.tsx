'use client'

import { useState } from 'react'
import { X, PlayCircle, PauseCircle, Trash2, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWarmupFiltersStore } from '@/stores/warmup-filters'
import { bulkWarmupOperationAction } from '@/app/actions/mail'
import type { WarmupBulkResult } from '@/types/mail'

type WarmupBulkActionBarProps = {
  onComplete: () => void
}

function getSuccessCount(results: WarmupBulkResult[]): number {
  return results.filter((r) => r.success).length
}

function getFailureCount(results: WarmupBulkResult[]): number {
  return results.filter((r) => !r.success).length
}

export function WarmupBulkActionBar({ onComplete }: WarmupBulkActionBarProps) {
  const { selectedIds, clearSelection } = useWarmupFiltersStore()
  const [loading, setLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'archive' | 'delete' | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const count = selectedIds.size

  if (count === 0) return null

  const ids = Array.from(selectedIds)

  function handleResult(result: { success: boolean; data?: WarmupBulkResult[]; error?: string }) {
    if (result.success && result.data) {
      const s = getSuccessCount(result.data)
      const f = getFailureCount(result.data)
      if (f > 0) {
        setResultMessage(`${s} succeeded, ${f} failed`)
      } else {
        setResultMessage(`${s} warmup${s !== 1 ? 's' : ''} updated`)
      }
    } else {
      setResultMessage(result.error ?? 'Action failed')
    }
    setTimeout(() => setResultMessage(null), 4000)
  }

  async function handlePause() {
    setLoading(true)
    const result = await bulkWarmupOperationAction({ operation: 'pause', configIds: ids })
    handleResult(result)
    clearSelection()
    setLoading(false)
    onComplete()
  }

  async function handleResume() {
    setLoading(true)
    const result = await bulkWarmupOperationAction({ operation: 'resume', configIds: ids })
    handleResult(result)
    clearSelection()
    setLoading(false)
    onComplete()
  }

  async function handleArchive() {
    setLoading(true)
    const result = await bulkWarmupOperationAction({ operation: 'archive', configIds: ids })
    handleResult(result)
    clearSelection()
    setConfirmAction(null)
    setLoading(false)
    onComplete()
  }

  async function handleDelete() {
    setLoading(true)
    const result = await bulkWarmupOperationAction({ operation: 'delete', configIds: ids })
    handleResult(result)
    clearSelection()
    setConfirmAction(null)
    setLoading(false)
    onComplete()
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2">
        <span className="text-sm font-medium text-primary">{count} selected</span>
        {resultMessage && (
          <span className="text-xs text-muted-foreground">{resultMessage}</span>
        )}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading} onClick={handlePause}>
            <PauseCircle className="mr-1 size-3" />
            Pause
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading} onClick={handleResume}>
            <PlayCircle className="mr-1 size-3" />
            Resume
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading}>
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setConfirmAction('archive')}>
                <Archive className="mr-2 size-3" />
                Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setConfirmAction('delete')}>
                <Trash2 className="mr-2 size-3" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0" onClick={clearSelection}>
          <X className="size-4" />
        </Button>
      </div>

      <Dialog open={confirmAction === 'archive'} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Warmups</DialogTitle>
            <DialogDescription>
              Are you sure you want to archive {count} warmup configuration{count !== 1 ? 's' : ''}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" disabled={loading} onClick={handleArchive}>Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAction === 'delete'} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Warmups</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {count} warmup configuration{count !== 1 ? 's' : ''}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" disabled={loading} onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
