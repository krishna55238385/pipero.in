'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { MailTableSkeleton } from '@/components/mail/MailSkeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Megaphone,
  Plus,
  Rocket,
  Search,
  Copy,
  Archive,
  LayoutTemplate,
  BarChart3,
  Pause,
  Play,
  CalendarDays,
} from 'lucide-react'
import {
  listCampaignsAction,
  launchCampaignAction,
  createCampaignAction,
  duplicateCampaignAction,
  archiveCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  listTemplatesAction,
  getDashboardStatsAction,
  previewCampaignEmailAction,
} from '@/app/actions/campaigns'
import {
  listLeadListsAction,
  previewListEnrollmentAction,
  enrollListIntoCampaignAction,
  getMailboxPools,
} from '@/app/actions/mail'
import type { CampaignResponse, CampaignTemplate, CampaignDashboardStats } from '@/types/campaign'
import type { EnrollmentPreview } from '@/services/mail/lead-list-service'

type Tab = 'campaigns' | 'templates' | 'launch' | 'calendar'

export default function MailCampaignsClient({ isLoading: initialLoading = false }: { isLoading?: boolean }) {
  const [tab, setTab] = useState<Tab>('campaigns')
  const [campaigns, setCampaigns] = useState<CampaignResponse[]>([])
  const [templates, setTemplates] = useState<CampaignTemplate[]>([])
  const [stats, setStats] = useState<CampaignDashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(initialLoading)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [launchId, setLaunchId] = useState<string | null>(null)
  const [leadLists, setLeadLists] = useState<Awaited<ReturnType<typeof listLeadListsAction>>['lists']>([])
  const [pools, setPools] = useState<Awaited<ReturnType<typeof getMailboxPools>>>([])
  const [enrollListId, setEnrollListId] = useState<string>('')
  const [enrollPreview, setEnrollPreview] = useState<EnrollmentPreview | null>(null)
  const [enrollMessage, setEnrollMessage] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<{ subject: string; bodyHtml: string } | null>(null)
  const [previewTo, setPreviewTo] = useState('')
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignPoolId, setNewCampaignPoolId] = useState('')
  const [newCampaignListId, setNewCampaignListId] = useState('')

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [result, tmpls, dash, lists, poolList] = await Promise.all([
        listCampaignsAction(),
        listTemplatesAction().catch(() => []),
        getDashboardStatsAction().catch(() => null),
        listLeadListsAction({ pageSize: 100 }).catch(() => ({ lists: [], total: 0, page: 1, pageSize: 100, totalPages: 1 })),
        getMailboxPools().catch(() => []),
      ])
      setCampaigns(result.campaigns || [])
      setTemplates(tmpls || [])
      setStats(dash)
      setLeadLists(lists.lists || [])
      setPools(poolList || [])
    } catch {
      setError('Failed to load campaigns')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (!search) return true
      return c.name.toLowerCase().includes(search.toLowerCase())
    })
  }, [campaigns, search, statusFilter])

  const launchCandidate = campaigns.find((c) => c.id === launchId) || null

  async function handleCreate() {
    const name = newCampaignName.trim() || `Campaign ${new Date().toLocaleDateString()}`
    const result = await createCampaignAction({
      name,
      poolId: newCampaignPoolId || null,
    })
    if (!result.success || !result.data) {
      setError(!result.success ? result.error : 'Create failed')
      return
    }
    if (newCampaignListId) {
      const enroll = await enrollListIntoCampaignAction(result.data.id, newCampaignListId)
      if (!enroll.success) {
        setError(('error' in enroll && enroll.error) || 'Campaign created but enrollment failed')
      }
    }
    window.location.href = `/mail/campaigns/builder/${result.data.id}`
  }

  async function handlePreviewEnrollment() {
    if (!launchId || !enrollListId) return
    setEnrollMessage(null)
    const result = await previewListEnrollmentAction(launchId, enrollListId)
    if (!result.success || !result.data) {
      setError(('error' in result && result.error) || 'Preview failed')
      setEnrollPreview(null)
      return
    }
    setEnrollPreview(result.data)
  }

  async function handleEnrollList() {
    if (!launchId || !enrollListId) return
    setBusyId(launchId)
    const result = await enrollListIntoCampaignAction(launchId, enrollListId)
    setBusyId(null)
    if (!result.success || !result.data) {
      setError(('error' in result && result.error) || 'Enrollment failed')
      return
    }
    setEnrollMessage(`Enrolled ${result.data.enrolled}, skipped ${result.data.skipped}`)
    setEnrollPreview(result.data.preview)
    await load()
  }

  async function handleLaunch(id: string) {
    setBusyId(id)
    const result = await launchCampaignAction(id)
    setBusyId(null)
    if (!result.success) {
      setError(result.error || 'Launch failed')
      setLaunchId(id)
      setTab('launch')
      return
    }
    setLaunchId(null)
    await load()
  }

  async function handleDuplicate(id: string) {
    setBusyId(id)
    const result = await duplicateCampaignAction(id)
    setBusyId(null)
    if (!result.success) {
      setError(result.error || 'Duplicate failed')
      return
    }
    await load()
  }

  async function handleArchive(id: string) {
    setBusyId(id)
    const result = await archiveCampaignAction(id)
    setBusyId(null)
    if (!result.success) {
      setError(result.error || 'Archive failed')
      return
    }
    await load()
  }

  async function handlePauseResume(id: string, status: string) {
    setBusyId(id)
    const result =
      status === 'running' ? await pauseCampaignAction(id) : await resumeCampaignAction(id)
    setBusyId(null)
    if (!result.success) {
      setError(result.error || 'Action failed')
      return
    }
    await load()
  }

  if (isLoading && campaigns.length === 0) {
    return (
      <div className="space-y-6">
        <MailPageHeader title="Campaigns" description="Sequences, templates, launch checklist, and performance" />
        <MailTableSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <MailPageHeader
          title="Campaign Platform"
          description="Dashboard, visual builder, templates, launch checklist, and analytics"
        />
        <Button onClick={() => void handleCreate()}>
          <Plus className="h-4 w-4 mr-1.5" />
          New campaign
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create campaign</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            placeholder="Campaign name"
            value={newCampaignName}
            onChange={(e) => setNewCampaignName(e.target.value)}
          />
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={newCampaignPoolId}
            onChange={(e) => setNewCampaignPoolId(e.target.value)}
          >
            <option value="">Select mailbox pool…</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={newCampaignListId}
            onChange={(e) => setNewCampaignListId(e.target.value)}
          >
            <option value="">Lead list (optional)…</option>
            {leadLists.map((l) => (
              <option key={l.id} value={l.id}>{l.name} ({l.memberCount})</option>
            ))}
          </select>
          <Button onClick={() => void handleCreate()}>Create & open builder</Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat title="Total" value={String(stats.totalCampaigns ?? campaigns.length)} />
          <Stat title="Running" value={String(stats.running ?? campaigns.filter((c) => c.status === 'running').length)} />
          <Stat title="Sent" value={String(stats.totalSent ?? campaigns.reduce((s, c) => s + (c.sentCount || 0), 0))} />
          <Stat title="Opened" value={String(stats.totalOpened ?? campaigns.reduce((s, c) => s + (c.openCount || 0), 0))} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['campaigns', 'Campaigns', Megaphone],
            ['calendar', 'Calendar', CalendarDays],
            ['templates', 'Templates', LayoutTemplate],
            ['launch', 'Launch checklist', Rocket],
          ] as const
        ).map(([key, label, Icon]) => (
          <Button key={key} size="sm" variant={tab === key ? 'default' : 'outline'} onClick={() => setTab(key)}>
            <Icon className="h-3.5 w-3.5 mr-1" />
            {label}
          </Button>
        ))}
      </div>

      {tab === 'campaigns' && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search campaigns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              {['draft', 'scheduled', 'running', 'paused', 'completed', 'archived'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <Card>
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Megaphone className="h-12 w-12 mb-3 opacity-40" />
                  <p className="text-sm font-medium">No campaigns yet</p>
                </div>
              ) : (
                <div className="divide-y">
                  {filtered.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <Link
                          href={`/mail/campaigns/builder/${c.id}`}
                          className="text-sm font-medium hover:underline truncate block"
                        >
                          {c.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {c.sentCount ?? 0} sent · {c.openCount ?? 0} opens · {c.replyCount ?? 0} replies
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Badge variant="outline">{c.status}</Badge>
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`/mail/analytics?campaign=${c.id}`}>
                            <BarChart3 className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === c.id}
                          onClick={() => void handleDuplicate(c.id)}
                          title="Duplicate"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        {(c.status === 'running' || c.status === 'paused') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === c.id}
                            onClick={() => void handlePauseResume(c.id, c.status)}
                          >
                            {c.status === 'running' ? (
                              <Pause className="h-3.5 w-3.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        {c.status !== 'running' && c.status !== 'archived' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === c.id}
                            onClick={() => {
                              setLaunchId(c.id)
                              setTab('launch')
                            }}
                          >
                            <Rocket className="h-3.5 w-3.5 mr-1" />
                            Launch
                          </Button>
                        )}
                        {c.status !== 'archived' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === c.id}
                            onClick={() => void handleArchive(c.id)}
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'calendar' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign calendar</CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.filter((c) => c.scheduledAt || c.startedAt || c.status === 'running' || c.status === 'scheduled').length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No scheduled or running campaigns yet.
              </p>
            ) : (
              <div className="space-y-2">
                {campaigns
                  .filter((c) => c.scheduledAt || c.startedAt || c.status === 'running' || c.status === 'scheduled')
                  .sort((a, b) => {
                    const da = new Date(a.scheduledAt || a.startedAt || a.createdAt).getTime()
                    const db = new Date(b.scheduledAt || b.startedAt || b.createdAt).getTime()
                    return da - db
                  })
                  .map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="min-w-0">
                        <Link href={`/mail/campaigns/builder/${c.id}`} className="text-sm font-medium hover:underline truncate block">
                          {c.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {c.timezone || 'UTC'} ·{' '}
                          {c.scheduledAt
                            ? `Scheduled ${new Date(c.scheduledAt).toLocaleString()}`
                            : c.startedAt
                              ? `Started ${new Date(c.startedAt).toLocaleString()}`
                              : `Created ${new Date(c.createdAt).toLocaleString()}`}
                        </p>
                      </div>
                      <Badge variant="outline">{c.status}</Badge>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'templates' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Template library</CardTitle>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No templates yet. Save a campaign as a template from the builder.
              </p>
            ) : (
              <div className="divide-y">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.description || '—'}</p>
                    </div>
                    <Badge variant="outline">{t.category || 'general'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'launch' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Launch checklist & enrollment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-w-md">
              <label className="text-sm font-medium">Campaign</label>
              <select
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={launchId || ''}
                onChange={(e) => {
                  setLaunchId(e.target.value || null)
                  setEnrollPreview(null)
                  setEnrollMessage(null)
                }}
              >
                <option value="">Select campaign...</option>
                {campaigns
                  .filter((c) => !['running', 'archived', 'completed'].includes(c.status))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.status})
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 max-w-3xl">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={enrollListId}
                onChange={(e) => setEnrollListId(e.target.value)}
                disabled={!launchId}
              >
                <option value="">Select lead list…</option>
                {leadLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.memberCount})
                  </option>
                ))}
              </select>
              <Button variant="outline" disabled={!launchId || !enrollListId} onClick={() => void handlePreviewEnrollment()}>
                Preview excluded
              </Button>
              <Button disabled={!launchId || !enrollListId || busyId === launchId} onClick={() => void handleEnrollList()}>
                Enroll list
              </Button>
            </div>

            {enrollPreview && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <Badge variant="outline">{enrollPreview.totalMembers} members</Badge>
                <Badge variant="secondary">{enrollPreview.eligible} eligible</Badge>
                <Badge variant="outline">{enrollPreview.excludedInvalid} invalid excluded</Badge>
                <Badge variant="outline">{enrollPreview.excludedSuppressed} suppressed</Badge>
                <Badge variant="outline">{enrollPreview.excludedDuplicate} already enrolled</Badge>
                <Badge variant="outline">{enrollPreview.excludedOther} other excluded</Badge>
              </div>
            )}
            {enrollMessage && <p className="text-sm text-muted-foreground">{enrollMessage}</p>}

            {launchCandidate && (
              <>
              <ul className="text-sm space-y-2">
                <CheckItem ok={Boolean(launchCandidate.poolId)} label="Mailbox pool assigned" />
                <CheckItem ok={(launchCandidate.recipientCount || 0) > 0 || Boolean(enrollPreview?.eligible)} label="Leads enrolled (or preview eligible &gt; 0)" />
                <CheckItem ok={true} label="Visual sequence saved (open builder to edit)" />
                <CheckItem ok={true} label="Suppression list enforced at send + enrollment time" />
                <CheckItem ok={true} label="List-Unsubscribe header injected on send" />
                <CheckItem ok={true} label="Physical address required in Mail Settings" />
                <CheckItem ok={true} label="Pool mailboxes must be Warm (hard-block)" />
              </ul>
              <EstimatedCompletion
                recipients={enrollPreview?.eligible || launchCandidate.recipientCount || 0}
                dailyCap={50}
              />
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Campaign preview</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!launchId}
                    onClick={() => {
                      if (!launchId) return
                      void previewCampaignEmailAction({ campaignId: launchId }).then((r) => {
                        if (r.success && r.data) setPreviewHtml(r.data)
                        else setEnrollMessage(!r.success ? r.error : 'Preview failed')
                      })
                    }}
                  >
                    Render preview
                  </Button>
                  <Input
                    className="h-8 max-w-xs text-sm"
                    placeholder="Send preview to email…"
                    value={previewTo}
                    onChange={(e) => setPreviewTo(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={!launchId || !previewTo.includes('@')}
                    onClick={() => {
                      if (!launchId) return
                      void previewCampaignEmailAction({
                        campaignId: launchId,
                        sendTo: previewTo.trim(),
                      }).then((r) => {
                        if (r.success && r.data) {
                          setPreviewHtml(r.data)
                          setEnrollMessage(
                            r.data.sent
                              ? `Preview emailed to ${previewTo}`
                              : 'Preview rendered (email delivery requires MAIL_SYSTEM_SMTP_*)'
                          )
                        } else {
                          setEnrollMessage(!r.success ? r.error : 'Preview send failed')
                        }
                      })
                    }}
                  >
                    Email preview
                  </Button>
                </div>
                {previewHtml && (
                  <div className="rounded-md border bg-background p-3 text-sm space-y-2">
                    <p className="font-medium">{previewHtml.subject}</p>
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: previewHtml.bodyHtml }}
                    />
                  </div>
                )}
              </div>
              </>
            )}
            <Button
              disabled={!launchId || busyId === launchId}
              onClick={() => launchId && void handleLaunch(launchId)}
            >
              <Rocket className="h-4 w-4 mr-1.5" />
              {busyId === launchId ? 'Launching...' : 'Launch campaign'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Launch is hard-blocked if the mailbox pool is not warm (mandatory warmup), unsubscribe is disabled, or physical address is missing. Complete warmup graduation before scaling campaign sends.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? 'text-emerald-600' : 'text-amber-600'}>{ok ? '✓' : '!'}</span>
      {label}
    </li>
  )
}

function EstimatedCompletion({ recipients, dailyCap }: { recipients: number; dailyCap: number }) {
  if (recipients <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Estimated completion: enroll leads to project finish date.
      </p>
    )
  }
  const days = Math.max(1, Math.ceil(recipients / Math.max(1, dailyCap)))
  const eta = new Date()
  eta.setDate(eta.getDate() + days)
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
      <p className="font-medium">Estimated completion</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        ~{recipients.toLocaleString()} eligible × ~{dailyCap}/day pool capacity ≈{' '}
        <strong className="text-foreground">{days} day{days === 1 ? '' : 's'}</strong> (
        {eta.toLocaleDateString()})
      </p>
    </div>
  )
}
