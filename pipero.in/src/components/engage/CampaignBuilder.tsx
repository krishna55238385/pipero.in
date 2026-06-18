'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Pencil, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { EngageCampaign, EngageLead, EngageSequence, EngageTemplate } from '@/types/engage'
import { createEngageCampaign, deleteEngageCampaign, runEngageWorkerNow } from '@/app/actions/engage'
import type { WorkerReport } from '@/lib/engage-worker'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'

const STATUS_BADGE: Record<EngageCampaign['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-500/10 text-blue-600',
  running: 'bg-amber-500/10 text-amber-600',
  completed: 'bg-emerald-500/10 text-emerald-600',
}

// Recipient statuses written by the campaign worker, in display order.
const PROGRESS_STATUSES: Array<{ key: string; label: string; className: string }> = [
  { key: 'pending', label: 'pending', className: 'bg-muted text-muted-foreground' },
  { key: 'in_progress', label: 'in progress', className: 'bg-blue-500/10 text-blue-600' },
  { key: 'completed', label: 'completed', className: 'bg-emerald-500/10 text-emerald-600' },
  { key: 'replied', label: 'replied', className: 'bg-violet-500/10 text-violet-600' },
  { key: 'stopped', label: 'bounced', className: 'bg-amber-500/10 text-amber-600' },
  { key: 'failed', label: 'failed', className: 'bg-red-500/10 text-red-600' },
  { key: 'skipped', label: 'skipped', className: 'bg-muted text-muted-foreground' },
]

// Recipients who have received at least one email (everything past pending,
// except skipped which were never sent).
const SENT_STATUSES = ['in_progress', 'completed', 'replied', 'stopped']
function sentCount(counts: Record<string, number>): number {
  return SENT_STATUSES.reduce((n, k) => n + (counts[k] ?? 0), 0)
}

// Plain-English explanations for the worker's skip_reason codes.
function skipReasonLabel(reason: string): string {
  if (reason.startsWith('bounce_status:')) return `bad email address (${reason.split(':')[1]})`
  switch (reason) {
    case 'missing_or_invalid_email': return 'no valid email address'
    case 'unsubscribed': return 'recipient unsubscribed'
    case 'missing_name_and_company': return 'missing name and company'
    case 'duplicate_email_in_audience': return 'duplicate in audience'
    default: return reason
  }
}

export default function CampaignBuilder({
  initialCampaigns,
  leads,
  templates,
  sequences,
  progress,
  skips = {},
}: {
  initialCampaigns: EngageCampaign[]
  leads: EngageLead[]
  templates: EngageTemplate[]
  sequences: EngageSequence[]
  progress: Record<string, Record<string, number>>
  skips?: Record<string, Record<string, number>>
}) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'template' | 'sequence'>('template')
  const [templateId, setTemplateId] = useState('')
  const [sequenceId, setSequenceId] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [stopOnReply, setStopOnReply] = useState(true)
  const [openTracking, setOpenTracking] = useState(true)
  const [linkTracking, setLinkTracking] = useState(true)
  const [dailyLimit, setDailyLimit] = useState('50')
  const [pending, startTransition] = useTransition()
  const [syncing, setSyncing] = useState(false)
  const [workerRunning, setWorkerRunning] = useState(false)
  const [workerReport, setWorkerReport] = useState<WorkerReport | null>(null)
  const [workerError, setWorkerError] = useState('')

  useEffect(() => {
    const supabase = createSupabaseClient()
    const channel = supabase
      .channel('engage-campaigns-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engage_campaigns' }, async () => {
        setSyncing(true)
        try {
          const res = await fetch('/api/engage/campaigns', { cache: 'no-store' })
          const data = await res.json()
          if (res.ok && Array.isArray(data?.campaigns)) {
            // Server is the source of truth: replace with the refetched rows and
            // drop any optimistic local-* placeholders so the saved row coming
            // back from the refetch doesn't transiently duplicate.
            const server = (data.campaigns as EngageCampaign[]).filter((c) => !String(c.id).startsWith('local-'))
            setCampaigns(server)
          }
        } finally {
          setSyncing(false)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const toggleLead = (id: string) => {
    setSelectedLeadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const templateName = useMemo(
    () => Object.fromEntries(templates.map((t) => [t.id, t.name])),
    [templates]
  )
  const sequenceName = useMemo(
    () => Object.fromEntries(sequences.map((s) => [s.id, s.name])),
    [sequences]
  )

  const canSubmit =
    !!name &&
    selectedLeadIds.length > 0 &&
    (mode === 'template' ? !!templateId : !!sequenceId)

  const createCampaign = (status: 'draft' | 'scheduled') => {
    if (!canSubmit) return
    if (status === 'scheduled' && !scheduleAt) return
    const next: EngageCampaign = {
      id: `local-${Date.now()}`,
      name,
      audienceLeadIds: selectedLeadIds,
      templateId: mode === 'template' ? templateId : '',
      sequenceId: mode === 'sequence' ? sequenceId : undefined,
      scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : new Date().toISOString(),
      status,
      stopOnReply,
      openTracking,
      linkTracking,
      dailyLimit: Math.max(1, Math.trunc(Number(dailyLimit) || 50)),
    }
    setCampaigns((prev) => [next, ...prev])
    startTransition(async () => {
      try {
        const { id } = await createEngageCampaign({
          name: next.name,
          audienceLeadIds: next.audienceLeadIds,
          templateId: next.templateId,
          sequenceId: next.sequenceId,
          scheduleAt: next.scheduleAt,
          status: next.status,
          stopOnReply: next.stopOnReply,
          openTracking: next.openTracking,
          linkTracking: next.linkTracking,
          dailyLimit: next.dailyLimit,
        })
        // Swap the optimistic `local-*` id for the real one so the campaign is
        // immediately clickable (links are disabled for local rows) and its
        // already-enrolled leads are reachable — without waiting on realtime.
        setCampaigns((prev) => prev.map((c) => (c.id === next.id ? { ...c, id } : c)))
      } catch {
        // keep local row for UX continuity
      }
    })
    setName('')
    setTemplateId('')
    setSequenceId('')
    setSelectedLeadIds([])
    setScheduleAt('')
  }

  const runWorker = async () => {
    setWorkerRunning(true)
    setWorkerError('')
    try {
      const report = await runEngageWorkerNow()
      setWorkerReport(report)
      router.refresh()
    } catch (error: unknown) {
      setWorkerError(error instanceof Error ? error.message : 'Worker run failed')
    } finally {
      setWorkerRunning(false)
    }
  }

  const delCampaign = (c: EngageCampaign) => {
    if (!window.confirm(`Delete campaign "${c.name}"? Its recipients and progress are removed too. This can't be undone.`)) return
    setCampaigns((prev) => prev.filter((p) => p.id !== c.id))
    if (String(c.id).startsWith('local-')) return
    startTransition(async () => {
      try {
        await deleteEngageCampaign(c.id)
        router.refresh()
      } catch {
        // realtime refetch reconciles
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Button type="button" variant="outline" onClick={runWorker} disabled={workerRunning}>
          {workerRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          {workerRunning ? 'Running worker...' : 'Run worker now'}
        </Button>
      </div>

      {workerError ? <p className="text-sm text-red-500">{workerError}</p> : null}
      {workerReport ? (
        <div className="rounded-xl border p-3 text-sm space-y-1">
          <p>
            Worker run finished: enrolled {workerReport.enrolled} · sent {workerReport.sent} · skipped {workerReport.skipped}
            {' '}· failed {workerReport.failed} · campaigns completed {workerReport.completedCampaigns}
            {' '}· mailboxes synced {workerReport.syncedMailboxes}
          </p>
          {workerReport.errors.length > 0 ? (
            <ul className="text-xs text-red-500 list-disc pl-4 space-y-0.5">
              {workerReport.errors.map((err, i) => (
                <li key={`${i}-${err}`}>{err}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle>Create campaign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'template' | 'sequence')}>
            <TabsList>
              <TabsTrigger value="template">Single template</TabsTrigger>
              <TabsTrigger value="sequence">Multi-step sequence</TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === 'template' ? (
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Select value={sequenceId} onValueChange={setSequenceId}>
              <SelectTrigger><SelectValue placeholder="Select sequence" /></SelectTrigger>
              <SelectContent>
                {sequences.length > 0 ? (
                  sequences.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name} ({s.steps.length} steps)</SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>No sequences yet — create one first</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}

          <div className="space-y-1">
            <Label htmlFor="campaign-schedule" className="text-sm">Schedule</Label>
            <Input id="campaign-schedule" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </div>

          <div className="rounded-xl border p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Stop on reply</span>
              <Switch checked={stopOnReply} onCheckedChange={setStopOnReply} />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Open tracking</span>
              <Switch checked={openTracking} onCheckedChange={setOpenTracking} />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Link tracking</span>
              <Switch checked={linkTracking} onCheckedChange={setLinkTracking} />
            </label>
            <div className="flex items-center justify-between gap-2 text-sm">
              <Label htmlFor="campaign-daily-limit" className="font-normal">Daily limit</Label>
              <Input
                id="campaign-daily-limit"
                type="number"
                min={1}
                className="w-20"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <p className="text-sm font-medium mb-2">Leads (audience)</p>
            {leads.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {leads.map((l) => (
                  <label key={l.id} className="text-sm flex items-center gap-2 rounded-lg border p-2">
                    <input type="checkbox" checked={selectedLeadIds.includes(l.id)} onChange={() => toggleLead(l.id)} />
                    <span>{l.name} <span className="text-muted-foreground">({l.company})</span></span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No leads available. Generate prospects in the GTM pipeline to build an audience.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => createCampaign('scheduled')} disabled={pending || !canSubmit || !scheduleAt}>
              {pending ? 'Saving...' : 'Create campaign'}
            </Button>
            <Button type="button" variant="outline" onClick={() => createCampaign('draft')} disabled={pending || !canSubmit}>
              Save as draft
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle>Campaign list {syncing ? <span className="text-xs text-muted-foreground">(syncing...)</span> : null}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {campaigns.map((c) => {
            const counts = progress[c.id] ?? {}
            const chips = PROGRESS_STATUSES.filter((s) => (counts[s.key] ?? 0) > 0)
            return (
              <div key={c.id} className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  {String(c.id).startsWith('local-') ? (
                    <p className="font-medium">{c.name}</p>
                  ) : (
                    <Link
                      href={`/engage/campaigns/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${
                        c.origin === 'auto'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {c.origin === 'auto' ? 'Auto' : 'Manual'}
                    </span>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${STATUS_BADGE[c.status] ?? 'bg-muted text-muted-foreground'}`}>
                      {c.status}
                    </span>
                    {/* Edit opens the full campaign detail (Analytics/Leads/…). */}
                    {!String(c.id).startsWith('local-') ? (
                      <Link
                        href={`/engage/campaigns/${c.id}`}
                        title="Open / edit campaign"
                        aria-label={`Edit ${c.name}`}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => delCampaign(c)}
                      title="Delete campaign"
                      aria-label={`Delete ${c.name}`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Audience: {c.audienceLeadIds.length}
                  {' '}· {c.sequenceId
                    ? `Sequence: ${sequenceName[c.sequenceId] || '—'}`
                    : `Template: ${templateName[c.templateId] || '—'}`}
                  {' '}· {new Date(c.scheduleAt).toLocaleString()}
                </p>
                {/* Headline: how many emails actually went out. */}
                {sentCount(counts) > 0 || (counts.pending ?? 0) > 0 ? (
                  <p className="text-sm font-medium">
                    <span className="text-emerald-600 dark:text-emerald-400">{sentCount(counts)} sent</span>
                    {(counts.pending ?? 0) > 0 ? <span className="text-muted-foreground"> · {counts.pending} queued</span> : null}
                  </p>
                ) : null}
                {chips.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {chips.map((s) => (
                      <span key={s.key} className={`text-xs rounded-full px-2 py-0.5 ${s.className}`}>
                        {counts[s.key]} {s.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {/* Explain WHY recipients were skipped (skipped = not emailed). */}
                {(counts.skipped ?? 0) > 0 && skips[c.id] ? (
                  <p className="text-xs text-muted-foreground">
                    Skipped (not sent):{' '}
                    {Object.entries(skips[c.id])
                      .map(([reason, n]) => `${n} · ${skipReasonLabel(reason)}`)
                      .join('; ')}
                  </p>
                ) : null}
              </div>
            )
          })}
          {!campaigns.length ? <p className="text-sm text-muted-foreground">No campaigns yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
