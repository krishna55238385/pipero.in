import type { CampaignBuilderNode, CampaignBuilderEdge, CampaignNodeType } from '@/types/campaign'

export type BuilderShortcut = {
  key: string
  label: string
  action: string
}

export const BUILDER_SHORTCUTS: BuilderShortcut[] = [
  { key: 'Ctrl+S', label: 'Save campaign', action: 'save' },
  { key: 'Ctrl+Z', label: 'Undo', action: 'undo' },
  { key: 'Ctrl+Y', label: 'Redo', action: 'redo' },
  { key: 'Ctrl+D', label: 'Duplicate node', action: 'duplicate' },
  { key: 'Delete', label: 'Delete selected', action: 'delete' },
  { key: 'Backspace', label: 'Delete selected', action: 'delete' },
  { key: 'Ctrl+L', label: 'Auto-layout', action: 'autoLayout' },
  { key: 'Escape', label: 'Deselect', action: 'deselect' },
  { key: 'Ctrl+V', label: 'Paste', action: 'paste' },
]

export type UndoState = {
  nodes: CampaignBuilderNode[]
  edges: CampaignBuilderEdge[]
}

export type UndoRedoStack = {
  past: UndoState[]
  future: UndoState[]
}

export function createEmptyUndoStack(): UndoRedoStack {
  return { past: [], future: [] }
}

export function pushUndo(
  stack: UndoRedoStack,
  nodes: CampaignBuilderNode[],
  edges: CampaignBuilderEdge[],
  maxSteps: number,
): UndoRedoStack {
  return {
    past: [...stack.past.slice(-maxSteps + 1), { nodes: [...nodes], edges: [...edges] }],
    future: [],
  }
}

export function popUndo(
  stack: UndoRedoStack,
  currentNodeState: { nodes: CampaignBuilderNode[]; edges: CampaignBuilderEdge[] },
): { stack: UndoRedoStack; nodes: CampaignBuilderNode[]; edges: CampaignBuilderEdge[] } | null {
  if (stack.past.length === 0) return null
  const prev = stack.past[stack.past.length - 1]
  return {
    stack: {
      past: stack.past.slice(0, -1),
      future: [...stack.future, { nodes: currentNodeState.nodes, edges: currentNodeState.edges }],
    },
    nodes: prev.nodes,
    edges: prev.edges,
  }
}

export function popRedo(
  stack: UndoRedoStack,
  currentNodeState: { nodes: CampaignBuilderNode[]; edges: CampaignBuilderEdge[] },
): { stack: UndoRedoStack; nodes: CampaignBuilderNode[]; edges: CampaignBuilderEdge[] } | null {
  if (stack.future.length === 0) return null
  const next = stack.future[stack.future.length - 1]
  return {
    stack: {
      past: [...stack.past, { nodes: currentNodeState.nodes, edges: currentNodeState.edges }],
      future: stack.future.slice(0, -1),
    },
    nodes: next.nodes,
    edges: next.edges,
  }
}

export function createNodeFromType(
  nodeType: CampaignNodeType,
  existingNodes: CampaignBuilderNode[],
): CampaignBuilderNode {
  const idx = existingNodes.length
  return {
    id: `${nodeType}-${Date.now()}-${idx}`,
    type: 'campaignNode',
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: nodeType.charAt(0).toUpperCase() + nodeType.slice(1).replace('_', ' '),
    },
  }
}

export function duplicateNode(
  node: CampaignBuilderNode,
  existingNodes: CampaignBuilderNode[],
): CampaignBuilderNode {
  return {
    ...node,
    id: `${node.data.nodeType}-${Date.now()}-copy-${existingNodes.length}`,
    position: { x: node.position.x + 40, y: node.position.y + 40 },
    data: { ...node.data, label: `${node.data.label} (copy)` },
  }
}
