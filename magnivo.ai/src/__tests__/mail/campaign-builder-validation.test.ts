import { describe, it, expect } from 'vitest'
import { validateCampaignGraph, getNodeSeverity, getRuleMessage } from '@/lib/campaign-builder/validation'
import type { CampaignBuilderNode, CampaignBuilderEdge } from '@/types/campaign'

function makeNode(id: string, nodeType: CampaignBuilderNode['data']['nodeType'], extra?: Partial<CampaignBuilderNode['data']>): CampaignBuilderNode {
  return {
    id,
    type: 'campaignNode',
    position: { x: 0, y: 0 },
    data: { nodeType, label: `${nodeType}-${id}`, ...extra },
  }
}

function makeEdge(id: string, source: string, target: string, sourceHandle?: string): CampaignBuilderEdge {
  return { id, source, target, type: 'smoothstep', animated: true, sourceHandle }
}

describe('validateCampaignGraph', () => {
  it('returns error for empty graph', () => {
    const result = validateCampaignGraph([], [])
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].errors).toContain('node_empty')
  })

  it('returns error when no start node', () => {
    const nodes = [makeNode('n1', 'email')]
    const result = validateCampaignGraph(nodes, [])
    expect(result.errors.some((e) => e.errors.includes('start_missing'))).toBe(true)
  })

  it('returns valid for simple start->email->exit chain', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { subject: 'Hi', body: 'Hello' }),
      makeNode('exit', 'exit'),
    ]
    const edges = [
      makeEdge('e1', 'start', 'n1'),
      makeEdge('e2', 'n1', 'exit'),
    ]
    const result = validateCampaignGraph(nodes, edges)
    expect(result.valid).toBe(true)
    expect(result.nodeCount).toBe(3)
    expect(result.edgeCount).toBe(2)
  })

  it('flags email node missing subject', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { body: 'Hello' }),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const emailErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(emailErrors?.errors).toContain('email_no_subject')
  })

  it('flags email node missing body', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { subject: 'Hi' }),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const emailErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(emailErrors?.errors).toContain('email_no_body')
  })

  it('flags start node with incoming connections', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { subject: 'Hi', body: 'Hello' }),
    ]
    const edges = [
      makeEdge('e1', 'start', 'n1'),
      makeEdge('e2', 'n1', 'start'),
    ]
    const result = validateCampaignGraph(nodes, edges)
    const startErrors = result.errors.find((e) => e.nodeId === 'start')
    expect(startErrors?.errors).toContain('start_incoming')
  })

  it('flags start node without outgoing connections', () => {
    const nodes = [makeNode('start', 'start')]
    const result = validateCampaignGraph(nodes, [])
    const startErrors = result.errors.find((e) => e.nodeId === 'start')
    expect(startErrors?.errors).toContain('start_outgoing')
  })

  it('flags orphan nodes not reachable from start', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { subject: 'Hi', body: 'Hello' }),
      makeNode('n2', 'email', { subject: 'Hi2', body: 'Hello2' }),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const orphanErrors = result.errors.find((e) => e.nodeId === 'n2')
    expect(orphanErrors?.errors).toContain('orphan_node')
  })

  it('flags wait node missing duration', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'wait', { duration: 0 }),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const waitErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(waitErrors?.errors).toContain('wait_missing_duration')
  })

  it('flags condition node missing field', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'condition'),
    ]
    const edges = [
      makeEdge('e1', 'start', 'n1'),
      makeEdge('e2', 'n1', 'start', 'true'),
    ]
    const result = validateCampaignGraph(nodes, edges)
    const condErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(condErrors?.errors).toContain('condition_no_field')
  })

  it('flags condition node without outgoing connections', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'condition', { field: 'email_opened' }),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const condErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(condErrors?.errors).toContain('condition_one_branch')
  })

  it('flags goal node missing name', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'goal'),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const goalErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(goalErrors?.errors).toContain('goal_no_name')
  })

  it('flags webhook node missing url', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'webhook'),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const whErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(whErrors?.errors).toContain('webhook_no_url')
  })

  it('flags disconnected nodes', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { subject: 'Hi', body: 'Hello' }),
    ]
    const result = validateCampaignGraph(nodes, [])
    const n1Errors = result.errors.find((e) => e.nodeId === 'n1')
    expect(n1Errors?.errors).toContain('node_disconnected')
  })

  it('does not flag disabled node types', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'ai_send'),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    const result = validateCampaignGraph(nodes, edges)
    const aiErrors = result.errors.find((e) => e.nodeId === 'n1')
    expect(aiErrors).toBeUndefined()
  })

  it('validates complex multi-branch graph', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('email1', 'email', { subject: 'Email 1', body: 'Body 1' }),
      makeNode('cond', 'condition', { field: 'email_opened' }),
      makeNode('email2', 'email', { subject: 'Email 2', body: 'Body 2' }),
      makeNode('email3', 'email', { subject: 'Email 3', body: 'Body 3' }),
      makeNode('exit', 'exit'),
    ]
    const edges = [
      makeEdge('e1', 'start', 'email1'),
      makeEdge('e2', 'email1', 'cond'),
      makeEdge('e3', 'cond', 'email2', 'true'),
      makeEdge('e4', 'cond', 'email3', 'false'),
      makeEdge('e5', 'email2', 'exit'),
      makeEdge('e6', 'email3', 'exit'),
    ]
    const result = validateCampaignGraph(nodes, edges)
    expect(result.valid).toBe(true)
  })
})

describe('getNodeSeverity', () => {
  it('returns null for valid node', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { subject: 'Hi', body: 'Hello' }),
    ]
    const edges = [
      makeEdge('e1', 'start', 'n1'),
    ]
    expect(getNodeSeverity('start', nodes, edges)).toBeNull()
  })

  it('returns error for email without subject', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('n1', 'email', { body: 'Hello' }),
    ]
    const edges = [makeEdge('e1', 'start', 'n1')]
    expect(getNodeSeverity('n1', nodes, edges)).toBe('error')
  })

  it('returns null for unknown node id', () => {
    expect(getNodeSeverity('unknown', [], [])).toBeNull()
  })
})

describe('getRuleMessage', () => {
  it('returns message for known rule', () => {
    const msg = getRuleMessage('email_no_subject')
    expect(msg).toContain('subject')
  })

  it('returns ruleId for unknown rule', () => {
    expect(getRuleMessage('unknown_rule')).toBe('unknown_rule')
  })
})
