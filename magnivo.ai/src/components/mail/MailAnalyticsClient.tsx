'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { MailStatsSkeleton } from '@/components/mail/MailSkeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  BarChart3,
  Download,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react'
import type { MailAnalyticsDashboard } from '@/types/mail'
import {
  getMailAnalyticsDashboardAction,
  exportAnalyticsCsvAction,
  exportRawAnalyticsEventsAction,
  getMailPermissionsAction,
  reconcileAllCampaignsAction,
} from '@/app/actions/mail'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'

const PERIODS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
] as const

export default function MailAnalyticsClient({ isLoading: initialLoading = false }: { isLoading?: boolean }) {
  const [data, setData] = useState<MailAnalyticsDashboard | null>(null)
  const [isLoading, setIsLoading] = useState(initialLoading)
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [canRead, setCanRead] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (periodDays: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const [dash, perms] = await Promise.all([
        getMailAnalyticsDashboardAction(periodDays),
        getMailPermissionsAction().catch(() => ({ canRead: true, canWrite: false, canManage: false, canAdmin: false })),
      ])
      setData(dash)
      setCanRead(perms.canRead)
    } catch {
      setError('Failed to load analytics')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  const filteredCampaigns = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    if (!q) return data.campaigns
    return data.campaigns.filter(
      (c) => c.name.toLowerCase().includes(q) || c.status.toLowerCase().includes(q)
    )
  }, [data, search])

  const filteredMailboxes = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    if (!q) return data.mailboxes
    return data.mailboxes.filter((m) => m.email.toLowerCase().includes(q))
  }, [data, search])

  async function download(kind: 'summary' | 'raw') {
    setBusy(kind)
    try {
      const csv =
        kind === 'summary'
          ? await exportAnalyticsCsvAction(days)
          : await exportRawAnalyticsEventsAction(days)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        kind === 'summary'
          ? `mail-analytics-${days}d-${new Date().toISOString().slice(0, 10)}.csv`
          : `mail-raw-events-${days}d-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(null)
    }
  }

  async function runReconcile() {
    setBusy('reconcile')
    setReconcileMsg(null)
    const result = await reconcileAllCampaignsAction()
    setBusy(null)
    if (!result) {
      setReconcileMsg('Reconciliation failed or permission denied')
      return
    }
    setReconcileMsg(
      `Reconciled ${result.checked} campaigns · ${result.balanced} balanced · ${result.mismatched} mismatched`
    )
  }

  if (!canRead) {
    return (
      <div className="space-y-6">
        <MailPageHeader title="Analytics" description="Campaign and mailbox performance" />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You need mail.read permission to view analytics.
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <MailPageHeader title="Analytics" description="Track your mail performance metrics" />
        <MailStatsSkeleton />
      </div>
    )
  }

  const o = data.overview
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <MailPageHeader title="Analytics" description="Campaign funnel, mailbox health, placement, and exports" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border bg-card p-1" role="tablist" aria-label="Date range">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                role="tab"
                aria-selected={days === p.days}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  days === p.days
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent'
                )}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load(days)} aria-label="Refresh analytics">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={busy === 'summary'} onClick={() => void download('summary')}>
            <Download className="h-4 w-4 mr-1.5" />
            Summary CSV
          </Button>
          <Button variant="outline" size="sm" disabled={busy === 'raw'} onClick={() => void download('raw')}>
            <Download className="h-4 w-4 mr-1.5" />
            Raw events
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {reconcileMsg && <p className="text-sm text-muted-foreground">{reconcileMsg}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard title="Sent" value={String(o.totalSent)} />
        <StatCard title="Delivered" value={`${o.totalDelivered} (${pct(o.deliveryRate)})`} />
        <StatCard title="Opened" value={`${o.totalOpened} (${pct(o.openRate)})`} />
        <StatCard title="Clicked" value={`${o.totalClicked} (${pct(o.clickRate)})`} />
        <StatCard title="Replied" value={`${o.totalReplied} (${pct(o.replyRate)})`} />
        <StatCard title="Bounced" value={`${o.totalBounced} (${pct(o.bounceRate)})`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Campaign funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignFunnel
              stages={[
                { label: 'Sent', value: o.totalSent },
                { label: 'Delivered', value: o.totalDelivered },
                { label: 'Opened', value: o.totalOpened },
                { label: 'Clicked', value: o.totalClicked },
                { label: 'Replied', value: o.totalReplied },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Risk & recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold tabular-nums">{data.riskScore}</span>
              <span className="text-xs text-muted-foreground pb-1">/ 100 risk</span>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {data.recommendations.map((r) => (
                <li key={r} className="leading-snug">
                  {r}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy === 'reconcile'}
              onClick={() => void runReconcile()}
            >
              Reconcile event counts
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance over time</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          {o.timeSeries.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={o.timeSeries} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                <Tooltip />
                <Legend />
                <Bar dataKey="sent" name="Sent" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="delivered" name="Delivered" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="opened" name="Opened" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="clicked" name="Clicked" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="bounced" name="Bounced" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inbox vs spam placement</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {data.placement.length === 0 ? (
              <EmptyChart label="No placement data yet — warmup interactions populate this chart." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.placement}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="inbox" name="Inbox" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="spam" name="Spam" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unsubscribes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{o.totalUnsubscribed}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Across campaign counters and mailbox usage in the selected window.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Filter campaigns or mailboxes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter analytics tables"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-campaign metrics</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredCampaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No campaigns match this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Campaign analytics">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Sent</th>
                    <th className="py-2 pr-3">Delivered</th>
                    <th className="py-2 pr-3">Opened</th>
                    <th className="py-2 pr-3">Clicked</th>
                    <th className="py-2 pr-3">Replied</th>
                    <th className="py-2 pr-3">Bounced</th>
                    <th className="py-2">Unsub</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((c) => (
                    <tr key={c.campaignId} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{c.name}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{c.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{c.sent}</td>
                      <td className="py-2 pr-3 tabular-nums">{c.delivered}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {c.opened} <span className="text-muted-foreground">({c.openRate}%)</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{c.clicked}</td>
                      <td className="py-2 pr-3 tabular-nums">{c.replied}</td>
                      <td className="py-2 pr-3 tabular-nums">{c.bounced}</td>
                      <td className="py-2 tabular-nums">{c.unsubscribed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-mailbox metrics ({days}d)</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredMailboxes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No mailbox usage in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Mailbox analytics">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">Mailbox</th>
                    <th className="py-2 pr-3">Sends</th>
                    <th className="py-2 pr-3">Opens</th>
                    <th className="py-2 pr-3">Clicks</th>
                    <th className="py-2 pr-3">Replies</th>
                    <th className="py-2 pr-3">Bounces</th>
                    <th className="py-2">Open rate</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMailboxes.map((m) => (
                    <tr key={m.mailboxId} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{m.email}</td>
                      <td className="py-2 pr-3 tabular-nums">{m.sends}</td>
                      <td className="py-2 pr-3 tabular-nums">{m.opens}</td>
                      <td className="py-2 pr-3 tabular-nums">{m.clicks}</td>
                      <td className="py-2 pr-3 tabular-nums">{m.replies}</td>
                      <td className="py-2 pr-3 tabular-nums">{m.bounces}</td>
                      <td className="py-2 tabular-nums">{m.openRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mailbox health (7d bounce / complaint / reputation)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.mailboxHealth.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No mailboxes connected.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Mailbox health">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">Mailbox</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Health</th>
                    <th className="py-2 pr-3">Bounce rate</th>
                    <th className="py-2 pr-3">Complaints</th>
                    <th className="py-2">Reputation</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mailboxHealth.map((m) => (
                    <tr key={m.mailboxId} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{m.email}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{m.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{m.healthScore}</td>
                      <td className="py-2 pr-3 tabular-nums">{m.bounceRate7d}%</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {m.complaints7d}{' '}
                        <span className="text-muted-foreground">({m.complaintRate7d}%)</span>
                      </td>
                      <td className="py-2">
                        {m.reputationScore != null ? (
                          <span className="tabular-nums">
                            {m.reputationScore}{' '}
                            <span className="text-muted-foreground">({m.reputationLevel})</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="py-4">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-xl font-bold tracking-tight tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

function EmptyChart({ label = 'No time-series data yet' }: { label?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <BarChart3 className="h-12 w-12 mb-3 opacity-40" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  )
}

function CampaignFunnel({ stages }: { stages: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...stages.map((s) => s.value))
  return (
    <div className="space-y-3" role="img" aria-label="Campaign conversion funnel">
      {stages.map((s, i) => {
        const width = Math.max(8, Math.round((s.value / max) * 100))
        const prev = i === 0 ? s.value : stages[i - 1].value
        const drop = prev > 0 ? Math.round(((prev - s.value) / prev) * 1000) / 10 : 0
        return (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {s.value.toLocaleString()}
                {i > 0 ? ` · −${drop}%` : ''}
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary/80 transition-all" style={{ width: `${width}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
