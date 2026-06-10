'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { semanticSearchContent, type ContentLibraryItem, type ContentType, type FunnelStage } from '@/app/actions/content-intelligence'

type FilterState = {
  q: string
  content_type: ContentType | 'all'
  funnel_stage: FunnelStage | 'all'
  persona: string | 'all'
  industry: string | 'all'
}

const CONTENT_TABS: Array<{ label: string; value: ContentType | 'all' }> = [
  { label: 'All Content', value: 'all' },
  { label: 'Email templates', value: 'email_template' },
  { label: 'WhatsApp scripts', value: 'whatsapp_script' },
  { label: 'Call scripts', value: 'call_script' },
  { label: 'Playbooks', value: 'playbook' },
  { label: 'Case studies', value: 'case_study' },
  { label: 'Ad creatives', value: 'ad_creative' },
  { label: 'Pitch decks', value: 'pitch_deck' },
  { label: 'Images / videos', value: 'media' },
]

function metricNumber(metrics: any, key: string) {
  const n = Number(metrics?.[key] ?? 0)
  return Number.isFinite(n) ? n : 0
}

export default function ContentLibraryClient(props: {
  initialItems: ContentLibraryItem[]
  initialFilters: FilterState
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filters, setFilters] = useState<FilterState>(props.initialFilters)
  const [aiQuery, setAiQuery] = useState('')
  const [aiResults, setAiResults] = useState<any[] | null>(null)

  const allPersonas = useMemo(() => {
    const s = new Set<string>()
    props.initialItems.forEach(i => { if (i.persona) s.add(i.persona) })
    return Array.from(s).sort()
  }, [props.initialItems])

  const allIndustries = useMemo(() => {
    const s = new Set<string>()
    props.initialItems.forEach(i => { if (i.industry) s.add(i.industry) })
    return Array.from(s).sort()
  }, [props.initialItems])

  const applyUrlFilters = (next: FilterState) => {
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    if (next.content_type !== 'all') sp.set('type', next.content_type)
    if (next.funnel_stage !== 'all') sp.set('stage', next.funnel_stage)
    if (next.persona !== 'all') sp.set('persona', next.persona)
    if (next.industry !== 'all') sp.set('industry', next.industry)
    router.push(`/content?${sp.toString()}`)
  }

  const onKeywordSearch = () => {
    startTransition(() => {
      setAiResults(null)
      applyUrlFilters(filters)
    })
  }

  const onContentTabClick = (tab: ContentType | 'all') => {
    const next = { ...filters, content_type: tab }
    setFilters(next)
    startTransition(() => {
      setAiResults(null)
      applyUrlFilters(next)
    })
  }

  const onAISearch = () => {
    const q = aiQuery.trim()
    if (!q) return
    startTransition(async () => {
      const res = await semanticSearchContent({ query: q, limit: 18, threshold: 0.18 })
      setAiResults(res)
    })
  }

  const empty = (aiResults ? aiResults.length === 0 : props.initialItems.length === 0)

  return (
    <div className="space-y-6">
      <Card className="rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-col md:flex-row">
            <div>
              <CardTitle className="text-xl">Library Dashboard</CardTitle>
              <CardDescription>Store, search, and execute templates, scripts, and playbooks.</CardDescription>
            </div>
            <div className="inline-flex rounded-xl border bg-background/70 p-1 shadow-sm">
              <Link href="/content/new">
                <Button className="rounded-lg px-4">Create Content</Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {CONTENT_TABS.map((tab) => {
              const active = filters.content_type === tab.value
              return (
                <Button
                  key={tab.value}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => onContentTabClick(tab.value)}
                  className="rounded-full"
                  disabled={isPending}
                >
                  {tab.label}
                </Button>
              )
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filters.q}
                  onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
                  placeholder="Keyword search (title/description)"
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <Select value={filters.content_type} onValueChange={(v) => setFilters((p) => ({ ...p, content_type: v as any }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Content type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="email_template">Email templates</SelectItem>
                  <SelectItem value="whatsapp_script">WhatsApp scripts</SelectItem>
                  <SelectItem value="call_script">Call scripts</SelectItem>
                  <SelectItem value="playbook">Playbooks</SelectItem>
                  <SelectItem value="case_study">Case studies</SelectItem>
                  <SelectItem value="ad_creative">Ad creatives</SelectItem>
                  <SelectItem value="pitch_deck">Pitch decks</SelectItem>
                  <SelectItem value="media">Media</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={filters.funnel_stage} onValueChange={(v) => setFilters((p) => ({ ...p, funnel_stage: v as any }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Funnel stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  <SelectItem value="awareness">Awareness</SelectItem>
                  <SelectItem value="consideration">Consideration</SelectItem>
                  <SelectItem value="conversion">Conversion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={onKeywordSearch} disabled={isPending} className="w-full">Apply</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select value={filters.persona} onValueChange={(v) => setFilters((p) => ({ ...p, persona: v }))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Persona" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All personas</SelectItem>
                {allPersonas.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.industry} onValueChange={(v) => setFilters((p) => ({ ...p, industry: v }))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All industries</SelectItem>
                {allIndustries.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Card className="rounded-xl border-dashed">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <p className="font-medium">AI semantic search</p>
              </div>
              <div className="flex gap-2 flex-col md:flex-row">
                <Input value={aiQuery} onChange={(e) => setAiQuery(e.target.value)} placeholder="Search by meaning (e.g., 'pricing objection reply for founders in fintech')" />
                <Button variant="outline" onClick={onAISearch} disabled={isPending}>Search</Button>
                {aiResults && (
                  <Button variant="ghost" onClick={() => setAiResults(null)} disabled={isPending}>Clear</Button>
                )}
              </div>
              {aiResults && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing {aiResults.length} AI matches. (Filters above apply to keyword search; AI results are similarity-ranked.)
                </p>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      {isPending && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="rounded-xl">
              <CardHeader className="pb-2">
                <div className="h-4 w-2/3 bg-muted rounded" />
                <div className="h-3 w-1/2 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-3 w-full bg-muted rounded mb-2" />
                <div className="h-3 w-5/6 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isPending && empty && (
        <Card className="rounded-xl">
          <CardContent className="py-12 text-center">
            <p className="font-semibold">No content yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first template, script, or playbook to start executing faster.</p>
            <Link href="/content/new">
              <Button className="mt-4">Create Content</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {!isPending && !empty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(aiResults ?? props.initialItems).map((item: any) => {
            const id = item.id
            const title = item.title
            const desc = item.description
            const tags = item.tags || []
            const type = item.content_type
            const stage = item.funnel_stage
            const persona = item.persona
            const industry = item.industry
            const metrics = item.performance_metrics || {}
            const usage = metricNumber(metrics, 'usage_count')
            const replied = metricNumber(metrics, 'replied')
            const converted = metricNumber(metrics, 'converted')
            const similarity = typeof item.similarity === 'number' ? item.similarity : null

            return (
              <Link key={id} href={`/content/${id}`} className="group">
                <Card className="rounded-xl h-full transition-shadow group-hover:shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base line-clamp-2">{title}</CardTitle>
                    <CardDescription className="line-clamp-2">{desc || '—'}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{type}</Badge>
                      <Badge variant="secondary">{stage}</Badge>
                      {persona && <Badge variant="outline">persona: {persona}</Badge>}
                      {industry && <Badge variant="outline">industry: {industry}</Badge>}
                      {similarity !== null && (
                        <Badge variant="outline">sim: {Math.round(similarity * 100)}%</Badge>
                      )}
                    </div>
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {tags.slice(0, 6).map((t: string) => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {t}
                          </span>
                        ))}
                        {tags.length > 6 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            +{tags.length - 6}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <div><span className="font-medium text-foreground">{usage}</span> uses</div>
                      <div><span className="font-medium text-foreground">{replied}</span> replies</div>
                      <div><span className="font-medium text-foreground">{converted}</span> conv</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

