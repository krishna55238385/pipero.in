import { describe, it, expect } from 'vitest'
import {
  createEmptyUndoStack,
  pushUndo,
  popUndo,
  popRedo,
  createNodeFromType,
  duplicateNode,
} from '@/lib/campaign-builder/shortcuts'
import type { CampaignBuilderNode, CampaignBuilderEdge } from '@/types/campaign'

function makeNode(id: string, nodeType: CampaignBuilderNode['data']['nodeType'] = 'email'): CampaignBuilderNode {
  return {
    id,
    type: 'campaignNode',
    position: { x: 0, y: 0 },
    data: { nodeType, label: id },
  }
}

function makeEdge(id: string, source: string, target: string): CampaignBuilderEdge {
  return { id, source, target, type: 'smoothstep', animated: true }
}

describe('createEmptyUndoStack', () => {
  it('creates empty past and future', () => {
    const stack = createEmptyUndoStack()
    expect(stack.past).toEqual([])
    expect(stack.future).toEqual([])
  })
})

describe('pushUndo', () => {
  it('adds state to past', () => {
    const stack = createEmptyUndoStack()
    const nodes = [makeNode('a')]
    const edges = [makeEdge('e1', 'a', 'b')]
    const result = pushUndo(stack, nodes, edges, 50)
    expect(result.past).toHaveLength(1)
    expect(result.future).toEqual([])
  })

  it('respects maxSteps', () => {
    let stack = createEmptyUndoStack()
    for (let i = 0; i < 5; i++) {
      stack = pushUndo(stack, [makeNode(`n${i}`)], [], 3)
    }
    expect(stack.past).toHaveLength(3)
    expect(stack.past[0].nodes[0].id).toBe('n2')
  })

  it('clears future when new action is pushed', () => {
    let stack = createEmptyUndoStack()
    stack = pushUndo(stack, [makeNode('a')], [], 50)
    const afterPop = popUndo(stack, { nodes: [makeNode('b')], edges: [] })!
    stack = afterPop.stack
    stack = pushUndo(stack, [makeNode('c')], [], 50)
    expect(stack.future).toEqual([])
  })
})

describe('popUndo', () => {
  it('returns null on empty stack', () => {
    const stack = createEmptyUndoStack()
    const result = popUndo(stack, { nodes: [], edges: [] })
    expect(result).toBeNull()
  })

  it('restores previous state', () => {
    let stack = createEmptyUndoStack()
    const nodes1 = [makeNode('a')]
    const nodes2 = [makeNode('b')]
    stack = pushUndo(stack, nodes1, [], 50)
    const result = popUndo(stack, { nodes: nodes2, edges: [] })!
    expect(result.nodes[0].id).toBe('a')
    expect(result.stack.past).toHaveLength(0)
    expect(result.stack.future).toHaveLength(1)
  })
})

describe('popRedo', () => {
  it('returns null on empty future', () => {
    const stack = createEmptyUndoStack()
    const result = popRedo(stack, { nodes: [], edges: [] })
    expect(result).toBeNull()
  })

  it('restores next state', () => {
    let stack = createEmptyUndoStack()
    const nodes1 = [makeNode('a')]
    const nodes2 = [makeNode('b')]
    stack = pushUndo(stack, nodes1, [], 50)
    const afterUndo = popUndo(stack, { nodes: nodes2, edges: [] })!
    stack = afterUndo.stack
    const result = popRedo(stack, { nodes: nodes2, edges: [] })!
    expect(result.nodes[0].id).toBe('b')
    expect(result.stack.future).toHaveLength(0)
    expect(result.stack.past).toHaveLength(1)
  })
})

describe('createNodeFromType', () => {
  it('creates node with correct type and label', () => {
    const node = createNodeFromType('email', [])
    expect(node.data.nodeType).toBe('email')
    expect(node.data.label).toBe('Email')
    expect(node.id).toContain('email-')
  })

  it('creates node with unique ids', () => {
    const existing = [makeNode('email-123-0')]
    const node1 = createNodeFromType('email', existing)
    const node2 = createNodeFromType('email', [...existing, node1])
    expect(node1.id).not.toBe(node2.id)
  })

  it('capitalizes label correctly', () => {
    const node = createNodeFromType('ai_send', [])
    expect(node.data.label).toBe('Ai send')
  })
})

describe('duplicateNode', () => {
  it('creates copy with different id', () => {
    const original = makeNode('email-1000-0', 'email')
    const copy = duplicateNode(original, [original])
    expect(copy.id).not.toBe(original.id)
    expect(copy.data.label).toContain('copy')
  })

  it('offsets position', () => {
    const original = { ...makeNode('a'), position: { x: 100, y: 200 } }
    const copy = duplicateNode(original, [original])
    expect(copy.position.x).toBe(140)
    expect(copy.position.y).toBe(240)
  })
})
