'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  Bookmark,
  CheckCircle2,
  Linkedin,
  Mail,
  Radio,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RunPhaseButton } from '@/components/prospects/run-phase-button'
import { getProspectLeads, promoteLead, runPhase1Search } from '@/app/actions/gtm'
import { signalLabel, type Icp, type IntentScore, type ProspectLeadRow } from '@/types/gtm'

const PAGE_SIZE = 25

function IntentBadge({ score }: { score: IntentScore }) {
  const cls =
    score === 'High'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : score === 'Medium'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
        : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
  return (
    <Badge variant="outline" className={cls}>
      {score}
    </Badge>
  )
}

function EmailCell({ lead }: { lead: ProspectLeadRow }) {
  if (!lead.email) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <div className="flex items-center gap-1.5">
      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-sm truncate max-w-[180px]" title={lead.email}>
        {lead.email}
      </span>
      {lead.verified ? (
        <Badge
          variant="outline"
          className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0"
        >
          Verified
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="bg-slate-500/10 text-slate-500 border-slate-500/20 text-[10px] px-1.5 py-0"
          title="Pattern email (first.last@domain) — not verified"
        >
          Pattern
        </Badge>
      )}
    </div>
  )
}

export function ProspectLeadsClient({
  initialLeads,
  initialCount,
  icps,
}: {
  initialLeads: ProspectLeadRow[]
  initialCount: number
  icps: Icp[]
}) {
  const [leads, setLeads] = useState(initialLeads)
  const [count, setCount] = useState(initialCount)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [icpId, setIcpId] = useState<string>('all')
  const [tier, setTier] = useState<string>('all')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [loading, startLoading] = useTransition()
  const [promoting, setPromoting] = useState<number | null>(null)

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  function load(nextPage = 1) {
    startLoading(async () => {
      const res = await getProspectLeads({
        q: q || undefined,
        icpId: icpId !== 'all' ? Number(icpId) : undefined,
        tier: tier !== 'all' ? tier : undefined,
        verifiedOnly: verifiedOnly || undefined,
        page: nextPage,
        pageSize: PAGE_SIZE,
      })
      setLeads(res.data)
      setCount(res.count)
      setPage(nextPage)
    })
  }

  async function onPromote(lead: ProspectLeadRow) {
    setPromoting(lead.id)
    const res = await promoteLead(lead.id)
    setPromoting(null)
    if (res.ok) {
      toast.success(`${lead.company} promoted to CRM`)
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, promoted: true, crmLeadId: res.crmLeadId || l.crmLeadId } : l)),
      )
    } else {
      toast.error(res.error || 'Promote failed')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Prospect Leads</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live from the GTM pipeline — {count.toLocaleString()} lead{count === 1 ? '' : 's'} discovered, enriched and scored.
          </p>
        </div>
      </div>

      <Tabs defaultValue="filters" className="w-full">
        <TabsList className="bg-muted rounded-lg p-[3px] h-9 w-fit">
          <TabsTrigger value="filters" className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            Search &amp; filter
          </TabsTrigger>
          <TabsTrigger value="ai" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Zap className="h-3.5 w-3.5 text-purple-500" />
            Search with AI
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="filters" className="mt-6 space-y-4">
          {/* Compact horizontal filter bar — sits above the full-width table */}
          <Card className="rounded-xl border bg-card shadow-sm">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label className="text-[11px] font-medium text-muted-foreground">Search</label>
                  <div className="relative mt-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && load(1)}
                      placeholder="Company, contact, industry…"
                      className="h-9 text-sm pl-8"
                    />
                  </div>
                </div>

                <div className="w-44">
                  <label className="text-[11px] font-medium text-muted-foreground">ICP</label>
                  <Select value={icpId} onValueChange={setIcpId}>
                    <SelectTrigger className="h-9 text-sm mt-1">
                      <SelectValue placeholder="All ICPs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All ICPs</SelectItem>
                      {icps.map((i) => (
                        <SelectItem key={i.id} value={String(i.id)}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-36">
                  <label className="text-[11px] font-medium text-muted-foreground">Score tier</label>
                  <Select value={tier} onValueChange={setTier}>
                    <SelectTrigger className="h-9 text-sm mt-1">
                      <SelectValue placeholder="All tiers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tiers</SelectItem>
                      <SelectItem value="hot">🔥 Hot</SelectItem>
                      <SelectItem value="warm">Warm</SelectItem>
                      <SelectItem value="cold">Cold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 h-9">
                  <Switch checked={verifiedOnly} onCheckedChange={setVerifiedOnly} />
                  <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Verified only</label>
                </div>

                <Button size="sm" className="h-9" onClick={() => load(1)} disabled={loading}>
                  {loading ? 'Loading…' : 'Apply filters'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl border bg-card shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b">
                        <TableHead>Contact</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Signals</TableHead>
                        <TableHead className="w-[150px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                            No prospects yet. Run an AI search or a pipeline from the ICP page to populate this list.
                          </TableCell>
                        </TableRow>
                      )}
                      {leads.map((lead) => (
                        <TableRow key={lead.id} className="border-b hover:bg-muted/50 align-top">
                          <TableCell>
                            <div className="font-medium">{lead.contactName || '—'}</div>
                            <div className="text-xs text-muted-foreground">{lead.title || ''}</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{lead.company}</div>
                            <div className="text-xs text-muted-foreground">{lead.industry || lead.domain || ''}</div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{lead.location || '—'}</TableCell>
                          <TableCell>
                            <EmailCell lead={lead} />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <IntentBadge score={lead.intentScore} />
                              {lead.icpScore != null && (
                                <span className="text-xs text-muted-foreground">{lead.icpScore}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {lead.signalsCount > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                <Badge variant="outline" className="w-fit gap-1 text-[11px]">
                                  <Radio className="h-3 w-3 text-blue-500" />
                                  {lead.signalsCount}
                                </Badge>
                                {lead.topSignalType && (
                                  <span className="text-[10px] text-muted-foreground">{signalLabel(lead.topSignalType)}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                                <Link href={`/prospects/leads/${lead.id}`}>View</Link>
                              </Button>
                              {lead.promoted ? (
                                lead.crmLeadId ? (
                                  <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs text-emerald-600">
                                    <Link href={`/leads/${lead.crmLeadId}`}>
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      In CRM
                                    </Link>
                                  </Button>
                                ) : (
                                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 gap-1">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    In CRM
                                  </Badge>
                                )
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1 text-xs"
                                  disabled={promoting === lead.id}
                                  onClick={() => onPromote(lead)}
                                >
                                  <Bookmark className="h-3.5 w-3.5" />
                                  {promoting === lead.id ? 'Promoting…' : 'Promote'}
                                </Button>
                              )}
                              {lead.linkedin && (
                                <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                  <a href={lead.linkedin} target="_blank" rel="noopener noreferrer">
                                    <Linkedin className="h-3.5 w-3.5 text-blue-600" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages} · {count.toLocaleString()} total
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => load(page - 1)} disabled={page <= 1 || loading}>
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => load(page + 1)} disabled={page >= totalPages || loading}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="ai" className="mt-6">
          <Card className="rounded-xl border bg-card shadow-sm max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                AI Prospect Search
              </CardTitle>
              <CardDescription>
                Describe your ideal customer in plain language. The pipeline defines an ICP, finds companies, enriches
                contacts &amp; emails, detects buying signals and scores everything — all stored here automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={3}
                placeholder="e.g. Series A–C fintech companies in India using outdated billing software, target the VP Finance or Head of Payments"
                className="text-sm"
              />
              <div className="flex items-center gap-3">
                <RunPhaseButton
                  run={() => runPhase1Search(aiPrompt)}
                  label="Search & store"
                  runningLabel="Running pipeline…"
                  icon={<Zap className="h-4 w-4" />}
                  onDone={() => load(1)}
                />
                <span className="text-xs text-muted-foreground">
                  Runs find → enrich → signals → score. Results appear in the list when it finishes.
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
