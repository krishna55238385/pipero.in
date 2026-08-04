'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, RefreshCw, Trash2, CheckCircle2, XCircle, Clock, Loader2, Key } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getDkimSelectors, createDkimSelectorAction, verifyDkimSelectorAction, deleteDkimSelectorAction, rotateDkimSelectorAction } from '@/app/actions/deliverability'
import type { DkimSelector } from '@/types/deliverability'

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', icon: CheckCircle2 },
  inactive: { bg: 'bg-muted/50', text: 'text-muted-foreground', icon: XCircle },
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-600', icon: Clock },
  failed: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
  expired: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
}

type SelectorManagerProps = {
  domainId: string
  onRefresh?: () => void
}

export function SelectorManager({ domainId, onRefresh }: SelectorManagerProps) {
  const [selectors, setSelectors] = useState<DkimSelector[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newSelector, setNewSelector] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [rotateDialogId, setRotateDialogId] = useState<string | null>(null)
  const [rotateDialogCurrentSelector, setRotateDialogCurrentSelector] = useState('')
  const [rotateNewSelector, setRotateNewSelector] = useState('')
  const [isRotating, setIsRotating] = useState(false)

  const loadSelectors = useCallback(async () => {
    setLoading(true)
    const sels = await getDkimSelectors(domainId)
    setSelectors(sels)
    setLoading(false)
  }, [domainId])

  useEffect(() => { loadSelectors() }, [loadSelectors])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSelector.trim() || isCreating) return
    setIsCreating(true)
    await createDkimSelectorAction({ domainId, selector: newSelector.trim() })
    setNewSelector('')
    setIsCreating(false)
    setShowCreateDialog(false)
    await loadSelectors()
    onRefresh?.()
  }

  const handleDelete = async () => {
    if (!deleteConfirmId) return
    await deleteDkimSelectorAction(deleteConfirmId)
    setDeleteConfirmId(null)
    await loadSelectors()
    onRefresh?.()
  }

  const handleVerify = async (id: string) => {
    setVerifying(id)
    await verifyDkimSelectorAction(id)
    setVerifying(null)
    await loadSelectors()
    onRefresh?.()
  }

  const handleRotate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rotateDialogId || !rotateNewSelector.trim() || isRotating) return
    setIsRotating(true)
    await rotateDkimSelectorAction({ domainId, currentSelectorId: rotateDialogId, newSelector: rotateNewSelector.trim() })
    setRotateDialogId(null)
    setRotateNewSelector('')
    setIsRotating(false)
    await loadSelectors()
    onRefresh?.()
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
        <CardTitle className="text-sm font-medium">DKIM Selectors</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </CardHeader>
      <CardContent>
        {selectors.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No selectors configured</p>
        ) : (
          <div className="space-y-2">
            {selectors.map(sel => {
              const style = STATUS_STYLES[sel.status] ?? STATUS_STYLES.pending
              const Icon = style.icon
              return (
                <div key={sel.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <div className={cn('p-1.5 rounded-md', style.bg)}>
                    <Icon className={cn('h-3.5 w-3.5', style.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{sel.selector}</span>
                      <Badge variant={sel.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                        {sel.status}
                      </Badge>
                    </div>
                    {sel.keyLength && (
                      <p className="text-xs text-muted-foreground">{sel.keyLength}-bit key</p>
                    )}
                    {sel.lastVerifiedAt && (
                      <p className="text-xs text-muted-foreground">Verified: {new Date(sel.lastVerifiedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleVerify(sel.id)} disabled={verifying === sel.id}>
                      <RefreshCw className={cn('h-3 w-3', verifying === sel.id && 'animate-spin')} />
                    </Button>
                    {sel.status === 'active' && (
                      <Button size="sm" variant="ghost" onClick={() => { setRotateDialogId(sel.id); setRotateDialogCurrentSelector(sel.selector); setRotateNewSelector('') }}>
                        <Key className="h-3 w-3" />
                      </Button>
                    )}
                    {sel.status !== 'active' && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(sel.id)}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showCreateDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Add DKIM Selector</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setShowCreateDialog(false); setNewSelector('') }}><XCircle className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="space-y-3">
                  <Input
                    placeholder="e.g. default, s1, s2"
                    value={newSelector}
                    onChange={(e) => setNewSelector(e.target.value)}
                    autoFocus
                    disabled={isCreating}
                  />
                  <p className="text-xs text-muted-foreground">
                    A new DKIM key pair will be generated for this selector.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setShowCreateDialog(false); setNewSelector('') }} disabled={isCreating}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={!newSelector.trim() || isCreating}>
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
                <CardTitle className="text-base">Delete Selector</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to delete this selector? Existing emails using it may fail DKIM verification.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                  <Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {rotateDialogId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Rotate DKIM Selector</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setRotateDialogId(null); setRotateNewSelector('') }}><XCircle className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRotate} className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Current selector: <Badge variant="secondary">{rotateDialogCurrentSelector}</Badge>
                  </p>
                  <Input
                    placeholder="New selector name"
                    value={rotateNewSelector}
                    onChange={(e) => setRotateNewSelector(e.target.value)}
                    autoFocus
                    disabled={isRotating}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setRotateDialogId(null); setRotateNewSelector('') }} disabled={isRotating}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={!rotateNewSelector.trim() || isRotating}>
                      {isRotating ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Rotating...</> : 'Rotate'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
