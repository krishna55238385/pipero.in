'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useWorkflowBuilderStore } from '@/stores/workflow-builder'
import type { ActionType, ConditionOperator, TriggerEventType } from '@/types/workflows'

const TRIGGERS: TriggerEventType[] = ['lead_created', 'email_opened', 'email_replied', 'deal_stage_changed', 'call_completed']
const OPERATORS: ConditionOperator[] = ['equals', 'not_equals', 'contains', 'gt', 'lt']
const ACTIONS: ActionType[] = ['send_email', 'add_to_campaign', 'create_task', 'assign_owner', 'update_lead_status', 'trigger_playbook', 'add_tag', 'delay']

export default function ConfigSidebar() {
  const nodes = useWorkflowBuilderStore((s) => s.nodes)
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId)
  const updateSelectedNodeData = useWorkflowBuilderStore((s) => s.updateSelectedNodeData)
  const duplicateSelectedNode = useWorkflowBuilderStore((s) => s.duplicateSelectedNode)
  const deleteSelectedNode = useWorkflowBuilderStore((s) => s.deleteSelectedNode)

  const node = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId])
  const currentAction = node?.data.action || { actionType: 'create_task' as ActionType }

  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!node ? (
          <p className="text-sm text-muted-foreground">Select a node to configure.</p>
        ) : (
          <>
            <Input
              value={node.data.label}
              onChange={(e) => updateSelectedNodeData({ label: e.target.value })}
              placeholder="Node label"
            />

            {node.data.kind === 'trigger' ? (
              <Select
                value={node.data.trigger?.event || 'lead_created'}
                onValueChange={(v) => updateSelectedNodeData({ trigger: { event: v as TriggerEventType } })}
              >
                <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}

            {node.data.kind === 'condition' ? (
              <>
                <Input
                  value={node.data.condition?.field || ''}
                  onChange={(e) => updateSelectedNodeData({ condition: { ...(node.data.condition || { operator: 'equals', value: '' }), field: e.target.value } })}
                  placeholder="Field"
                />
                <Select
                  value={node.data.condition?.operator || 'equals'}
                  onValueChange={(v) => updateSelectedNodeData({ condition: { ...(node.data.condition || { field: '', value: '' }), operator: v as ConditionOperator } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  value={node.data.condition?.value || ''}
                  onChange={(e) => updateSelectedNodeData({ condition: { ...(node.data.condition || { field: '', operator: 'equals' }), value: e.target.value } })}
                  placeholder="Value"
                />
              </>
            ) : null}

            {node.data.kind === 'action' ? (
              <>
                <Select
                  value={currentAction.actionType}
                  onValueChange={(v) => updateSelectedNodeData({ action: { ...currentAction, actionType: v as ActionType } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  value={currentAction.value || ''}
                  onChange={(e) => updateSelectedNodeData({ action: { ...currentAction, value: e.target.value } })}
                  placeholder="Value / Template / Tag"
                />
                <Input
                  value={String(currentAction.delayValue || '')}
                  onChange={(e) => updateSelectedNodeData({ action: { ...currentAction, delayValue: Number(e.target.value || 0) } })}
                  placeholder="Delay value"
                  type="number"
                />
                <Select
                  value={currentAction.delayUnit || 'hours'}
                  onValueChange={(v) => updateSelectedNodeData({ action: { ...currentAction, delayUnit: v as 'hours' | 'days' } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">hours</SelectItem>
                    <SelectItem value="days">days</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : null}

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={duplicateSelectedNode} className="flex-1">Duplicate</Button>
              <Button type="button" variant="destructive" onClick={deleteSelectedNode} className="flex-1">Delete</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

