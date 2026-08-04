'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Trash2, Copy, Sparkles, Braces, Loader2 } from 'lucide-react'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { generateAiVariantsAction } from '@/app/actions/campaigns'
import type { CampaignBuilderNode } from '@/types/campaign'

const CONDITION_FIELDS = [
  'email_opened',
  'email_clicked',
  'email_replied',
  'email_bounced',
  'goal_achieved',
  'days_since_start',
  'variant',
]
const CONDITION_OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than']
const GOAL_TYPES = ['email_opened', 'email_clicked', 'email_replied', 'link_clicked', 'goal_achieved']
const WAIT_UNITS = ['minutes', 'hours', 'days', 'weeks']
const DELAY_UNITS = ['minutes', 'hours', 'days', 'weeks']

const MERGE_TAGS = [
  '{{first_name}}',
  '{{name}}',
  '{{company}}',
  '{{job_title}}',
  '{{email}}',
  '{{sender_name}}',
  '{{unsubscribe_url}}',
]

export default function CampaignPropertiesPanel() {
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const selectedNodeId = useCampaignBuilderStore((s) => s.selectedNodeId)
  const updateNodeData = useCampaignBuilderStore((s) => s.updateNodeData)
  const duplicateSelectedNode = useCampaignBuilderStore((s) => s.duplicateSelectedNode)
  const deleteSelectedNode = useCampaignBuilderStore((s) => s.deleteSelectedNode)

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  )

  if (!node) {
    return (
      <Card className="rounded-2xl h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Properties</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a node to edit its properties.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-2xl h-full overflow-hidden flex flex-col">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Properties</CardTitle>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={duplicateSelectedNode} className="h-7 px-2">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={deleteSelectedNode}
              disabled={node.data.nodeType === 'start'}
              className="h-7 px-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 overflow-y-auto flex-1 min-h-0">
        <NodeFields node={node} updateNodeData={updateNodeData} />
      </CardContent>
    </Card>
  )
}

function NodeFields({
  node,
  updateNodeData,
}: {
  node: CampaignBuilderNode
  updateNodeData: (nodeId: string, patch: Partial<CampaignBuilderNode['data']>) => void
}) {
  const data = node.data
  const set = (patch: Partial<CampaignBuilderNode['data']>) => updateNodeData(node.id, patch)
  const [targetField, setTargetField] = useState<'subject' | 'body'>('body')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiVariants, setAiVariants] = useState<Array<{ subject: string; bodyHtml: string; opening: string; cta: string }>>([])
  const [abEnabled, setAbEnabled] = useState(Boolean(data.abEnabled))

  function insertMergeTag(tag: string) {
    if (targetField === 'subject') {
      set({ subject: `${data.subject || ''}${tag}` })
    } else {
      set({ body: `${data.body || ''}${tag}` })
    }
  }

  async function runAiVariants() {
    setAiBusy(true)
    setAiError(null)
    try {
      const result = await generateAiVariantsAction({
        baseSubject: data.subject || '',
        baseBodyHtml: data.body || '',
        count: 3,
        goal: 'Book a meeting',
        researchContext: {
          companySummary: undefined,
          painPoints: [],
          recentSignals: [],
          icpFitNotes: 'Use Magnivo research context when available at send time',
        },
      })
      if (!result.success || !result.data) {
        setAiError(!result.success ? result.error : 'AI generation failed')
        return
      }
      setAiVariants(result.data.variants)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Label</Label>
        <Input value={data.label} onChange={(e) => set({ label: e.target.value })} placeholder="Node label" className="h-8 text-xs" />
      </div>

      {data.nodeType === 'email' && (
        <>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Subject</Label>
            <Input
              value={data.subject || ''}
              onFocus={() => setTargetField('subject')}
              onChange={(e) => set({ subject: e.target.value })}
              placeholder="Email subject"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Body</Label>
            <Textarea
              value={data.body || ''}
              onFocus={() => setTargetField('body')}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="Email body content..."
              className="text-xs min-h-[120px] resize-y"
            />
          </div>

          <div className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-1 text-xs font-medium">
              <Braces className="h-3.5 w-3.5" /> Merge tags
              <span className="text-muted-foreground font-normal">→ {targetField}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {MERGE_TAGS.map((tag) => (
                <Button
                  key={tag}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => insertMergeTag(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">A/B variants</Label>
            <Button
              type="button"
              size="sm"
              variant={abEnabled ? 'default' : 'outline'}
              className="h-7"
              onClick={() => {
                const next = !abEnabled
                setAbEnabled(next)
                set({ abEnabled: next })
              }}
            >
              {abEnabled ? 'On' : 'Off'}
            </Button>
          </div>

          <div className="space-y-2 rounded-md border p-2">
            <Button type="button" size="sm" className="w-full h-8" disabled={aiBusy} onClick={() => void runAiVariants()}>
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Generate AI variants
            </Button>
            {aiError && <p className="text-[11px] text-destructive">{aiError}</p>}
            {aiVariants.map((v, idx) => (
              <div key={`${v.subject}-${idx}`} className="rounded border p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">Variant {idx + 1}</Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-6 text-[10px]"
                    onClick={() => set({ subject: v.subject, body: v.bodyHtml })}
                  >
                    Apply
                  </Button>
                </div>
                <p className="text-[11px] font-medium truncate">{v.subject}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-2">{v.opening || v.cta}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {(data.nodeType === 'wait' || data.nodeType === 'delay') && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Duration</Label>
            <Input
              type="number"
              min={0}
              value={data.duration || ''}
              onChange={(e) => set({ duration: Number(e.target.value) || 0 })}
              placeholder="0"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Unit</Label>
            <Select value={data.unit || 'days'} onValueChange={(v) => set({ unit: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(data.nodeType === 'wait' ? WAIT_UNITS : DELAY_UNITS).map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {data.nodeType === 'condition' && (
        <>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Field</Label>
            <Select value={data.field || ''} onValueChange={(v) => set({ field: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select field" /></SelectTrigger>
              <SelectContent>
                {CONDITION_FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Operator</Label>
            <Select value={data.operator || 'equals'} onValueChange={(v) => set({ operator: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITION_OPERATORS.map((o) => (
                  <SelectItem key={o} value={o}>{o.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Value</Label>
            <Input value={data.value || ''} onChange={(e) => set({ value: e.target.value })} placeholder="Comparison value" className="h-8 text-xs" />
          </div>
        </>
      )}

      {data.nodeType === 'split' && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Variant A (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={(data.percentages as number[])?.[0] ?? 50}
            onChange={(e) => {
              const a = Number(e.target.value) || 0
              set({ percentages: [a, 100 - a] })
            }}
            className="h-8 text-xs"
          />
        </div>
      )}

      {data.nodeType === 'goal' && (
        <>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Goal Name</Label>
            <Input value={data.goalName || ''} onChange={(e) => set({ goalName: e.target.value })} placeholder="Goal name" className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Goal Type</Label>
            <Select value={data.goalType || 'email_opened'} onValueChange={(v) => set({ goalType: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GOAL_TYPES.map((g) => (
                  <SelectItem key={g} value={g}>{g.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {data.nodeType === 'webhook' && (
        <>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">URL</Label>
            <Input value={data.url || ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://..." className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Method</Label>
            <Select value={data.method || 'POST'} onValueChange={(v) => set({ method: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </>
  )
}
