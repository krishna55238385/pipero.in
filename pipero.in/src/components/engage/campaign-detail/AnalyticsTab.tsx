'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CampaignKpis, CampaignStepStat, EngageAnalyticsDay } from '@/types/engage'

const fmt = (n: number) => n.toLocaleString()
const pct = (n: number) => `${n.toFixed(1)}%`

const formatDay = (date: string) => {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function AnalyticsTab({
  kpis,
  steps,
  timeSeries,
}: {
  kpis: CampaignKpis
  steps: CampaignStepStat[]
  timeSeries: EngageAnalyticsDay[]
}) {
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'Sequence started', value: fmt(kpis.sequenceStarted), sub: `${fmt(kpis.sent)} emails sent` },
    { label: 'Open rate', value: pct(kpis.openRate), sub: `${fmt(kpis.openCount)} opens` },
    { label: 'Click rate', value: pct(kpis.clickRate), sub: `${fmt(kpis.clickCount)} clicks` },
    { label: 'Reply rate', value: pct(kpis.replyRate), sub: `${fmt(kpis.replyCount)} replies` },
    { label: 'Opportunities', value: fmt(kpis.opportunities), sub: 'positive replies' },
    { label: 'Unsubscribes', value: fmt(kpis.unsubscribes) },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((k) => (
          <Card key={k.label} className="rounded-2xl border bg-card">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{k.value}</div>
              {k.sub ? <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border bg-card">
        <CardHeader className="pb-2">
          <CardTitle>Performance over time</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          {timeSeries.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No email activity yet. Run the worker to start sending and see daily performance.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeSeries} barGap={2}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                  strokeOpacity={0.6}
                  className="dark:stroke-slate-800"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(100, 116, 139, 0.08)' }}
                  labelFormatter={(label) => formatDay(String(label))}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(10px)',
                    color: '#0f172a',
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="sends" name="Sent" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="opens" name="Opens" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="clicks" name="Clicks" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="replies" name="Replies" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border bg-card">
        <CardHeader className="pb-2">
          <CardTitle>Step analytics</CardTitle>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">No step activity yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                  <TableHead className="text-right">Replied</TableHead>
                  <TableHead className="text-right">Clicked</TableHead>
                  <TableHead className="text-right">Opportunities</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((s) => (
                  <TableRow key={s.step}>
                    <TableCell className="font-medium">Step {s.step}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.opened)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.replied)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.clicked)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.opportunities)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
