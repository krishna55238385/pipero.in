'use client'

import { useState } from 'react'
import { Mail, PlugZap, Ban, CalendarClock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { GtmScheduleConfig, UnsubscribeRow } from '@/types/engage'
import { resyncMailboxNow, saveGtmSchedule } from '@/app/actions/engage'
import SmtpConnectDialog from '@/components/engage/SmtpConnectDialog'

const pad2 = (n: number) => String(n).padStart(2, '0')

export default function EngageSettingsClient({
  mailboxEmail,
  lastSyncedAt,
  watchExpiration,
  mailboxes = [],
  unsubscribes = [],
  schedule = null,
  icpOptions = [],
}: {
  mailboxEmail?: string | null
  lastSyncedAt?: string | null
  watchExpiration?: string | null
  historyId?: string | null
  mailboxes?: Array<{ id: string; email: string; lastSyncedAt: string | null; watchExpiration: string | null }>
  unsubscribes?: UnsubscribeRow[]
  schedule?: GtmScheduleConfig | null
  icpOptions?: Array<{ id: number; name: string }>
}) {
  const [watching, setWatching] = useState(false)
  const [watchError, setWatchError] = useState('')

  const [mailboxSyncing, setMailboxSyncing] = useState(false)
  const [mailboxSyncMessage, setMailboxSyncMessage] = useState('')
  const [mailboxSyncError, setMailboxSyncError] = useState('')

  // Daily lead automation (gtm_schedules) form state.
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false)
  const [runHour, setRunHour] = useState(schedule?.runHour ?? 3)
  const [runMinute, setRunMinute] = useState(schedule?.runMinute ?? 0)
  const [timezone, setTimezone] = useState(schedule?.timezone ?? 'Asia/Kolkata')
  const [leadsPerDay, setLeadsPerDay] = useState(String(schedule?.leadsPerDay ?? 25))
  const [icpId, setIcpId] = useState<number | null>(schedule?.icpId ?? null)
  const [sender, setSender] = useState<'gmail' | 'instantly'>(schedule?.sender ?? 'gmail')
  const [autoSend, setAutoSend] = useState(schedule?.autoSend ?? false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleMessage, setScheduleMessage] = useState('')
  const [scheduleError, setScheduleError] = useState('')

  // Prefer the full list of connected mailboxes; fall back to the single primary
  // so the card still renders if only legacy props are passed.
  const connectedMailboxes =
    mailboxes.length > 0
      ? mailboxes
      : mailboxEmail
        ? [{ id: 'primary', email: mailboxEmail, lastSyncedAt: lastSyncedAt ?? null, watchExpiration: watchExpiration ?? null }]
        : []

  const startWatch = async () => {
    setWatchError('')
    setWatching(true)
    try {
      const res = await fetch('/api/engage/gmail/watch/start', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to start Gmail watch')
      window.location.reload()
    } catch (error: unknown) {
      setWatchError(error instanceof Error ? error.message : 'Failed to start Gmail watch')
    } finally {
      setWatching(false)
    }
  }

  const syncMailbox = async () => {
    setMailboxSyncMessage('')
    setMailboxSyncError('')
    setMailboxSyncing(true)
    try {
      const { synced } = await resyncMailboxNow()
      setMailboxSyncMessage(`Synced ${synced} messages`)
    } catch (error: unknown) {
      setMailboxSyncError(error instanceof Error ? error.message : 'Mailbox sync failed')
    } finally {
      setMailboxSyncing(false)
    }
  }

  const onTimeChange = (value: string) => {
    const [h, m] = value.split(':')
    const hour = Number(h)
    const minute = Number(m)
    if (Number.isFinite(hour)) setRunHour(Math.min(23, Math.max(0, hour)))
    if (Number.isFinite(minute)) setRunMinute(Math.min(59, Math.max(0, minute)))
  }

  const saveSchedule = async () => {
    setScheduleMessage('')
    setScheduleError('')
    setSavingSchedule(true)
    try {
      await saveGtmSchedule({
        id: schedule?.id,
        icpId,
        enabled,
        runHour,
        runMinute,
        timezone: timezone.trim() || 'Asia/Kolkata',
        leadsPerDay: Math.max(1, Math.trunc(Number(leadsPerDay) || 25)),
        sender,
        autoSend,
      })
      setScheduleMessage('Schedule saved')
    } catch (error: unknown) {
      setScheduleError(error instanceof Error ? error.message : 'Failed to save schedule')
    } finally {
      setSavingSchedule(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Engage Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Gmail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {connectedMailboxes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not connected</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {connectedMailboxes.length} connected
                </p>
                <ul className="space-y-1">
                  {connectedMailboxes.map((m, i) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5"
                    >
                      <span className="truncate text-sm font-medium">{m.email}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        {i === 0 ? <Badge variant="secondary">Primary</Badge> : null}
                        {m.lastSyncedAt ? new Date(m.lastSyncedAt).toLocaleDateString() : 'Never synced'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  Manage per-account limits &amp; warmup on the{' '}
                  <a href="/engage/accounts" className="underline">Email Accounts</a> page.
                </p>
              </div>
            )}
            <Button
              asChild
              type="button"
              className="w-full"
            >
              <a href="/api/engage/gmail/connect?returnTo=/engage/settings">
                <PlugZap className="h-4 w-4 mr-2" />
                {connectedMailboxes.length > 0 ? 'Connect another account' : 'Connect Gmail'}
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={startWatch}
              disabled={!mailboxEmail || watching}
            >
              {watching ? 'Starting watch...' : 'Start Gmail push watch'}
            </Button>
            {watchError ? <p className="text-xs text-red-500">{watchError}</p> : null}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={syncMailbox}
              disabled={!mailboxEmail || mailboxSyncing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${mailboxSyncing ? 'animate-spin' : ''}`} />
              {mailboxSyncing ? 'Syncing mailbox...' : 'Sync mailbox now'}
            </Button>
            {mailboxSyncMessage ? <p className="text-xs text-emerald-600">{mailboxSyncMessage}</p> : null}
            {mailboxSyncError ? <p className="text-xs text-red-500">{mailboxSyncError}</p> : null}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle>Outlook</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">UI placeholder for Microsoft Graph integration.</p>
            <Button type="button" variant="outline" className="w-full" disabled>Connect Outlook</Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle>SMTP</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">UI placeholder for custom SMTP provider setup.</p>
            <SmtpConnectDialog />
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Daily lead automation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Runs the GTM pipeline every day at the configured time: scrape new leads, enrich, score, and (optionally) send the first email.
          </p>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">Turn the daily automation on or off.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="gtm-run-time" className="text-sm">Run time</Label>
              <Input
                id="gtm-run-time"
                type="time"
                value={`${pad2(runHour)}:${pad2(runMinute)}`}
                onChange={(e) => onTimeChange(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gtm-timezone" className="text-sm">Timezone</Label>
              <Input
                id="gtm-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Kolkata"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gtm-leads-per-day" className="text-sm">Leads per day</Label>
              <Input
                id="gtm-leads-per-day"
                type="number"
                min={1}
                value={leadsPerDay}
                onChange={(e) => setLeadsPerDay(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">ICP</Label>
              <Select
                value={icpId == null ? 'all' : String(icpId)}
                onValueChange={(v) => setIcpId(v === 'all' ? null : Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="All ICPs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ICPs</SelectItem>
                  {icpOptions.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">Sender</Label>
              <Select value={sender} onValueChange={(v) => setSender(v as 'gmail' | 'instantly')}>
                <SelectTrigger><SelectValue placeholder="Sender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="instantly">Instantly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <p className="text-sm font-medium">Auto-send emails</p>
                <p className="text-xs text-muted-foreground">Off = pipeline runs in dry-run mode, no emails are sent.</p>
              </div>
              <Switch checked={autoSend} onCheckedChange={setAutoSend} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={saveSchedule} disabled={savingSchedule}>
              {savingSchedule ? 'Saving...' : 'Save schedule'}
            </Button>
            {scheduleMessage ? <p className="text-xs text-emerald-600">{scheduleMessage}</p> : null}
            {scheduleError ? <p className="text-xs text-red-500">{scheduleError}</p> : null}
          </div>

          {schedule?.lastRunDate ? (
            <p className="text-xs text-muted-foreground">
              Last run: {new Date(schedule.lastRunDate).toLocaleDateString()}
              {schedule.lastRunStatus ? ` — ${schedule.lastRunStatus}` : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4" /> Unsubscribes
            <Badge variant="secondary">{unsubscribes.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unsubscribes.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium">No unsubscribes yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Recipients who opt out of your outreach are suppressed and listed here.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {unsubscribes.map((u, i) => (
                <li
                  key={`${u.email}|${u.campaignId ?? ''}|${u.unsubscribedAt ?? ''}|${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="truncate text-sm font-medium">{u.email}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {u.campaignId ? (
                      <Badge variant="outline">{u.campaignId}</Badge>
                    ) : null}
                    {u.unsubscribedAt ? (
                      <span>{new Date(u.unsubscribedAt).toLocaleDateString()}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
