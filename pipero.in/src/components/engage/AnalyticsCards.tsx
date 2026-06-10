import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { EngageAnalyticsData } from '@/types/engage'

const fmt = (n: number) => n.toLocaleString()
const pct = (n: number) => `${n.toFixed(1)}%`

export default function AnalyticsCards({ data }: { data: EngageAnalyticsData }) {
  const { totals, openRate, clickRate, replyRate, unsubscribeRate } = data

  const kpis: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: 'Emails sent',
      value: fmt(totals.sends),
    },
    {
      label: 'Open rate',
      value: pct(openRate),
      sub: `${fmt(totals.uniqueOpens)} unique opens`,
    },
    {
      label: 'Click rate',
      value: pct(clickRate),
      sub: `${fmt(totals.uniqueClicks)} unique clicks`,
    },
    {
      label: 'Reply rate',
      value: pct(replyRate),
      sub: `${fmt(totals.uniqueReplies)} unique replies`,
    },
    {
      label: 'Opportunities',
      value: fmt(totals.opportunities),
      sub: 'positive replies',
    },
    {
      label: 'Unsubscribes',
      value: fmt(totals.unsubscribes),
      sub: pct(unsubscribeRate),
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => (
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
  )
}
