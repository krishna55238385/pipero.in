import type { Edge, Node } from '@xyflow/react'

export type WorkflowStatus = 'active' | 'draft'
export type WorkflowNodeKind = 'trigger' | 'condition' | 'action'

export type TriggerEventType =
  | 'lead_created'
  | 'email_opened'
  | 'email_replied'
  | 'deal_stage_changed'
  | 'call_completed'

export type ConditionOperator = 'equals' | 'contains' | 'gt' | 'lt' | 'not_equals'

export type ActionType =
  | 'send_email'
  | 'add_to_campaign'
  | 'create_task'
  | 'assign_owner'
  | 'update_lead_status'
  | 'trigger_playbook'
  | 'add_tag'
  | 'delay'

export type TriggerConfig = {
  event: TriggerEventType
}

export type ConditionConfig = {
  field: string
  operator: ConditionOperator
  value: string
}

export type ActionConfig = {
  actionType: ActionType
  templateId?: string
  userId?: string
  delayValue?: number
  delayUnit?: 'hours' | 'days'
  value?: string
}

export type WorkflowNodeData = {
  kind: WorkflowNodeKind
  label: string
  trigger?: TriggerConfig
  condition?: ConditionConfig
  action?: ActionConfig
  executed?: boolean
}

export type WorkflowNode = Node<WorkflowNodeData>
export type WorkflowEdge = Edge

export type WorkflowGraph = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type WorkflowRecord = {
  id: string
  name: string
  status: WorkflowStatus
  triggerType: TriggerEventType
  lastRunAt: string | null
  version: number
  graph: WorkflowGraph
  createdAt?: string
}

export type WorkflowSimulationResult = {
  runId: string
  executedNodeIds: string[]
  status: 'success' | 'failed'
  logs: Array<{ message: string; timestamp: string }>
}

