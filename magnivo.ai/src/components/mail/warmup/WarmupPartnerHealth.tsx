'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { WarmupConfigResponse, WarmupDashboardStats } from '@/types/mail'

type WarmupPartnerHealthProps = {
  configs: WarmupConfigResponse[]
  stats: WarmupDashboardStats | null
}

export function WarmupPartnerHealth({ configs, stats }: WarmupPartnerHealthProps) {
  const byProvider = configs.reduce<Record<string, { total: number; healthy: number; atRisk: number }>>((acc, c) => {
    const key = c.mailboxProvider || 'unknown'
    if (!acc[key]) acc[key] = { total: 0, healthy: 0, atRisk: 0 }
    acc[key].total += 1
    if (c.health === 'excellent' || c.health === 'healthy') acc[key].healthy += 1
    if (c.health === 'warning' || c.health === 'critical') acc[key].atRisk += 1
    return acc
  }, {})

  const graduatingSoon = configs
    .filter((c) => c.status === 'running' && c.currentDay >= Math.max(1, c.totalDays - 5))
    .sort((a, b) => b.currentDay - a.currentDay)
    .slice(0, 8)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Partner / provider health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.keys(byProvider).length === 0 ? (
            <p className="text-sm text-muted-foreground">No warmup partners active</p>
          ) : (
            Object.entries(byProvider).map(([provider, row]) => (
              <div key={provider} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <div>
                  <p className="font-medium capitalize">{provider}</p>
                  <p className="text-xs text-muted-foreground">{row.total} mailboxes</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline">{row.healthy} healthy</Badge>
                  <Badge variant={row.atRisk > 0 ? 'destructive' : 'secondary'}>{row.atRisk} at risk</Badge>
                </div>
              </div>
            ))
          )}
          {stats && (
            <p className="text-xs text-muted-foreground pt-2">
              Avg health {stats.avgHealthScore.toFixed(0)} · Graduation rate {stats.graduationRate.toFixed(0)}%
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Graduation timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {graduatingSoon.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mailboxes near graduation</p>
          ) : (
            graduatingSoon.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.mailboxEmail}</p>
                  <p className="text-xs text-muted-foreground">
                    Day {c.currentDay}/{c.totalDays} · target {c.currentDailyTarget}/day
                  </p>
                </div>
                <Badge variant="outline">{c.health}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
