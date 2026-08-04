'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Globe, Link2, Unlink, RefreshCw, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getPostmasterDomains, connectPostmasterDomainAction, disconnectPostmasterDomainAction, syncPostmasterMetricsAction, getPostmasterDashboard } from '@/app/actions/deliverability'
import type { PostmasterDomain, PostmasterDashboardStats } from '@/types/deliverability'

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  connected: { bg: 'bg-emerald-500/10', text: 'text-emerald-600' },
  disconnected: { bg: 'bg-muted/50', text: 'text-muted-foreground' },
  error: { bg: 'bg-red-500/10', text: 'text-red-600' },
  pending_verification: { bg: 'bg-amber-500/10', text: 'text-amber-600' },
}

export function PostmasterDashboard() {
  const [domains, setDomains] = useState<PostmasterDomain[]>([])
  const [stats, setStats] = useState<PostmasterDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [connectDomain, setConnectDomain] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [disconnectConfirmId, setDisconnectConfirmId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [d, s] = await Promise.all([getPostmasterDomains(), getPostmasterDashboard()])
    setDomains(d)
    setStats(s)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!connectDomain.trim() || isConnecting) return
    setIsConnecting(true)
    await connectPostmasterDomainAction(connectDomain.trim())
    setConnectDomain('')
    setIsConnecting(false)
    setShowConnectDialog(false)
    await loadData()
  }

  const handleSync = async (id: string) => {
    setSyncing(id)
    await syncPostmasterMetricsAction(id)
    setSyncing(null)
    await loadData()
  }

  const handleDisconnect = async () => {
    if (!disconnectConfirmId) return
    await disconnectPostmasterDomainAction(disconnectConfirmId)
    setDisconnectConfirmId(null)
    await loadData()
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
          <Globe className="h-4 w-4" /> Google Postmaster
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setShowConnectDialog(true)}>
          <Link2 className="h-3.5 w-3.5 mr-1" /> Connect
        </Button>
      </CardHeader>
      <CardContent>
        {stats && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.domainsConnected}</div>
              <div className="text-xs text-muted-foreground">Connected</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-600">{stats.avgAuthSuccessRate > 0 ? `${Math.round(stats.avgAuthSuccessRate * 100)}%` : 'N/A'}</div>
              <div className="text-xs text-muted-foreground">Auth Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{stats.avgSpamComplaintRate > 0 ? `${(stats.avgSpamComplaintRate * 100).toFixed(2)}%` : 'N/A'}</div>
              <div className="text-xs text-muted-foreground">Spam Rate</div>
            </div>
          </div>
        )}

        {domains.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No Postmaster domains connected</p>
        ) : (
          <div className="space-y-2">
            {domains.map(domain => {
              const style = STATUS_STYLES[domain.connectionStatus] ?? STATUS_STYLES.disconnected
              return (
                <div key={domain.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{domain.postmasterDomain}</span>
                      <Badge variant="secondary" className={cn('text-[10px]', style.bg, style.text)}>
                        {domain.connectionStatus}
                      </Badge>
                    </div>
                    {domain.lastSyncAt && (
                      <p className="text-xs text-muted-foreground">Last sync: {new Date(domain.lastSyncAt).toLocaleString()}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleSync(domain.id)} disabled={syncing === domain.id}>
                      <RefreshCw className={cn('h-3 w-3', syncing === domain.id && 'animate-spin')} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDisconnectConfirmId(domain.id)}>
                      <Unlink className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showConnectDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Connect Google Postmaster</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setShowConnectDialog(false); setConnectDomain('') }}><XCircle className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleConnect} className="space-y-3">
                  <Input
                    placeholder="e.g. company.com"
                    value={connectDomain}
                    onChange={(e) => setConnectDomain(e.target.value)}
                    autoFocus
                    disabled={isConnecting}
                  />
                  <p className="text-xs text-muted-foreground">
                    You will be redirected to Google to authorize access to Postmaster Tools data.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setShowConnectDialog(false); setConnectDomain('') }} disabled={isConnecting}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={!connectDomain.trim() || isConnecting}>
                      {isConnecting ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Connecting...</> : 'Connect'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {disconnectConfirmId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-sm mx-4">
              <CardHeader>
                <CardTitle className="text-base">Disconnect Domain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Disconnect this domain from Google Postmaster? Historical data will be preserved but sync will stop.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setDisconnectConfirmId(null)}>Cancel</Button>
                  <Button variant="destructive" size="sm" onClick={handleDisconnect}>Disconnect</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
