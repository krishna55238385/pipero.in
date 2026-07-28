'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck, Users, MailWarning, Clock, CheckCircle2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { resolveCrmSyncFlag } from '@/app/actions/gtm'
import type { CrmSyncFlag, DataQualityReport } from '@/types/gtm'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const parsed = new Date(d)
  if (isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function flagTypeMeta(flagType: string): { label: string; icon: typeof Users; className: string } {
  switch (flagType) {
    case 'duplicate_contact':
      return { label: 'Duplicate contact', icon: Users, className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' }
    case 'invalid_contact':
      return { label: 'Invalid contact', icon: MailWarning, className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30' }
    case 'stale_deal':
      return { label: 'Stale deal', icon: Clock, className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' }
    default:
      return { label: flagType, icon: Users, className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' }
  }
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-slate-900 dark:text-foreground'
  if (score >= 70) return 'text-emerald-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-red-600'
}

// Agent 37 — Data Refresh
function DataQualityCard({ report }: { report: DataQualityReport | null }) {
  return (
    <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-cyan-600" />
          Data Quality
        </CardTitle>
        <CardDescription>Lead contact freshness and email deliverability, last refresh run.</CardDescription>
      </CardHeader>
      <CardContent>
        {!report ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No data refresh has run yet. Run the data refresh pipeline to populate this.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Avg quality score</div>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${scoreColor(report.avgQualityScore)}`}>
                  {report.avgQualityScore !== null ? `${report.avgQualityScore.toFixed(0)}/100` : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-border p-3">
                <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground">Bounce rate</div>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${report.bounceRate !== null && report.bounceRate > 10 ? 'text-red-600' : 'text-slate-900 dark:text-foreground'}`}>
                  {report.bounceRate !== null ? `${report.bounceRate.toFixed(1)}%` : 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{report.leadsExamined} leads examined</span>
              <span>·</span>
              <span>{report.reverifiedCount} re-verified</span>
              <span>·</span>
              <span>{report.stillStaleCount} still stale</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Last run {fmtDate(report.generatedAt)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Agent 32 — CRM Sync
function SyncFlagRow({ flag }: { flag: CrmSyncFlag }) {
  const [resolved, setResolved] = useState(false)
  const [pending, startTransition] = useTransition()
  const meta = flagTypeMeta(flag.flagType)
  const Icon = meta.icon

  if (resolved) return null

  const onResolve = () => {
    startTransition(async () => {
      const res = await resolveCrmSyncFlag(flag.id)
      if (res.ok) {
        toast.success('Flag resolved')
        setResolved(true)
      } else {
        toast.error(res.error || 'Failed to resolve flag')
      }
    })
  }

  return (
    <div className="flex items-start justify-between gap-3 border-b last:border-0 py-2.5">
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <Badge variant="outline" className={`text-[10px] ${meta.className}`}>{meta.label}</Badge>
            <span className="text-[11px] text-muted-foreground">{fmtDate(flag.detectedAt)}</span>
          </div>
          <p className="text-sm text-foreground break-words">{flag.details || '—'}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onResolve} disabled={pending} className="gap-1.5 shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5" /> {pending ? '...' : 'Resolve'}
      </Button>
    </div>
  )
}

function SyncFlagsCard({ flags }: { flags: CrmSyncFlag[] }) {
  return (
    <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-orange-600" />
          CRM Sync Flags
          {flags.length > 0 && <Badge variant="secondary" className="ml-1">{flags.length}</Badge>}
        </CardTitle>
        <CardDescription>Duplicate contacts, unverifiable contacts, and deals gone quiet — flagged, never auto-merged or deleted.</CardDescription>
      </CardHeader>
      <CardContent>
        {flags.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No open flags — CRM data hygiene looks clean.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {flags.map((f) => (
              <SyncFlagRow key={f.id} flag={f} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function DataHealth({
  qualityReport,
  syncFlags,
}: {
  qualityReport: DataQualityReport | null
  syncFlags: CrmSyncFlag[]
}) {
  return (
    <div className="space-y-6 mt-10">
      <div className="flex items-center gap-2 px-1">
        <ShieldCheck className="h-6 w-6 text-cyan-600" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-foreground">Data Health</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DataQualityCard report={qualityReport} />
        <SyncFlagsCard flags={syncFlags} />
      </div>
    </div>
  )
}
