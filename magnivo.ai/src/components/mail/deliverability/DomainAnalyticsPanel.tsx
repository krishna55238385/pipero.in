'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, BarChart3, Loader2 } from 'lucide-react'
import {
  getDomainAnalyticsAction,
  exportDomainAnalyticsCsvAction,
} from '@/app/actions/deliverability'
import type { DomainAnalyticsSnapshot } from '@/services/mail/domain-analytics-service'

function Metric({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold tabular-nums">
        {value}
        {suffix ? <span className="text-xs font-normal text-muted-foreground ml-0.5">{suffix}</span> : null}
      </p>
    </div>
  )
}

export function DomainAnalyticsPanel({ domainId }: { domainId: string }) {
  const [data, setData] = useState<DomainAnalyticsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDomainAnalyticsAction(domainId)
      setData(snap)
    } finally {
      setLoading(false)
    }
  }, [domainId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleExport() {
    setExporting(true)
    try {
      const csv = await exportDomainAnalyticsCsvAction()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `domain-analytics-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Domain analytics (7 days)
        </CardTitle>
        <Button size="sm" variant="outline" disabled={exporting} onClick={() => void handleExport()}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
          </p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">No analytics available for this domain.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Mailboxes" value={data.mailboxCount} />
              <Metric label="Sent" value={data.sent7d} />
              <Metric label="Open rate" value={data.openRate7d} suffix="%" />
              <Metric label="Reply rate" value={data.replyRate7d} suffix="%" />
              <Metric label="Bounce rate" value={data.bounceRate7d} suffix="%" />
              <Metric label="Health" value={data.healthScore ?? '—'} />
              <Metric label="Reputation" value={data.currentReputation ?? '—'} />
              <Metric label="Bounced" value={data.bounced7d} />
            </div>
            {data.reputationTrend.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-2">Reputation trend</p>
                <div className="flex items-end gap-1 h-16">
                  {data.reputationTrend.slice(-14).map((p) => (
                    <div
                      key={p.date}
                      className="flex-1 min-w-[6px] rounded-t bg-primary/70"
                      style={{ height: `${Math.max(8, Math.min(100, p.score))}%` }}
                      title={`${new Date(p.date).toLocaleDateString()}: ${p.score}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
