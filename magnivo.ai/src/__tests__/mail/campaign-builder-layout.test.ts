import { describe, it, expect } from 'vitest'
import { autoLayoutNodes } from '@/lib/campaign-builder/auto-layout'
import type { CampaignBuilderNode, CampaignBuilderEdge } from '@/types/campaign'

function makeNode(id: string, x: number = 0, y: number = 0): CampaignBuilderNode {
  return {
    id,
    type: 'campaignNode',
    position: { x, y },
    data: { nodeType: 'email', label: id },
  }
}

function makeEdge(id: string, source: string, target: string): CampaignBuilderEdge {
  return { id, source, target, type: 'smoothstep', animated: true }
}

describe('autoLayoutNodes', () => {
  it('returns empty array for empty input', () => {
    expect(autoLayoutNodes([], [])).toEqual([])
  })

  it('lays out linear chain vertically', () => {
    const nodes = [makeNode('start'), makeNode('n1', 500, 500), makeNode('n2', 800, 800)]
    const edges = [makeEdge('e1', 'start', 'n1'), makeEdge('e2', 'n1', 'n2')]
    const result = autoLayoutNodes(nodes, edges)
    expect(result).toHaveLength(3)
    expect(result[0].position.y).toBe(0)
    expect(result[1].position.y).toBeGreaterThan(0)
    expect(result[2].position.y).toBeGreaterThan(result[1].position.y)
  })

  it('lays out branching graph with nodes at same level', () => {
    const nodes = [makeNode('start'), makeNode('n1'), makeNode('n2')]
    const edges = [makeEdge('e1', 'start', 'n1'), makeEdge('e2', 'start', 'n2')]
    const result = autoLayoutNodes(nodes, edges)
    const n1 = result.find((n) => n.id === 'n1')
    const n2 = result.find((n) => n.id === 'n2')
    expect(n1?.position.y).toBe(n2?.position.y)
  })

  it('preserves node ids after layout', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')]
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
    const result = autoLayoutNodes(nodes, edges)
    expect(result.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('handles single node', () => {
    const nodes = [makeNode('only')]
    const result = autoLayoutNodes(nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0].position.y).toBe(0)
  })
})
