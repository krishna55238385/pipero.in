'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type {
  TriggerEventType,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowRecord,
  WorkflowSimulationResult,
} from '@/types/workflows'

type AutomationFlowRow = {
  id: string
  name: string
  trigger_type: TriggerEventType
  is_active: boolean
  workflow_graph: unknown
  version: number
  last_run_at: string | null
  created_at: string
}

function defaultGraph(triggerType: TriggerEventType): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'triggerNode',
        position: { x: 240, y: 80 },
        data: { kind: 'trigger', label: 'Trigger', trigger: { event: triggerType } },
      },
    ],
    edges: [],
  }
}

function safeGraph(value: unknown, triggerType: TriggerEventType): WorkflowGraph {
  const v = value as Partial<WorkflowGraph> | null
  if (!v || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) return defaultGraph(triggerType)
  return {
    nodes: v.nodes as WorkflowNode[],
    edges: v.edges as WorkflowEdge[],
  }
}

async function getActorContext() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id
  if (!userId) throw new Error('Authentication required')
  const { data: profile } = await supabase.from('users').select('organization_id').eq('id', userId).single()
  if (!profile?.organization_id) throw new Error('Organization not found')
  return { supabase, userId, orgId: profile.organization_id as string }
}

function toRecord(row: AutomationFlowRow): WorkflowRecord {
  const graph = safeGraph(row.workflow_graph, row.trigger_type)
  return {
    id: row.id,
    name: row.name,
    status: row.is_active ? 'active' : 'draft',
    triggerType: row.trigger_type,
    lastRunAt: row.last_run_at,
    version: row.version ?? 1,
    graph,
    createdAt: row.created_at,
  }
}

export async function getWorkflowList(): Promise<WorkflowRecord[]> {
  const { supabase, orgId } = await getActorContext()
  const { data, error } = await supabase
    .from('automation_flows')
    .select('id,name,trigger_type,is_active,workflow_graph,version,last_run_at,created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as AutomationFlowRow[] | null)?.map(toRecord) ?? []
}

export async function getWorkflowById(id: string): Promise<WorkflowRecord | null> {
  const { supabase, orgId } = await getActorContext()
  const { data, error } = await supabase
    .from('automation_flows')
    .select('id,name,trigger_type,is_active,workflow_graph,version,last_run_at,created_at')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return toRecord(data as AutomationFlowRow)
}

export async function createWorkflow(input: { name: string; triggerType: TriggerEventType }): Promise<{ id: string }> {
  const { supabase, orgId, userId } = await getActorContext()
  const graph = defaultGraph(input.triggerType)
  const { data, error } = await supabase
    .from('automation_flows')
    .insert({
      organization_id: orgId,
      created_by: userId,
      name: input.name,
      trigger_type: input.triggerType,
      conditions: [],
      actions: [],
      is_active: false,
      workflow_graph: graph,
      version: 1,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/workflows')
  return { id: String(data.id) }
}

export async function updateWorkflow(input: {
  id: string
  name: string
  triggerType: TriggerEventType
  status: 'active' | 'draft'
  graph: WorkflowGraph
}) {
  const { supabase, orgId, userId } = await getActorContext()
  const { data: existing, error: existingError } = await supabase
    .from('automation_flows')
    .select('version')
    .eq('organization_id', orgId)
    .eq('id', input.id)
    .single()
  if (existingError) throw new Error(existingError.message)
  const nextVersion = Number(existing.version ?? 1) + 1

  const { error } = await supabase
    .from('automation_flows')
    .update({
      name: input.name,
      trigger_type: input.triggerType,
      is_active: input.status === 'active',
      workflow_graph: input.graph,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('id', input.id)
  if (error) throw new Error(error.message)

  await supabase.from('automation_flow_versions').insert({
    flow_id: input.id,
    organization_id: orgId,
    version: nextVersion,
    snapshot: {
      name: input.name,
      triggerType: input.triggerType,
      status: input.status,
      graph: input.graph,
    },
    created_by: userId,
  })

  revalidatePath('/workflows')
  revalidatePath(`/workflows/${input.id}`)
}

export async function toggleWorkflowStatus(id: string, active: boolean) {
  const { supabase, orgId } = await getActorContext()
  const { error } = await supabase
    .from('automation_flows')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/workflows')
}

export async function deleteWorkflow(id: string) {
  const { supabase, orgId } = await getActorContext()
  const { error } = await supabase
    .from('automation_flows')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/workflows')
}

function evaluateConditionNode(node: WorkflowNode, eventData: Record<string, unknown>) {
  const c = node.data.condition
  if (!c) return true
  const raw = eventData[c.field]
  const left = raw == null ? '' : String(raw)
  const right = c.value ?? ''
  if (c.operator === 'equals') return left === right
  if (c.operator === 'not_equals') return left !== right
  if (c.operator === 'contains') return left.toLowerCase().includes(right.toLowerCase())
  if (c.operator === 'gt') return Number(left) > Number(right)
  if (c.operator === 'lt') return Number(left) < Number(right)
  return true
}

function nextNodesFrom(currentId: string, edges: WorkflowEdge[], nodesById: Map<string, WorkflowNode>) {
  return edges
    .filter((e) => e.source === currentId)
    .map((e) => nodesById.get(e.target))
    .filter((n): n is WorkflowNode => Boolean(n))
}

function simulateWorkflowGraph(
  graph: WorkflowGraph,
  eventData: Record<string, unknown>
): WorkflowSimulationResult {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
  const triggerNode = graph.nodes.find((n) => n.data.kind === 'trigger')
  const runId = `sim_${Date.now()}`
  if (!triggerNode) {
    return {
      runId,
      executedNodeIds: [],
      status: 'failed',
      logs: [{ message: 'No trigger node found', timestamp: new Date().toISOString() }],
    }
  }

  const queue: WorkflowNode[] = [triggerNode]
  const seen = new Set<string>()
  const executedNodeIds: string[] = []
  const logs: Array<{ message: string; timestamp: string }> = []

  while (queue.length) {
    const node = queue.shift()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    const now = new Date().toISOString()

    if (node.data.kind === 'condition') {
      const pass = evaluateConditionNode(node, eventData)
      logs.push({ message: `Condition "${node.data.label}" => ${pass ? 'PASS' : 'FAIL'}`, timestamp: now })
      executedNodeIds.push(node.id)
      if (!pass) continue
    } else {
      logs.push({ message: `Executed ${node.data.kind}: ${node.data.label}`, timestamp: now })
      executedNodeIds.push(node.id)
    }

    queue.push(...nextNodesFrom(node.id, graph.edges, nodesById))
  }

  return {
    runId,
    executedNodeIds,
    status: 'success',
    logs,
  }
}

export async function testWorkflow(input: { id: string; eventData?: Record<string, unknown> }) {
  const { supabase, orgId } = await getActorContext()
  const flow = await getWorkflowById(input.id)
  if (!flow) throw new Error('Workflow not found')

  const simulation = simulateWorkflowGraph(flow.graph, input.eventData ?? {})

  await supabase.from('automation_runs').insert({
    organization_id: orgId,
    flow_id: flow.id,
    entity_type: 'lead',
    entity_id: String(input.eventData?.id ?? 'simulation'),
    status: simulation.status,
    logs: simulation.logs,
    completed_at: new Date().toISOString(),
  })

  return simulation
}

