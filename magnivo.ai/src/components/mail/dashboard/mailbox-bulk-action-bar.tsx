'use client'

import { useState } from 'react'
import { X, Users, CheckCircle2, Ban, Archive, Trash2, RotateCcw, ShieldCheck, RefreshCw } from 'lucide-react'
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
import { useMailFiltersStore } from '@/stores/mail-filters'
import {
  bulkEnableMailboxesAction,
  bulkDisableMailboxesAction,
  bulkArchiveMailboxesAction,
  bulkDeleteMailboxesAction,
  bulkRestoreMailboxesAction,
  bulkVerifyMailboxesAction,
  bulkReconnectMailboxesAction,
} from '@/app/actions/mail'
import type { MailApiResult, MailboxActionResult, MailUserPermissions } from '@/types/mail'

type MailboxBulkActionBarProps = {
  onComplete: () => void
  userPermissions?: MailUserPermissions
}

function getSuccessCount(results: MailboxActionResult[]): number {
  return results.filter(r => r.success).length
}

function getFailureCount(results: MailboxActionResult[]): number {
  return results.filter(r => !r.success).length
}

export function MailboxBulkActionBar({ onComplete, userPermissions }: MailboxBulkActionBarProps) {
  const { selectedMailboxIds, clearMailboxSelection } = useMailFiltersStore()
  const [loading, setLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'archive' | 'delete' | 'restore' | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const count = selectedMailboxIds.size

  const canManage = userPermissions?.canManage ?? true
  const canAdmin = userPermissions?.canAdmin ?? true

  if (count === 0) return null

  const ids = Array.from(selectedMailboxIds)

  function handleResult(result: MailApiResult<MailboxActionResult[]>) {
    if (result.success && result.data) {
      const success = getSuccessCount(result.data)
      const failure = getFailureCount(result.data)
      if (failure > 0) {
        setResultMessage(`${success} succeeded, ${failure} failed`)
      } else {
        setResultMessage(`${success} mailbox${success !== 1 ? 'es' : ''} updated`)
      }
    } else if (!result.success) {
      setResultMessage(result.error ?? 'Action failed')
    }
    setTimeout(() => setResultMessage(null), 4000)
  }

  async function handleEnable() {
    setLoading(true)
    const result = await bulkEnableMailboxesAction(ids)
    handleResult(result)
    clearMailboxSelection()
    setLoading(false)
    onComplete()
  }

  async function handleDisable() {
    setLoading(true)
    const result = await bulkDisableMailboxesAction(ids)
    handleResult(result)
    clearMailboxSelection()
    setLoading(false)
    onComplete()
  }

  async function handleArchive() {
    setLoading(true)
    const result = await bulkArchiveMailboxesAction(ids)
    handleResult(result)
    clearMailboxSelection()
    setConfirmAction(null)
    setLoading(false)
    onComplete()
  }

  async function handleDelete() {
    setLoading(true)
    const result = await bulkDeleteMailboxesAction(ids)
    handleResult(result)
    clearMailboxSelection()
    setConfirmAction(null)
    setLoading(false)
    onComplete()
  }

  async function handleRestore() {
    setLoading(true)
    const result = await bulkRestoreMailboxesAction(ids)
    handleResult(result)
    clearMailboxSelection()
    setConfirmAction(null)
    setLoading(false)
    onComplete()
  }

  async function handleVerify() {
    setLoading(true)
    const result = await bulkVerifyMailboxesAction(ids)
    handleResult(result)
    clearMailboxSelection()
    setLoading(false)
    onComplete()
  }

  async function handleReconnect() {
    setLoading(true)
    const result = await bulkReconnectMailboxesAction(ids)
    handleResult(result)
    clearMailboxSelection()
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
          {canManage && (
            <>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading} onClick={handleEnable}>
                <CheckCircle2 className="mr-1 size-3" />
                Enable
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading} onClick={handleDisable}>
                <Ban className="mr-1 size-3" />
                Disable
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading}>
                <Users className="mr-1 size-3" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canManage && (
                <>
                  <DropdownMenuItem onClick={() => setConfirmAction('archive')}>
                    <Archive className="mr-2 size-3" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setConfirmAction('restore')}>
                    <RotateCcw className="mr-2 size-3" />
                    Restore
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleVerify}>
                    <ShieldCheck className="mr-2 size-3" />
                    Verify Connections
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleReconnect}>
                    <RefreshCw className="mr-2 size-3" />
                    Reconnect (OAuth)
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              {canAdmin && (
                <DropdownMenuItem className="text-destructive" onClick={() => setConfirmAction('delete')}>
                  <Trash2 className="mr-2 size-3" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0" onClick={clearMailboxSelection}>
          <X className="size-4" />
        </Button>
      </div>

      <Dialog open={confirmAction === 'archive'} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Mailboxes</DialogTitle>
            <DialogDescription>
              Are you sure you want to archive {count} mailbox{count !== 1 ? 'es' : ''}? Archived mailboxes will be hidden from active views and cannot send mail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" disabled={loading} onClick={handleArchive}>Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAction === 'restore'} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Mailboxes</DialogTitle>
            <DialogDescription>
              Are you sure you want to restore {count} mailbox{count !== 1 ? 'es' : ''}? They will be reactivated and visible in active views.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button disabled={loading} onClick={handleRestore}>Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAction === 'delete'} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Mailboxes</DialogTitle>
            <DialogDescription>
              Are you sure you want to soft-delete {count} mailbox{count !== 1 ? 'es' : ''}? Configurations and audit logs will be preserved, but the mailboxes will be hidden from all views.
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
