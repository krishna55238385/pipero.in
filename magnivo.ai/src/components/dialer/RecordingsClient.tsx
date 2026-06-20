'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CallLog } from '@/components/dialer/storage'
import { listCallLogs, updateCallLog } from '@/app/actions/dialer'
import CallHistoryTable from '@/components/dialer/CallHistoryTable'
import CallDetailsDrawer from '@/components/dialer/CallDetailsDrawer'

export default function RecordingsClient() {
  const [logs, setLogs] = useState<CallLog[]>([])
  const [q, setQ] = useState('')
  const [range, setRange] = useState<'all' | 'today' | '7d' | '30d'>('30d')
  const [minDuration, setMinDuration] = useState<'all' | '30' | '60' | '120'>('30')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'longest'>('newest')
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

  const recordings = useMemo(() => logs.filter(l => l.hasRecording), [logs])

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const now = new Date()
    const min = minDuration === 'all' ? 0 : Number(minDuration)
    return recordings
      .filter((r) => {
        if (needle && !`${r.leadName} ${r.company} ${r.phone}`.toLowerCase().includes(needle)) return false
        if (min && r.durationSeconds < min) return false
        if (range !== 'all') {
          const started = new Date(r.startedAt)
          if (range === 'today' && started.toDateString() !== now.toDateString()) return false
          if (range === '7d' && started.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) return false
          if (range === '30d' && started.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        if (sortBy === 'oldest') return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
        return b.durationSeconds - a.durationSeconds
      })
  }, [recordings, q, range, minDuration, sortBy])

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recordings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recordings" />
            </div>
            <Select value={range} onValueChange={(v) => setRange(v as any)}>
              <SelectTrigger><SelectValue placeholder="Date range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Select value={minDuration} onValueChange={(v) => setMinDuration(v as any)}>
              <SelectTrigger><SelectValue placeholder="Min duration" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any duration</SelectItem>
                <SelectItem value="30">≥ 00:30</SelectItem>
                <SelectItem value="60">≥ 01:00</SelectItem>
                <SelectItem value="120">≥ 02:00</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="longest">Longest</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {filtered.length} recordings
            </span>
          </div>

          {filtered.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No recordings yet.
            </div>
          )}

          {filtered.length ? (
            <CallHistoryTable
              rows={filtered}
              enableBulk
              onRowClick={(row) => {
                setSelectedCallId(row.id)
                setDetailsOpen(true)
              }}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-dashed">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Next: attach real recording URLs from a calling provider and enable waveform + playback.
        </CardContent>
      </Card>

      <CallDetailsDrawer
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        call={selectedCall}
        onUpdateCall={updateCall}
      />
    </div>
  )
}

