'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, Activity } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  getWarmupPlacementSeriesAction,
  getWarmupSimulationSnapshotAction,
  exportWarmupReportCsvAction,
} from '@/app/actions/mail'
import type { WarmupPlacementPoint, WarmupSimulationSnapshot } from '@/services/mail/warmup-analytics-service'
import type { WarmupDashboardStats } from '@/types/mail'

const STATUS_COLORS: Record<string, string> = {
  running: '#10b981',
  paused: '#f59e0b',
  graduated: '#8b5cf6',
  draft: '#94a3b8',
  pending: '#eab308',
  completed: '#3b82f6',
  disabled: '#6b7280',
  failed: '#ef4444',
}

type WarmupChartsProps = {
  stats: WarmupDashboardStats
}

export function WarmupCharts({ stats }: WarmupChartsProps) {
  const [placement, setPlacement] = useState<WarmupPlacementPoint[]>([])
  const [sim, setSim] = useState<WarmupSimulationSnapshot | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void Promise.all([
      getWarmupPlacementSeriesAction(30),
      getWarmupSimulationSnapshotAction(),
    ]).then(([p, s]) => {
      setPlacement(p)
      setSim(s)
    })
  }, [])

  async function handleExport() {
    setExporting(true)
    try {
      const csv = await exportWarmupReportCsvAction()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `warmup-report-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const statusData = [
    { name: 'Running', value: stats.running },
    { name: 'Paused', value: stats.paused },
    { name: 'Graduated', value: stats.graduated },
    { name: 'Other', value: Math.max(0, stats.totalConfigs - stats.running - stats.paused - stats.graduated) },
  ].filter((d) => d.value > 0)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={exporting} onClick={() => void handleExport()}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export warmup report
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border/20 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Inbox vs spam placement (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {placement.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                No placement data yet. Warmup interactions will appear here after sends.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={placement}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="inbox" stackId="1" stroke="#10b981" fill="#10b98155" name="Inbox" />
                  <Area type="monotone" dataKey="spam" stackId="1" stroke="#ef4444" fill="#ef444455" name="Spam" />
                  <Area type="monotone" dataKey="unknown" stackId="1" stroke="#94a3b8" fill="#94a3b855" name="Unknown" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Simulation fidelity (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!sim ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Sends" value={sim.sends24h} />
                <Metric label="Opens" value={sim.opens24h} />
                <Metric label="Replies" value={sim.replies24h} />
                <Metric label="Spam rescues" value={sim.spamRescues24h} />
                <Metric label="Open rate" value={`${sim.avgOpenRate24h}%`} />
                <Metric label="Subject variants" value={sim.contentVariantsLast24h} />
                <Metric label="Partners healthy" value={sim.partnersActive} />
                <Metric label="Partners excluded" value={sim.partnersExcluded} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/20">
          <CardHeader>
            <CardTitle className="text-base">Warmup status & health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mt-1 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold">{stats.totalConfigs}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.avgHealthScore.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Avg health</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.graduationRate.toFixed(0)}%</p>
                <p className="text-xs text-muted-foreground">Graduation</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {statusData.map((s) => (
                <span
                  key={s.name}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: STATUS_COLORS[s.name.toLowerCase()] ?? '#94a3b8' }}
                  />
                  {s.name}: {s.value}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
