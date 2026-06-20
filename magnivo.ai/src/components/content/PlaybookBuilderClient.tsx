'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { ArrowLeft, Plus, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { runPlaybookManually, upsertPlaybookSteps } from '@/app/actions/content-intelligence'

type StepType = 'send_email' | 'send_whatsapp' | 'wait' | 'assign_task'
type Step = {
  id: string
  step_type: StepType
  title: string
  content_id?: string | null
  config: Record<string, unknown>
}

function newStep(step_type: StepType): Step {
  const base: Step = {
    id: `tmp_${Math.random().toString(16).slice(2)}`,
    step_type,
    title:
      step_type === 'send_email'
        ? 'Send email'
        : step_type === 'send_whatsapp'
          ? 'Send WhatsApp'
          : step_type === 'wait'
            ? 'Wait'
            : 'Assign task',
    content_id: null,
    config:
      step_type === 'wait'
        ? { wait_minutes: 60 }
        : step_type === 'assign_task'
          ? { task_title: 'Follow up', priority: 'normal' }
          : { variables: { name: '{{name}}', company: '{{company}}' } },
  }
  return base
}

export default function PlaybookBuilderClient(props: {
  playbook: any
  steps: any[]
  availableContent: Array<{ id: string; title: string; content_type: string }>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [steps, setSteps] = useState<Step[]>(() =>
    (props.steps || []).map((s) => ({
      id: s.id,
      step_type: s.step_type,
      title: s.title,
      content_id: s.content_id,
      config: s.config || {},
    }))
  )
  const [leadId, setLeadId] = useState('')
  const [variablesJson, setVariablesJson] = useState('{ \"name\": \"\", \"company\": \"\" }')
  const [executionPlan, setExecutionPlan] = useState<any>(null)

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const next = Array.from(steps)
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved)
    setSteps(next)
  }

  const addStep = (t: StepType) => setSteps((p) => [...p, newStep(t)])

  const save = () => {
    startTransition(async () => {
      const payload = steps.map((s, idx) => ({
        step_order: idx + 1,
        step_type: s.step_type,
        title: s.title,
        config: s.config || {},
        content_id: s.content_id ?? null,
      }))
      const res = await upsertPlaybookSteps(props.playbook.id, payload)
      if ('error' in res) return alert(res.error)
      router.refresh()
      alert('Saved')
    })
  }

  const run = () => {
    startTransition(async () => {
      let vars: Record<string, string> = {}
      try {
        const parsed = JSON.parse(variablesJson)
        vars = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')]))
      } catch {
        return alert('Variables JSON is invalid')
      }
      const res = await runPlaybookManually({
        playbook_id: props.playbook.id,
        lead_id: leadId || undefined,
        variables: vars,
      })
      if ('error' in res) return alert(res.error)
      setExecutionPlan(res.execution_plan)
    })
  }

  const contentById = useMemo(() => new Map(props.availableContent.map((c) => [c.id, c])), [props.availableContent])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-col md:flex-row">
        <div className="flex items-center gap-3">
          <Link href="/content/playbooks">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">{props.playbook.title}</h1>
            <p className="text-sm text-muted-foreground">{props.playbook.description || '—'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={save} disabled={isPending}>Save</Button>
          <Button onClick={run} disabled={isPending}>
            <Play className="h-4 w-4 mr-2" />
            Run
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Steps</CardTitle>
              <CardDescription>Drag to reorder. Configure each step.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => addStep('send_email')}>
                  <Plus className="h-4 w-4 mr-2" /> Send email
                </Button>
                <Button size="sm" variant="outline" onClick={() => addStep('send_whatsapp')}>
                  <Plus className="h-4 w-4 mr-2" /> Send WhatsApp
                </Button>
                <Button size="sm" variant="outline" onClick={() => addStep('wait')}>
                  <Plus className="h-4 w-4 mr-2" /> Wait
                </Button>
                <Button size="sm" variant="outline" onClick={() => addStep('assign_task')}>
                  <Plus className="h-4 w-4 mr-2" /> Assign task
                </Button>
              </div>

              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="steps">
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3">
                      {steps.map((s, idx) => (
                        <Draggable key={s.id} draggableId={s.id} index={idx}>
                          {(draggable) => (
                            <div
                              ref={draggable.innerRef}
                              {...draggable.draggableProps}
                              className="border rounded-xl p-4 bg-background"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div
                                    {...draggable.dragHandleProps}
                                    className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground"
                                  >
                                    #{idx + 1}
                                  </div>
                                  <Badge variant="secondary">{s.step_type}</Badge>
                                </div>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => setSteps((p) => p.filter((x) => x.id !== s.id))}
                                >
                                  Remove
                                </Button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                <div>
                                  <p className="text-sm font-medium mb-1">Title</p>
                                  <Input value={s.title} onChange={(e) => {
                                    const v = e.target.value
                                    setSteps((p) => p.map((x) => x.id === s.id ? { ...x, title: v } : x))
                                  }} />
                                </div>
                                <div>
                                  <p className="text-sm font-medium mb-1">Linked content (optional)</p>
                                  <Input
                                    value={s.content_id || ''}
                                    onChange={(e) => {
                                      const v = e.target.value.trim()
                                      setSteps((p) => p.map((x) => x.id === s.id ? { ...x, content_id: v || null } : x))
                                    }}
                                    placeholder="Paste content UUID"
                                  />
                                  {s.content_id && contentById.get(s.content_id) && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {contentById.get(s.content_id)?.title}
                                    </p>
                                  )}
                                </div>
                                <div className="md:col-span-2">
                                  <p className="text-sm font-medium mb-1">Config (JSON)</p>
                                  <Textarea
                                    className="font-mono text-xs min-h-[120px]"
                                    value={JSON.stringify(s.config || {}, null, 2)}
                                    onChange={(e) => {
                                      const raw = e.target.value
                                      try {
                                        const parsed = raw.trim() ? JSON.parse(raw) : {}
                                        setSteps((p) => p.map((x) => x.id === s.id ? { ...x, config: parsed } : x))
                                      } catch {
                                        // ignore until valid
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Run settings</CardTitle>
              <CardDescription>Manual trigger (webhook-ready output).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm font-medium mb-1">Lead ID (optional)</p>
                <Input value={leadId} onChange={(e) => setLeadId(e.target.value)} placeholder="Lead UUID" />
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Variables (JSON)</p>
                <Textarea className="font-mono text-xs min-h-[120px]" value={variablesJson} onChange={(e) => setVariablesJson(e.target.value)} />
              </div>
              <Button onClick={run} disabled={isPending} className="w-full">
                <Play className="h-4 w-4 mr-2" /> Run playbook
              </Button>
            </CardContent>
          </Card>

          {executionPlan && (
            <Card className="rounded-xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Execution plan</CardTitle>
                <CardDescription>Use this as a payload to n8n.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap bg-muted/30 border rounded-lg p-3 overflow-auto max-h-[420px]">
                  {JSON.stringify(executionPlan, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

