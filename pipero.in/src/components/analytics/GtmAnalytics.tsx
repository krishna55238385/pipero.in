'use client'

import { BrainCircuit, Coins, Hash, Activity, Globe2, Layers } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { Icp, MarketSegment } from '@/types/gtm'

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
}: {
  usage: LlmUsageSummary
  market: MarketSegment[]
  icps: Icp[]
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
