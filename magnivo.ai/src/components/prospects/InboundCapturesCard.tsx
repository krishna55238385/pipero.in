'use client'

import { Flame, UserPlus, PauseCircle, Radio } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { InboundSignalCapture } from '@/types/gtm'

function statusMeta(status: string): { label: string; className: string; icon: typeof Flame } {
  switch (status) {
    case 'promoted':
      return { label: 'Promoted to lead', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', icon: UserPlus }
    case 'held':
      return { label: 'Held', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20', icon: PauseCircle }
    default:
      return { label: 'Candidate', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30', icon: Radio }
  }
}

function strengthClass(strength: string | null): string {
  const s = (strength || '').toLowerCase()
  if (s === 'high') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
  if (s === 'medium') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
}

export function InboundCapturesCard({ captures }: { captures: InboundSignalCapture[] }) {
  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inbound Signal Captures</CardTitle>
        <CardDescription className="text-xs">
          Companies with multiple website sessions, evaluated for promotion into a lead — never acted on below 2 sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b">
                <TableHead>Company</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead>High-intent pages</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {captures.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    No inbound signal captures yet — promotable once a visitor logs 2+ sessions.
                  </TableCell>
                </TableRow>
              )}
              {captures.map((c) => {
                const meta = statusMeta(c.status)
                const Icon = meta.icon
                return (
                  <TableRow key={c.id} className="border-b hover:bg-muted/50 align-top">
                    <TableCell>
                      <div className="font-medium">{c.companyName || c.companyDomain}</div>
                      <div className="text-xs text-muted-foreground">{c.companyDomain}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[11px] capitalize ${strengthClass(c.signalStrength)}`}>
                        {c.signalStrength || 'unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{c.sessions ?? '—'}</TableCell>
                    <TableCell>
                      {c.highIntentPagesHit ? (
                        <Badge variant="outline" className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                          <Flame className="h-3 w-3" /> Yes
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1 text-[11px] ${meta.className}`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </Badge>
                      {c.status === 'held' && c.heldReason && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{c.heldReason}</div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
