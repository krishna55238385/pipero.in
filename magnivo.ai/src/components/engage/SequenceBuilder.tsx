'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Trash2, FileText, Pencil, X, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { EngageSequence, EngageTemplate } from '@/types/engage'
import { createEngageSequence, deleteEngageSequence, generateSequenceWithAI, updateEngageSequence } from '@/app/actions/engage'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'

type DraftStep = { id: string; templateId: string; delayDays: number }

export default function SequenceBuilder({
  initialSequences,
  templates,
}: {
  initialSequences: EngageSequence[]
  templates: EngageTemplate[]
}) {
  const [sequences, setSequences] = useState(initialSequences)
  const [templateList, setTemplateList] = useState(templates)
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<DraftStep[]>([{ id: 's-initial', templateId: '', delayDays: 0 }])
  // null = creating a new sequence; otherwise the id of the sequence being edited.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [syncing, setSyncing] = useState(false)
  // Autonomous AI sequence builder.
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  // Keep local template list in sync if the server prop changes (re-navigation).
  useEffect(() => setTemplateList(templates), [templates])

  useEffect(() => {
    const supabase = createSupabaseClient()
    const channel = supabase
      .channel('engage-sequences-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engage_sequences' }, async () => {
        setSyncing(true)
        try {
          const res = await fetch('/api/engage/sequences', { cache: 'no-store' })
          const data = await res.json()
          if (res.ok && Array.isArray(data?.sequences)) {
            // Server is the source of truth: replace with the refetched rows and
            // drop any optimistic local-* placeholders so the saved row coming
            // back from the refetch doesn't transiently duplicate.
            const server = (data.sequences as EngageSequence[]).filter((s) => !String(s.id).startsWith('local-'))
            setSequences(server)
          }
        } finally {
          setSyncing(false)
        }
      })
      // A template created on the Templates page (or another tab) should appear
      // in the step dropdowns here without a manual reload.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engage_templates' }, async () => {
        try {
          const res = await fetch('/api/engage/templates', { cache: 'no-store' })
          const data = await res.json()
          if (res.ok && Array.isArray(data?.templates)) {
            setTemplateList(data.templates as EngageTemplate[])
          }
        } catch {
          // non-fatal — server fetch on next navigation will catch up
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const templateName = useMemo(
    () => Object.fromEntries(templateList.map((t) => [t.id, t.name])),
    [templateList]
  )

  const updateStep = (id: string, patch: Partial<DraftStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const addStep = () => setSteps((prev) => [...prev, { id: `s-${Date.now()}-${prev.length}`, templateId: '', delayDays: 1 }])
  const removeStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id))

  // Step 1 always sends immediately (delay 0); later steps wait at least 1 day.
  const normalizedDelay = (idx: number, delayDays: number) =>
    idx === 0 ? 0 : Math.max(1, Math.trunc(Number(delayDays) || 1))

  const hasTemplates = templateList.length > 0
  const canCreate = hasTemplates && !!name.trim() && steps.length > 0 && steps.every((s) => !!s.templateId)
  // Tell the user *why* the button is disabled instead of leaving them guessing.
  const disabledReason = !hasTemplates
    ? 'Create at least one template first.'
    : !name.trim()
      ? 'Give the sequence a name.'
      : !steps.every((s) => !!s.templateId)
        ? 'Pick a template for every step.'
        : ''

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setSteps([{ id: `s-reset-${Date.now()}`, templateId: '', delayDays: 0 }])
  }

  const saveSequence = () => {
    if (!canCreate) return
    const normalizedSteps = steps.map((s, idx) => ({
      id: s.id,
      templateId: s.templateId,
      delayDays: normalizedDelay(idx, s.delayDays),
    }))

    if (editingId) {
      // Edit existing — optimistic update + persist.
      setSequences((prev) => prev.map((s) => (s.id === editingId ? { ...s, name, steps: normalizedSteps } : s)))
      const id = editingId
      startTransition(async () => {
        try {
          await updateEngageSequence(id, { name, steps: normalizedSteps })
        } catch {
          // realtime refetch reconciles
        }
      })
    } else {
      const next: EngageSequence = { id: `local-${Date.now()}`, name, steps: normalizedSteps }
      setSequences((prev) => [next, ...prev])
      startTransition(async () => {
        try {
          await createEngageSequence({ name: next.name, steps: next.steps })
        } catch {
          // keep local state
        }
      })
    }
    resetForm()
  }

  // Load an existing sequence into the form for editing.
  const editSequence = (seq: EngageSequence) => {
    setEditingId(seq.id)
    setName(seq.name)
    setSteps(
      seq.steps.length
        ? seq.steps.map((s, i) => ({ id: s.id || `s-${i}`, templateId: s.templateId, delayDays: s.delayDays }))
        : [{ id: 's-initial', templateId: '', delayDays: 0 }],
    )
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const del = (seq: EngageSequence) => {
    if (!window.confirm(`Delete sequence "${seq.name}"? This can't be undone.`)) return
    setSequences((prev) => prev.filter((s) => s.id !== seq.id))
    if (editingId === seq.id) resetForm()
    if (seq.id.startsWith('local-')) return
    startTransition(async () => {
      try {
        await deleteEngageSequence(seq.id)
      } catch {
        // realtime refetch reconciles
      }
    })
  }

  // Autonomous AI: from one prompt, generate a multi-step sequence — the AI
  // decides the steps, writes each email, creates the templates, and wires them
  // into the form. The user just reviews and clicks Create.
  const generateWithAI = async () => {
    if (!aiPrompt.trim()) return
    setAiError('')
    setAiLoading(true)
    try {
      const result = await generateSequenceWithAI(aiPrompt.trim())
      setTemplateList((prev) => {
        const existing = new Set(prev.map((t) => t.id))
        const added: EngageTemplate[] = result.steps
          .filter((s) => !existing.has(s.templateId))
          .map((s) => ({ id: s.templateId, name: s.templateName, subject: '', body: '', attachments: [], updatedAt: new Date().toISOString() }))
        return [...added, ...prev]
      })
      setEditingId(null)
      setName(result.name)
      setSteps(result.steps.map((s, i) => ({ id: `ai-${i}-${Date.now()}`, templateId: s.templateId, delayDays: i === 0 ? 0 : s.delayDays })))
      setAiOpen(false)
      setAiPrompt('')
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'AI generation failed')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
          <CardTitle>{editingId ? 'Edit sequence' : 'Create sequence'}</CardTitle>
          <Button type="button" size="sm" variant={aiOpen ? 'default' : 'outline'} onClick={() => setAiOpen((v) => !v)}>
            <Sparkles className="h-4 w-4 mr-2" />
            AI Generate
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Autonomous AI sequence builder — prompt in, full sequence out. */}
          {aiOpen ? (
            <div className="rounded-xl border bg-accent/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Describe the goal — the AI picks &amp; orders your <span className="font-semibold">saved templates</span> into a sequence with sensible wait-days. e.g. “book a 15-min demo with B2B SaaS founders: intro, 2 follow-ups, breakup”.
              </p>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="What should this sequence achieve?"
                className="min-h-16"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generateWithAI()
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">Builds from your saved templates. ⌘/Ctrl + Enter</span>
                <Button type="button" size="sm" onClick={generateWithAI} disabled={aiLoading || !aiPrompt.trim()}>
                  {aiLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  {aiLoading ? 'Generating…' : 'Generate sequence'}
                </Button>
              </div>
              {aiError ? <p className="text-xs text-red-500">{aiError}</p> : null}
            </div>
          ) : null}
          {!hasTemplates ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed bg-muted/30 p-3">
              <p className="text-sm text-muted-foreground">
                You need at least one template before you can build a sequence.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/engage/templates"><FileText className="h-4 w-4 mr-2" />Create a template</Link>
              </Button>
            </div>
          ) : null}
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sequence name" />
          <div className="space-y-2">
            {steps.map((step, idx) => (
              <div key={step.id} className="rounded-xl border p-3 grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-2 items-center">
                <Select value={step.templateId} onValueChange={(v) => updateStep(step.id, { templateId: v })} disabled={!hasTemplates}>
                  <SelectTrigger><SelectValue placeholder={hasTemplates ? `Step ${idx + 1} template` : 'No templates yet'} /></SelectTrigger>
                  <SelectContent>
                    {templateList.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={idx === 0 ? 0 : 1}
                  value={idx === 0 ? 0 : step.delayDays}
                  onChange={(e) => updateStep(step.id, { delayDays: Number(e.target.value) })}
                  disabled={idx === 0}
                  title={idx === 0 ? 'The first step sends immediately' : 'Days to wait after the previous step'}
                  placeholder="Delay days"
                />
                <Button type="button" variant="outline" onClick={() => removeStep(step.id)} disabled={steps.length <= 1}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Step 1 sends immediately. Each later step waits the given number of days after the previous step.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={addStep} disabled={!hasTemplates}><Plus className="h-4 w-4 mr-2" />Add step</Button>
            <Button type="button" onClick={saveSequence} disabled={pending || !canCreate}>
              {pending ? 'Saving...' : editingId ? 'Update sequence' : 'Create sequence'}
            </Button>
            {editingId ? (
              <Button type="button" variant="ghost" onClick={resetForm}>
                <X className="h-4 w-4 mr-2" />Cancel
              </Button>
            ) : null}
            {!canCreate && disabledReason ? (
              <span className="text-xs text-muted-foreground">{disabledReason}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle>Sequences {syncing ? <span className="text-xs text-muted-foreground">(syncing...)</span> : null}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {sequences.map((s) => (
            <div
              key={s.id}
              className={`flex items-start gap-2 rounded-xl border p-3 ${editingId === s.id ? 'border-blue-500/30 bg-blue-500/5' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.steps.length} step{s.steps.length === 1 ? '' : 's'}
                  {s.steps.length > 0 ? (
                    <>
                      {' '}·{' '}
                      {s.steps
                        .map((st, i) =>
                          `${templateName[st.templateId] || 'Unknown template'}${i > 0 ? ` (+${st.delayDays}d)` : ''}`
                        )
                        .join(' → ')}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => editSequence(s)}
                  title="Edit sequence"
                  aria-label={`Edit ${s.name}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => del(s)}
                  title="Delete sequence"
                  aria-label={`Delete ${s.name}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {!sequences.length ? <p className="text-sm text-muted-foreground">No sequences yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
