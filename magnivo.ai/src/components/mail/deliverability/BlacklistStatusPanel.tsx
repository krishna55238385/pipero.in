'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Shield, AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getBlacklistDashboardStatsAction, checkAllBlacklists } from '@/app/actions/deliverability'
import type { BlacklistDashboardStats, BlacklistCheck } from '@/types/deliverability'

type BlacklistStatusPanelProps = {
  domainId?: string
  onRefresh?: () => void
}

export function BlacklistStatusPanel({ domainId, onRefresh }: BlacklistStatusPanelProps) {
  const [stats, setStats] = useState<BlacklistDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  const loadStats = useCallback(async () => {
    setLoading(true)
    const s = await getBlacklistDashboardStatsAction()
    setStats(s)
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const handleCheckAll = async () => {
    if (!domainId) return
    setChecking(true)
    await checkAllBlacklists(domainId)
    setChecking(false)
    await loadStats()
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

  if (!stats) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Shield className="h-4 w-4" /> Blacklist Status
        </CardTitle>
        {domainId && (
          <Button size="sm" variant="outline" onClick={handleCheckAll} disabled={checking}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', checking && 'animate-spin')} /> Check All
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-600">{stats.cleanDomains}</div>
            <div className="text-xs text-muted-foreground">Clean</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{stats.listedDomains}</div>
            <div className="text-xs text-muted-foreground">Listed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-muted-foreground">{stats.unknownDomains}</div>
            <div className="text-xs text-muted-foreground">Unknown</div>
          </div>
        </div>

        {stats.recentListings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Recent Listings</h4>
            {stats.recentListings.map((listing: BlacklistCheck) => (
              <div key={listing.id} className="flex items-center gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/20">
                <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{listing.blacklistName}</span>
                  {listing.ip && <span className="text-xs text-muted-foreground ml-2">({listing.ip})</span>}
                </div>
                <Badge variant="destructive" className="text-[10px]">Listed</Badge>
              </div>
            ))}
          </div>
        )}

        {stats.recentListings.length === 0 && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-sm text-emerald-600">All clean - no active blacklist listings</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
