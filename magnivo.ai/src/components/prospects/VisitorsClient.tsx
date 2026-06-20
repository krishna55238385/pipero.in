'use client'

import { useState, useTransition } from 'react'
import { Globe, Info, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RunPhaseButton } from '@/components/prospects/run-phase-button'
import { addGa4Connection, syncGa4 } from '@/app/actions/gtm'
import type { Ga4Connection, IntentScore, VisitorSignalRow } from '@/types/gtm'

function IntentBadge({ score }: { score: IntentScore }) {
  const className =
    score === 'High'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : score === 'Medium'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
        : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
  return (
    <Badge variant="outline" className={className}>
      {score}
    </Badge>
  )
}

function formatLastSeen(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Ga4ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [propertyId, setPropertyId] = useState('')
  const [measurementId, setMeasurementId] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [lookbackDays, setLookbackDays] = useState('7')
  const [pending, startTransition] = useTransition()

  function onSubmit() {
    if (!propertyId.trim()) {
      toast.error('Property ID is required')
      return
    }
    startTransition(async () => {
      const res = await addGa4Connection({
        propertyId: propertyId.trim(),
        measurementId: measurementId.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        lookbackDays: Number(lookbackDays) || 7,
      })
      if (res.ok) {
        toast.success('GA4 property connected')
        onConnected()
      } else {
        toast.error(res.error || 'Could not connect GA4 property')
      }
    })
  }

  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4 text-blue-500" />
          Connect Google Analytics 4
        </CardTitle>
        <CardDescription>
          Link a GA4 property to pull anonymous website-visitor sessions and aggregate intent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Property ID *</Label>
            <Input
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="e.g. 123456789"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Measurement ID (optional)</Label>
            <Input
              value={measurementId}
              onChange={(e) => setMeasurementId(e.target.value)}
              placeholder="e.g. G-XXXXXXXXXX"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Website URL</Label>
            <Input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Lookback (days)</Label>
            <Input
              type="number"
              min={1}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(e.target.value)}
              placeholder="7"
              className="h-9 text-sm"
            />
          </div>
        </div>
        <Button size="sm" className="gap-1.5" onClick={onSubmit} disabled={pending}>
          <Plus className="h-4 w-4" />
          {pending ? 'Connecting…' : 'Connect property'}
        </Button>
      </CardContent>
    </Card>
  )
}

function Ga4StatusBar({ connection, onSynced }: { connection: Ga4Connection; onSynced: () => void }) {
  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
            <Globe className="h-4 w-4 text-blue-500" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">GA4 property {connection.property_id}</span>
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0"
              >
                {connection.status || 'connected'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {connection.website_url ? `${connection.website_url} · ` : ''}
              Last synced{' '}
              {connection.last_synced_at ? formatLastSeen(connection.last_synced_at) : 'never'}
            </p>
          </div>
        </div>
        <RunPhaseButton
          run={syncGa4}
          label="Sync now"
          runningLabel="Syncing…"
          icon={<RefreshCw className="h-4 w-4" />}
          variant="outline"
          poll={false}
          onDone={onSynced}
        />
      </CardContent>
    </Card>
  )
}

export function VisitorsClient({
  initialVisitors,
  initialConnections,
}: {
  initialVisitors: VisitorSignalRow[]
  initialConnections: Ga4Connection[]
}) {
  const connection = initialConnections[0] ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Anonymous Website Visitors</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Identify companies and channels driving anonymous traffic to your website.
        </p>
      </div>

      {connection ? (
        <Ga4StatusBar connection={connection} onSynced={() => window.location.reload()} />
      ) : (
        <Ga4ConnectForm onConnected={() => window.location.reload()} />
      )}

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
        <span>
          Company-level identity requires a reverse-IP / visitor-identification provider. Where a company
          cannot be resolved, the aggregate intent for the channel or landing page is shown instead.
        </span>
      </div>

      <Card className="rounded-xl border bg-card shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead>Company / Source</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Engaged</TableHead>
                  <TableHead className="text-right">Page views</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialVisitors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      No visitor signals yet. Connect a GA4 property and run a sync to populate this list.
                    </TableCell>
                  </TableRow>
                )}
                {initialVisitors.map((v) => {
                  const label = v.company || v.dimensionValue || v.domain || 'Unknown source'
                  const sub = v.company ? v.domain || v.dimensionValue : v.domain
                  return (
                    <TableRow key={v.id} className="border-b hover:bg-muted/50 align-top">
                      <TableCell>
                        <div className="font-medium">{label}</div>
                        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{v.channel || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{v.country || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.sessions.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {v.engagedSessions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {v.pageViews.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{v.visitorScore}</TableCell>
                      <TableCell>
                        <IntentBadge score={v.intentScore} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatLastSeen(v.lastSeenAt)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
