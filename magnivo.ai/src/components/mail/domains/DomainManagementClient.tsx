'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Plus,
  Search,
  RefreshCw,
  Trash2,
  Shield,
  Globe,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  History,
  Settings2,
  Loader2,
} from 'lucide-react'
import {
  getDeliverabilityDomains,
  createDeliverabilityDomain,
  updateDeliverabilityDomain,
  deleteDeliverabilityDomain,
  verifyDomain,
  getDomainHistory,
  getDomainDnsRecords,
  getDnsInstructions,
  getDnsProviders,
  suggestDomainsFromMailboxesAction,
  getDeliverabilityPermissionsAction,
} from '@/app/actions/deliverability'
import { HealthScoreBadge } from '@/components/mail/deliverability/HealthScoreBadge'
import { DnsStatusLabel } from '@/components/mail/deliverability/DnsStatusIcon'
import { ProviderInstructionsPanel } from '@/components/mail/deliverability/ProviderInstructionsPanel'
import { HistoryTimeline } from '@/components/mail/deliverability/HistoryTimeline'
import { DnsDiagnosticsCenter } from '@/components/mail/deliverability/DnsDiagnosticsCenter'
import { DomainAnalyticsPanel } from '@/components/mail/deliverability/DomainAnalyticsPanel'
import type { MailUserPermissions } from '@/types/mail'
import type {
  DeliverabilityDomain,
  DomainPurpose,
  DnsProvider,
  VerificationHistoryEntry,
  DnsRecord,
  ProviderDnsInstruction,
} from '@/types/deliverability'

const PURPOSES: { id: DomainPurpose; label: string }[] = [
  { id: 'sending', label: 'Sending' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'warmup', label: 'Warmup' },
  { id: 'shared', label: 'Shared' },
]

export default function DomainManagementClient() {
  const [domains, setDomains] = useState<DeliverabilityDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [purposeFilter, setPurposeFilter] = useState<DomainPurpose | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [instructionType, setInstructionType] = useState<'spf' | 'dkim' | 'dmarc' | 'tracking' | 'return_path'>('spf')
  const [history, setHistory] = useState<VerificationHistoryEntry[]>([])
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([])
  const [instructions, setInstructions] = useState<ProviderDnsInstruction[]>([])
  const [providers, setProviders] = useState<{ id: DnsProvider; name: string }[]>([])

  // Wizard state
  const [wizDomain, setWizDomain] = useState('')
  const [wizPurpose, setWizPurpose] = useState<DomainPurpose>('sending')
  const [wizProvider, setWizProvider] = useState<DnsProvider>('cloudflare')
  const [wizTags, setWizTags] = useState('')
  const [wizNotes, setWizNotes] = useState('')
  const [wizStep, setWizStep] = useState(1)

  // Edit state
  const [editNotes, setEditNotes] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editPurpose, setEditPurpose] = useState<DomainPurpose>('sending')
  const [permissions, setPermissions] = useState<MailUserPermissions>({
    canRead: true,
    canWrite: true,
    canManage: true,
    canAdmin: false,
  })
  const [suggestedDomains, setSuggestedDomains] = useState<string[]>([])

  const canWrite = permissions.canWrite
  const canManage = permissions.canManage

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, prov, perms, suggestions] = await Promise.all([
        getDeliverabilityDomains(),
        getDnsProviders(),
        getDeliverabilityPermissionsAction(),
        suggestDomainsFromMailboxesAction(),
      ])
      setDomains(list)
      setProviders(prov)
      setPermissions(perms)
      setSuggestedDomains(suggestions)
      if (!selectedId && list[0]) setSelectedId(list[0].id)
    } catch {
      setError('Failed to load domains')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = useMemo(
    () => domains.find((d) => d.id === selectedId) ?? null,
    [domains, selectedId]
  )

  useEffect(() => {
    if (!selected) return
    setEditNotes(selected.notes || '')
    setEditTags((selected.tags || []).join(', '))
    setEditPurpose(selected.purpose || 'sending')
    void Promise.all([
      getDomainHistory(selected.id),
      getDomainDnsRecords(selected.id),
      getDnsInstructions(
        selected.domain,
        instructionType,
        selected.dnsProvider || 'cloudflare',
        selected.dkimSelector
      ),
    ]).then(([h, r, i]) => {
      setHistory(h)
      setDnsRecords(r)
      setInstructions(Array.isArray(i) ? i : [i].filter(Boolean))
    })
  }, [selected, instructionType])

  const filtered = domains.filter((d) => {
    if (purposeFilter !== 'all' && d.purpose !== purposeFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      d.domain.includes(q) ||
      d.notes.toLowerCase().includes(q) ||
      d.tags.some((t) => t.toLowerCase().includes(q))
    )
  })

  const stats = useMemo(() => {
    const healthy = domains.filter((d) => d.healthStatus === 'excellent' || d.healthStatus === 'good').length
    const attention = domains.filter((d) => d.healthStatus === 'fair' || d.healthStatus === 'poor').length
    const avg =
      domains.length === 0
        ? 0
        : Math.round(domains.reduce((s, d) => s + d.healthScore, 0) / domains.length)
    return { total: domains.length, healthy, attention, avg }
  }, [domains])

  async function handleCreate() {
    const domain = wizDomain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
    if (!domain || !domain.includes('.')) {
      setError('Enter a valid domain (e.g. mail.company.com)')
      return
    }
    setBusy(true)
    setError(null)
    const result = await createDeliverabilityDomain({
      domain,
      purpose: wizPurpose,
      dnsProvider: wizProvider,
      tags: wizTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      notes: wizNotes,
    })
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Failed to add domain')
      return
    }
    setWizardOpen(false)
    setWizStep(1)
    setWizDomain('')
    setWizTags('')
    setWizNotes('')
    await load()
    if (result.data) setSelectedId(result.data.id)
  }

  async function handleVerify() {
    if (!selected) return
    setBusy(true)
    const result = await verifyDomain({ domainId: selected.id, source: 'manual' })
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Verification failed')
      return
    }
    await load()
  }

  async function handleSaveMeta() {
    if (!selected) return
    setBusy(true)
    const result = await updateDeliverabilityDomain(selected.id, {
      purpose: editPurpose,
      notes: editNotes,
      tags: editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    })
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Save failed')
      return
    }
    await load()
  }

  async function handleDelete() {
    if (!selected) return
    setBusy(true)
    setError(null)
    const result = await deleteDeliverabilityDomain(selected.id)
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Delete failed')
      return
    }
    setDeleteOpen(false)
    setSelectedId(null)
    await load()
  }

  async function handleMarkOwned() {
    if (!selected) return
    setBusy(true)
    await updateDeliverabilityDomain(selected.id, { ownershipVerified: true })
    setBusy(false)
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <MailPageHeader
          title="Domain Management"
          description="Sending, tracking, and warmup domains — DNS, health, reputation, and history"
        />
        {canWrite ? (
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add domain
          </Button>
        ) : null}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Domains" value={String(stats.total)} icon={Globe} />
        <Stat label="Healthy" value={String(stats.healthy)} icon={CheckCircle2} />
        <Stat label="Needs attention" value={String(stats.attention)} icon={AlertTriangle} />
        <Stat label="Avg health" value={`${stats.avg}%`} icon={Shield} />
      </div>

      {wizardOpen && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Add Domain Wizard — Step {wizStep} of 3</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {wizStep === 1 && (
              <div className="space-y-3 max-w-lg">
                <div className="space-y-2">
                  <Label>Domain name</Label>
                  <Input
                    placeholder="mail.company.com"
                    value={wizDomain}
                    onChange={(e) => setWizDomain(e.target.value)}
                  />
                </div>
                {suggestedDomains.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Detected from connected mailboxes
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {suggestedDomains.map((d) => (
                        <Button
                          key={d}
                          type="button"
                          size="sm"
                          variant={wizDomain === d ? 'default' : 'outline'}
                          onClick={() => setWizDomain(d)}
                        >
                          {d}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Purpose</Label>
                  <div className="flex flex-wrap gap-2">
                    {PURPOSES.map((p) => (
                      <Button
                        key={p.id}
                        type="button"
                        size="sm"
                        variant={wizPurpose === p.id ? 'default' : 'outline'}
                        onClick={() => setWizPurpose(p.id)}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {wizStep === 2 && (
              <div className="space-y-3 max-w-lg">
                <div className="space-y-2">
                  <Label>DNS provider (for instructions)</Label>
                  <select
                    className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    value={wizProvider}
                    onChange={(e) => setWizProvider(e.target.value as DnsProvider)}
                  >
                    {(providers.length
                      ? providers
                      : [
                          { id: 'cloudflare' as const, name: 'Cloudflare' },
                          { id: 'godaddy' as const, name: 'GoDaddy' },
                          { id: 'namecheap' as const, name: 'Namecheap' },
                          { id: 'google' as const, name: 'Google Domains' },
                          { id: 'other' as const, name: 'Other' },
                        ]
                    ).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Tags (comma-separated)</Label>
                  <Input value={wizTags} onChange={(e) => setWizTags(e.target.value)} placeholder="primary, client-a" />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <textarea
                    className="w-full min-h-[80px] rounded-md border bg-background p-3 text-sm"
                    value={wizNotes}
                    onChange={(e) => setWizNotes(e.target.value)}
                  />
                </div>
              </div>
            )}
            {wizStep === 3 && (
              <div className="text-sm space-y-2 max-w-lg">
                <p>
                  <span className="text-muted-foreground">Domain:</span> <strong>{wizDomain}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Purpose:</span> {wizPurpose}
                </p>
                <p>
                  <span className="text-muted-foreground">Provider:</span> {wizProvider}
                </p>
                <p className="text-muted-foreground text-xs">
                  On create we auto-verify SPF, DKIM, DMARC, MX, and BIMI. You can continue DNS setup after add.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setWizardOpen(false)}>
                Cancel
              </Button>
              {wizStep > 1 && (
                <Button variant="secondary" onClick={() => setWizStep((s) => s - 1)}>
                  Back
                </Button>
              )}
              {wizStep < 3 ? (
                <Button onClick={() => setWizStep((s) => s + 1)} disabled={wizStep === 1 && !wizDomain.trim()}>
                  Next
                </Button>
              ) : (
                <Button onClick={() => void handleCreate()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Add &amp; Verify
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-4">
          <CardHeader className="pb-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search domains, tags, notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <FilterChip active={purposeFilter === 'all'} onClick={() => setPurposeFilter('all')} label="All" />
              {PURPOSES.map((p) => (
                <FilterChip
                  key={p.id}
                  active={purposeFilter === p.id}
                  onClick={() => setPurposeFilter(p.id)}
                  label={p.label}
                />
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Globe className="h-10 w-10 mb-2 opacity-40" />
                <p className="text-sm">No domains yet</p>
              </div>
            ) : (
              <div className="divide-y max-h-[640px] overflow-y-auto">
                {filtered.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition ${
                      selectedId === d.id ? 'bg-muted/60' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{d.domain}</span>
                      <HealthScoreBadge score={d.healthScore} level={d.healthStatus} size="sm" showLabel={false} />
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge variant="outline" className="text-[10px]">
                        {d.purpose}
                      </Badge>
                      {d.tags.slice(0, 2).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-8 space-y-4">
          {!selected ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                Select a domain to manage DNS, health, and history
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {selected.domain}
                      {selected.ownershipVerified ? (
                        <Badge className="bg-emerald-600/15 text-emerald-700">Ownership verified</Badge>
                      ) : (
                        <Badge variant="outline">Ownership pending</Badge>
                      )}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Last checked{' '}
                      {selected.lastCheckedAt
                        ? new Date(selected.lastCheckedAt).toLocaleString()
                        : 'never'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy || !canWrite} onClick={() => void handleVerify()}>
                      <RefreshCw className={`h-3.5 w-3.5 mr-1 ${busy ? 'animate-spin' : ''}`} />
                      Verify DNS
                    </Button>
                    {!selected.ownershipVerified && canWrite && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleMarkOwned()}>
                        Mark owned
                      </Button>
                    )}
                    {canManage && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete
                    </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <DnsCell label="SPF" status={selected.spfStatus} />
                  <DnsCell label="DKIM" status={selected.dkimStatus} />
                  <DnsCell label="DMARC" status={selected.dmarcStatus} />
                  <DnsCell label="MX" status={selected.mxStatus} />
                  <DnsCell label="Tracking" status={selected.trackingStatus} />
                  <DnsCell label="BIMI" status={selected.bimiStatus === 'not_configured' ? 'unverified' : selected.bimiStatus} />
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Settings2 className="h-4 w-4" /> Domain settings
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Purpose</Label>
                      <select
                        className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                        value={editPurpose}
                        onChange={(e) => setEditPurpose(e.target.value as DomainPurpose)}
                      >
                        {PURPOSES.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Tags</Label>
                      <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <textarea
                        className="w-full min-h-[80px] rounded-md border bg-background p-3 text-sm"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                      />
                    </div>
                    <Button size="sm" disabled={busy || !canWrite} onClick={() => void handleSaveMeta()}>
                      Save
                    </Button>
                    {selected.bimiStatus === 'not_configured' && (
                      <div className="rounded-md border border-dashed p-3 space-y-1">
                        <p className="text-xs font-medium">BIMI (optional)</p>
                        <p className="text-xs text-muted-foreground">
                          After DMARC enforcement, publish a TXT at{' '}
                          <code className="text-[11px]">default._bimi.{selected.domain}</code> pointing to your
                          SVG brand logo. Magnivo stores BIMI status on this domain for verification.
                        </p>
                      </div>
                    )}
                    {selected.mxStatus !== 'valid' && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">MX verification</p>
                        <p className="text-xs text-muted-foreground">
                          MX is {selected.mxStatus || 'unverified'}. Ensure mail exchangers resolve so bounce
                          handling and inbox tests succeed.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Cached DNS records</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dnsRecords.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No cached records — run Verify DNS.</p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {dnsRecords.map((r) => (
                          <div key={r.id} className="text-xs border rounded-md p-2">
                            <div className="font-medium">
                              {r.recordType} · {r.recordName}
                            </div>
                            <div className="text-muted-foreground break-all">{r.recordValue}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Provider DNS instructions</CardTitle>
                  <div className="flex flex-wrap gap-1 pt-2">
                    {(['spf', 'dkim', 'dmarc', 'tracking', 'return_path'] as const).map((t) => (
                      <Button
                        key={t}
                        size="sm"
                        variant={instructionType === t ? 'default' : 'outline'}
                        onClick={() => setInstructionType(t)}
                      >
                        {t.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <ProviderInstructionsPanel
                    instructions={instructions}
                    providers={providers}
                    selectedProvider={selected.dnsProvider || 'cloudflare'}
                    domain={selected.domain}
                    recordType={instructionType}
                    onProviderChange={async (provider) => {
                      await updateDeliverabilityDomain(selected.id, { dnsProvider: provider })
                      const i = await getDnsInstructions(
                        selected.domain,
                        instructionType,
                        provider,
                        selected.dkimSelector
                      )
                      setInstructions(Array.isArray(i) ? i : [i].filter(Boolean))
                      await load()
                    }}
                  />
                </CardContent>
              </Card>

              <DnsDiagnosticsCenter
                domain={selected}
                busy={busy}
                onRecheck={canWrite ? () => void handleVerify() : undefined}
              />

              <DomainAnalyticsPanel domainId={selected.id} />

              <HistoryTimeline
                entries={history}
                title="Domain activity timeline"
                emptyMessage="No domain activity yet. Verify DNS or update settings to build history."
              />
            </>
          )}
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(open) => !busy && setDeleteOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete domain</DialogTitle>
            <DialogDescription>
              Permanently remove <span className="font-medium text-foreground">{selected?.domain}</span> and its
              cached DNS records, verification history, and deliverability metadata. Linked tracking domains and
              mailbox associations may stop resolving. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy || !selected} onClick={() => void handleDelete()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Globe
}) {
  return (
    <Card>
      <CardContent className="pt-4 flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2 py-1 rounded-full border ${
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'
      }`}
    >
      {label}
    </button>
  )
}

function DnsCell({ label, status }: { label: string; status: string }) {
  return (
    <div className="rounded-md border p-2 space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <DnsStatusLabel status={status as 'valid' | 'invalid' | 'missing' | 'unverified'} />
    </div>
  )
}
