'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EngageProductShell, EngageEmpty, EngageLoading, EngageToolbar } from '@/components/mail/EngageProductShell'
import {
  getTrackingDomainsAction,
  createTrackingDomainAction,
  verifyTrackingDomainAction,
  deleteTrackingDomainAction,
  setDefaultTrackingDomainAction,
  getDeliverabilityDomains,
} from '@/app/actions/deliverability'
import type { TrackingDomain } from '@/types/deliverability'
import { Loader2, Trash2 } from 'lucide-react'

function isTrackingDefault(d: TrackingDomain): boolean {
  return Boolean((d.metadata as { isDefault?: boolean } | null)?.isDefault)
}

export default function EngageTrackingDomainsClient() {
  const [domains, setDomains] = useState<Awaited<ReturnType<typeof getTrackingDomainsAction>>>([])
  const [sendingDomains, setSendingDomains] = useState<Awaited<ReturnType<typeof getDeliverabilityDomains>>>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [domainId, setDomainId] = useState('')
  const [trackingHost, setTrackingHost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TrackingDomain | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [t, s] = await Promise.all([getTrackingDomainsAction(), getDeliverabilityDomains()])
      setDomains(t)
      setSendingDomains(s)
      if (!domainId && s[0]) setDomainId(s[0].id)
    } catch {
      setError('Failed to load tracking domains')
    } finally {
      setLoading(false)
    }
  }, [domainId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = domains.filter((d) => {
    if (!search) return true
    return d.trackingDomain.toLowerCase().includes(search.toLowerCase())
  })

  async function create() {
    if (!domainId || !trackingHost.trim()) return
    setBusy(true)
    const result = await createTrackingDomainAction(domainId, trackingHost.trim())
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Create failed')
      return
    }
    setTrackingHost('')
    await load()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusy(true)
    setError(null)
    const result = await deleteTrackingDomainAction(deleteTarget.id)
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Delete failed')
      return
    }
    setDeleteTarget(null)
    await load()
  }

  if (loading) {
    return (
      <EngageProductShell title="Tracking Domains" description="Per-tenant CNAME tracking — never shared across workspaces">
        <EngageLoading />
      </EngageProductShell>
    )
  }

  return (
    <EngageProductShell
      title="Tracking Domains"
      description="Open-pixel and click-redirect hosts. Each workspace must use its own CNAME."
      stats={[
        { label: 'Tracking domains', value: domains.length },
        { label: 'Verified', value: domains.filter((d) => d.status === 'verified').length, tone: 'good' },
        { label: 'Failed', value: domains.filter((d) => d.status === 'failed').length, tone: 'bad' },
        { label: 'Sending domains', value: sendingDomains.length },
      ]}
      toolbar={
        <EngageToolbar search={search} onSearch={setSearch} onRefresh={() => void load()} searchPlaceholder="Search tracking hosts…" />
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add tracking domain</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
          >
            <option value="">Sending domain…</option>
            {sendingDomains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.domain}
              </option>
            ))}
          </select>
          <Input
            placeholder="track.yourdomain.com"
            value={trackingHost}
            onChange={(e) => setTrackingHost(e.target.value)}
          />
          <Button disabled={busy || !domainId || !trackingHost.trim()} onClick={() => void create()}>
            {busy ? 'Adding…' : 'Add & prepare DNS'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EngageEmpty
              title="No tracking domains"
              description="Add a CNAME host so open/click tracking stays on your domain (Google/Yahoo sender requirements)."
            />
          ) : (
            <div className="divide-y">
              {filtered.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.trackingDomain}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      CNAME → {d.cnameTarget || 'pending'}
                      {isTrackingDefault(d) ? ' · default' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{d.status}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await verifyTrackingDomainAction(d.id)
                        await load()
                      }}
                    >
                      Verify
                    </Button>
                    {!isTrackingDefault(d) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          await setDefaultTrackingDomainAction(d.id)
                          await load()
                        }}
                      >
                        Set default
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(d)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !busy && !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tracking domain</DialogTitle>
            <DialogDescription>
              Remove <span className="font-medium text-foreground">{deleteTarget?.trackingDomain}</span>? Active
              campaigns using this host for open/click tracking will be affected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy || !deleteTarget} onClick={() => void confirmDelete()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EngageProductShell>
  )
}
