'use client'

import { useState, useTransition } from 'react'
import {
  Sparkles,
  Building2,
  Users,
  Radio,
  Swords,
  FileText,
  Send,
  Linkedin,
  Mail,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  AlertTriangle,
  Target,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { approveGtmBrief, rejectGtmBrief, getGtmDataForCrmLead } from '@/app/actions/gtm'
import { toText, toTextList } from '@/lib/gtm-render'
import {
  signalLabel,
  type AccountIntel,
  type StakeholderRow,
  type StakeholderMap,
  type BuyingSignalRow,
  type CompetitorIntel,
  type GtmBrief,
  type OutreachBundle,
} from '@/types/gtm'

// The data prop mirrors exactly what getGtmDataForCrmLead returns (or null).
type GtmData = NonNullable<Awaited<ReturnType<typeof getGtmDataForCrmLead>>>

function fmtDate(d: string | null | undefined, pattern = 'MMM d, yyyy') {
  if (!d) return '—'
  const parsed = new Date(d)
  if (isNaN(parsed.getTime())) return '—'
  return format(parsed, pattern)
}

function Chips({ items, className }: { items: unknown; className?: string }) {
  const rows = toTextList(items)
  if (rows.length === 0) return <span className="text-xs text-muted-foreground italic">None</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((item, i) => (
        <Badge key={i} variant="outline" className={`font-normal text-xs ${className || ''}`}>
          {item}
        </Badge>
      ))}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="text-sm text-foreground whitespace-pre-wrap">{value || '—'}</p>
    </div>
  )
}

function threatClass(level: string | null | undefined) {
  const l = (level || '').toLowerCase()
  if (l === 'high') return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30'
  if (l === 'medium') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
}

function intentClass(intent: string | null | undefined) {
  const l = (intent || '').toLowerCase()
  if (l === 'high') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
  if (l === 'medium') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
}

function confidenceClass(conf: string | null | undefined) {
  const l = (conf || '').toLowerCase()
  if (l === 'high' || l === 'verified') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
  if (l === 'medium') return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
  return 'bg-slate-500/10 text-slate-500 border-slate-500/20'
}

// ------------------------------------------------------------------ Account Intel
function AccountIntelTab({ intel }: { intel: AccountIntel | null }) {
  if (!intel) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No account intelligence available for this lead.
      </p>
    )
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="What they do" value={intel.whatTheyDo} />
        <Field label="Business model" value={intel.businessModel} />
        <Field label="Growth trajectory" value={intel.growthTrajectory} />
        <Field label="Competitive position" value={intel.competitivePosition} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-blue-500" /> Recent moves
          </div>
          <Chips items={intel.recentMoves} className="border-blue-500/30 text-blue-700 dark:text-blue-400" />
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-purple-500" /> Likely pain points
          </div>
          <Chips items={intel.likelyPainPoints} className="border-purple-500/30 text-purple-700 dark:text-purple-400" />
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Instability flags
          </div>
          <Chips items={intel.instabilityFlags} className="border-amber-500/30 text-amber-700 dark:text-amber-400" />
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-emerald-500" /> Key signals for outreach
          </div>
          <Chips items={intel.keySignalsForOutreach} className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400" />
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Buying Committee
function BuyingCommitteeTab({
  stakeholders,
  map,
}: {
  stakeholders: StakeholderRow[]
  map: StakeholderMap | null
}) {
  return (
    <div className="space-y-6">
      {map && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <div className="text-xs text-muted-foreground">Entry point</div>
            <div className="text-sm font-medium text-foreground">{map.entryPointFullName || '—'}</div>
            {map.entryPointRoleType && (
              <Badge variant="outline" className="text-[10px] capitalize">{map.entryPointRoleType}</Badge>
            )}
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <div className="text-xs text-muted-foreground">Coverage status</div>
            <Badge variant="outline" className="capitalize">{map.coverageStatus || '—'}</Badge>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <div className="text-xs text-muted-foreground">Multi-threading</div>
            <Badge variant="outline" className="capitalize">{map.multiThreadingStatus || '—'}</Badge>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <div className="text-xs text-muted-foreground">Missing roles</div>
            <Chips items={map.missingRoles} />
          </div>
        </div>
      )}

      {stakeholders.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Seniority</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-[60px]">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stakeholders.map((s) => (
                <TableRow key={s.id} className="align-top">
                  <TableCell className="font-medium">{s.fullName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.jobTitle || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-[11px]">{s.roleType}</Badge>
                  </TableCell>
                  <TableCell className="text-sm capitalize text-muted-foreground">{s.seniority || '—'}</TableCell>
                  <TableCell>
                    {s.email ? (
                      <div className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate max-w-[200px]" title={s.email}>{s.email}</span>
                        {s.emailConfidence && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 capitalize ${confidenceClass(s.emailConfidence)}`}>
                            {s.emailConfidence}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.linkedinUrl ? (
                      <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                        <a href={s.linkedinUrl} target="_blank" rel="noopener noreferrer">
                          <Linkedin className="h-3.5 w-3.5 text-blue-600" />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">No stakeholders mapped yet.</p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Signals
function SignalsTab({ signals }: { signals: BuyingSignalRow[] }) {
  if (signals.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No buying signals detected for this lead.</p>
  }
  return (
    <div className="space-y-3">
      {signals.map((sig) => (
        <div key={sig.id} className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="gap-1 border-blue-500/30 text-blue-700 dark:text-blue-400">
                <Radio className="h-3 w-3" />
                {signalLabel(sig.signalType)}
              </Badge>
              {sig.intent && (
                <Badge variant="outline" className={`capitalize ${intentClass(sig.intent)}`}>{sig.intent}</Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{fmtDate(sig.detectedAt)}</span>
          </div>
          <p className="text-sm text-foreground">{sig.summary || sig.text || '—'}</p>
          {sig.sourceUrl && (
            <a
              href={sig.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Source
            </a>
          )}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Competitors
function CompetitorsTab({ competitors }: { competitors: CompetitorIntel[] }) {
  if (competitors.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No competitor intelligence available.</p>
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {competitors.map((c) => (
        <Card key={c.id} className="border-slate-200 dark:border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Swords className="h-4 w-4 text-rose-500" /> {c.competitorName}
              </CardTitle>
              <Badge variant="outline" className={`capitalize ${threatClass(c.threatLevel)}`}>
                {c.threatLevel || 'unknown'} threat
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Biggest weakness</div>
              <p className="text-sm text-foreground">{c.biggestWeakness || '—'}</p>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Talk tracks</div>
              {c.talkTracks && c.talkTracks.length > 0 ? (
                <ul className="space-y-1.5">
                  {c.talkTracks.map((t, i) => (
                    <li key={i} className="text-sm text-foreground flex gap-2 items-start">
                      {t.scenario && (
                        <Badge variant="outline" className="text-[10px] shrink-0 h-5 capitalize">
                          {toText(t.scenario)}
                        </Badge>
                      )}
                      <span className="min-w-0 break-words">{toText(t.message)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-muted-foreground italic">None</span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ GTM Brief
function ReviewStatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  if (s === 'approved')
    return (
      <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
        <CheckCircle2 className="h-3.5 w-3.5" /> Approved
      </Badge>
    )
  if (s === 'rejected')
    return (
      <Badge variant="outline" className="gap-1 bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">
        <XCircle className="h-3.5 w-3.5" /> Rejected
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
      <Clock className="h-3.5 w-3.5" /> {status?.replace(/_/g, ' ') || 'Pending'}
    </Badge>
  )
}

function BriefTab({ brief }: { brief: GtmBrief | null }) {
  const [status, setStatus] = useState(brief?.reviewStatus || '')
  const [pending, startTransition] = useTransition()

  if (!brief) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No GTM brief generated yet.</p>
  }

  function onApprove() {
    if (!brief) return
    startTransition(async () => {
      const res = await approveGtmBrief(brief.id)
      if (res.ok) {
        setStatus('approved')
        toast.success('Brief approved')
      } else {
        toast.error(res.error || 'Failed to approve brief')
      }
    })
  }

  function onReject() {
    if (!brief) return
    startTransition(async () => {
      const res = await rejectGtmBrief(brief.id)
      if (res.ok) {
        setStatus('rejected')
        toast.success('Brief rejected')
      } else {
        toast.error(res.error || 'Failed to reject brief')
      }
    })
  }

  const isPending = (status || '').toLowerCase() === 'pending_review'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">Brief date: {fmtDate(brief.briefDate)}</div>
        {isPending ? (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onApprove} disabled={pending} className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {pending ? 'Saving…' : 'Approve'}
            </Button>
            <Button size="sm" variant="outline" onClick={onReject} disabled={pending} className="gap-1.5">
              <XCircle className="h-3.5 w-3.5" /> Reject
            </Button>
          </div>
        ) : (
          <ReviewStatusBadge status={status} />
        )}
      </div>

      <Field label="Executive summary" value={brief.executiveSummary} />

      {brief.urgencySignal && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Urgency signal
          </div>
          <p className="text-sm text-foreground">{brief.urgencySignal}</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next actions</div>
        {brief.nextActions && brief.nextActions.length > 0 ? (
          <ol className="list-decimal pl-5 space-y-1">
            {brief.nextActions.map((a, i) => (
              <li key={i} className="text-sm text-foreground">{toText(a)}</li>
            ))}
          </ol>
        ) : (
          <span className="text-xs text-muted-foreground italic">None</span>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Outreach
function OutreachTab({ outreach }: { outreach: OutreachBundle }) {
  const { personalisation, sequence, channelPlan, log } = outreach
  const hasAny = personalisation || sequence || channelPlan || (log && log.length > 0)
  if (!hasAny) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No outreach plan generated yet.</p>
  }
  return (
    <div className="space-y-6">
      {personalisation && personalisation.angles.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Personalisation angles</div>
          <div className="space-y-2">
            {personalisation.angles.map((angle, i) => (
              <div key={i} className="rounded-lg border bg-muted/30 p-3 text-sm text-foreground">
                {typeof angle === 'object' && angle !== null
                  ? String(
                      (angle as Record<string, unknown>).angle ??
                        (angle as Record<string, unknown>).text ??
                        (angle as Record<string, unknown>).hook ??
                        JSON.stringify(angle),
                    )
                  : String(angle)}
              </div>
            ))}
          </div>
        </div>
      )}

      {sequence && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sequence</div>
            {sequence.persona && <Badge variant="outline" className="capitalize">{sequence.persona}</Badge>}
            {sequence.cta && <span className="text-xs text-muted-foreground">CTA: {sequence.cta}</span>}
          </div>
          {sequence.steps && sequence.steps.length > 0 ? (
            <div className="space-y-2">
              {sequence.steps.map((step, i) => {
                const s = step as Record<string, unknown>
                const subject = s.subject ?? s.title ?? s.channel ?? `Step ${i + 1}`
                const body = s.body ?? s.message ?? s.text ?? ''
                return (
                  <div key={i} className="rounded-lg border bg-card p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">Step {i + 1}</Badge>
                      <span className="text-sm font-medium text-foreground">{String(subject)}</span>
                    </div>
                    {body ? <p className="text-sm text-muted-foreground whitespace-pre-wrap">{String(body)}</p> : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">No steps</span>
          )}
        </div>
      )}

      {channelPlan && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Channel plan</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
              <div className="text-xs text-muted-foreground">Primary</div>
              <Badge variant="outline" className="capitalize">{channelPlan.primaryChannel || '—'}</Badge>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
              <div className="text-xs text-muted-foreground">Secondary</div>
              <Badge variant="outline" className="capitalize">{channelPlan.secondaryChannel || '—'}</Badge>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
              <div className="text-xs text-muted-foreground">Send window</div>
              <div className="text-sm font-medium text-foreground">
                {channelPlan.sendWindowStartHour}:00 – {channelPlan.sendWindowEndHour}:00
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
              <div className="text-xs text-muted-foreground">Touches / week</div>
              <div className="text-sm font-medium text-foreground">{channelPlan.touchesPerWeek}</div>
            </div>
          </div>
          {channelPlan.rationale && (
            <p className="text-xs text-muted-foreground">{channelPlan.rationale}</p>
          )}
        </div>
      )}

      {log && log.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent outreach log</div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Channel</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="capitalize text-sm">{row.channel || '—'}</TableCell>
                    <TableCell className="text-sm">{row.stepNumber ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[220px]" title={row.variantSubject || ''}>
                      {row.variantSubject || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-[11px]">{row.status || '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(row.sentAt, 'MMM d, h:mm a')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Root
export function GtmIntelligence({ data }: { data: GtmData | null }) {
  if (!data) {
    return (
      <Card className="shadow-sm border-dashed border-slate-200 dark:border-border bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-secondary flex items-center justify-center mb-3">
            <Sparkles className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-sm text-muted-foreground max-w-sm">
            No AI intelligence yet — run Phase 2/3 for this lead&apos;s ICP.
          </p>
        </CardContent>
      </Card>
    )
  }

  const { intel, stakeholders, map, brief, outreach, competitors, signals } = data

  return (
    <Card className="shadow-sm border-slate-200 dark:border-border">
      <CardHeader className="border-b dark:border-border pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" /> GTM Intelligence
        </CardTitle>
        <CardDescription>
          AI-generated account intel, buying committee, signals, competitors, brief and outreach plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        <Tabs defaultValue="intel" className="w-full">
          <TabsList className="bg-muted rounded-lg p-[3px] h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="intel" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Building2 className="h-3.5 w-3.5" /> Account Intel
            </TabsTrigger>
            <TabsTrigger value="committee" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Users className="h-3.5 w-3.5" /> Buying Committee
            </TabsTrigger>
            <TabsTrigger value="signals" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Radio className="h-3.5 w-3.5" /> Signals
              {signals.length > 0 && <span className="text-[10px] text-muted-foreground">({signals.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="competitors" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Swords className="h-3.5 w-3.5" /> Competitors
            </TabsTrigger>
            <TabsTrigger value="brief" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <FileText className="h-3.5 w-3.5" /> GTM Brief
            </TabsTrigger>
            <TabsTrigger value="outreach" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Send className="h-3.5 w-3.5" /> Outreach
            </TabsTrigger>
          </TabsList>

          <TabsContent value="intel" className="mt-5">
            <AccountIntelTab intel={intel} />
          </TabsContent>
          <TabsContent value="committee" className="mt-5">
            <BuyingCommitteeTab stakeholders={stakeholders} map={map} />
          </TabsContent>
          <TabsContent value="signals" className="mt-5">
            <SignalsTab signals={signals} />
          </TabsContent>
          <TabsContent value="competitors" className="mt-5">
            <CompetitorsTab competitors={competitors} />
          </TabsContent>
          <TabsContent value="brief" className="mt-5">
            <BriefTab brief={brief} />
          </TabsContent>
          <TabsContent value="outreach" className="mt-5">
            <OutreachTab outreach={outreach} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
