'use client'

import { useMemo, useState } from 'react'
import { Swords, Target, ShieldAlert, Globe } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toText, toTextList } from '@/lib/gtm-render'
import type { CompetitorIntel, Icp } from '@/types/gtm'

function threatClass(level: string): string {
  switch ((level || '').toLowerCase()) {
    case 'high':
      return 'border-rose-300 text-rose-600 bg-rose-50 dark:bg-rose-950/30'
    case 'low':
      return 'border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'
    default:
      return 'border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/30'
  }
}

function CompetitorCard({ c }: { c: CompetitorIntel }) {
  return (
    <Card className="rounded-xl border bg-card shadow-sm flex flex-col min-w-0">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2 min-w-0">
            <Swords className="h-4 w-4 text-rose-500 shrink-0" />
            <span className="truncate">{c.competitorName}</span>
          </CardTitle>
          <Badge variant="outline" className={`capitalize shrink-0 ${threatClass(c.threatLevel)}`}>
            {c.threatLevel || 'unknown'} threat
          </Badge>
        </div>
        {c.competitorDomain && (
          <a
            href={c.competitorDomain.startsWith('http') ? c.competitorDomain : `https://${c.competitorDomain}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
          >
            <Globe className="h-3 w-3" /> {c.competitorDomain}
          </a>
        )}
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 pt-0">
        {c.summary && <p className="text-sm text-foreground/90 break-words">{c.summary}</p>}

        {c.complaintCategories.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Complaint themes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.complaintCategories.map((cat, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-[10px] bg-muted/40 capitalize"
                  title={toTextList(cat.top_complaints).join(' • ')}
                >
                  {toText(cat.category)}
                  {cat.severity ? ` · ${toText(cat.severity)}` : ''}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> Biggest weakness
          </div>
          <p className="text-sm text-foreground break-words">{c.biggestWeakness || '—'}</p>
        </div>

        {(c.whoLovesThem || c.whoHatesThem) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {c.whoLovesThem && (
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">Who loves them</div>
                <p className="text-xs text-foreground/80 break-words">{c.whoLovesThem}</p>
              </div>
            )}
            {c.whoHatesThem && (
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-rose-600">Who hates them</div>
                <p className="text-xs text-foreground/80 break-words">{c.whoHatesThem}</p>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Talk tracks</div>
          {c.talkTracks.length > 0 ? (
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
  )
}

export function CompetitorsClient({
  icps,
  competitorsByIcp,
}: {
  icps: Icp[]
  competitorsByIcp: Record<number, CompetitorIntel[]>
}) {
  // Default to the first ICP that actually has competitor intelligence.
  const defaultIcp = useMemo(() => {
    const withData = icps.find((i) => (competitorsByIcp[i.id]?.length ?? 0) > 0)
    return (withData ?? icps[0])?.id ?? null
  }, [icps, competitorsByIcp])

  const [selected, setSelected] = useState<number | null>(defaultIcp)
  const competitors = selected != null ? competitorsByIcp[selected] ?? [] : []

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competitors</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Competitive intelligence per Ideal Customer Profile — weaknesses, complaint themes, and talk tracks
          your reps can use against each rival.
        </p>
      </div>

      {icps.length === 0 ? (
        <Card className="rounded-xl border bg-card">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Target className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No ICPs yet. Create an ICP and run competitive analysis to populate this view.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {icps.map((icp) => {
              const count = competitorsByIcp[icp.id]?.length ?? 0
              const isActive = icp.id === selected
              return (
                <button
                  key={icp.id}
                  onClick={() => setSelected(icp.id)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'border-border bg-card hover:bg-muted/50 text-foreground'
                  }`}
                >
                  <Target className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate max-w-[200px]">{icp.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {count}
                  </Badge>
                </button>
              )
            })}
          </div>

          {competitors.length === 0 ? (
            <Card className="rounded-xl border bg-card">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                <Swords className="h-8 w-8 mx-auto mb-3 opacity-40" />
                No competitor intelligence for this ICP yet. Run Phase 2 competitive analysis to populate it.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {competitors.map((c) => (
                <CompetitorCard key={c.id} c={c} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
