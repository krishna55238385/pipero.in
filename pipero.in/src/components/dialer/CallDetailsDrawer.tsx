"use client"

import { useMemo, useState, useTransition } from "react"
import { Sparkles, Tags, ClipboardList, MessageSquareText, ShieldAlert } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { CallLog } from "@/components/dialer/storage"
import { summarizeDialerCall } from "@/app/actions/dialer-ai"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  call: CallLog | null
  onUpdateCall: (id: string, patch: Partial<CallLog>) => void
}

function formatScore(v: unknown) {
  if (typeof v !== "number") return "—"
  return String(v)
}

export default function CallDetailsDrawer({ open, onOpenChange, call, onUpdateCall }: Props) {
  const [tagDraft, setTagDraft] = useState("")
  const [isPending, startTransition] = useTransition()

  const canSummarize = useMemo(() => {
    if (!call) return false
    return Boolean(call.transcript && call.transcript.trim().length > 20)
  }, [call])

  const onAddTag = () => {
    if (!call) return
    const next = tagDraft.trim()
    if (!next) return
    const tags = Array.from(new Set([...(call.tags ?? []), next])).slice(0, 25)
    onUpdateCall(call.id, { tags })
    setTagDraft("")
  }

  const onRemoveTag = (t: string) => {
    if (!call) return
    onUpdateCall(call.id, { tags: (call.tags ?? []).filter((x) => x !== t) })
  }

  const generateSummary = () => {
    if (!call) return
    if (!canSummarize) return
    startTransition(async () => {
      try {
        const res = await summarizeDialerCall({
          transcript: call.transcript ?? "",
          lead: { name: call.leadName, company: call.company, phone: call.phone },
        })
        // onUpdateCall persists summary + ai_generated_at to the DB via updateCallLog.
        onUpdateCall(call.id, { summary: res, ai_generated_at: new Date().toISOString() })
      } catch (err) {
        console.error("Failed to generate call summary:", err)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed right-0 top-0 left-auto bottom-0 h-[100dvh] w-[min(720px,100vw)] max-w-none translate-x-0 translate-y-0 rounded-none border-l p-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
        showCloseButton
      >
        <div className="h-full flex flex-col">
          <DialogHeader className="px-5 py-4 border-b">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle className="truncate">{call ? call.leadName : "Call details"}</DialogTitle>
                {call ? (
                  <p className="text-xs text-muted-foreground truncate">
                    {call.company} · {call.phone} · {new Date(call.startedAt).toLocaleString()}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No call selected</p>
                )}
              </div>
              {call ? (
                <Badge
                  variant={call.outcome === "connected" ? "secondary" : "outline"}
                  className={call.outcome === "connected" ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10" : ""}
                >
                  {call.outcome}
                </Badge>
              ) : null}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto px-5 py-4">
            <Tabs defaultValue="summary">
              <TabsList variant="line" className="w-full justify-start">
                <TabsTrigger value="summary">
                  <Sparkles />
                  Summary
                </TabsTrigger>
                <TabsTrigger value="transcript">
                  <MessageSquareText />
                  Transcript
                </TabsTrigger>
                <TabsTrigger value="notes">
                  <ClipboardList />
                  Notes
                </TabsTrigger>
                <TabsTrigger value="coaching">
                  <ShieldAlert />
                  Coaching
                </TabsTrigger>
                <TabsTrigger value="tags">
                  <Tags />
                  Tags
                </TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">AI summary</div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={generateSummary}
                    disabled={!call || !canSummarize || isPending}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {isPending ? "Generating…" : call?.summary ? "Regenerate" : "Generate"}
                  </Button>
                </div>
                {!call ? (
                  <div className="text-sm text-muted-foreground">Select a call to view details.</div>
                ) : !canSummarize ? (
                  <div className="text-sm text-muted-foreground">
                    Add a transcript (live or pasted) to generate a summary.
                  </div>
                ) : call.summary ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border p-3">
                      <p className="text-sm leading-relaxed">{call.summary.overview}</p>
                      {call.ai_generated_at ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          AI generated: {new Date(call.ai_generated_at).toLocaleString()}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border p-3">
                        <p className="text-xs font-medium mb-2">Key points</p>
                        <ul className="text-sm space-y-1 list-disc pl-5">
                          {(call.summary.key_points ?? []).map((x, idx) => (
                            <li key={idx}>{x}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-xl border p-3">
                        <p className="text-xs font-medium mb-2">Next steps</p>
                        <ul className="text-sm space-y-1 list-disc pl-5">
                          {(call.summary.next_steps ?? []).map((x, idx) => (
                            <li key={idx}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border p-3">
                        <p className="text-xs font-medium mb-2">Objections</p>
                        {(call.summary.objections ?? []).length ? (
                          <ul className="text-sm space-y-1 list-disc pl-5">
                            {(call.summary.objections ?? []).map((x, idx) => (
                              <li key={idx}>{x}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">None detected</p>
                        )}
                      </div>
                      <div className="rounded-xl border p-3">
                        <p className="text-xs font-medium mb-2">Signals</p>
                        <div className="flex flex-wrap gap-2">
                          {call.summary.sentiment ? (
                            <Badge variant="outline">Sentiment: {call.summary.sentiment}</Badge>
                          ) : null}
                          {(call.summary.risk_flags ?? []).map((x, idx) => (
                            <Badge key={idx} variant="outline">
                              {x}
                            </Badge>
                          ))}
                          {!call.summary.sentiment && !(call.summary.risk_flags ?? []).length ? (
                            <p className="text-sm text-muted-foreground">—</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No summary yet.</div>
                )}
              </TabsContent>

              <TabsContent value="transcript" className="mt-4 space-y-2">
                <div className="text-sm font-medium">Transcript</div>
                <Textarea
                  value={call?.transcript ?? ""}
                  onChange={(e) => call && onUpdateCall(call.id, { transcript: e.target.value })}
                  placeholder="Paste transcript here…"
                  className="min-h-64"
                  disabled={!call}
                />
              </TabsContent>

              <TabsContent value="notes" className="mt-4 space-y-2">
                <div className="text-sm font-medium">Notes</div>
                <Textarea
                  value={call?.notes ?? ""}
                  onChange={(e) => call && onUpdateCall(call.id, { notes: e.target.value })}
                  placeholder="Notes…"
                  className="min-h-52"
                  disabled={!call}
                />
              </TabsContent>

              <TabsContent value="coaching" className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border p-3">
                    <p className="text-xs font-medium mb-2">Scorecard</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Talk ratio</span>
                        <span className="font-mono">{formatScore(call?.scorecard?.talk_ratio)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Clarity</span>
                        <span className="font-mono">{formatScore(call?.scorecard?.clarity)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Empathy</span>
                        <span className="font-mono">{formatScore(call?.scorecard?.empathy)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Next step set</span>
                        <span className="font-mono">{call?.scorecard?.next_step_set ? "yes" : "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border p-3">
                    <p className="text-xs font-medium mb-2">Coaching prompts</p>
                    <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
                      <li>Confirm decision maker + timeline.</li>
                      <li>Ask 1 quant question (volume, SLA, conversion).</li>
                      <li>Close with a calendarized next step.</li>
                    </ul>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="tags" className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    placeholder="Add tag (e.g., pricing, demo, objection)"
                    disabled={!call}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        onAddTag()
                      }
                    }}
                  />
                  <Button type="button" onClick={onAddTag} disabled={!call || !tagDraft.trim()}>
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(call?.tags ?? []).length ? (
                    (call?.tags ?? []).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onRemoveTag(t)}
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-full"
                        disabled={!call}
                        title="Remove tag"
                      >
                        <Badge variant="outline" className="hover:bg-accent">
                          {t}
                          <span className="ml-1 opacity-60">×</span>
                        </Badge>
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No tags yet.</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

