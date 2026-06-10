'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Phone, Delete } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import LeadList from '@/components/dialer/LeadList'
import DialPad from '@/components/dialer/DialPad'
import CallControls from '@/components/dialer/CallControls'
import AIAssistantPanel from '@/components/dialer/AIAssistantPanel'
import CallStatusBar from '@/components/dialer/CallStatusBar'
import TranscriptPanel from '@/components/dialer/TranscriptPanel'
import CallDetailsDrawer from '@/components/dialer/CallDetailsDrawer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CallStatus, DialerLead } from '@/components/dialer/types'
import type { CallLog } from '@/components/dialer/storage'
import { listLeadsForDialer, listCallLogs, createCallLog, updateCallLog } from '@/app/actions/dialer'

export default function DialerWorkspace() {
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<DialerLead[]>([])
  const [selectedLead, setSelectedLead] = useState<DialerLead | null>(null)
  const [dialValue, setDialValue] = useState('')
  const [callStatus, setCallStatus] = useState<CallStatus>('Idle')
  const [callTimer, setCallTimer] = useState(0)
  const [notes, setNotes] = useState('')
  const [transcriptDraft, setTranscriptDraft] = useState('')
  const [muted, setMuted] = useState(false)
  const [onHold, setOnHold] = useState(false)
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const callStartedAtRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [{ leads: fetchedLeads }, logs] = await Promise.all([
          listLeadsForDialer(),
          listCallLogs(),
        ])
        if (cancelled) return
        setLeads(fetchedLeads)
        setSelectedLead(fetchedLeads[0] || null)
        setDialValue(fetchedLeads[0]?.phone || '')
        setCallLogs(logs)
      } catch (err) {
        if (!cancelled) console.error('Failed to load dialer data:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (callStatus !== 'Connected') return
    const interval = setInterval(() => {
      setCallTimer((s) => s + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [callStatus])

  useEffect(() => {
    if (!selectedLead) return
    setDialValue(selectedLead.phone)
  }, [selectedLead])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const k = e.key
      const allowed = '0123456789*#'
      if (allowed.includes(k)) {
        e.preventDefault()
        setDialValue((v) => v + k)
      } else if (k === 'Backspace') {
        e.preventDefault()
        setDialValue((v) => v.slice(0, -1))
      } else if (k === 'Enter') {
        e.preventDefault()
        if (callStatus === 'Idle' || callStatus === 'Ended') startCall()
      } else if (k === 'Escape') {
        e.preventDefault()
        endCall()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [callStatus])

  const startCall = () => {
    if (!dialValue.trim()) return
    setCallStatus('Calling')
    setCallTimer(0)
    setMuted(false)
    setOnHold(false)
    setTranscriptDraft('')
    callStartedAtRef.current = Date.now()

    // Simulate connecting after brief ringing
    setTimeout(() => {
      setCallStatus('Connected')
    }, 1700)
  }

  const endCall = () => {
    const startedAtMs = callStartedAtRef.current
    const endedAtMs = Date.now()
    if (startedAtMs) {
      const durationSeconds = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000))
      const outcome: CallLog['outcome'] = callStatus === 'Connected'
        ? 'connected'
        : 'no_answer'
      const lead = selectedLead
      ;(async () => {
        try {
          const newLog = await createCallLog({
            lead_id: lead?.id ?? null,
            lead_name: lead?.name ?? 'Unknown',
            company: lead?.company ?? '-',
            phone: dialValue,
            direction: 'outbound',
            started_at: new Date(startedAtMs).toISOString(),
            ended_at: new Date(endedAtMs).toISOString(),
            duration_seconds: durationSeconds,
            outcome,
            notes,
            transcript: transcriptDraft.trim() ? transcriptDraft.trim() : null,
          })
          setCallLogs((prev) => [newLog, ...prev])
        } catch (err) {
          console.error('Failed to save call log:', err)
        }
      })()
    }
    setCallStatus('Ended')
    setOnHold(false)
    setMuted(false)
    callStartedAtRef.current = null
  }

  const pressDial = (value: string) => setDialValue((v) => v + value)

  const leadMeta = useMemo(() => {
    if (!selectedLead) return { subtitle: 'No lead selected' }
    return { subtitle: `${selectedLead.title} · ${selectedLead.company}` }
  }, [selectedLead])

  const leadInitials = useMemo(() => {
    const n = selectedLead?.name?.trim() || ''
    if (!n) return '—'
    return n
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('')
  }, [selectedLead?.name])

  const selectedCall = useMemo(() => {
    if (!selectedCallId) return null
    return callLogs.find((c) => c.id === selectedCallId) ?? null
  }, [callLogs, selectedCallId])

  const updateCall = (id: string, patch: Partial<CallLog>) => {
    setCallLogs((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dialer Workspace</h1>
          <p className="text-sm text-muted-foreground">
            Keyboard: type numbers, <span className="font-mono">Enter</span> to call, <span className="font-mono">Esc</span> to end.
          </p>
        </div>
      </div>

      {/* Mobile: tabs for Leads / Dialer / AI */}
      <div className="xl:hidden">
        <Tabs defaultValue="dialer">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="leads">Leads</TabsTrigger>
            <TabsTrigger value="dialer">Dialer</TabsTrigger>
            <TabsTrigger value="ai">AI Assistant</TabsTrigger>
          </TabsList>
          <TabsContent value="leads" className="mt-3">
            <LeadList
              leads={leads}
              selectedLeadId={selectedLead?.id || null}
              onSelectLead={(lead) => setSelectedLead(lead)}
              loading={loading}
            />
          </TabsContent>
          <TabsContent value="dialer" className="mt-3 space-y-4">
            <Card className="rounded-2xl overflow-hidden">
              <CardHeader className="pb-2 bg-gradient-to-br from-muted/40 to-transparent">
                <CardTitle className="text-base">Call console</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-3">
                <div className="flex items-center gap-3 rounded-2xl border p-3">
                  <div className="relative">
                    <div className={`h-11 w-11 rounded-full border grid place-items-center font-semibold ${
                      callStatus === 'Calling'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                        : callStatus === 'Connected'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                          : 'bg-muted/40'
                    }`}>
                      {leadInitials}
                    </div>
                    {callStatus === 'Calling' && (
                      <span className="absolute inset-0 rounded-full animate-ping bg-amber-400/30" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{selectedLead?.name || 'No lead selected'}</p>
                    <p className="text-xs text-muted-foreground truncate">{leadMeta.subtitle}</p>
                  </div>
                </div>

                <CallStatusBar status={callStatus} timerSeconds={callTimer} />

                <div className="relative">
                  <Phone className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    value={dialValue}
                    onChange={(e) => setDialValue(e.target.value)}
                    placeholder="Enter phone number"
                    className="pl-9 pr-10 text-base rounded-2xl"
                    inputMode="tel"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setDialValue((v) => v.slice(0, -1))}
                  >
                    <Delete className="h-4 w-4" />
                  </Button>
                </div>

                <DialPad onPress={pressDial} />

                <CallControls
                  status={callStatus}
                  muted={muted}
                  onCall={startCall}
                  onEnd={endCall}
                  onMute={() => setMuted((m) => !m)}
                  onHold={() => setOnHold((h) => !h)}
                />

                {onHold && (
                  <div className="text-xs text-amber-500">Call is on hold</div>
                )}
              </CardContent>
            </Card>

            <TranscriptPanel
              value={transcriptDraft}
              onChange={setTranscriptDraft}
              disabled={callStatus === 'Idle' || loading}
              compact
            />
          </TabsContent>
          <TabsContent value="ai" className="mt-3">
            <AIAssistantPanel lead={selectedLead} notes={notes} onNotesChange={setNotes} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Desktop: 3-panel grid */}
      <div className="hidden xl:grid grid-cols-[320px_minmax(0,1fr)_360px] gap-4">
        <LeadList
          leads={leads}
          selectedLeadId={selectedLead?.id || null}
          onSelectLead={(lead) => setSelectedLead(lead)}
          loading={loading}
        />

        <div className="space-y-4">
          <Card className="rounded-2xl overflow-hidden">
            <CardHeader className="pb-2 bg-gradient-to-br from-muted/40 to-transparent">
              <CardTitle className="text-base">Call console</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl border p-3">
                <div className="relative">
                  <div className={`h-11 w-11 rounded-full border grid place-items-center font-semibold ${
                    callStatus === 'Calling'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                      : callStatus === 'Connected'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                        : 'bg-muted/40'
                  }`}>
                    {leadInitials}
                  </div>
                  {callStatus === 'Calling' && (
                    <span className="absolute inset-0 rounded-full animate-ping bg-amber-400/30" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{selectedLead?.name || 'No lead selected'}</p>
                  <p className="text-xs text-muted-foreground truncate">{leadMeta.subtitle}</p>
                </div>
              </div>

              <CallStatusBar status={callStatus} timerSeconds={callTimer} />

              <div className="relative">
                <Phone className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={dialValue}
                  onChange={(e) => setDialValue(e.target.value)}
                  placeholder="Enter phone number"
                  className="pl-9 pr-10 text-base rounded-2xl"
                  inputMode="tel"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  onClick={() => setDialValue((v) => v.slice(0, -1))}
                >
                  <Delete className="h-4 w-4" />
                </Button>
              </div>

              <DialPad onPress={pressDial} />

              <CallControls
                status={callStatus}
                muted={muted}
                onCall={startCall}
                onEnd={endCall}
                onMute={() => setMuted((m) => !m)}
                onHold={() => setOnHold((h) => !h)}
              />

              {onHold && (
                <div className="text-xs text-amber-500">Call is on hold</div>
              )}
            </CardContent>
          </Card>

          <TranscriptPanel
            value={transcriptDraft}
            onChange={setTranscriptDraft}
            disabled={callStatus === 'Idle' || loading}
            compact
          />
        </div>

        <AIAssistantPanel lead={selectedLead} notes={notes} onNotesChange={setNotes} />
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent calls</CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && callLogs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No calls yet. Completed calls will appear here.
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {callLogs.slice(0, 6).map((c) => (
            <button
              key={c.id}
              type="button"
              className="rounded-xl border p-3 text-left hover:bg-accent/40 transition-colors"
              onClick={() => {
                setSelectedCallId(c.id)
                setDetailsOpen(true)
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.leadName}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.company} · {c.phone}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  c.outcome === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                    : c.outcome === 'voicemail'
                      ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                }`}>
                  {c.outcome}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{new Date(c.startedAt).toLocaleString()}</span>
                <span className="font-mono">{Math.floor(c.durationSeconds / 60).toString().padStart(2, '0')}:{(c.durationSeconds % 60).toString().padStart(2, '0')}</span>
              </div>
              {c.hasRecording && (
                <p className="text-xs text-purple-400 mt-2">Recording available</p>
              )}
            </button>
          ))}
          </div>
          )}
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

