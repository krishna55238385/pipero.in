'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createContentItem, type ContentType, type FunnelStage } from '@/app/actions/content-intelligence'

const DEFAULT_BODY = {
  type: 'markdown',
  markdown: `Hi {{name}},\n\nQuick question — are you evaluating options for {{company}} right now?\n\nIf yes, I can share a short 2-minute overview and examples relevant to your industry.\n\nBest,\n{{sender_name}}`,
}

export default function ContentEditorClient() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contentType, setContentType] = useState<ContentType>('email_template')
  const [funnelStage, setFunnelStage] = useState<FunnelStage>('awareness')
  const [persona, setPersona] = useState('')
  const [industry, setIndustry] = useState('')
  const [tags, setTags] = useState('outreach, objection-handling')

  const [bodyMode, setBodyMode] = useState<'json' | 'markdown'>('markdown')
  const [markdown, setMarkdown] = useState(DEFAULT_BODY.markdown)
  const [jsonBody, setJsonBody] = useState(() => JSON.stringify(DEFAULT_BODY, null, 2))
  const [uploads, setUploads] = useState<Array<{
    name: string
    size: number
    mime_type: string
    path: string
    public_url: string | null
    extracted_text?: string
    summary?: string
  }>>([])
  const [uploading, setUploading] = useState(false)

  const variableHints = useMemo(() => {
    const common = ['name', 'company', 'sender_name', 'sender_title', 'product', 'pricing', 'cta_link']
    return common
  }, [])

  const onCreate = () => {
    startTransition(async () => {
      let content_body: any = {}
      if (bodyMode === 'markdown') {
        content_body = { type: 'markdown', markdown }
      } else {
        try {
          content_body = jsonBody.trim() ? JSON.parse(jsonBody) : {}
        } catch {
          return alert('Invalid JSON in body editor.')
        }
      }

      const res = await createContentItem({
        title,
        description,
        content_type: contentType,
        funnel_stage: funnelStage,
        persona: persona || undefined,
        industry: industry || undefined,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        content_body: {
          ...content_body,
          uploaded_assets: uploads,
          extracted_text: uploads.map((u) => u.extracted_text || '').filter(Boolean).join('\n\n'),
        },
        media: { files: uploads },
      })
      if ('error' in res) return alert(res.error)
      router.push(`/content/${res.data.id}`)
    })
  }

  const onUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const results: Array<{
        name: string
        size: number
        mime_type: string
        path: string
        public_url: string | null
        extracted_text?: string
        summary?: string
      }> = []

      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.set('file', file)
        const res = await fetch('/api/content/upload', { method: 'POST', body: fd })
        const json = await res.json()
        if (!res.ok || !json?.success) {
          alert(json?.error || `Upload failed for ${file.name}`)
          continue
        }
        results.push({
          ...json.file,
          extracted_text: json.extracted_text || '',
          summary: json.summary || '',
        })
      }

      if (results.length > 0) {
        setUploads((prev) => [...prev, ...results])

        // If user is creating media/doc content, prefill body with extracted content for AI indexing.
        const extracted = results.map((r) => r.extracted_text || '').filter(Boolean).join('\n\n')
        if (extracted) {
          if (bodyMode === 'markdown') {
            setMarkdown((prev) => `${prev}\n\n---\n\n${extracted}`.trim())
          } else {
            try {
              const parsed = jsonBody.trim() ? JSON.parse(jsonBody) : {}
              parsed.extracted_text = [parsed.extracted_text || '', extracted].filter(Boolean).join('\n\n')
              parsed.uploaded_assets = [...(parsed.uploaded_assets || []), ...results]
              setJsonBody(JSON.stringify(parsed, null, 2))
            } catch {
              // ignore malformed JSON mode
            }
          }
        }
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-col md:flex-row">
        <div className="flex items-center gap-3">
          <Link href="/content">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">Create Content</h1>
            <p className="text-sm text-muted-foreground">Templates, scripts, playbooks, and media metadata.</p>
          </div>
        </div>
        <Button onClick={onCreate} disabled={isPending}>Create</Button>
      </div>

      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Metadata</CardTitle>
          <CardDescription>Used for filtering, search, and recommendations.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Title</p>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Founder intro (short)" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Tags (comma-separated)</p>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g., outbound, pricing, followup" />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Content type</p>
            <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email_template">Email template</SelectItem>
                <SelectItem value="whatsapp_script">WhatsApp script</SelectItem>
                <SelectItem value="call_script">Call script</SelectItem>
                <SelectItem value="playbook">Playbook</SelectItem>
                <SelectItem value="case_study">Case study</SelectItem>
                <SelectItem value="ad_creative">Ad creative</SelectItem>
                <SelectItem value="pitch_deck">Pitch deck</SelectItem>
                <SelectItem value="media">Media</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Funnel stage</p>
            <Select value={funnelStage} onValueChange={(v) => setFunnelStage(v as FunnelStage)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="awareness">Awareness</SelectItem>
                <SelectItem value="consideration">Consideration</SelectItem>
                <SelectItem value="conversion">Conversion</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Persona</p>
            <Input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="e.g., Founder, CMO" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Industry</p>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g., SaaS, Fintech" />
          </div>

          <div className="md:col-span-2 space-y-2">
            <p className="text-sm font-medium">Description</p>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When and why to use this content" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Body editor</CardTitle>
          <CardDescription>Supports variables like <span className="font-mono">{'{{name}}'}</span>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Upload docs / creatives / media</p>
            <Input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv,.json,image/*,video/*"
              onChange={(e) => onUploadFiles(e.target.files)}
              disabled={uploading || isPending}
            />
            <p className="text-xs text-muted-foreground">
              Upload PDFs, creatives, decks, docs, images, videos. AI extracts/summarizes and attaches context automatically.
            </p>
            {uploads.length > 0 && (
              <div className="space-y-2">
                {uploads.map((u, idx) => (
                  <div key={`${u.path}_${idx}`} className="border rounded-lg p-2 text-xs">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-muted-foreground">{u.mime_type} · {(u.size / 1024).toFixed(1)} KB</div>
                    {u.summary ? <div className="mt-1">{u.summary}</div> : null}
                    {u.public_url ? (
                      <a href={u.public_url} target="_blank" rel="noreferrer" className="underline text-blue-600 dark:text-blue-400 mt-1 inline-block">
                        View file
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <Button variant={bodyMode === 'markdown' ? 'default' : 'outline'} size="sm" onClick={() => setBodyMode('markdown')}>Markdown</Button>
            <Button variant={bodyMode === 'json' ? 'default' : 'outline'} size="sm" onClick={() => setBodyMode('json')}>JSON</Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-purple-500" />
              AI will use this body + metadata for generation and search.
            </div>
          </div>

          {bodyMode === 'markdown' ? (
            <Textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              className="min-h-[360px]"
              placeholder="Write your template here..."
            />
          ) : (
            <Textarea
              value={jsonBody}
              onChange={(e) => setJsonBody(e.target.value)}
              className="min-h-[360px] font-mono text-xs"
              placeholder={`{ "type": "markdown", "markdown": "..." }`}
            />
          )}

          <div className="flex flex-wrap gap-2">
            {variableHints.map((v) => (
              <Badge key={v} variant="outline" className="font-mono">{`{{${v}}}`}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

