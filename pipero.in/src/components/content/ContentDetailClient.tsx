'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { askContentAI, generatePersonalizedContent, logContentUsage, updateContentItem } from '@/app/actions/content-intelligence'

export default function ContentDetailClient(props: {
  detail: {
    content: any
    versions: any[]
    usage_summary: Record<string, number>
  }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { content, versions, usage_summary } = props.detail

  const [editTitle, setEditTitle] = useState<string>(content.title || '')
  const [editDescription, setEditDescription] = useState<string>(content.description || '')
  const [editTags, setEditTags] = useState<string>((content.tags || []).join(', '))
  const [editPersona, setEditPersona] = useState<string>(content.persona || '')
  const [editIndustry, setEditIndustry] = useState<string>(content.industry || '')
  const [editBody, setEditBody] = useState<string>(() => {
    try { return JSON.stringify(content.content_body ?? {}, null, 2) } catch { return String(content.content_body ?? '') }
  })
  const [changeSummary, setChangeSummary] = useState<string>('Updated')

  const [varName, setVarName] = useState('name')
  const [varCompany, setVarCompany] = useState('company')
  const [varNameValue, setVarNameValue] = useState('')
  const [varCompanyValue, setVarCompanyValue] = useState('')
  const [goal, setGoal] = useState('Personalize for this lead and keep it concise.')
  const [generated, setGenerated] = useState<string>('')
  const [docQuestion, setDocQuestion] = useState('')
  const [docAnswer, setDocAnswer] = useState('')

  // Metrics are derived from real content_usage_logs (via usage_summary), not a cached column.
  const usage = usage_summary || {}
  const usageCount = Number(usage.executed || 0)
  const replied = Number(usage.replied || 0)
  const converted = Number(usage.converted || 0)

  const versionsPreview = useMemo(() => versions.slice(0, 15), [versions])
  const uploadedAssets = useMemo(() => {
    const body = content.content_body || {}
    return Array.isArray(body.uploaded_assets) ? body.uploaded_assets : []
  }, [content.content_body])

  const onSave = () => {
    startTransition(async () => {
      let parsed: any = {}
      try {
        parsed = editBody.trim() ? JSON.parse(editBody) : {}
      } catch {
        // fallback: store as markdown
        parsed = { type: 'markdown', markdown: editBody }
      }

      const tags = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const res = await updateContentItem(content.id, {
        title: editTitle,
        description: editDescription,
        content_body: parsed,
        tags,
        persona: editPersona || undefined,
        industry: editIndustry || undefined,
        change_summary: changeSummary,
      })

      if ('error' in res) return alert(res.error)
      router.refresh()
    })
  }

  const onGenerate = () => {
    startTransition(async () => {
      const variables: Record<string, string> = {
        [varName]: varNameValue,
        [varCompany]: varCompanyValue,
      }
      const res = await generatePersonalizedContent({
        content_id: content.id,
        variables,
        goal,
        complexity: 'fast',
      })
      if ('error' in res) return alert(res.error)
      setGenerated(res.content)
    })
  }

  const onAskDocsAI = () => {
    const q = docQuestion.trim()
    if (!q) return
    startTransition(async () => {
      const res = await askContentAI({
        content_id: content.id,
        question: q,
        mode: 'pro',
      })
      if ('error' in res) return alert(res.error)
      setDocAnswer(res.answer || '')
    })
  }

  const onLog = (event_type: 'executed' | 'opened' | 'replied' | 'converted') => {
    startTransition(async () => {
      const res = await logContentUsage({
        content_id: content.id,
        channel: content.content_type === 'email_template' ? 'email' : content.content_type === 'whatsapp_script' ? 'whatsapp' : 'other',
        event_type,
        context: { source: 'manual_detail_page' },
      })
      if ('error' in res) return alert(res.error)
      router.refresh()
    })
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
            <h1 className="text-2xl font-semibold">{content.title}</h1>
            <p className="text-sm text-muted-foreground">{content.description || '—'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onLog('executed')} disabled={isPending}>Log Use</Button>
          <Button variant="outline" onClick={() => onLog('opened')} disabled={isPending}>Log Open</Button>
          <Button variant="outline" onClick={() => onLog('replied')} disabled={isPending}>Log Reply</Button>
          <Button onClick={() => onLog('converted')} disabled={isPending}>Log Conversion</Button>
        </div>
      </div>

      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Overview</CardTitle>
          <CardDescription>Metadata + performance at a glance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{content.content_type}</Badge>
            <Badge variant="secondary">{content.funnel_stage}</Badge>
            {content.persona && <Badge variant="outline">persona: {content.persona}</Badge>}
            {content.industry && <Badge variant="outline">industry: {content.industry}</Badge>}
            <Badge variant="outline">v{content.current_version}</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Usage</p>
              <p className="font-semibold">{usageCount}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Replies</p>
              <p className="font-semibold">{replied}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Conversions</p>
              <p className="font-semibold">{converted}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">Events (all)</p>
              <p className="font-semibold">{Object.values(usage_summary || {}).reduce((a, b) => a + Number(b || 0), 0)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="view" className="w-full">
        <TabsList className="bg-muted rounded-lg p-[3px] h-9 w-fit">
          <TabsTrigger value="view" className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm">View</TabsTrigger>
          <TabsTrigger value="edit" className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm">Edit</TabsTrigger>
          <TabsTrigger value="versions" className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm">Versions</TabsTrigger>
          <TabsTrigger value="ai" className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm">AI</TabsTrigger>
        </TabsList>

        <TabsContent value="view" className="mt-6">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Content body</CardTitle>
              <CardDescription>Stored as JSON. If you saved Markdown, it will be inside `markdown`.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap bg-muted/30 border rounded-lg p-4 overflow-auto max-h-[520px]">
                {editBody}
              </pre>
              {uploadedAssets.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium">Uploaded assets</p>
                  {uploadedAssets.map((a: any, idx: number) => (
                    <div key={`${a.path || a.name}_${idx}`} className="border rounded-lg p-3 text-sm">
                      <div className="font-medium">{a.name || 'File'}</div>
                      <div className="text-xs text-muted-foreground">{a.mime_type || 'unknown'} · {a.path || '-'}</div>
                      {a.summary ? <p className="text-xs mt-1">{a.summary}</p> : null}
                      {a.public_url ? (
                        <a href={a.public_url} target="_blank" rel="noreferrer" className="text-xs underline text-blue-600 dark:text-blue-400">
                          Open file
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="edit" className="mt-6">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Edit content</CardTitle>
              <CardDescription>Saving creates a new version automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-sm font-medium mb-1">Title</p>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Tags (comma-separated)</p>
                  <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Persona</p>
                  <Input value={editPersona} onChange={(e) => setEditPersona(e.target.value)} placeholder="e.g., Founder, CMO" />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Industry</p>
                  <Input value={editIndustry} onChange={(e) => setEditIndustry(e.target.value)} placeholder="e.g., SaaS, Fintech" />
                </div>
                <div className="md:col-span-2">
                  <p className="text-sm font-medium mb-1">Description</p>
                  <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-1">Body (JSON preferred; Markdown allowed)</p>
                <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} className="min-h-[320px] font-mono text-xs" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-sm font-medium mb-1">Change summary</p>
                  <Input value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={onSave} disabled={isPending}>Save (new version)</Button>
                  <Button variant="outline" onClick={() => router.refresh()} disabled={isPending}>Discard</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions" className="mt-6">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Version history</CardTitle>
              <CardDescription>Latest first.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {versionsPreview.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-4 border rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">v{v.version} — {v.change_summary || 'Update'}</p>
                    <p className="text-xs text-muted-foreground truncate">{new Date(v.created_at).toLocaleString()}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      try {
                        setEditBody(JSON.stringify(v.content_body ?? {}, null, 2))
                      } catch {
                        setEditBody(String(v.content_body ?? ''))
                      }
                      setEditTitle(v.title || editTitle)
                      setEditDescription(v.description || '')
                      setEditTags((v.tags || []).join(', '))
                      setEditPersona(v.persona || '')
                      setEditIndustry(v.industry || '')
                    }}
                  >
                    Load into editor
                  </Button>
                </div>
              ))}
              {versions.length > versionsPreview.length && (
                <p className="text-xs text-muted-foreground">Showing {versionsPreview.length} of {versions.length} versions.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-6">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">AI generator</CardTitle>
              <CardDescription>Fill variables then generate a personalized version.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex gap-2">
                  <Input value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="Var key (e.g. name)" />
                  <Input value={varNameValue} onChange={(e) => setVarNameValue(e.target.value)} placeholder="Value" />
                </div>
                <div className="flex gap-2">
                  <Input value={varCompany} onChange={(e) => setVarCompany(e.target.value)} placeholder="Var key (e.g. company)" />
                  <Input value={varCompanyValue} onChange={(e) => setVarCompanyValue(e.target.value)} placeholder="Value" />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Goal</p>
                <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onGenerate} disabled={isPending}>
                  <Sparkles className="h-4 w-4 mr-2 text-purple-500" />
                  Generate
                </Button>
              </div>
              {generated && (
                <pre className="text-sm whitespace-pre-wrap bg-muted/30 border rounded-lg p-4 overflow-auto max-h-[420px]">
                  {generated}
                </pre>
              )}

              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-2">Ask AI about uploaded docs/creatives</p>
                <div className="flex gap-2 flex-col md:flex-row">
                  <Input value={docQuestion} onChange={(e) => setDocQuestion(e.target.value)} placeholder="e.g., Summarize this deck in 5 bullets for a founder call" />
                  <Button variant="outline" onClick={onAskDocsAI} disabled={isPending}>Ask</Button>
                </div>
                {docAnswer && (
                  <pre className="text-sm whitespace-pre-wrap bg-muted/30 border rounded-lg p-4 overflow-auto max-h-[380px] mt-3">
                    {docAnswer}
                  </pre>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

