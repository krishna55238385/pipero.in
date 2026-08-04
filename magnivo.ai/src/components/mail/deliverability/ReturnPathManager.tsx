'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, RefreshCw, Trash2, Star, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getReturnPaths, createReturnPath, deleteReturnPathAction, verifyReturnPathAction, setDefaultReturnPathAction, getReturnPathAuditHistory } from '@/app/actions/deliverability'
import type { ReturnPath } from '@/types/deliverability'

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', icon: CheckCircle2 },
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-600', icon: Clock },
  failed: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
  expired: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
  rotating: { bg: 'bg-blue-500/10', text: 'text-blue-600', icon: RefreshCw },
}

type ReturnPathManagerProps = {
  domainId: string
  onRefresh?: () => void
}

export function ReturnPathManager({ domainId, onRefresh }: ReturnPathManagerProps) {
  const [returnPaths, setReturnPaths] = useState<ReturnPath[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [auditHistory, setAuditHistory] = useState<unknown[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const loadReturnPaths = useCallback(async () => {
    setLoading(true)
    const paths = await getReturnPaths(domainId)
    setReturnPaths(paths)
    setLoading(false)
  }, [domainId])

  useEffect(() => { loadReturnPaths() }, [loadReturnPaths])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDomain.trim() || isCreating) return
    setIsCreating(true)
    await createReturnPath({ domainId, returnPathDomain: newDomain.trim() })
    setNewDomain('')
    setIsCreating(false)
    setShowCreateDialog(false)
    await loadReturnPaths()
    onRefresh?.()
  }

  const handleDelete = async () => {
    if (!deleteConfirmId) return
    await deleteReturnPathAction(deleteConfirmId)
    setDeleteConfirmId(null)
    await loadReturnPaths()
    onRefresh?.()
  }

  const handleVerify = async (id: string) => {
    setVerifying(id)
    await verifyReturnPathAction(id)
    setVerifying(null)
    await loadReturnPaths()
    onRefresh?.()
  }

  const handleSetDefault = async (id: string) => {
    await setDefaultReturnPathAction(id, domainId)
    await loadReturnPaths()
    onRefresh?.()
  }

  const handleViewAudit = async (id: string) => {
    const history = await getReturnPathAuditHistory(id)
    setAuditHistory(history)
    setShowAudit(true)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Return Paths</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </CardHeader>
      <CardContent>
        {returnPaths.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No return paths configured</p>
        ) : (
          <div className="space-y-2">
            {returnPaths.map(rp => {
              const style = STATUS_STYLES[rp.status] ?? STATUS_STYLES.pending
              const Icon = style.icon
              return (
                <div key={rp.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <div className={cn('p-1.5 rounded-md', style.bg)}>
                    <Icon className={cn('h-3.5 w-3.5', style.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{rp.returnPathDomain}</span>
                      {rp.isDefault && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                    </div>
                    {rp.cnameTarget && (
                      <p className="text-xs text-muted-foreground truncate">CNAME: {rp.cnameTarget}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleVerify(rp.id)} disabled={verifying === rp.id}>
                      <RefreshCw className={cn('h-3 w-3', verifying === rp.id && 'animate-spin')} />
                    </Button>
                    {!rp.isDefault && (
                      <Button size="sm" variant="ghost" onClick={() => handleSetDefault(rp.id)}>
                        <Star className="h-3 w-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handleViewAudit(rp.id)}>
                      <Clock className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(rp.id)}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showAudit && (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium">Audit History</h4>
              <Button size="sm" variant="ghost" onClick={() => setShowAudit(false)}>Close</Button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {auditHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground">No history</p>
              ) : (
                auditHistory.map((entry: any, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    <span className="font-medium">{entry.action}</span> - {new Date(entry.created_at).toLocaleString()}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {showCreateDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Add Return Path</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setShowCreateDialog(false); setNewDomain('') }}><XCircle className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="space-y-3">
                  <Input
                    placeholder="e.g. bounce.yourdomain.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    autoFocus
                    disabled={isCreating}
                  />
                  <p className="text-xs text-muted-foreground">
                    A CNAME record will be verified automatically after creation.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setShowCreateDialog(false); setNewDomain('') }} disabled={isCreating}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={!newDomain.trim() || isCreating}>
                      {isCreating ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Creating...</> : 'Create'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {deleteConfirmId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-sm mx-4">
              <CardHeader>
                <CardTitle className="text-base">Delete Return Path</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to delete this return path? This action cannot be undone.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                  <Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
