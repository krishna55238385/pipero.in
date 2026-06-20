'use client'

import {
  Banknote,
  Building2,
  ExternalLink,
  Flame,
  Newspaper,
  Radio,
  Rocket,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { RunPhaseButton } from '@/components/prospects/run-phase-button'
import { runGenerateSignals } from '@/app/actions/gtm'
import { signalLabel, type BuyingSignalRow, type SignalTypeSummary } from '@/types/gtm'

// The signal types the user always wants visible, even at zero count.
const PINNED_TYPES = ['funding', 'product', 'acquisition', 'layoffs', 'keywords'] as const

const TYPE_DESCRIPTIONS: Record<string, string> = {
  funding: 'Companies announcing new funding rounds or raising capital',
  product: 'Companies launching new products or services',
  product_launch: 'Companies launching new products or services',
  acquisition: 'Companies announcing acquisitions or getting acquired',
  layoffs: 'Companies announcing layoffs or workforce reductions',
  hiring: 'Companies making important leadership or executive hires',
  key_hire: 'Companies making important leadership or executive hires',
  expansion: 'Companies expanding to new locations or opening offices',
  partnership: 'Companies announcing new partnerships or collaborations',
  awards: 'Companies receiving awards or industry recognition',
  keywords: 'Target keywords getting news coverage',
  news: 'Target keywords getting news coverage',
  leadership_change: 'Leadership or executive changes at target accounts',
}

function typeIcon(type: string) {
  switch (type) {
    case 'funding':
      return Banknote
    case 'product':
    case 'product_launch':
      return Rocket
    case 'acquisition':
      return Building2
    case 'layoffs':
    case 'hiring':
    case 'key_hire':
    case 'leadership_change':
      return Users
    case 'keywords':
    case 'news':
      return Newspaper
    default:
      return Radio
  }
}

function typeDescription(type: string): string {
  return TYPE_DESCRIPTIONS[type] || `Buying signals of type "${signalLabel(type)}"`
}

function isHigh(intent: string | null): boolean {
  return (intent || '').toLowerCase() === 'high'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function IntentBadge({ high }: { high: boolean }) {
  return high ? (
    <Badge
      variant="outline"
      className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
    >
      <Flame className="h-3 w-3" />
      High
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
    >
      Low
    </Badge>
  )
}

export function SignalsClient({
  summary,
  recent,
}: {
  summary: SignalTypeSummary[]
  recent: BuyingSignalRow[]
}) {
  // Merge the live summary with the pinned types so the 5 the user cares about
  // always render — even when their count is zero.
  const byType = new Map<string, SignalTypeSummary>()
  for (const s of summary) byType.set(s.type, s)
  for (const t of PINNED_TYPES) {
    if (!byType.has(t)) {
      byType.set(t, { type: t, label: signalLabel(t), count: 0, highIntent: 0, lastDetected: null })
    }
  }
  const cards = Array.from(byType.values()).sort((a, b) => b.count - a.count)

  const totalSignals = summary.reduce((acc, s) => acc + s.count, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Buying Signals</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {totalSignals > 0
              ? `${totalSignals.toLocaleString()} signal${totalSignals === 1 ? '' : 's'} detected across your prospects — funding, launches, acquisitions, layoffs and news.`
              : 'Detected buying signals across your prospects — funding, launches, acquisitions, layoffs and news.'}
          </p>
        </div>
        {/* Manual refresh: regenerate buying signals for ALL leads (org-wide). */}
        <RunPhaseButton
          run={() => runGenerateSignals()}
          label="Generate signals"
          runningLabel="Scanning…"
          icon={<Radio className="h-4 w-4" />}
          onDone={() => { if (typeof window !== 'undefined') window.location.reload() }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = typeIcon(c.type)
          return (
            <Card key={c.type} className="rounded-xl border bg-card shadow-sm flex flex-col">
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base leading-tight flex items-center gap-2">
                    <Icon className="h-4 w-4 text-blue-500 shrink-0" />
                    <span className="truncate">{signalLabel(c.type)}</span>
                  </CardTitle>
                  <CardDescription className="text-sm mt-1.5">{typeDescription(c.type)}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0 mt-auto">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums text-foreground">
                      {c.count.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      signal{c.count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {c.highIntent > 0 && (
                      <Badge
                        variant="outline"
                        className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                      >
                        <Flame className="h-3 w-3" />
                        {c.highIntent} high-intent
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {c.lastDetected ? `Last ${formatDate(c.lastDetected)}` : 'None yet'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="rounded-xl border bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent signals</CardTitle>
          <CardDescription className="text-xs">
            Latest buying signals detected across your prospect accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead>Company</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-[120px]">Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      No buying signals detected yet. Run a pipeline from the ICP or Leads page to start
                      tracking funding, launches, acquisitions and news.
                    </TableCell>
                  </TableRow>
                )}
                {recent.map((s) => (
                  <TableRow key={s.id} className="border-b hover:bg-muted/50 align-top">
                    <TableCell className="font-medium">{s.company || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1 text-[11px] whitespace-nowrap">
                        <Radio className="h-3 w-3 text-blue-500" />
                        {signalLabel(s.signalType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[360px]">
                      <span className="text-sm text-muted-foreground line-clamp-2">
                        {s.summary || s.text || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <IntentBadge high={isHigh(s.intent)} />
                    </TableCell>
                    <TableCell>
                      {s.sourceUrl ? (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                        >
                          Source
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatDate(s.detectedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
