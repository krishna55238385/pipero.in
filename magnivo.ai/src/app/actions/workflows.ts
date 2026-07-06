'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'
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

async function getOrCreateUser(clerkUser: { id: string, email: string | null, firstName?: string | null, lastName?: string | null }) {
  // Try to find existing user
  const existing = await pool.query(
    'SELECT * FROM public.users WHERE clerk_id = $1 LIMIT 1',
    [clerkUser.id]
  )

  if (existing.rows[0]) {
    // Update email if missing
    if (!existing.rows[0].email && clerkUser.email) {
      await pool.query(
        'UPDATE public.users SET email = $1 WHERE clerk_id = $2',
        [clerkUser.email, clerkUser.id]
      )
    }
    return existing.rows[0]
  }

  // Not found by clerk_id — check if a user with this email already exists
  if (clerkUser.email) {
    const byEmail = await pool.query(
      'SELECT * FROM public.users WHERE email = $1 LIMIT 1',
      [clerkUser.email]
    )
    if (byEmail.rows[0]) return byEmail.rows[0]
  }

  // Still not found — check for a pending invite matching this email
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || clerkUser.email || 'New User'

  if (clerkUser.email) {
    const invite = await pool.query(
      `SELECT id, organization_id, role FROM public.organization_invites
       WHERE email = $1 AND status = 'pending' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [clerkUser.email]
    )
    const invited = invite.rows[0]
    if (invited) {
      const invitedUser = await pool.query(
        `INSERT INTO public.users (clerk_id, organization_id, email, full_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [clerkUser.id, invited.organization_id, clerkUser.email, fullName, invited.role]
      )
      await pool.query(
        `UPDATE public.organization_invites SET status = 'accepted', accepted_at = now() WHERE id = $1`,
        [invited.id]
      )
      return invitedUser.rows[0]
    }
  }

  // No invite either — fall back to the existing org
  const orgResult = await pool.query('SELECT id FROM public.organizations LIMIT 1')
  const orgId = orgResult.rows[0]?.id
  if (!orgId) return null

  const newUser = await pool.query(
    `INSERT INTO public.users (clerk_id, organization_id, email, full_name, role)
     VALUES ($1, $2, $3, $4, 'admin')
     RETURNING *`,
    [clerkUser.id, orgId, clerkUser.email, fullName]
  )

  return newUser.rows[0]
}

async function getActorContext() {
  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
  const clerkUser = await currentUser()

  let userId: string | null = null

  if (!clerkUser && isMockAuth) {
    const r = await pool.query('SELECT id FROM public.users LIMIT 1')
    userId = r.rows[0]?.id ?? null
  } else if (clerkUser) {
    const dbRow = await getOrCreateUser({
      id: clerkUser.id,
      email: clerkUser.emailAddresses?.[0]?.emailAddress ?? null,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
    })
    userId = dbRow?.id ?? null
    if (!userId) throw new Error('User not found')
  } else {
    throw new Error('Authentication required')
  }

  const orgRes = await pool.query('SELECT id FROM public.organizations LIMIT 1')
  const orgId = orgRes.rows[0]?.id
  if (!orgId) throw new Error('Organization not found')

  return { userId, orgId: orgId as string }
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
  try {
    const { orgId } = await getActorContext()
    const r = await pool.query(
      'SELECT id,name,trigger_type,is_active,workflow_graph,version,last_run_at,created_at FROM public.automation_flows WHERE organization_id = $1 ORDER BY created_at DESC',
      [orgId])
    return (r.rows as AutomationFlowRow[]).map(toRecord)
  } catch (err: any) { throw new Error(err.message) }
}

export async function getWorkflowById(id: string): Promise<WorkflowRecord | null> {
  try {
    const { orgId } = await getActorContext()
    const r = await pool.query(
      'SELECT id,name,trigger_type,is_active,workflow_graph,version,last_run_at,created_at FROM public.automation_flows WHERE organization_id = $1 AND id = $2 LIMIT 1',
      [orgId, id])
    if (!r.rows[0]) return null
    return toRecord(r.rows[0] as AutomationFlowRow)
  } catch (err: any) { throw new Error(err.message) }
}

export async function createWorkflow(input: { name: string; triggerType: TriggerEventType }): Promise<{ id: string }> {
  try {
    const { orgId, userId } = await getActorContext()
    const graph = defaultGraph(input.triggerType)
    const r = await pool.query(
      `INSERT INTO public.automation_flows (organization_id, created_by, name, trigger_type, conditions, actions, is_active, workflow_graph, version)
       VALUES ($1,$2,$3,$4,'[]'::jsonb,'[]'::jsonb,false,$5,1) RETURNING id`,
      [orgId, userId, input.name, input.triggerType, JSON.stringify(graph)])
    revalidatePath('/workflows')
    return { id: String(r.rows[0].id) }
  } catch (err: any) { throw new Error(err.message) }
}

export async function updateWorkflow(input: {
  id: string
  name: string
  triggerType: TriggerEventType
  status: 'active' | 'draft'
  graph: WorkflowGraph
}) {
  try {
    const { orgId, userId } = await getActorContext()
    const existingRes = await pool.query(
      'SELECT version FROM public.automation_flows WHERE organization_id = $1 AND id = $2 LIMIT 1',
      [orgId, input.id])
    if (!existingRes.rows[0]) throw new Error('Workflow not found')
    const nextVersion = Number(existingRes.rows[0].version ?? 1) + 1

    await pool.query(
      `UPDATE public.automation_flows SET name = $1, trigger_type = $2, is_active = $3, workflow_graph = $4, version = $5, updated_at = $6
       WHERE organization_id = $7 AND id = $8`,
      [input.name, input.triggerType, input.status === 'active', JSON.stringify(input.graph), nextVersion, new Date().toISOString(), orgId, input.id])

    await pool.query(
      'INSERT INTO public.automation_flow_versions (flow_id, organization_id, version, snapshot, created_by) VALUES ($1,$2,$3,$4,$5)',
      [input.id, orgId, nextVersion, JSON.stringify({ name: input.name, triggerType: input.triggerType, status: input.status, graph: input.graph }), userId])

    revalidatePath('/workflows')
    revalidatePath(`/workflows/${input.id}`)
  } catch (err: any) { throw new Error(err.message) }
}

export async function toggleWorkflowStatus(id: string, active: boolean) {
  try {
    const { orgId } = await getActorContext()
    await pool.query(
      'UPDATE public.automation_flows SET is_active = $1, updated_at = $2 WHERE organization_id = $3 AND id = $4',
      [active, new Date().toISOString(), orgId, id])
    revalidatePath('/workflows')
  } catch (err: any) { throw new Error(err.message) }
}

export async function deleteWorkflow(id: string) {
  try {
    const { orgId } = await getActorContext()
    await pool.query('DELETE FROM public.automation_flows WHERE organization_id = $1 AND id = $2', [orgId, id])
    revalidatePath('/workflows')
  } catch (err: any) { throw new Error(err.message) }
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

function simulateWorkflowGraph(graph: WorkflowGraph, eventData: Record<string, unknown>): WorkflowSimulationResult {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
  const triggerNode = graph.nodes.find((n) => n.data.kind === 'trigger')
  const runId = `sim_${Date.now()}`
  if (!triggerNode) {
    return {
      runId, executedNodeIds: [], status: 'failed',
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

  return { runId, executedNodeIds, status: 'success', logs }
}

export async function testWorkflow(input: { id: string; eventData?: Record<string, unknown> }) {
  try {
    const { orgId } = await getActorContext()
    const flow = await getWorkflowById(input.id)
    if (!flow) throw new Error('Workflow not found')

    const simulation = simulateWorkflowGraph(flow.graph, input.eventData ?? {})

    await pool.query(
      `INSERT INTO public.automation_runs (organization_id, flow_id, entity_type, entity_id, status, logs, completed_at)
       VALUES ($1,$2,'lead',$3,$4,$5,$6)`,
      [orgId, flow.id, String(input.eventData?.id ?? 'simulation'), simulation.status, JSON.stringify(simulation.logs), new Date().toISOString()])

    return simulation
  } catch (err: any) { throw new Error(err.message) }
}
