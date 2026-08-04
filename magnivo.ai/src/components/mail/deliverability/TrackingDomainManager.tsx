'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, RefreshCw, Trash2, CheckCircle2, XCircle, Clock, Loader2, Globe, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getTrackingDomainsAction, createTrackingDomainAction, deleteTrackingDomainAction, verifyTrackingDomainAction, setDefaultTrackingDomainAction } from '@/app/actions/deliverability'
import type { TrackingDomain } from '@/types/deliverability'

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', icon: CheckCircle2 },
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-600', icon: Clock },
  failed: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
  expired: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
  inactive: { bg: 'bg-muted/50', text: 'text-muted-foreground', icon: XCircle },
}

type TrackingDomainManagerProps = {
  domainId: string
  onRefresh?: () => void
}

export function TrackingDomainManager({ domainId, onRefresh }: TrackingDomainManagerProps) {
  const [domains, setDomains] = useState<TrackingDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const loadDomains = useCallback(async () => {
    setLoading(true)
    const list = await getTrackingDomainsAction()
    const filtered = list.filter((td) => td.domainId === domainId)
    setDomains(filtered)
    setLoading(false)
  }, [domainId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data fetching pattern
  useEffect(() => { loadDomains() }, [loadDomains])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDomain.trim() || isCreating) return
    setIsCreating(true)
    await createTrackingDomainAction(domainId, newDomain.trim())
    setNewDomain('')
    setIsCreating(false)
    setShowCreateDialog(false)
    await loadDomains()
    onRefresh?.()
  }

  const handleDelete = async () => {
    if (!deleteConfirmId) return
    await deleteTrackingDomainAction(deleteConfirmId)
    setDeleteConfirmId(null)
    await loadDomains()
    onRefresh?.()
  }

  const handleVerify = async (id: string) => {
    setVerifying(id)
    await verifyTrackingDomainAction(id)
    setVerifying(null)
    await loadDomains()
    onRefresh?.()
  }

  const handleSetDefault = async (id: string) => {
    await setDefaultTrackingDomainAction(id)
    await loadDomains()
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
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Globe className="h-4 w-4" /> Tracking Domains
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </CardHeader>
      <CardContent>
        {domains.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No tracking domains configured</p>
        ) : (
          <div className="space-y-2">
            {domains.map(td => {
              const style = STATUS_STYLES[td.status] ?? STATUS_STYLES.pending
              const Icon = style.icon
              return (
                <div key={td.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <div className={cn('p-1.5 rounded-md', style.bg)}>
                    <Icon className={cn('h-3.5 w-3.5', style.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{td.trackingDomain}</span>
                      <Badge variant="secondary" className={cn('text-[10px]', style.bg, style.text)}>
                        {td.status}
                      </Badge>
                      {(td.metadata as Record<string, unknown>)?.isDefault === true ? (
                        <Badge variant="outline" className="text-[10px]">Default</Badge>
                      ) : null}
                    </div>
                    {td.cnameTarget && (
                      <p className="text-xs text-muted-foreground truncate">CNAME: {td.cnameTarget}</p>
                    )}
                    {td.lastVerifiedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        Verified: {new Date(td.lastVerifiedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleVerify(td.id)} disabled={verifying === td.id}>
                      <RefreshCw className={cn('h-3 w-3', verifying === td.id && 'animate-spin')} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleSetDefault(td.id)}>
                      <Star className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(td.id)}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
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
                  <CardTitle className="text-base">Add Tracking Domain</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setShowCreateDialog(false); setNewDomain('') }}><XCircle className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="space-y-3">
                  <Input
                    placeholder="e.g. track.yourdomain.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    autoFocus
                    disabled={isCreating}
                  />
                  <p className="text-xs text-muted-foreground">
                    Add a CNAME record pointing to your tracking server. Verification will run automatically.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setShowCreateDialog(false); setNewDomain('') }} disabled={isCreating}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={!newDomain.trim() || isCreating}>
                      {isCreating ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Adding...</> : 'Add & Verify'}
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
                <CardTitle className="text-base">Delete Tracking Domain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to delete this tracking domain? Active campaigns using it will be affected.
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
