'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getPhaseRun, getPhaseRuns } from '@/app/actions/gtm'
import type { PhaseRun } from '@/types/gtm'

function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  const cls =
    s === 'succeeded'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : s === 'failed'
        ? 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30'
        : s === 'running'
          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30'
          : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
  return (
    <Badge variant="outline" className={`${cls} capitalize text-[11px]`}>
      {s === 'running' || s === 'queued' ? (
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
      ) : null}
      {status || 'queued'}
    </Badge>
  )
}

function formatTime(value: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Pull the most informative single line out of a log blob (the actual error). */
export function lastMeaningfulLine(logs: string | null | undefined): string | null {
  if (!logs) return null
  const lines = logs
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^[~^\s]+$/.test(l)) // skip caret/underline frames
  if (!lines.length) return null
  // Prefer a Python exception or an explicit error line.
  const errLine = [...lines].reverse().find(
    (l) =>
      /error|exception|traceback|invalid|failed|denied|forbidden|unauthorized|quota|401|403|429|500/i.test(l),
  )
  return errLine || lines[lines.length - 1]
}

export function PipelineRunsPanel({
  initialRuns,
  title = 'Recent pipeline runs',
  description = 'Live status, errors and full logs for every pipeline run.',
}: {
  initialRuns: PhaseRun[]
  title?: string
  description?: string
}) {
  const [runs, setRuns] = useState<PhaseRun[]>(initialRuns)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, PhaseRun | null>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const expandedRef = useRef<string | null>(null)
  expandedRef.current = expanded

  const hasActive = runs.some((r) => r.status === 'running' || r.status === 'queued')

  // Live poll so a run appears + advances (queued → running → succeeded/failed)
  // without any manual reload. Faster cadence while something is active.
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const fresh = await getPhaseRuns(20)
        if (stopped) return
        setRuns(fresh)
        const exp = expandedRef.current
        if (exp) {
          const d = await getPhaseRun(exp)
          if (!stopped) setDetail((prev) => ({ ...prev, [exp]: d }))
        }
      } catch {
        /* transient network hiccup — next tick retries */
      }
    }
    const interval = setInterval(tick, hasActive ? 3500 : 12000)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [hasActive])

  async function loadDetail(id: string, force = false) {
    if (!force && detail[id]) return
    setLoadingId(id)
    try {
      const d = await getPhaseRun(id)
      setDetail((prev) => ({ ...prev, [id]: d }))
    } finally {
      setLoadingId(null)
    }
  }

  function toggle(run: PhaseRun) {
    if (expanded === run.id) {
      setExpanded(null)
      return
    }
    setExpanded(run.id)
    void loadDetail(run.id)
  }

  function manualRefresh() {
    startTransition(async () => {
      setRuns(await getPhaseRuns(20))
      if (expanded) await loadDetail(expanded, true)
    })
  }

  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            {title}
            {hasActive && (
              <span className="flex items-center gap-1 text-[11px] font-normal text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" /> live
              </span>
            )}
          </CardTitle>
          <CardDescription className="text-xs">{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={manualRefresh} disabled={pending}>
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No pipeline runs yet. Trigger one above and it will stream here.
          </p>
        ) : (
          runs.map((run) => {
            const isOpen = expanded === run.id
            const d = detail[run.id]
            const errorOneLine = run.error || (d ? lastMeaningfulLine(d.logs) : null)
            return (
              <div key={run.id} className="rounded-lg border bg-muted/30 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(run)}
                  className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="pt-0.5 shrink-0 text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium capitalize">{run.phase || 'run'}</span>
                      <StatusBadge status={run.status} />
                      <span className="text-xs text-muted-foreground">{formatTime(run.started_at || run.created_at)}</span>
                    </div>
                    {run.command && (
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono truncate" title={run.command}>
                        {run.command}
                      </p>
                    )}
                    {run.status === 'failed' && errorOneLine && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 break-words font-medium">
                        {errorOneLine}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 pt-0.5">
                    {isOpen ? 'Hide logs' : 'View logs'}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t bg-slate-950 px-3 py-2.5">
                    {loadingId === run.id && !d ? (
                      <div className="flex items-center gap-2 text-slate-400 text-xs py-3">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading logs…
                      </div>
                    ) : (
                      <>
                        {d?.error && (
                          <div className="mb-2 text-[11px] text-red-400 font-mono">error: {d.error}</div>
                        )}
                        <pre className="text-[11px] leading-relaxed text-slate-200 font-mono whitespace-pre-wrap break-words max-h-96 overflow-auto">
                          {d?.logs?.trim()
                            ? d.logs
                            : run.status === 'running' || run.status === 'queued'
                              ? '⏳ running — logs will stream here as the pipeline prints them…'
                              : '(no console output captured for this run)'}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
