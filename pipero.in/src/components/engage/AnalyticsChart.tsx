'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import type { EngageAnalyticsDay } from '@/types/engage'

const formatDay = (date: string) => {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function AnalyticsChart({ data }: { data: EngageAnalyticsDay[] }) {
  return (
    <Card className="rounded-2xl border bg-card">
      <CardHeader className="pb-2">
        <CardTitle>Email performance over time</CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No email activity in this period. Send campaigns or sequences to see daily performance.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2}>
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
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
              <Bar dataKey="sends" name="Sent" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="opens" name="Opens" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="clicks" name="Clicks" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="replies" name="Replies" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
