'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Filter, PhoneCall, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { CallLog } from '@/components/dialer/storage'
import { listCallLogs, updateCallLog } from '@/app/actions/dialer'
import CallHistoryTable from '@/components/dialer/CallHistoryTable'
import CallDetailsDrawer from '@/components/dialer/CallDetailsDrawer'
import FilterPresets, { type DialerFilters } from '@/components/dialer/FilterPresets'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function formatTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const secs = (totalSeconds % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

export default function DialerDashboardClient() {
  const [logs, setLogs] = useState<CallLog[]>([])
  const [q, setQ] = useState('')
  const [outcome, setOutcome] = useState<'all' | CallLog['outcome']>('all')
  const [direction, setDirection] = useState<'all' | CallLog['direction']>('all')
  const [range, setRange] = useState<'all' | 'today' | '7d' | '30d'>('7d')
  const [recordingOnly, setRecordingOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'longest' | 'shortest'>('newest')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fetched = await listCallLogs()
        if (!cancelled) setLogs(fetched)
      } catch (err) {
        if (!cancelled) console.error('Failed to load call logs:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedCall = useMemo(() => {
    if (!selectedCallId) return null
    return logs.find((c) => c.id === selectedCallId) ?? null
  }, [logs, selectedCallId])

  const updateCall = (id: string, patch: Partial<CallLog>) => {
    setLogs((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    const dbPatch: Parameters<typeof updateCallLog>[1] = {}
    if ('notes' in patch) dbPatch.notes = patch.notes ?? null
    if ('transcript' in patch) dbPatch.transcript = patch.transcript ?? null
    if ('summary' in patch) dbPatch.summary = patch.summary ?? null
    if ('ai_generated_at' in patch) dbPatch.ai_generated_at = patch.ai_generated_at ?? null
    if ('tags' in patch) dbPatch.tags = patch.tags ?? null
    if ('scorecard' in patch) dbPatch.scorecard = patch.scorecard ?? null
    if ('recordingUrl' in patch) dbPatch.recording_url = patch.recordingUrl ?? null
    if (Object.keys(dbPatch).length === 0) return
    updateCallLog(id, dbPatch).catch((err) => console.error('Failed to update call log:', err))
  }

  const currentFilters: DialerFilters = useMemo(
    () => ({ q, outcome, direction, range, recordingOnly }),
    [q, outcome, direction, range, recordingOnly]
  )

  const applyFilters = (f: DialerFilters) => {
    setQ(f.q)
    setOutcome(f.outcome as any)
    setDirection(f.direction as any)
    setRange(f.range as any)
    setRecordingOnly(Boolean(f.recordingOnly))
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const now = new Date()
    return logs
      .filter((l) => {
        if (needle && !`${l.leadName} ${l.company} ${l.phone}`.toLowerCase().includes(needle)) return false
        if (outcome !== 'all' && l.outcome !== outcome) return false
        if (direction !== 'all' && l.direction !== direction) return false
        if (recordingOnly && !l.hasRecording) return false
        if (range !== 'all') {
          const started = new Date(l.startedAt)
          if (range === 'today') {
            if (started.toDateString() !== now.toDateString()) return false
          } else if (range === '7d') {
            if (started.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) return false
          } else if (range === '30d') {
            if (started.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) return false
          }
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        if (sortBy === 'longest') return b.durationSeconds - a.durationSeconds
        return a.durationSeconds - b.durationSeconds
      })
  }, [logs, q, outcome, direction, range, recordingOnly, sortBy])

  const kpis = useMemo(() => {
    const total = filtered.length
    const connected = filtered.filter(l => l.outcome === 'connected').length
    const recordings = filtered.filter(l => l.hasRecording).length
    const totalSeconds = filtered.reduce((sum, l) => sum + (l.durationSeconds || 0), 0)
    const avg = total ? Math.round(totalSeconds / total) : 0
    const connectRate = total ? Math.round((connected / total) * 100) : 0
    return { total, connected, recordings, avg, connectRate }
  }, [filtered])

  const chartData = useMemo(() => {
    const dayMap = new Map<string, { day: string; calls: number; connected: number }>()
    filtered.forEach((l) => {
      const key = new Date(l.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const prev = dayMap.get(key) || { day: key, calls: 0, connected: 0 }
      prev.calls += 1
      if (l.outcome === 'connected') prev.connected += 1
      dayMap.set(key, prev)
    })
    return Array.from(dayMap.values()).slice(-10)
  }, [filtered])

  return (
    <div className="space-y-4">
      <Tabs defaultValue="overview">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="overview">
            <PhoneCall className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="coaching">
            <Badge variant="outline">Coach</Badge>
            Coaching mode
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Total calls</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{kpis.total}</CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Connected</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{kpis.connected}</CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recordings</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{kpis.recordings}</CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Avg duration</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{formatTime(kpis.avg)}</CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Connect rate</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{kpis.connectRate}%</CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FilterPresets current={currentFilters} onApply={applyFilters} />
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                <div className="md:col-span-2 relative">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by lead/company/phone" />
                </div>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as any)}>
                  <SelectTrigger><SelectValue placeholder="Outcome" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All outcomes</SelectItem>
                    <SelectItem value="connected">Connected</SelectItem>
                    <SelectItem value="no_answer">No answer</SelectItem>
                    <SelectItem value="voicemail">Voicemail</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
                  <SelectTrigger><SelectValue placeholder="Direction" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All directions</SelectItem>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={range} onValueChange={(v) => setRange(v as any)}>
                  <SelectTrigger><SelectValue placeholder="Date range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All time</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant={recordingOnly ? 'default' : 'outline'} size="sm" onClick={() => setRecordingOnly((v) => !v)}>
                  <Filter className="h-4 w-4 mr-2" /> Recording only
                </Button>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Sort: Newest</SelectItem>
                    <SelectItem value="longest">Sort: Longest</SelectItem>
                    <SelectItem value="shortest">Sort: Shortest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Call trend</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="day" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="calls" fill="#6366f1" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="connected" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Quality signals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <span className="text-muted-foreground">Calls with transcripts</span>
                  <span className="font-mono">{filtered.filter((x) => Boolean(x.transcript?.trim())).length}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <span className="text-muted-foreground">Calls with summaries</span>
                  <span className="font-mono">{filtered.filter((x) => Boolean(x.summary)).length}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <span className="text-muted-foreground">Connected longer than 2m</span>
                  <span className="font-mono">{filtered.filter((x) => x.outcome === 'connected' && x.durationSeconds >= 120).length}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Call history</CardTitle>
            </CardHeader>
            <CardContent>
              <CallHistoryTable
                rows={filtered}
                enableBulk
                onRowClick={(row) => {
                  setSelectedCallId(row.id)
                  setDetailsOpen(true)
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="coaching" className="space-y-4">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Coaching mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Focus on calls with transcripts/summaries. Click a row to open the drilldown drawer.
              </p>
              <CallHistoryTable
                rows={filtered.filter((x) => x.outcome === 'connected').slice(0, 50)}
                enableBulk
                onRowClick={(row) => {
                  setSelectedCallId(row.id)
                  setDetailsOpen(true)
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CallDetailsDrawer
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        call={selectedCall}
        onUpdateCall={updateCall}
      />
    </div>
  )
}

