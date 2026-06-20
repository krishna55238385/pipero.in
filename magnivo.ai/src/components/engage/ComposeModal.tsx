'use client'

import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, List, Loader2, Paperclip, Sparkles, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EngageAttachment } from '@/types/engage'

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function ComposeModal({
  open,
  onOpenChange,
  seedTo,
  seedSubject,
  seedBodyHtml,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  seedTo?: string
  seedSubject?: string
  seedBodyHtml?: string
  onSent?: () => void
}) {
  const [to, setTo] = useState(seedTo || '')
  const [subject, setSubject] = useState(seedSubject || '')
  const [bodyHtml, setBodyHtml] = useState(seedBodyHtml || '<p>Hi {{name}},</p><p></p>')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [attachments, setAttachments] = useState<EngageAttachment[]>([])
  const [uploadingNames, setUploadingNames] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const editorRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      // Reset attachment + AI state so the next compose starts clean
      setAttachments([])
      setUploadingNames([])
      setUploadError('')
      setAiOpen(false)
      setAiPrompt('')
      setAiError('')
      return
    }
    if (seedTo) setTo(seedTo)
    if (seedSubject) setSubject(seedSubject)
    if (seedBodyHtml) setBodyHtml(seedBodyHtml)
  }, [open, seedTo, seedSubject, seedBodyHtml])

  // AI Generate: turn a free-form instruction into a structured {subject, body}
  // and drop them straight into the Subject field and the editor.
  const generateWithAI = async () => {
    if (!aiPrompt.trim()) return
    setAiError('')
    setAiLoading(true)
    try {
      const res = await fetch('/api/engage/ai/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt.trim(), to }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'AI generation failed')
      if (data.subject) setSubject(data.subject)
      if (data.bodyHtml) setBodyHtml(data.bodyHtml) // syncs into editorRef via effect
      setAiOpen(false)
      setAiPrompt('')
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'AI generation failed')
    } finally {
      setAiLoading(false)
    }
  }

  useEffect(() => {
    if (!editorRef.current) return
    if (editorRef.current.innerHTML !== bodyHtml) {
      editorRef.current.innerHTML = bodyHtml
    }
  }, [bodyHtml])

  const insertVariable = (v: string) => {
    if (!editorRef.current) return
    editorRef.current.focus()
    document.execCommand('insertText', false, v)
    setBodyHtml(editorRef.current.innerHTML)
  }

  const runFormat = (cmd: 'bold' | 'italic' | 'insertUnorderedList') => {
    if (!editorRef.current) return
    editorRef.current.focus()
    document.execCommand(cmd)
    setBodyHtml(editorRef.current.innerHTML)
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

  const send = async () => {
    setError('')
    setSending(true)
    try {
      const res = await fetch('/api/engage/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, bodyHtml, attachments }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Send failed')
      onOpenChange(false)
      onSent?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-2xl (prefixed) so tailwind-merge overrides the base dialog's
          sm:max-w-lg — an unprefixed max-w-* silently loses to it at sm+. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compose email</DialogTitle>
          <DialogDescription>Attachments and Gmail-backed send.</DialogDescription>
        </DialogHeader>

        {/* min-w-0 lets this grid child shrink instead of letting the
            non-wrapping toolbar below push the inputs past the card edge. */}
        <div className="space-y-3 min-w-0">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" />
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => insertVariable('{{name}}')}>
              Insert {'{{name}}'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => insertVariable('{{company}}')}>
              Insert {'{{company}}'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4 mr-2" />
              Attachments
            </Button>
            <Button
              type="button"
              size="sm"
              variant={aiOpen ? 'default' : 'outline'}
              onClick={() => setAiOpen((v) => !v)}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              AI Generate
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

          {/* AI prompt box — type an instruction, AI fills Subject + body. */}
          {aiOpen ? (
            <div className="rounded-xl border bg-accent/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Describe the email you want — e.g. “short intro asking {'{{name}}'} for a 15-min call about our AI outreach tool”.
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="What should this email say?"
                rows={2}
                className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generateWithAI()
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Fills the Subject and body below. ⌘/Ctrl + Enter
                </span>
                <Button type="button" size="sm" onClick={generateWithAI} disabled={aiLoading || !aiPrompt.trim()}>
                  {aiLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  {aiLoading ? 'Generating…' : 'Generate'}
                </Button>
              </div>
              {aiError ? <p className="text-xs text-red-500">{aiError}</p> : null}
            </div>
          ) : null}

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

          <div className="rounded-xl border p-2 space-y-2">
            <div className="flex items-center gap-1 border-b pb-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => runFormat('bold')}><Bold className="h-4 w-4" /></Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => runFormat('italic')}><Italic className="h-4 w-4" /></Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => runFormat('insertUnorderedList')}><List className="h-4 w-4" /></Button>
            </div>
            <div
              ref={editorRef}
              contentEditable
              onInput={(e) => setBodyHtml((e.target as HTMLDivElement).innerHTML)}
              className="min-h-56 outline-none text-sm"
              suppressContentEditableWarning
            />
          </div>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={send} disabled={sending || uploadingNames.length > 0 || !to || !subject || !bodyHtml}>
            {sending ? 'Sending...' : 'Send email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

