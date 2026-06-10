import Link from 'next/link'
import {
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  MapPin,
  Linkedin,
  Globe,
  Radar,
  Gauge,
  Brain,
  Users,
  Lightbulb,
  PenLine,
  Send,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { getLeadGtmData, getProspectLeadById } from '@/app/actions/gtm'
import type { BuyingSignalRow } from '@/types/gtm'
import { toText, toTextList } from '@/lib/gtm-render'

type Lead = NonNullable<Awaited<ReturnType<typeof getProspectLeadById>>>
type Gtm = Awaited<ReturnType<typeof getLeadGtmData>>

function Section({
  step,
  agent,
  title,
  icon,
  empty,
  children,
}: {
  step: string
  agent: string
  title: string
  icon: React.ReactNode
  empty?: boolean
  children: React.ReactNode
}) {
  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-[11px] font-semibold">
            {step}
          </span>
          {icon}
          <span>{title}</span>
          <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
            {agent}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        {empty ? (
          <p className="text-xs text-muted-foreground italic">
            No data yet — run this phase for the ICP.
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function List({ items }: { items: unknown }) {
  const rows = toTextList(items)
  if (!rows.length) return null
  return (
    <ul className="list-disc pl-4 space-y-0.5 text-sm">
      {rows.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  )
}

export function ProspectLeadDetail({
  lead,
  gtm,
  signals,
}: {
  lead: Lead
  gtm: Gtm
  signals: BuyingSignalRow[]
}) {
  const { intel, stakeholders, map, brief, outreach } = gtm

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/prospects/leads">
            <Button variant="ghost" size="sm" className="-ml-2 mb-1 text-muted-foreground">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Prospect Leads
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-500" />
            {lead.company || 'Unknown company'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lead.domain && (
              <span className="flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" />
                {lead.domain}
              </span>
            )}
            {lead.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {lead.location}
              </span>
            )}
            {lead.companyLinkedin && (
              <a href={lead.companyLinkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600">
                <Linkedin className="h-3.5 w-3.5" /> LinkedIn
              </a>
            )}
          </div>
        </div>
        {lead.scoreTier && (
          <Badge
            className="text-xs capitalize"
            variant={lead.scoreTier === 'hot' ? 'default' : 'outline'}
          >
            {lead.scoreTier} · {lead.icpScore ?? '—'}/100
          </Badge>
        )}
      </div>

      {/* Phase 1 — Lead + enrichment (Agents 02/03) */}
      <Section step="P1" agent="Agents 02–03" title="Company & contact" icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Contact" value={lead.contactName} />
          <Field label="Title" value={lead.title} />
          <Field label="Industry" value={lead.industry} />
          <Field label="Company size" value={lead.companySize} />
          <Field label="Phone" value={lead.phone} />
          <Field label="Address" value={lead.address} />
        </div>
        {lead.email && (
          <div className="mt-3 flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{lead.email}</span>
            {lead.verified ? (
              <Badge variant="outline" className="text-[10px] text-green-600 border-green-600/40">
                <CheckCircle2 className="h-3 w-3 mr-1" /> verified
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-600/40">
                <AlertTriangle className="h-3 w-3 mr-1" /> unverified ({lead.bounceStatus || 'pattern'})
              </Badge>
            )}
          </div>
        )}
      </Section>

      {/* Phase 1 — Score (Agent 05) */}
      <Section
        step="P1"
        agent="Agent 05"
        title="ICP score"
        icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
        empty={lead.icpScore === null && !lead.scoreTier}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl font-semibold">{lead.icpScore ?? '—'}</span>
          <span className="text-sm text-muted-foreground">/100</span>
          {lead.scoreTier && <Badge variant="outline" className="capitalize">{lead.scoreTier}</Badge>}
        </div>
        {lead.scoreReasoning && <p className="mt-2 text-sm text-muted-foreground">{lead.scoreReasoning}</p>}
      </Section>

      {/* Phase 1 — Signals (Agent 04) */}
      <Section step="P1" agent="Agent 04" title="Buying signals" icon={<Radar className="h-4 w-4 text-muted-foreground" />} empty={!signals.length}>
        <ul className="space-y-2">
          {signals.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <Badge
                variant="outline"
                className={`text-[10px] capitalize ${s.intent === 'high' ? 'border-green-600/40 text-green-600' : ''}`}
              >
                {s.signalType} · {s.intent}
              </Badge>
              <span className="text-sm text-muted-foreground">{s.summary || s.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Phase 2 — Account intelligence (Agent 06) */}
      <Section step="P2" agent="Agent 06" title="Account intelligence" icon={<Brain className="h-4 w-4 text-muted-foreground" />} empty={!intel}>
        {intel && (
          <div className="space-y-2">
            <Field label="What they do" value={intel.whatTheyDo} />
            <Field label="Business model" value={intel.businessModel} />
            <Field label="Growth" value={intel.growthTrajectory} />
            {intel.likelyPainPoints?.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Pain points</p>
                <List items={intel.likelyPainPoints} />
              </div>
            )}
            {intel.keySignalsForOutreach?.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Outreach hooks</p>
                <List items={intel.keySignalsForOutreach} />
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Phase 2 — Stakeholders (Agent 07) */}
      <Section step="P2" agent="Agent 07" title="Stakeholders" icon={<Users className="h-4 w-4 text-muted-foreground" />} empty={!stakeholders.length && !map}>
        {map && (
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">coverage: {map.coverageStatus}</Badge>
            <Badge variant="outline">{map.multiThreadingStatus}</Badge>
            {map.championBudgetFlag && <Badge variant="outline" className="text-amber-600 border-amber-600/40">champion lacks budget</Badge>}
          </div>
        )}
        <ul className="space-y-1">
          {stakeholders.map((p) => (
            <li key={p.id} className="text-sm">
              <span className="font-medium">{p.fullName}</span>
              {p.jobTitle ? ` — ${p.jobTitle}` : ''}{' '}
              <Badge variant="outline" className="text-[10px] capitalize">{p.roleType}</Badge>
            </li>
          ))}
        </ul>
      </Section>

      {/* Phase 2 — GTM insight brief (Agent 10) */}
      <Section step="P2" agent="Agent 10" title="GTM insight brief" icon={<Lightbulb className="h-4 w-4 text-muted-foreground" />} empty={!brief}>
        {brief && (
          <div className="space-y-2">
            {brief.reviewStatus && (
              <Badge variant="outline" className="text-[10px] capitalize">{brief.reviewStatus.replace('_', ' ')}</Badge>
            )}
            <Field label="Executive summary" value={brief.executiveSummary} />
            <Field label="Urgency" value={brief.urgencySignal} />
            {brief.nextActions?.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Next actions</p>
                <List items={brief.nextActions} />
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Phase 3 — Outreach (Agents 11–14) */}
      <Section
        step="P3"
        agent="Agents 11–14"
        title="Outreach"
        icon={<PenLine className="h-4 w-4 text-muted-foreground" />}
        empty={!outreach.personalisation && !outreach.sequence && !outreach.channelPlan && !outreach.log.length}
      >
        <div className="space-y-3">
          {outreach.channelPlan && (
            <div className="text-sm">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Channel plan (Agent 13)</span>
              <div className="mt-0.5 flex flex-wrap gap-2">
                <Badge variant="outline" className="capitalize">primary: {outreach.channelPlan.primaryChannel}</Badge>
                <Badge variant="outline">
                  {outreach.channelPlan.sendWindowStartHour}:00–{outreach.channelPlan.sendWindowEndHour}:00
                </Badge>
                <Badge variant="outline">{outreach.channelPlan.touchesPerWeek}/week</Badge>
              </div>
            </div>
          )}
          {outreach.sequence && (
            <div className="text-sm">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Sequence (Agent 12) · {outreach.sequence.steps.length} steps · quality {outreach.sequence.qualityScore}/100
              </span>
              {outreach.sequence.cta && <p className="text-sm mt-0.5">CTA: {outreach.sequence.cta}</p>}
            </div>
          )}
          {outreach.log.length > 0 && (
            <div className="text-sm">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Send className="h-3 w-3" /> Send log (Agent 14)
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {outreach.log.map((l) => (
                  <li key={l.id} className="text-xs text-muted-foreground">
                    step {l.stepNumber} · {l.channel} · {l.status}
                    {l.variantSubject ? ` · "${l.variantSubject}"` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
