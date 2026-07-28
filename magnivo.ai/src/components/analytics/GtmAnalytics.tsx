'use client'

import { BrainCircuit, Coins, Hash, Activity, Globe2, Layers, TrendingUp, TrendingDown, ClipboardList, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight, PiggyBank, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { Icp, MarketSegment, RevenueForecast, BoardReport, RoiAttributionSnapshot } from '@/types/gtm'

function fmtUsdFull(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function riskClass(level: string | undefined): string {
  const l = (level || '').toLowerCase()
  if (l === 'stuck') return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30'
  if (l === 'at_risk' || l === 'at risk') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
}

// Agent 34 — Revenue Forecasting
function RevenueForecastCard({ forecast }: { forecast: RevenueForecast | null }) {
  return (
    <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-emerald-600" />
          Revenue Forecast
        </CardTitle>
        <CardDescription>
          Conservative / base / optimistic rollup from active deals (probability ≥ 30% required to count as committed).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!forecast ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No forecast generated yet. Run the revenue forecasting pipeline to populate this.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Conservative</div>
                <p className="mt-1 text-xl font-bold text-slate-900 dark:text-foreground tabular-nums">{fmtUsdFull(forecast.conservativeTotal)}</p>
              </div>
              <div className="rounded-xl border-2 border-emerald-500/40 p-3 bg-emerald-500/5">
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Base case</div>
                <p className="mt-1 text-xl font-bold text-slate-900 dark:text-foreground tabular-nums">{fmtUsdFull(forecast.baseTotal)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Optimistic</div>
                <p className="mt-1 text-xl font-bold text-slate-900 dark:text-foreground tabular-nums">{fmtUsdFull(forecast.optimisticTotal)}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{forecast.committedDealCount} committed deal(s)</span>
              <span>·</span>
              <span>{forecast.excludedDealCount} excluded (below 30% confidence)</span>
              <span>·</span>
              <span>{forecast.totalDealCount} total active</span>
            </div>

            {forecast.dealBreakdown.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Deal</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Probability</TableHead>
                      <TableHead className="text-right">Weighted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {forecast.dealBreakdown.slice(0, 8).map((d, i) => (
                      <TableRow key={d.deal_id ?? i}>
                        <TableCell className="text-sm truncate max-w-[180px]">{d.company_name || '—'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{d.value != null ? fmtUsdFull(d.value) : '—'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{d.probability != null ? `${d.probability}%` : '—'}</TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums">{d.weighted_value != null ? fmtUsdFull(d.weighted_value) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function fmtUsdPrecise(n: number): string {
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toFixed(4)}`
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

// Agent 36 — ROI Attribution
function RoiAttributionCard({ roi }: { roi: RoiAttributionSnapshot | null }) {
  return (
    <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <PiggyBank className="h-5 w-5 text-teal-600" />
          ROI Attribution
        </CardTitle>
        <CardDescription>What the AI pipeline costs vs. what it's produced.</CardDescription>
      </CardHeader>
      <CardContent>
        {!roi ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No ROI snapshot generated yet. Run the ROI attribution pipeline to populate this.
          </p>
        ) : (
          <div className="space-y-5">
            {roi.flaggedNegativeRoi && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-950/20 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-sm font-medium text-red-700 dark:text-red-400">Negative ROI flagged this snapshot</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Total AI spend</div>
                <p className="mt-1 text-xl font-bold text-slate-900 dark:text-foreground tabular-nums">{fmtUsdPrecise(roi.totalLlmCostUsd)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">ROI ratio</div>
                <p className={`mt-1 text-xl font-bold tabular-nums ${roi.roiRatio === null ? 'text-slate-900 dark:text-foreground' : roi.roiRatio >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {roi.roiRatio !== null ? `${roi.roiRatio >= 0 ? '+' : ''}${(roi.roiRatio * 100).toFixed(0)}%` : 'N/A'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Cost / lead</div>
                <p className="mt-1 text-sm font-bold text-slate-900 dark:text-foreground tabular-nums">
                  {roi.costPerLead !== null ? fmtUsdPrecise(roi.costPerLead) : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Cost / qualified deal</div>
                <p className="mt-1 text-sm font-bold text-slate-900 dark:text-foreground tabular-nums">
                  {roi.costPerQualifiedDeal !== null ? fmtUsdPrecise(roi.costPerQualifiedDeal) : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Cost / closed deal</div>
                <p className="mt-1 text-sm font-bold text-slate-900 dark:text-foreground tabular-nums">
                  {roi.costPerClosedDeal !== null ? fmtUsdPrecise(roi.costPerClosedDeal) : 'N/A'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{roi.leadCount} leads</span>
              <span>·</span>
              <span>{roi.qualifiedDealCount} qualified</span>
              <span>·</span>
              <span>{roi.closedWonCount} closed-won ({fmtUsdPrecise(roi.closedWonRevenue)})</span>
            </div>

            {roi.channelBreakdown.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Closed-won</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roi.channelBreakdown.map((c, i) => (
                      <TableRow key={c.channel ?? i}>
                        <TableCell className="text-sm capitalize">{c.channel}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{fmtUsdPrecise(c.cost_usd)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{c.leads}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{c.closed_won_deals}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {roi.limitationsNote && (
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2.5">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{roi.limitationsNote}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Agent 35 — Board Reporting
function BoardReportCard({ report }: { report: BoardReport | null }) {
  return (
    <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-indigo-600" />
          Board Report
        </CardTitle>
        <CardDescription>Leadership-ready pipeline, conversion, and risk summary.</CardDescription>
      </CardHeader>
      <CardContent>
        {!report ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No board report generated yet. Run the board reporting pipeline to populate this.
          </p>
        ) : (
          <div className="space-y-5">
            {report.executiveSummary && (
              <p className="text-sm text-foreground bg-muted/40 rounded-lg p-3">{report.executiveSummary}</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Conversion rate</div>
                <p className="mt-1 text-xl font-bold text-slate-900 dark:text-foreground tabular-nums">
                  {report.conversionRate !== null ? `${report.conversionRate}%` : 'N/A'}
                </p>
                {report.conversionRateNote && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{report.conversionRateNote}</p>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Forecast (base)</div>
                <p className="mt-1 text-xl font-bold text-slate-900 dark:text-foreground tabular-nums">
                  {report.forecastBaseTotal !== null ? fmtUsdFull(report.forecastBaseTotal) : 'N/A'}
                </p>
                {report.forecastDeltaFromPrevious !== null && (
                  <p className={`text-[11px] mt-0.5 flex items-center gap-0.5 ${report.forecastDeltaFromPrevious >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {report.forecastDeltaFromPrevious >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {fmtUsdFull(Math.abs(report.forecastDeltaFromPrevious))} vs last report
                  </p>
                )}
              </div>
            </div>

            {Object.keys(report.pipelineByStage).length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Pipeline by stage</div>
                {Object.entries(report.pipelineByStage).map(([stage, info]) => (
                  <div key={stage} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-700 dark:text-foreground">{stage.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground tabular-nums">{info.count} deal(s) · {fmtUsdFull(info.total_value)}</span>
                  </div>
                ))}
              </div>
            )}

            {report.topRisks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Top risks
                </div>
                {report.topRisks.map((r, i) => (
                  <div key={r.deal_id ?? i} className="flex items-start justify-between gap-2 text-sm border-b last:border-0 pb-1.5 last:pb-0">
                    <div>
                      <span className="font-medium text-slate-900 dark:text-foreground">{r.company_name || 'Unknown'}</span>
                      {r.next_best_action && <p className="text-xs text-muted-foreground">{r.next_best_action}</p>}
                    </div>
                    <Badge variant="outline" className={`shrink-0 capitalize ${riskClass(r.risk_level)}`}>
                      {(r.risk_level || 'unknown').replace(/_/g, ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Going well
                </div>
                {report.goingWell.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nothing to report yet</p>
                ) : (
                  <ul className="space-y-1">
                    {report.goingWell.map((item, i) => (
                      <li key={i} className="text-xs text-foreground">+ {item}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <TrendingDown className="h-3.5 w-3.5 text-red-500" /> Needs attention
                </div>
                {report.needsAttention.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nothing flagged</p>
                ) : (
                  <ul className="space-y-1">
                    {report.needsAttention.map((item, i) => (
                      <li key={i} className="text-xs text-foreground">! {item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type LlmUsageSummary = {
  totalCost: number
  totalCalls: number
  totalTokens: number
  byAgent: Array<{ agent: string; cost: number; calls: number }>
  byPhase: Array<{ phase: string; cost: number; calls: number }>
}

function fmtUsd(n: number): string {
  if (!n) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtCompact(n: number): string {
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}

function priorityClass(rank: number): string {
  if (rank <= 1) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
  if (rank === 2) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
}

export default function GtmAnalytics({
  usage,
  market,
  icps,
  forecast,
  boardReport,
  roi,
}: {
  usage: LlmUsageSummary
  market: MarketSegment[]
  icps: Icp[]
  forecast: RevenueForecast | null
  boardReport: BoardReport | null
  roi: RoiAttributionSnapshot | null
}) {
  const icpName = new Map(icps.map((i) => [i.id, i.name]))
  const maxPhaseCost = Math.max(1e-9, ...usage.byPhase.map((p) => p.cost))
  const maxAgentCost = Math.max(1e-9, ...usage.byAgent.map((a) => a.cost))

  return (
    <div className="space-y-6 mt-10">
      <div className="flex items-center gap-2 px-1">
        <BrainCircuit className="h-6 w-6 text-purple-600 dark:text-purple-500" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-foreground">GTM Pipeline Intelligence</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---------------- Revenue Forecast (Agent 34) ---------------- */}
        <RevenueForecastCard forecast={forecast} />

        {/* ---------------- Board Report (Agent 35) ---------------- */}
        <BoardReportCard report={boardReport} />

        {/* ---------------- ROI Attribution (Agent 36) ---------------- */}
        <RoiAttributionCard roi={roi} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---------------- AI Pipeline Cost ---------------- */}
        <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              AI Pipeline Cost
            </CardTitle>
            <CardDescription>LLM spend across the GTM agent pipeline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-muted-foreground">
                  <Coins className="h-3.5 w-3.5 text-amber-500" /> Total cost
                </div>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-foreground">{fmtUsd(usage.totalCost)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 text-blue-500" /> Calls
                </div>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-foreground">{usage.totalCalls.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-muted-foreground">
                  <Hash className="h-3.5 w-3.5 text-emerald-500" /> Tokens
                </div>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-foreground">{fmtCompact(usage.totalTokens)}</p>
              </div>
            </div>

            {usage.totalCalls === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No LLM usage recorded yet. Run a pipeline to start tracking cost.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <Layers className="h-3.5 w-3.5" /> By phase
                  </div>
                  {usage.byPhase.length === 0 && (
                    <p className="text-xs text-muted-foreground">No phase data.</p>
                  )}
                  {usage.byPhase.map((p) => (
                    <div key={p.phase} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-foreground capitalize truncate">{p.phase}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {fmtUsd(p.cost)} · {p.calls}
                        </span>
                      </div>
                      <Progress value={(p.cost / maxPhaseCost) * 100} className="h-1.5" />
                    </div>
                  ))}
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <BrainCircuit className="h-3.5 w-3.5" /> By agent
                  </div>
                  {usage.byAgent.length === 0 && (
                    <p className="text-xs text-muted-foreground">No agent data.</p>
                  )}
                  {usage.byAgent.slice(0, 8).map((a) => (
                    <div key={a.agent} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-foreground truncate" title={a.agent}>
                          {a.agent}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {fmtUsd(a.cost)} · {a.calls}
                        </span>
                      </div>
                      <Progress value={(a.cost / maxAgentCost) * 100} className="h-1.5" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------------- Market Sizing ---------------- */}
        <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-blue-600 dark:text-blue-500" />
              Market Sizing
            </CardTitle>
            <CardDescription>TAM / SAM / SOM and recommended outreach volume per segment.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b">
                    <TableHead>Segment</TableHead>
                    <TableHead>TAM</TableHead>
                    <TableHead>SAM</TableHead>
                    <TableHead>SOM</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="text-right">Rec. vol.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {market.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        No market sizing data yet. Run the weekly market sizing pipeline to populate this.
                      </TableCell>
                    </TableRow>
                  )}
                  {market.map((m) => (
                    <TableRow key={m.id} className="border-b hover:bg-muted/50 align-top">
                      <TableCell>
                        <div className="font-medium text-slate-900 dark:text-foreground">
                          {m.segmentName || icpName.get(m.icpId) || `ICP ${m.icpId}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {icpName.get(m.icpId) || `ICP ${m.icpId}`}
                          {m.leadTotal > 0 && ` · ${m.leadTotal} leads`}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{m.tamEstimate || '—'}</TableCell>
                      <TableCell className="text-sm tabular-nums">{m.samEstimate || '—'}</TableCell>
                      <TableCell className="text-sm tabular-nums">{m.somThisMonth || '—'}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={priorityClass(m.priorityRank)}
                          title={m.priorityRationale || undefined}
                        >
                          #{m.priorityRank}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums">
                        {m.recommendedVolume.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
