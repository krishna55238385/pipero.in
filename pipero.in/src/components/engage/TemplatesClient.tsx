'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Paperclip, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { EngageAttachment, EngageTemplate } from '@/types/engage'
import { deleteEngageTemplate, upsertEngageTemplate } from '@/app/actions/engage'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function TemplatesClient({ initialTemplates }: { initialTemplates: EngageTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [activeId, setActiveId] = useState(initialTemplates[0]?.id || '')
  const [name, setName] = useState(initialTemplates[0]?.name || '')
  const [subject, setSubject] = useState(initialTemplates[0]?.subject || '')
  const [body, setBody] = useState(initialTemplates[0]?.body || '')
  const [attachments, setAttachments] = useState<EngageAttachment[]>(initialTemplates[0]?.attachments || [])
  const [uploadingNames, setUploadingNames] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pending, startTransition] = useTransition()
  const [syncing, setSyncing] = useState(false)
  // AI template generation.
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => {
    const supabase = createSupabaseClient()
    const channel = supabase
      .channel('engage-templates-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engage_templates' }, async () => {
        setSyncing(true)
        try {
          const res = await fetch('/api/engage/templates', { cache: 'no-store' })
          const data = await res.json()
          if (res.ok && Array.isArray(data?.templates)) {
            setTemplates(data.templates)
            if (!activeId && data.templates[0]) {
              const first = data.templates[0] as EngageTemplate
              setActiveId(first.id)
              setName(first.name)
              setSubject(first.subject)
              setBody(first.body)
              setAttachments(first.attachments || [])
            }
          }
        } finally {
          setSyncing(false)
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeId])

  const select = (tpl: EngageTemplate) => {
    setActiveId(tpl.id)
    setName(tpl.name)
    setSubject(tpl.subject)
    setBody(tpl.body)
    setAttachments(tpl.attachments || [])
    setUploadError('')
  }

  const createNew = () => {
    setActiveId('')
    setName('')
    setSubject('')
    setBody('Hi {{name}},\n')
    setAttachments([])
    setUploadError('')
  }

  // AI: turn a free-form prompt into a full template (name + subject + body).
  const generateWithAI = async () => {
    if (!aiPrompt.trim()) return
    setAiError('')
    setAiLoading(true)
    try {
      const res = await fetch('/api/engage/ai/generate-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'AI generation failed')
      const genName = data.name || 'AI template'
      const genSubject = data.subject || ''
      const genBody = data.body || ''
      // Fill the editor…
      setName(genName)
      setSubject(genSubject)
      setBody(genBody)
      setAiOpen(false)
      setAiPrompt('')
      // …and save it straight away as a new template (no extra click needed).
      const localId = `local-${Date.now()}`
      const created: EngageTemplate = {
        id: localId, name: genName, subject: genSubject, body: genBody, attachments: [], updatedAt: new Date().toISOString(),
      }
      setTemplates((prev) => [created, ...prev])
      setActiveId(localId)
      setAttachments([])
      startTransition(async () => {
        try {
          await upsertEngageTemplate({ id: '', name: genName, subject: genSubject, body: genBody, attachments: [] })
        } catch {
          // local-first; realtime refetch reconciles the saved row
        }
      })
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'AI generation failed')
    } finally {
      setAiLoading(false)
    }
  }

  const del = (tpl: EngageTemplate) => {
    if (!window.confirm(`Delete template "${tpl.name}"? This can't be undone.`)) return
    setTemplates((prev) => prev.filter((p) => p.id !== tpl.id))
    if (activeId === tpl.id) createNew()
    // Unsaved (local-*) rows only live in state — nothing to delete server-side.
    if (tpl.id.startsWith('local-')) return
    startTransition(async () => {
      try {
        await deleteEngageTemplate(tpl.id)
      } catch {
        // realtime refetch keeps the list consistent with the server
      }
    })
  }

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    setUploadError('')
    const files = Array.from(fileList)
    for (const file of files) {
      setUploadingNames((prev) => [...prev, file.name])
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/engage/attachments', { method: 'POST', body: form })
        const data = await res.json()
        if (!res.ok || !data?.attachment) throw new Error(data?.error || `Failed to upload ${file.name}`)
        setAttachments((prev) => [...prev, data.attachment as EngageAttachment])
      } catch (e: unknown) {
        setUploadError(e instanceof Error ? e.message : `Failed to upload ${file.name}`)
      } finally {
        setUploadingNames((prev) => {
          const next = [...prev]
          const idx = next.indexOf(file.name)
          if (idx >= 0) next.splice(idx, 1)
          return next
        })
      }
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const save = () => {
    // Local id is only for the optimistic React-key/state row. Existing
    // templates keep their real id; new ones get a local-* placeholder.
    const localId = activeId || `local-${Date.now()}`
    const updated: EngageTemplate = { id: localId, name, subject, body, attachments, updatedAt: new Date().toISOString() }
    setTemplates((prev) => [updated, ...prev.filter((p) => p.id !== localId)])
    setActiveId(localId)
    startTransition(async () => {
      try {
        // For new templates send an empty id so the DB generates the (uuid) id;
        // sending the local-* placeholder would fail a uuid id column.
        await upsertEngageTemplate({ id: activeId || '', name, subject, body, attachments })
      } catch {
        // local-first UX
      }
    })
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:flex-1 xl:min-h-0 xl:grid-cols-[360px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
      {/* On mobile/tablet the two cards stack and scroll with the page; on xl
          they fill the bounded height and scroll internally. */}
      <Card className="rounded-2xl flex flex-col xl:min-h-0 xl:overflow-hidden">
        <CardHeader className="pb-2 flex-row items-center justify-between shrink-0">
          <CardTitle>Templates {syncing ? <span className="text-xs text-muted-foreground">(syncing...)</span> : null}</CardTitle>
          <Button type="button" size="sm" onClick={createNew}>New</Button>
        </CardHeader>
        <CardContent className="space-y-2 flex-1 xl:min-h-0 xl:overflow-auto">
          {templates.map((t) => (
            <div
              key={t.id}
              className={`flex items-start gap-2 rounded-xl border p-3 ${activeId === t.id ? 'bg-blue-500/10 border-blue-500/30' : 'hover:bg-accent/40'}`}
            >
              <button type="button" onClick={() => select(t)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{t.name}</p>
                  {t.attachments?.length ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Paperclip className="h-3 w-3" />
                      {t.attachments.length}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
              </button>
              <button
                type="button"
                onClick={() => del(t)}
                title="Delete template"
                aria-label={`Delete ${t.name}`}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {!templates.length ? <p className="text-sm text-muted-foreground">No templates yet.</p> : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl flex flex-col xl:min-h-0 xl:overflow-hidden">
        <CardHeader className="pb-2 shrink-0 flex-row items-center justify-between">
          <CardTitle>Template Editor</CardTitle>
          <Button type="button" size="sm" variant={aiOpen ? 'default' : 'outline'} onClick={() => setAiOpen((v) => !v)}>
            <Sparkles className="h-4 w-4 mr-2" />
            AI Generate
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 flex-1 xl:min-h-0 xl:overflow-auto">
          {/* AI template generator — prompt fills name + subject + body. */}
          {aiOpen ? (
            <div className="rounded-xl border bg-accent/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Describe the template you want — e.g. “follow-up nudging {'{{name}}'} at {'{{company}}'} for a 15-min call”.
              </p>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="What should this template say?"
                className="min-h-16"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generateWithAI()
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">Fills name, subject &amp; body. ⌘/Ctrl + Enter</span>
                <Button type="button" size="sm" onClick={generateWithAI} disabled={aiLoading || !aiPrompt.trim()}>
                  {aiLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  {aiLoading ? 'Generating…' : 'Generate'}
                </Button>
              </div>
              {aiError ? <p className="text-xs text-red-500">{aiError}</p> : null}
            </div>
          ) : null}
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-60" placeholder="Body (supports {{name}}, {{company}})" />

          {attachments.length || uploadingNames.length ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <span
                  key={`${a.path}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-accent/40 px-2.5 py-1 text-xs"
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="max-w-40 truncate">{a.filename}</span>
                  {typeof a.size === 'number' ? (
                    <span className="text-muted-foreground">{formatSize(a.size)}</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    aria-label={`Remove ${a.filename}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {uploadingNames.map((nameUploading, i) => (
                <span
                  key={`uploading-${nameUploading}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground"
                >
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span className="max-w-40 truncate">{nameUploading}</span>
                </span>
              ))}
            </div>
          ) : null}
          {uploadError ? <p className="text-xs text-red-500">{uploadError}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={save} disabled={pending || uploadingNames.length > 0 || !name || !subject}>
              {pending ? 'Saving...' : 'Save template'}
            </Button>
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4 mr-2" />
              Attachments
            </Button>
            <Button type="button" variant="outline" onClick={() => setBody((v) => `${v}\n{{name}}`)}>
              Insert {'{{name}}'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setBody((v) => `${v}\n{{company}}`)}>
              Insert {'{{company}}'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                uploadFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

