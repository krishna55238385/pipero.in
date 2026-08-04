'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Eye, MousePointerClick, BarChart3, Loader2 } from 'lucide-react'
import { getTrackingDashboard } from '@/app/actions/deliverability'
import type { TrackingDashboardStats } from '@/types/deliverability'

export function TrackingOverviewPanel() {
  const [stats, setStats] = useState<TrackingDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    setLoading(true)
    const s = await getTrackingDashboard()
    setStats(s)
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

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
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Tracking Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Eye className="h-3.5 w-3.5 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-blue-600">{stats.uniqueOpens}</div>
            <div className="text-xs text-muted-foreground">Unique Opens</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{stats.totalOpens}</div>
            <div className="text-xs text-muted-foreground">Total Opens</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <MousePointerClick className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-emerald-600">{stats.uniqueClicks}</div>
            <div className="text-xs text-muted-foreground">Unique Clicks</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{stats.totalClicks}</div>
            <div className="text-xs text-muted-foreground">Total Clicks</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded-lg border text-center">
            <div className="text-lg font-bold text-blue-600">
              {stats.openRate > 0 ? `${(stats.openRate * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-muted-foreground">Open Rate</div>
          </div>
          <div className="p-2 rounded-lg border text-center">
            <div className="text-lg font-bold text-emerald-600">
              {stats.clickRate > 0 ? `${(stats.clickRate * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-muted-foreground">Click Rate</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
