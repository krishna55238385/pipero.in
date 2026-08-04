'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  getBounceDashboard,
  getComplaintDashboard,
  getDeliverabilityDashboardStats,
  getBlacklistDashboardStatsAction,
  getReputationDashboard,
} from '@/app/actions/deliverability'
import type { DeliverabilityDomain } from '@/types/deliverability'

type Recommendation = {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  action: string
}

type ReportPeriod = 'daily' | 'weekly' | 'monthly'

export function DeliverabilityReportsPanel({ domains }: { domains: DeliverabilityDomain[] }) {
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bounce, setBounce] = useState<Awaited<ReturnType<typeof getBounceDashboard>> | null>(null)
  const [complaint, setComplaint] = useState<Awaited<ReturnType<typeof getComplaintDashboard>> | null>(null)
  const [reputation, setReputation] = useState<Awaited<ReturnType<typeof getReputationDashboard>> | null>(null)
  const [blacklist, setBlacklist] = useState<Awaited<ReturnType<typeof getBlacklistDashboardStatsAction>> | null>(null)
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getDeliverabilityDashboardStats>> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [b, c, r, bl, s] = await Promise.all([
        getBounceDashboard().catch(() => null),
        getComplaintDashboard().catch(() => null),
        getReputationDashboard().catch(() => null),
        getBlacklistDashboardStatsAction().catch(() => null),
        getDeliverabilityDashboardStats().catch(() => null),
      ])
      setBounce(b)
      setComplaint(c)
      setReputation(r)
      setBlacklist(bl)
      setStats(s)
    } catch {
      setError('Failed to load deliverability reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hardBounceRate = useMemo(() => {
    const total = bounce?.totalBounces ?? 0
    if (total <= 0) return 0
    return (bounce?.hardBounces ?? 0) / total
  }, [bounce])

  const softBounceRate = useMemo(() => {
    const total = bounce?.totalBounces ?? 0
    if (total <= 0) return 0
    return (bounce?.softBounces ?? 0) / total
  }, [bounce])

  const complaintPressure = useMemo(() => {
    const active = complaint?.activeComplaints ?? 0
    const total = Math.max(1, complaint?.totalComplaints ?? 0)
    return active / total
  }, [complaint])

  const riskScore = useMemo(() => {
    let score = 100
    if (stats) {
      score -= Math.min(40, stats.failedDomains * 12)
      score -= Math.min(25, stats.needsAttention * 6)
      score -= Math.max(0, 70 - (stats.avgHealthScore || 0)) * 0.4
    }
    score -= Math.min(20, hardBounceRate * 400)
    score -= Math.min(15, softBounceRate * 200)
    score -= Math.min(25, (complaint?.autoPausedMailboxes ?? 0) * 8)
    score -= Math.min(20, (blacklist?.listedDomains ?? 0) * 10)
    return Math.max(0, Math.min(100, Math.round(score)))
  }, [stats, hardBounceRate, softBounceRate, complaint, blacklist])

  const riskLevel =
    riskScore >= 80 ? 'low' : riskScore >= 60 ? 'moderate' : riskScore >= 40 ? 'elevated' : 'critical'

  const recommendations = useMemo((): Recommendation[] => {
    const items: Recommendation[] = []
    for (const d of domains.filter((x) => x.spfStatus !== 'valid' || x.dkimStatus !== 'valid' || x.dmarcStatus !== 'valid')) {
      items.push({
        id: `dns-${d.id}`,
        severity: 'critical',
        title: `${d.domain} DNS incomplete`,
        action: 'Open Domains → Verify SPF/DKIM/DMARC and follow provider instructions.',
      })
    }
    if ((complaint?.autoPausedMailboxes ?? 0) > 0 || complaintPressure >= 0.3) {
      items.push({
        id: 'complaint-threshold',
        severity: 'critical',
        title: 'Complaint pressure elevated (auto-pause active)',
        action: 'Review Complaints tab, check Postmaster/SNDS, and tighten list hygiene.',
      })
    }
    if (hardBounceRate >= 0.3 || (bounce?.hardBounces ?? 0) >= 10) {
      items.push({
        id: 'hard-bounce',
        severity: 'warning',
        title: 'Hard bounce volume elevated',
        action: 'Run lead verification, suppress invalids, and pause high-bounce campaigns.',
      })
    }
    if ((blacklist?.listedDomains ?? 0) > 0) {
      items.push({
        id: 'blacklist',
        severity: 'critical',
        title: `${blacklist?.listedDomains} domain(s) listed`,
        action: 'Review Blacklist tab, request delisting, and reduce send volume until cleared.',
      })
    }
    if ((reputation?.avgReputationScore ?? 70) < 60) {
      items.push({
        id: 'reputation',
        severity: 'warning',
        title: 'Domain reputation trending low',
        action: 'Increase warmup volume ratio, tighten targeting, and monitor inbox placement.',
      })
    }
    if (items.length === 0) {
      items.push({
        id: 'healthy',
        severity: 'info',
        title: 'No critical deliverability risks detected',
        action: 'Continue daily DNS monitoring and weekly bounce/complaint reviews.',
      })
    }
    return items
  }, [domains, bounce, complaint, blacklist, reputation, hardBounceRate, complaintPressure])

  function exportReport() {
    const lines = [
      'period,risk_score,risk_level,avg_health,failed_domains,hard_bounce_rate,soft_bounce_rate,complaint_rate,listed',
      [
        period,
        riskScore,
        riskLevel,
        stats?.avgHealthScore ?? '',
        stats?.failedDomains ?? '',
        hardBounceRate,
        softBounceRate,
        complaint?.autoPausedMailboxes ?? '',
        blacklist?.listedDomains ?? '',
      ].join(','),
      '',
      'recommendation_severity,title,action',
      ...recommendations.map((r) => `${r.severity},"${r.title}","${r.action}"`),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deliverability-${period}-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading reports…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <Button key={p} size="sm" variant={period === p ? 'default' : 'outline'} onClick={() => setPeriod(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={exportReport}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export {period} report
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric
          label="Risk score"
          value={String(riskScore)}
          hint={riskLevel}
          icon={riskScore >= 60 ? TrendingUp : TrendingDown}
          tone={riskScore >= 60 ? 'ok' : 'bad'}
        />
        <Metric label="Avg domain health" value={`${stats?.avgHealthScore ?? 0}%`} hint="all domains" icon={CheckCircle2} tone="ok" />
        <Metric
          label="Hard bounce share"
          value={`${(hardBounceRate * 100).toFixed(1)}%`}
          hint="of bounces"
          icon={AlertTriangle}
          tone={hardBounceRate >= 0.3 ? 'bad' : 'ok'}
        />
        <Metric
          label="Auto-paused"
          value={String(complaint?.autoPausedMailboxes ?? 0)}
          hint="complaint policy"
          icon={ShieldAlert}
          tone={(complaint?.autoPausedMailboxes ?? 0) > 0 ? 'bad' : 'ok'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommendations & recovery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recommendations.map((r) => (
            <div key={r.id} className="flex items-start gap-3 rounded-md border p-3">
              <Badge
                variant={r.severity === 'critical' ? 'destructive' : r.severity === 'warning' ? 'secondary' : 'outline'}
              >
                {r.severity}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.action}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inbox / spam placement signals</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-3 text-sm">
          <PlacementStat label="Healthy domains" value={stats?.healthyDomains ?? 0} />
          <PlacementStat label="Needs attention" value={stats?.needsAttention ?? 0} />
          <PlacementStat label="Blacklist hits" value={blacklist?.listedDomains ?? 0} />
          <PlacementStat label="Auto-paused mailboxes" value={complaint?.autoPausedMailboxes ?? 0} />
          <PlacementStat label="Soft bounce share" value={`${(softBounceRate * 100).toFixed(1)}%`} />
          <PlacementStat label="Avg reputation" value={String(reputation?.avgReputationScore ?? '—')} />
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  hint: string
  icon: typeof TrendingUp
  tone: 'ok' | 'bad'
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 ${tone === 'bad' ? 'text-red-500' : 'text-emerald-500'}`} />
          {label}
        </div>
        <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
        <p className="text-[11px] text-muted-foreground capitalize">{hint}</p>
      </CardContent>
    </Card>
  )
}

function PlacementStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-1">{value}</p>
    </div>
  )
}
