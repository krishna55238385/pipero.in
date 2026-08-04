'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertOctagon, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getBounceDashboard } from '@/app/actions/deliverability'
import type { BounceDashboardStats, BounceRecord } from '@/types/deliverability'

const BOUNCE_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  hard: { bg: 'bg-red-500/10', text: 'text-red-600' },
  soft: { bg: 'bg-amber-500/10', text: 'text-amber-600' },
  unknown: { bg: 'bg-muted/50', text: 'text-muted-foreground' },
}

export function BounceIntelligencePanel() {
  const [stats, setStats] = useState<BounceDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    setLoading(true)
    const s = await getBounceDashboard()
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
          <AlertOctagon className="h-4 w-4" /> Bounce Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{stats.totalBounces}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{stats.hardBounces}</div>
            <div className="text-xs text-muted-foreground">Hard</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.softBounces}</div>
            <div className="text-xs text-muted-foreground">Soft</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{stats.suppressionCount}</div>
            <div className="text-xs text-muted-foreground">Suppressed</div>
          </div>
        </div>

        {stats.recentBounces.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Recent Bounces</h4>
            {stats.recentBounces.slice(0, 5).map((bounce: BounceRecord) => {
              const style = BOUNCE_TYPE_STYLES[bounce.bounceType] ?? BOUNCE_TYPE_STYLES.unknown
              return (
                <div key={bounce.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <div className={cn('p-1.5 rounded-md', style.bg)}>
                    <AlertOctagon className={cn('h-3.5 w-3.5', style.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{bounce.recipientEmail}</span>
                      <Badge variant="secondary" className={cn('text-[10px]', style.bg, style.text)}>
                        {bounce.bounceType}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{bounce.bounceCategory}</p>
                  </div>
                  {bounce.suppressed && (
                    <Badge variant="destructive" className="text-[10px]">Suppressed</Badge>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
