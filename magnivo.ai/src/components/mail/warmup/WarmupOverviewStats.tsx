'use client'

import { useEffect, useRef, useState } from 'react'
import { Flame, PlayCircle, PauseCircle, Trophy, Gauge, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getWarmupDashboardAction } from '@/app/actions/mail'
import type { WarmupDashboardStats } from '@/types/mail'

const statCards = [
  { key: 'totalConfigs', label: 'Total Warmups', icon: Flame, color: 'text-primary', bgColor: 'bg-primary/10' },
  { key: 'running', label: 'Running', icon: PlayCircle, color: 'text-emerald-600', bgColor: 'bg-emerald-600/10' },
  { key: 'paused', label: 'Paused', icon: PauseCircle, color: 'text-amber-600', bgColor: 'bg-amber-600/10' },
  { key: 'graduated', label: 'Graduated', icon: Trophy, color: 'text-blue-600', bgColor: 'bg-blue-600/10' },
  { key: 'avgHealthScore', label: 'Avg Health', icon: Gauge, color: 'text-violet-600', bgColor: 'bg-violet-600/10' },
  { key: 'graduationRate', label: 'Graduation Rate', icon: TrendingUp, color: 'text-cyan-600', bgColor: 'bg-cyan-600/10' },
] as const

type WarmupOverviewStatsProps = {
  refreshKey?: number
}

export function WarmupOverviewStats({ refreshKey }: WarmupOverviewStatsProps) {
  const [stats, setStats] = useState<WarmupDashboardStats | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    getWarmupDashboardAction()
      .then((s) => { if (mountedRef.current) setStats(s) })
      .catch(() => {})
    return () => { mountedRef.current = false }
  }, [refreshKey])

  const loading = stats === null

  const values: Record<string, string> = stats
    ? {
        totalConfigs: String(stats.totalConfigs),
        running: String(stats.running),
        paused: String(stats.paused),
        graduated: String(stats.graduated),
        avgHealthScore: stats.avgHealthScore > 0 ? stats.avgHealthScore.toFixed(0) : '—',
        graduationRate: stats.graduationRate > 0 ? `${stats.graduationRate.toFixed(0)}%` : '—',
      }
    : { totalConfigs: '0', running: '0', paused: '0', graduated: '0', avgHealthScore: '—', graduationRate: '—' }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {statCards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.key} className="border-border/20">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`rounded-lg p-2 ${card.bgColor}`}>
                <Icon className={`size-4 ${card.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-lg font-semibold leading-none">
                  {loading ? (
                    <span className="inline-block h-5 w-8 animate-pulse rounded bg-muted" />
                  ) : (
                    values[card.key]
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
