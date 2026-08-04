import type { CampaignBuilderNode, CampaignBuilderEdge } from '@/types/campaign'
import { NODE_WIDTH, NODE_SPACING_X, NODE_SPACING_Y } from './constants'

type LayoutNode = {
  id: string
  x: number
  y: number
  outDegree: number
}

type LayoutEdge = {
  source: string
  target: string
}

function buildAdjacency(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    const list = adj.get(e.source)
    if (list) list.push(e.target)
  }
  return adj
}

function computeLevels(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, number> {
  const adj = buildAdjacency(nodes, edges)
  const inDeg = new Map<string, number>()
  for (const n of nodes) inDeg.set(n.id, 0)
  for (const e of edges) inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1)

  const levels = new Map<string, number>()
  const queue: { id: string; level: number }[] = []

  for (const n of nodes) {
    if ((inDeg.get(n.id) || 0) === 0) {
      queue.push({ id: n.id, level: 0 })
    }
  }

  while (queue.length > 0) {
    const { id, level } = queue.shift()!
    if (levels.has(id)) continue
    levels.set(id, level)

    for (const child of adj.get(id) || []) {
      inDeg.set(child, (inDeg.get(child) || 0) - 1)
      if ((inDeg.get(child) || 0) <= 0) {
        queue.push({ id: child, level: level + 1 })
      }
    }
  }

  for (const n of nodes) {
    if (!levels.has(n.id)) levels.set(n.id, 0)
  }

  return levels
}

export function autoLayoutNodes(
  nodes: CampaignBuilderNode[],
  edges: CampaignBuilderEdge[],
): CampaignBuilderNode[] {
  if (nodes.length === 0) return []

  const layoutNodes: LayoutNode[] = nodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    outDegree: edges.filter((e) => e.source === n.id).length,
  }))

  const layoutEdges: LayoutEdge[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
  }))

  const levels = computeLevels(layoutNodes, layoutEdges)

  const levelGroups = new Map<number, LayoutNode[]>()
  for (const ln of layoutNodes) {
    const level = levels.get(ln.id) || 0
    if (!levelGroups.has(level)) levelGroups.set(level, [])
    levelGroups.get(level)!.push(ln)
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  for (const [level, group] of levelGroups) {
    const totalWidth = group.length * NODE_WIDTH + Math.max(0, group.length - 1) * NODE_SPACING_X
    const startX = -totalWidth / 2

    for (let i = 0; i < group.length; i++) {
      const ln = group[i]
      const node = nodeMap.get(ln.id)
      if (node) {
        node.position.x = startX + i * (NODE_WIDTH + NODE_SPACING_X)
        node.position.y = level * NODE_SPACING_Y
      }
    }
  }

  return nodes.map((n) => nodeMap.get(n.id) || n)
}
