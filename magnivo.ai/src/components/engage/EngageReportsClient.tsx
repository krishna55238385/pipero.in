'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EngageProductShell, EngageEmpty, EngageLoading } from '@/components/mail/EngageProductShell'
import {
  exportEngageReportAction,
  createScheduledReportAction,
  deleteScheduledReportAction,
  listScheduledReportsAction,
  updateScheduledReportAction,
  exportRawAnalyticsEventsAction,
  getWarmupDashboardAction,
  getOrgUsageSummaryAction,
} from '@/app/actions/mail'
import {
  getBounceDashboard,
  getComplaintDashboard,
  getDeliverabilityDashboardStats,
  getBlacklistDashboardStatsAction,
} from '@/app/actions/deliverability'
import { Download, Plus, Trash2 } from 'lucide-react'
import type { ScheduledReport } from '@/types/mail'

type ReportKey = 'campaigns' | 'mailboxes' | 'leads'

export default function EngageReportsClient() {
  const [loading, setLoading] = useState(true)
  const [bounce, setBounce] = useState<Awaited<ReturnType<typeof getBounceDashboard>> | null>(null)
  const [complaint, setComplaint] = useState<Awaited<ReturnType<typeof getComplaintDashboard>> | null>(null)
  const [deliv, setDeliv] = useState<Awaited<ReturnType<typeof getDeliverabilityDashboardStats>> | null>(null)
  const [blacklist, setBlacklist] = useState<Awaited<ReturnType<typeof getBlacklistDashboardStatsAction>> | null>(null)
  const [warmup, setWarmup] = useState<Awaited<ReturnType<typeof getWarmupDashboardAction>> | null>(null)
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof getOrgUsageSummaryAction>> | null>(null)
  const [scheduled, setScheduled] = useState<ScheduledReport[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('Weekly campaign report')
  const [newEmail, setNewEmail] = useState('')
  const [newType, setNewType] = useState<ScheduledReport['reportType']>('campaigns')
  const [newCadence, setNewCadence] = useState<ScheduledReport['cadence']>('weekly')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [b, c, d, bl, w, u, s] = await Promise.all([
        getBounceDashboard().catch(() => null),
        getComplaintDashboard().catch(() => null),
        getDeliverabilityDashboardStats().catch(() => null),
        getBlacklistDashboardStatsAction().catch(() => null),
        getWarmupDashboardAction().catch(() => null),
        getOrgUsageSummaryAction().catch(() => null),
        listScheduledReportsAction().catch(() => []),
      ])
      setBounce(b)
      setComplaint(c)
      setDeliv(d)
      setBlacklist(bl)
      setWarmup(w)
      setUsage(u)
      setScheduled(s)
    } catch {
      setError('Failed to load report center')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function download(report: ReportKey | 'raw') {
    setBusy(report)
    try {
      if (report === 'raw') {
        const csv = await exportRawAnalyticsEventsAction(30)
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `engage-raw-events-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
        return
      }
      const result = await exportEngageReportAction(report)
      if (!result) {
        setError('Export failed')
        return
      }
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(null)
    }
  }

  async function createSchedule() {
    setBusy('create')
    const result = await createScheduledReportAction({
      name: newName,
      reportType: newType,
      cadence: newCadence,
      recipients: newEmail ? [newEmail.trim()] : [],
    })
    setBusy(null)
    if (!result.success) {
      setError('error' in result ? String(result.error) : 'Failed to create schedule')
      return
    }
    setNewEmail('')
    await load()
  }

  if (loading) {
    return (
      <EngageProductShell title="Report Center" description="Operational reports and CSV exports">
        <EngageLoading />
      </EngageProductShell>
    )
  }

  return (
    <EngageProductShell
      title="Report Center"
      description="Campaign, mailbox, lead hygiene, deliverability, scheduled exports, and usage reporting"
      stats={[
        { label: 'Avg domain health', value: `${deliv?.avgHealthScore ?? 0}%` },
        { label: 'Hard bounces', value: bounce?.hardBounces ?? 0, tone: (bounce?.hardBounces ?? 0) > 0 ? 'warn' : 'good' },
        { label: 'Auto-paused', value: complaint?.autoPausedMailboxes ?? 0, tone: (complaint?.autoPausedMailboxes ?? 0) > 0 ? 'bad' : 'good' },
        { label: 'Blacklisted domains', value: blacklist?.listedDomains ?? 0, tone: (blacklist?.listedDomains ?? 0) > 0 ? 'bad' : 'good' },
        { label: 'Warmup running', value: warmup?.running ?? 0 },
        { label: 'Sends (month)', value: usage?.sends ?? 0 },
      ]}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-4">
        {(
          [
            ['campaigns', 'Campaign performance', 'Sent, opens, clicks, replies, bounces per campaign'],
            ['mailboxes', 'Mailbox health', 'Status, health score, daily usage, warmup state'],
            ['leads', 'Lead hygiene', 'Verification status, suppression, source'],
            ['raw', 'Raw events', 'Pixel, click, bounce, and engage event stream (CSV)'],
          ] as const
        ).map(([key, title, desc]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{desc}</p>
              <Button size="sm" disabled={busy === key} onClick={() => void download(key)}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                {busy === key ? 'Exporting…' : 'Export CSV'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Report name"
              aria-label="Scheduled report name"
            />
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={newType}
              onChange={(e) => setNewType(e.target.value as ScheduledReport['reportType'])}
              aria-label="Report type"
            >
              <option value="campaigns">Campaigns</option>
              <option value="mailboxes">Mailboxes</option>
              <option value="leads">Leads</option>
              <option value="analytics_raw">Raw events</option>
              <option value="placement">Placement</option>
              <option value="usage">Usage</option>
            </select>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={newCadence}
              onChange={(e) => setNewCadence(e.target.value as ScheduledReport['cadence'])}
              aria-label="Cadence"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Recipient email (optional)"
              aria-label="Recipient email"
            />
            <Button disabled={busy === 'create'} onClick={() => void createSchedule()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Schedule
            </Button>
          </div>

          {scheduled.length === 0 ? (
            <EngageEmpty
              title="No scheduled reports"
              description="Create a daily, weekly, or monthly export. The deliverability worker runs due schedules."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Scheduled reports">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Cadence</th>
                    <th className="py-2 pr-3">Next run</th>
                    <th className="py-2 pr-3">Last status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduled.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{r.name}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{r.reportType}</Badge>
                      </td>
                      <td className="py-2 pr-3">{r.cadence}</td>
                      <td className="py-2 pr-3 text-xs">{new Date(r.nextRunAt).toLocaleString()}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={r.lastStatus === 'failed' ? 'destructive' : 'secondary'}>
                          {r.lastStatus ?? (r.isActive ? 'pending' : 'paused')}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void updateScheduledReportAction(r.id, { isActive: !r.isActive }).then(() => load())
                            }
                          >
                            {r.isActive ? 'Pause' : 'Resume'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${r.name}`}
                            onClick={() => void deleteScheduledReportAction(r.id).then(() => load())}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
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
          <CardTitle className="text-base">Usage snapshot (this month)</CardTitle>
        </CardHeader>
        <CardContent>
          {!usage ? (
            <EngageEmpty title="No usage yet" description="Counters populate as sends and engagements occur." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['Sends', usage.sends],
                  ['Opens', usage.opens],
                  ['Clicks', usage.clicks],
                  ['Replies', usage.replies],
                  ['Bounces', usage.bounces],
                  ['Unsubscribes', usage.unsubscribes],
                  ['Warmup sends', usage.warmupSends],
                ] as const
              ).map(([label, value]) => (
                <Badge key={label} variant="outline" className="px-3 py-1.5">
                  {label}: {value}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </EngageProductShell>
  )
}
