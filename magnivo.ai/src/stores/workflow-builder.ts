'use client'

import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react'
import type { TriggerEventType, WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeData } from '@/types/workflows'

type Store = {
  name: string
  status: 'active' | 'draft'
  triggerType: TriggerEventType
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  selectedNodeId: string | null
  setMeta: (meta: { name?: string; status?: 'active' | 'draft'; triggerType?: TriggerEventType }) => void
  loadGraph: (graph: WorkflowGraph) => void
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  onConnect: (connection: Connection) => void
  setSelectedNode: (id: string | null) => void
  updateSelectedNodeData: (patch: Partial<WorkflowNodeData>) => void
  addNode: (kind: WorkflowNodeData['kind']) => void
  duplicateSelectedNode: () => void
  deleteSelectedNode: () => void
  markExecuted: (nodeIds: string[]) => void
  resetExecuted: () => void
}

function makeNode(kind: WorkflowNodeData['kind'], idx: number): WorkflowNode {
  const id = `${kind}-${Date.now()}-${idx}`
  const base: WorkflowNodeData =
    kind === 'trigger'
      ? { kind, label: 'Trigger', trigger: { event: 'lead_created' } }
      : kind === 'condition'
        ? { kind, label: 'Condition', condition: { field: 'status', operator: 'equals', value: 'Hot' } }
        : { kind, label: 'Action', action: { actionType: 'create_task' } }
  const type = kind === 'trigger' ? 'triggerNode' : kind === 'condition' ? 'conditionNode' : 'actionNode'
  return {
    id,
    type,
    position: { x: 220 + idx * 10, y: 140 + idx * 20 },
    data: base,
  }
}

export const useWorkflowBuilderStore = create<Store>((set) => ({
  name: '',
  status: 'draft',
  triggerType: 'lead_created',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  setMeta: (meta) =>
    set((state) => ({
      ...state,
      name: meta.name ?? state.name,
      status: meta.status ?? state.status,
      triggerType: meta.triggerType ?? state.triggerType,
    })),
  loadGraph: (graph) => set({ nodes: graph.nodes, edges: graph.edges, selectedNodeId: null }),
  onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
  onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),
  onConnect: (connection) => set((s) => ({ edges: addEdge({ ...connection, animated: true }, s.edges) })),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  updateSelectedNodeData: (patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === s.selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    })),
  addNode: (kind) =>
    set((s) => ({
      nodes: [...s.nodes, makeNode(kind, s.nodes.length + 1)],
    })),
  duplicateSelectedNode: () =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === s.selectedNodeId)
      if (!node) return s
      const copy: WorkflowNode = {
        ...node,
        id: `${node.id}-copy-${Date.now()}`,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
      }
      return { ...s, nodes: [...s.nodes, copy] }
    }),
  deleteSelectedNode: () =>
    set((s) => {
      const id = s.selectedNodeId
      if (!id) return s
      return {
        ...s,
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: null,
      }
    }),
  markExecuted: (nodeIds) =>
    set((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, executed: nodeIds.includes(n.id) } })),
    })),
  resetExecuted: () =>
    set((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, executed: false } })),
    })),
}))

