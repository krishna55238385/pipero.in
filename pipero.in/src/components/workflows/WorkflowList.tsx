'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { createWorkflow, deleteWorkflow, toggleWorkflowStatus } from '@/app/actions/workflows'
import type { TriggerEventType, WorkflowRecord } from '@/types/workflows'
import { toast } from 'sonner'

const TRIGGERS: TriggerEventType[] = ['lead_created', 'email_opened', 'email_replied', 'deal_stage_changed', 'call_completed']

export default function WorkflowList({ initialWorkflows }: { initialWorkflows: WorkflowRecord[] }) {
  const [workflows, setWorkflows] = useState(initialWorkflows)
  const [pending, startTransition] = useTransition()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<TriggerEventType>('lead_created')

  const onCreate = () => {
    if (!name.trim()) {
      toast.error('Workflow name is required')
      return
    }
    startTransition(async () => {
      try {
        const res = await createWorkflow({ name, triggerType })
        setWorkflows((prev) => [
          {
            id: res.id,
            name,
            status: 'draft',
            triggerType,
            lastRunAt: null,
            version: 1,
            graph: { nodes: [], edges: [] },
          },
          ...prev,
        ])
        setCreateOpen(false)
        setName('')
        toast.success('Workflow created')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create workflow')
      }
    })
  }

  const onToggle = (wf: WorkflowRecord, active: boolean) => {
    setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? { ...x, status: active ? 'active' : 'draft' } : x)))
    startTransition(async () => {
      try {
        await toggleWorkflowStatus(wf.id, active)
      } catch (e) {
        setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? { ...x, status: wf.status } : x)))
        toast.error(e instanceof Error ? e.message : 'Failed to toggle workflow')
      }
    })
  }

  const onDelete = (id: string) => {
    const old = workflows
    setWorkflows((prev) => prev.filter((x) => x.id !== id))
    startTransition(async () => {
      try {
        await deleteWorkflow(id)
      } catch (e) {
        setWorkflows(old)
        toast.error(e instanceof Error ? e.message : 'Failed to delete workflow')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workflow Automations</h1>
          <p className="text-sm text-muted-foreground">Triggers → Conditions → Actions visual builder</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button type="button">
              <Plus className="h-4 w-4 mr-2" />
              Create workflow
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create workflow</DialogTitle>
              <DialogDescription>Start with a trigger and build on canvas.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" />
              <select
                className="w-full h-10 rounded-md border px-3 bg-background"
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as TriggerEventType)}
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="button" onClick={onCreate} disabled={pending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle>Workflow list</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {workflows.map((wf) => (
            <div key={wf.id} className="rounded-xl border p-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{wf.name}</p>
                <p className="text-xs text-muted-foreground">
                  Trigger: {wf.triggerType} · Last run: {wf.lastRunAt ? new Date(wf.lastRunAt).toLocaleString() : 'Never'} · v{wf.version}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`switch-${wf.id}`} className="text-xs">Active</Label>
                  <Switch
                    id={`switch-${wf.id}`}
                    checked={wf.status === 'active'}
                    onCheckedChange={(v) => onToggle(wf, v)}
                  />
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/workflows/${wf.id}`}>Edit</Link>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(wf.id)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          {!workflows.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No workflows yet. Create your first automation.</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

