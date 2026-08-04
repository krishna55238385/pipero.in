'use client'

import { useEffect, useRef, useState } from 'react'
import { Mail, CheckCircle2, AlertTriangle, KeyRound, ServerOff, Gauge } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getMailboxDashboardStats } from '@/app/actions/mail'
import type { DashboardStatsResult } from '@/app/actions/mail'

const statCards = [
  { key: 'total', label: 'Total Mailboxes', icon: Mail, color: 'text-primary', bgColor: 'bg-primary/10' },
  { key: 'connected', label: 'Connected', icon: CheckCircle2, color: 'text-emerald-600', bgColor: 'bg-emerald-600/10' },
  { key: 'needsAttention', label: 'Needs Attention', icon: AlertTriangle, color: 'text-amber-600', bgColor: 'bg-amber-600/10' },
  { key: 'oauthExpired', label: 'OAuth Expired', icon: KeyRound, color: 'text-orange-600', bgColor: 'bg-orange-600/10' },
  { key: 'smtpErrors', label: 'SMTP Errors', icon: ServerOff, color: 'text-destructive', bgColor: 'bg-destructive/10' },
  { key: 'dailyCapacity', label: 'Daily Capacity', icon: Gauge, color: 'text-blue-600', bgColor: 'bg-blue-600/10' },
] as const

type MailboxOverviewStatsProps = {
  refreshKey?: number
}

export function MailboxOverviewStats({ refreshKey }: MailboxOverviewStatsProps) {
  const [stats, setStats] = useState<DashboardStatsResult | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    getMailboxDashboardStats()
      .then((s) => { if (mountedRef.current) setStats(s) })
      .catch(() => {})
    return () => { mountedRef.current = false }
  }, [refreshKey])

  const loading = stats === null

  const values: Record<string, number> = stats
    ? { total: stats.total, connected: stats.connected, needsAttention: stats.needsAttention, oauthExpired: stats.oauthExpired, smtpErrors: stats.smtpErrors, dailyCapacity: stats.dailyCapacity }
    : { total: 0, connected: 0, needsAttention: 0, oauthExpired: 0, smtpErrors: 0, dailyCapacity: 0 }

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
