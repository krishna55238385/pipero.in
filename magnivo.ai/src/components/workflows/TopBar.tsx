'use client'

import { useTransition } from 'react'
import { FlaskConical, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkflowBuilderStore } from '@/stores/workflow-builder'
import { updateWorkflow, testWorkflow } from '@/app/actions/workflows'
import type { TriggerEventType } from '@/types/workflows'
import { toast } from 'sonner'

const TRIGGERS: TriggerEventType[] = ['lead_created', 'email_opened', 'email_replied', 'deal_stage_changed', 'call_completed']

export default function TopBar({ workflowId }: { workflowId: string }) {
  const [pending, startTransition] = useTransition()
  const { name, status, triggerType, nodes, edges, setMeta, markExecuted, resetExecuted } = useWorkflowBuilderStore((s) => s)

  const saveWorkflow = () => {
    if (!name.trim()) {
      toast.error('Workflow name is required')
      return
    }
    startTransition(async () => {
      try {
        await updateWorkflow({
          id: workflowId,
          name,
          status,
          triggerType,
          graph: { nodes, edges },
        })
        toast.success('Workflow saved')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save workflow')
      }
    })
  }

  const testRun = () => {
    startTransition(async () => {
      try {
        resetExecuted()
        const sim = await testWorkflow({
          id: workflowId,
          eventData: { status: 'Hot', value: 12000, email_opened: true },
        })
        markExecuted(sim.executedNodeIds)
        toast.success('Simulation completed')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Simulation failed')
      }
    })
  }

  return (
    <div className="rounded-2xl border bg-card p-3 flex flex-wrap items-center gap-2 justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setMeta({ name: e.target.value })}
          placeholder="Workflow name"
          className="w-[260px]"
        />
        <Select value={triggerType} onValueChange={(v) => setMeta({ triggerType: v as TriggerEventType })}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRIGGERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="active-toggle" className="text-sm text-muted-foreground">Active</Label>
        <Switch
          id="active-toggle"
          checked={status === 'active'}
          onCheckedChange={(v) => setMeta({ status: v ? 'active' : 'draft' })}
        />
        <Button type="button" variant="outline" onClick={testRun} disabled={pending}>
          <FlaskConical className="h-4 w-4 mr-2" />
          Test Workflow
        </Button>
        <Button type="button" onClick={saveWorkflow} disabled={pending}>
          <Save className="h-4 w-4 mr-2" />
          {pending ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

