'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  Building2,
  Flame,
  Loader2,
  MailCheck,
  MessageSquare,
  Search,
  Sparkles,
  Target,
  Users,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RunPhaseButton } from '@/components/prospects/run-phase-button'
import { PipelineRunsPanel } from '@/components/prospects/PipelineRunsPanel'
import { toText } from '@/lib/gtm-render'
import {
  runFindAndPrepare,
  runPhase1Search,
} from '@/app/actions/gtm'
import { sendNowForIcp } from '@/app/actions/engage'
import type { Icp, MarketSegment, PhaseRun } from '@/types/gtm'

function refresh() {
  // Live-data server page is force-dynamic; reload to pull fresh ICP counts.
  if (typeof window !== 'undefined') window.location.reload()
}

// "Send now" — dispatches the already-prepared sequences from the DB (fast,
// no agent re-run) to un-contacted leads only, via the campaign worker.
function SendNowButton({ icpId, onDone }: { icpId: number; onDone: () => void }) {
  const [sending, setSending] = useState(false)
  const run = async () => {
    setSending(true)
    try {
      const { report } = await sendNowForIcp(icpId)
      const sent = report?.sent ?? 0
      if (sent > 0) toast.success(`Sent ${sent} email${sent === 1 ? '' : 's'} to new leads`)
      else toast.message('No new leads to send — everyone prepared has already been emailed.')
      if (report?.errors?.length) toast.error(report.errors[0])
      onDone()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }
  return (
    <Button type="button" size="sm" variant="outline" onClick={run} disabled={sending}>
      {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MailCheck className="h-4 w-4 mr-2" />}
      {sending ? 'Sending…' : 'Send now'}
    </Button>
  )
}

function IcpCard({ icp }: { icp: Icp }) {
  const tags = icp.industry ?? []
  const leadCount = icp.leadCount ?? 0
  const hotCount = icp.hotCount ?? 0

  return (
    <Card className="rounded-xl border bg-card shadow-sm flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-500 shrink-0" />
              <span className="truncate">{icp.name}</span>
            </CardTitle>
            {icp.product_line && (
              <CardDescription className="text-xs mt-1 truncate">{icp.product_line}</CardDescription>
            )}
          </div>
          {icp.active === false && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
              Inactive
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 pt-0">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 6).map((tag, i) => (
              <Badge key={i} variant="outline" className="text-[10px] bg-muted/40">
                {toText(tag)}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{leadCount.toLocaleString()}</span>
            <span className="text-muted-foreground text-xs">leads</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-orange-500" />
            <span className="font-medium">{hotCount.toLocaleString()}</span>
            <span className="text-muted-foreground text-xs">hot</span>
          </div>
        </div>

        <div className="mt-auto pt-1 space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Run pipeline phases:</p>
          <div className="flex flex-wrap gap-2">
            <RunPhaseButton
              run={() => runFindAndPrepare(icp.id)}
              label="Find leads"
              runningLabel="Finding & preparing…"
              icon={<Search className="h-4 w-4" />}
              size="sm"
              onDone={refresh}
            />
            <SendNowButton icpId={icp.id} onDone={refresh} />
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Find leads</span> finds, enriches, scores &amp; writes each lead&apos;s
            personalized 5-step emails (no send) ·{' '}
            <span className="font-medium text-foreground">Send now</span> instantly emails only the new, un-contacted leads
            from the database and tracks them under this ICP&apos;s campaign
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function IcpClient({
  icps,
  runs,
  market,
}: {
  icps: Icp[]
  runs: PhaseRun[]
  market: MarketSegment[]
}) {
  const [aiPrompt, setAiPrompt] = useState('')

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">ICP &amp; Pipelines</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Define ideal customer profiles and run the find → understand → reach-out pipeline for each.
          </p>
        </div>
      </div>

      {/* AI search — define & run a brand-new ICP --------------------------- */}
      <Card className="rounded-xl border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI search (new ICP)
          </CardTitle>
          <CardDescription>
            Describe an ideal customer in plain language. The pipeline defines a new ICP, finds companies, enriches
            contacts &amp; emails, detects buying signals and scores everything — all stored automatically.
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
              label="Define & run ICP"
              runningLabel="Running pipeline…"
              icon={<Zap className="h-4 w-4" />}
              onDone={refresh}
            />
            <span className="text-xs text-muted-foreground">
              Runs define → find → enrich → signals → score. Watch live status &amp; logs below; the new ICP appears when it finishes.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ICP cards --------------------------------------------------------- */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-blue-500" />
          Ideal customer profiles
          <span className="text-muted-foreground font-normal">({icps.length})</span>
        </h2>
        {icps.length === 0 ? (
          <Card className="rounded-xl border bg-card shadow-sm">
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No ICPs yet. Use the AI search above to define and run your first one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {icps.map((icp) => (
              <IcpCard key={icp.id} icp={icp} />
            ))}
          </div>
        )}
      </div>

      {/* Recent pipeline runs — live status + full logs -------------------- */}
      <PipelineRunsPanel
        initialRuns={runs}
        description="Live status, errors and full console logs for find / understand / reach-out jobs across all ICPs."
      />

      {/* Market sizing ----------------------------------------------------- */}
      {market.length > 0 && (
        <Card className="rounded-xl border bg-card shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Market sizing
            </CardTitle>
            <CardDescription className="text-xs">TAM / SAM / SOM and recommended outreach volume per segment.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b">
                    <TableHead>Segment / ICP</TableHead>
                    <TableHead>TAM</TableHead>
                    <TableHead>SAM</TableHead>
                    <TableHead>SOM</TableHead>
                    <TableHead className="text-center">Priority</TableHead>
                    <TableHead className="text-right">Rec. volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {market.map((seg) => (
                    <TableRow key={seg.id} className="border-b hover:bg-muted/50 align-top">
                      <TableCell>
                        <div className="font-medium flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {seg.segmentName || `ICP #${seg.icpId}`}
                        </div>
                        {seg.priorityRationale && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1 max-w-[280px]">
                            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                            <span className="truncate" title={seg.priorityRationale}>
                              {seg.priorityRationale}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{seg.tamEstimate || '—'}</TableCell>
                      <TableCell className="text-sm">{seg.samEstimate || '—'}</TableCell>
                      <TableCell className="text-sm">{seg.somThisMonth || '—'}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-[11px]">
                          #{seg.priorityRank}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {seg.recommendedVolume.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
