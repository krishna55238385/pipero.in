import type {
  CampaignBuilderNode,
  CampaignBuilderEdge,
  CampaignNodeValidationErrors,
  CampaignSeverity,
} from '@/types/campaign'
import { NODE_DEFINITIONS } from './constants'

type ValidationRule = {
  id: string
  message: string
  severity: CampaignSeverity
  fix?: { type: 'auto' | 'manual'; description: string }
}

const rules: ValidationRule[] = [
  { id: 'node_empty', message: 'Campaign must have at least one node', severity: 'error' },
  { id: 'start_missing', message: 'Campaign must have a Start node', severity: 'error' },
  { id: 'start_duplicate', message: 'Only one Start node is allowed', severity: 'error' },
  { id: 'start_outgoing', message: 'Start node must have an outgoing connection', severity: 'error', fix: { type: 'auto', description: 'Connect Start to the next node' } },
  { id: 'start_incoming', message: 'Start node must not have incoming connections', severity: 'error', fix: { type: 'auto', description: 'Remove incoming connections to Start' } },
  { id: 'exit_no_outgoing', message: 'Exit node must not have outgoing connections', severity: 'warning' },
  { id: 'email_no_subject', message: 'Email node is missing a subject line', severity: 'error' },
  { id: 'email_no_body', message: 'Email node is missing body content', severity: 'error' },
  { id: 'wait_missing_duration', message: 'Wait node must have a duration value', severity: 'error' },
  { id: 'condition_no_field', message: 'Condition node must have a field to evaluate', severity: 'error' },
  { id: 'condition_one_branch', message: 'Condition node must have at least one outgoing connection', severity: 'error', fix: { type: 'auto', description: 'Add at least one branch from the condition' } },
  { id: 'goal_no_name', message: 'Goal node must have a goal name', severity: 'error' },
  { id: 'webhook_no_url', message: 'Webhook node must have a target URL', severity: 'error' },
  { id: 'node_disconnected', message: 'Node is not connected to any other node', severity: 'warning', fix: { type: 'auto', description: 'Connect this node to the flow' } },
  { id: 'orphan_node', message: 'Node is not reachable from the Start node', severity: 'warning' },
]

function findNodeErrors(
  node: CampaignBuilderNode,
  allNodes: CampaignBuilderNode[],
  allEdges: CampaignBuilderEdge[],
): string[] {
  const errors: string[] = []
  const incoming = allEdges.filter((e) => e.target === node.id)
  const outgoing = allEdges.filter((e) => e.source === node.id)
  const def = NODE_DEFINITIONS.find((d) => d.type === node.data.nodeType)
  const data = node.data

  if (def?.disabled) return []

  if (node.data.nodeType === 'start') {
    if (incoming.length > 0) errors.push('start_incoming')
    if (outgoing.length === 0) errors.push('start_outgoing')
  } else if (node.data.nodeType === 'exit') {
    if (outgoing.length > 0) errors.push('exit_no_outgoing')
    if (incoming.length === 0) errors.push('node_disconnected')
  } else {
    if (incoming.length === 0 && outgoing.length === 0) errors.push('node_disconnected')
  }

  switch (node.data.nodeType) {
    case 'email':
      if (!data.subject?.trim()) errors.push('email_no_subject')
      if (!data.body?.trim()) errors.push('email_no_body')
      break
    case 'wait':
    case 'delay':
      if (!data.duration || data.duration <= 0) errors.push('wait_missing_duration')
      break
    case 'condition':
      if (!data.field?.trim()) errors.push('condition_no_field')
      if (outgoing.length === 0) errors.push('condition_one_branch')
      break
    case 'goal':
      if (!data.goalName?.trim()) errors.push('goal_no_name')
      break
    case 'webhook':
      if (!data.url?.trim()) errors.push('webhook_no_url')
      break
  }

  return errors
}

function findOrphanNodes(
  nodes: CampaignBuilderNode[],
  edges: CampaignBuilderEdge[],
): Set<string> {
  const visited = new Set<string>()
  const queue = nodes
    .filter((n) => n.data.nodeType === 'start')
    .map((n) => n.id)

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    edges
      .filter((e) => e.source === id)
      .forEach((e) => queue.push(e.target))
  }

  const orphans = new Set<string>()
  nodes.forEach((n) => {
    if (!visited.has(n.id) && n.data.nodeType !== 'start') {
      orphans.add(n.id)
    }
  })
  return orphans
}

export type CampaignValidationResult = {
  valid: boolean
  errors: CampaignNodeValidationErrors[]
  nodeCount: number
  edgeCount: number
}

export function validateCampaignGraph(
  nodes: CampaignBuilderNode[],
  edges: CampaignBuilderEdge[],
): CampaignValidationResult {
  const errors: CampaignNodeValidationErrors[] = []

  if (nodes.length === 0) {
    errors.push({ nodeId: '__campaign__', errors: ['node_empty'] })
    return { valid: false, errors, nodeCount: 0, edgeCount: 0 }
  }

  const startNodes = nodes.filter((n) => n.data.nodeType === 'start')
  if (startNodes.length === 0) {
    errors.push({ nodeId: '__campaign__', errors: ['start_missing'] })
  } else if (startNodes.length > 1) {
    errors.push({ nodeId: startNodes[1].id, errors: ['start_duplicate'] })
  }

  const orphans = findOrphanNodes(nodes, edges)

  for (const node of nodes) {
    const nodeErrors = findNodeErrors(node, nodes, edges)
    if (orphans.has(node.id)) nodeErrors.push('orphan_node')
    if (nodeErrors.length > 0) {
      errors.push({ nodeId: node.id, errors: nodeErrors })
    }
  }

  return {
    valid: errors.every((e) => !e.errors.includes('start_missing') && !e.errors.includes('node_empty')),
    errors,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  }
}

export function getNodeSeverity(
  nodeId: string,
  nodes: CampaignBuilderNode[],
  edges: CampaignBuilderEdge[],
): CampaignSeverity | null {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const nodeErrors = findNodeErrors(node, nodes, edges)
  if (nodeErrors.length === 0) return null
  const ruleMap = new Map(rules.map((r) => [r.id, r.severity]))
  if (nodeErrors.some((e) => ruleMap.get(e) === 'error')) return 'error'
  if (nodeErrors.some((e) => ruleMap.get(e) === 'warning')) return 'warning'
  return null
}

export function getRuleMessage(ruleId: string): string {
  return rules.find((r) => r.id === ruleId)?.message ?? ruleId
}
