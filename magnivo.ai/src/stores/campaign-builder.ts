'use client'

import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react'
import type {
  CampaignBuilderNode,
  CampaignBuilderEdge,
  CampaignNodeType,
  CampaignRecord,
  CampaignStatus,
} from '@/types/campaign'
import {
  createNodeFromType,
  createEmptyUndoStack,
  duplicateNode,
  pushUndo,
  popUndo,
  popRedo,
} from '@/lib/campaign-builder/shortcuts'
import { autoLayoutNodes } from '@/lib/campaign-builder/auto-layout'
import { validateCampaignGraph, type CampaignValidationResult } from '@/lib/campaign-builder/validation'
import { MAX_UNDO_STEPS } from '@/lib/campaign-builder/constants'
import { persistCampaign, getCampaign } from '@/app/actions/campaigns'

type BuilderMeta = {
  id: string | null
  name: string
  status: CampaignStatus
  tags: string[]
  folderId: string | null
  sequenceId: string | null
  templateId: string | null
}

type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedAt: number | null
  error: string | null
}

type Store = {
  meta: BuilderMeta
  nodes: CampaignBuilderNode[]
  edges: CampaignBuilderEdge[]
  selectedNodeId: string | null
  clipboard: { nodes: CampaignBuilderNode[]; edges: CampaignBuilderEdge[] } | null
  undoStack: ReturnType<typeof createEmptyUndoStack>
  validation: CampaignValidationResult
  saveState: SaveState
  isDirty: boolean

  setMeta: (patch: Partial<BuilderMeta>) => void
  loadCampaign: (campaign: CampaignRecord) => void
  loadCampaignById: (id: string) => Promise<void>
  onNodesChange: (changes: NodeChange<CampaignBuilderNode>[]) => void
  onEdgesChange: (changes: EdgeChange<CampaignBuilderEdge>[]) => void
  onConnect: (connection: Connection) => void
  setSelectedNode: (id: string | null) => void
  updateNodeData: (nodeId: string, patch: Partial<CampaignBuilderNode['data']>) => void
  addNode: (nodeType: CampaignNodeType) => void
  duplicateSelectedNode: () => void
  deleteSelectedNode: () => void
  copySelected: () => void
  paste: () => void
  undo: () => void
  redo: () => void
  autoLayout: () => void
  save: () => Promise<void>
  refreshValidation: () => void
}

function recordUndo(state: Store): { undoStack: Store['undoStack'] } {
  const undoStack = pushUndo(state.undoStack, state.nodes, state.edges, MAX_UNDO_STEPS)
  return { undoStack }
}

function campaignToBuilderNodes(campaign: CampaignRecord): CampaignBuilderNode[] {
  const nodes: CampaignBuilderNode[] = []

  nodes.push({
    id: 'start',
    type: 'campaignNode',
    position: { x: 0, y: 0 },
    data: { nodeType: 'start', label: 'Start' },
  })

  if (campaign.sequences?.[0]?.steps) {
    for (let i = 0; i < campaign.sequences[0].steps.length; i++) {
      const step = campaign.sequences[0].steps[i]
      const config = step.conditionConfig || {}
      nodes.push({
        id: step.id || `node-${i}`,
        type: 'campaignNode',
        position: { x: 0, y: (i + 1) * 160 },
        data: {
          nodeType: ((config.nodeType as string) || 'email') as CampaignNodeType,
          label: `Step ${i + 1}`,
          subject: step.subject,
          body: step.bodyHtml || step.bodyText,
          duration: (step.delayDays || 0) * 24 + (step.delayHours || 0),
          unit: 'hours',
        },
      })
    }
  }

  if (campaign.nodes) {
    for (const node of campaign.nodes) {
      if (nodes.find((n) => n.id === node.id)) continue
      const cfg = node.config || {}
      nodes.push({
        id: node.id,
        type: 'campaignNode',
        position: { x: node.positionX ?? 0, y: node.positionY ?? 0 },
        data: {
          nodeType: (node.nodeType as CampaignNodeType) || 'email',
          label: node.label || node.nodeType?.charAt(0).toUpperCase() + node.nodeType?.slice(1) || 'Node',
          subject: cfg.subject as string | undefined,
          body: cfg.body as string | undefined,
          duration: cfg.duration as number | undefined,
          unit: cfg.unit as string | undefined,
          field: cfg.field as string | undefined,
          operator: cfg.operator as string | undefined,
          value: cfg.value as string | undefined,
          url: cfg.url as string | undefined,
          method: cfg.method as string | undefined,
          goalName: cfg.goalName as string | undefined,
          goalType: cfg.goalType as string | undefined,
        },
      })
    }
  }

  return nodes
}

function campaignToBuilderEdges(campaign: CampaignRecord): CampaignBuilderEdge[] {
  const edges: CampaignBuilderEdge[] = []

  if (campaign.edges) {
    for (const edge of campaign.edges) {
      edges.push({
        id: edge.id || `e-${edge.sourceNodeId}-${edge.targetNodeId}`,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label: edge.label,
        animated: true,
        type: 'smoothstep',
      })
    }
  }

  if (edges.length === 0 && campaign.sequences?.[0]?.steps) {
    const steps = campaign.sequences[0].steps
    edges.push({
      id: 'e-start-0',
      source: 'start',
      target: steps[0]?.id || 'node-0',
      animated: true,
      type: 'smoothstep',
    })
    for (let i = 0; i < steps.length - 1; i++) {
      edges.push({
        id: `e-${i}-${i + 1}`,
        source: steps[i].id || `node-${i}`,
        target: steps[i + 1].id || `node-${i + 1}`,
        animated: true,
        type: 'smoothstep',
      })
    }
  }

  return edges
}

export const useCampaignBuilderStore = create<Store>((set, get) => ({
  meta: { id: null, name: '', status: 'draft', tags: [], folderId: null, sequenceId: null, templateId: null },
  nodes: [],
  edges: [],
  selectedNodeId: null,
  clipboard: null,
  undoStack: createEmptyUndoStack(),
  validation: { valid: false, errors: [], nodeCount: 0, edgeCount: 0 },
  saveState: { status: 'idle', lastSavedAt: null, error: null },
  isDirty: false,

  setMeta: (patch) =>
    set((s) => ({ meta: { ...s.meta, ...patch }, isDirty: true })),

  loadCampaign: (campaign) => {
    const nodes = campaignToBuilderNodes(campaign)
    const edges = campaignToBuilderEdges(campaign)
    const validation = validateCampaignGraph(nodes, edges)
    set({
      meta: {
        id: campaign.id,
        name: campaign.name || '',
        status: campaign.status || 'draft',
        tags: campaign.tags?.map((t) => t.name) || [],
        folderId: campaign.folderId || null,
        sequenceId: campaign.sequences?.[0]?.id || null,
        templateId: null,
      },
      nodes,
      edges,
      selectedNodeId: null,
      validation,
      isDirty: false,
      saveState: { status: 'idle', lastSavedAt: null, error: null },
    })
  },

  loadCampaignById: async (id) => {
    const campaign = await getCampaign(id)
    if (campaign) get().loadCampaign(campaign)
  },

  onNodesChange: (changes) =>
    set((s) => {
      const nodes = applyNodeChanges(changes, s.nodes)
      const validation = validateCampaignGraph(nodes, s.edges)
      return { nodes, validation, isDirty: true }
    }),

  onEdgesChange: (changes) =>
    set((s) => {
      const edges = applyEdgeChanges(changes, s.edges)
      const validation = validateCampaignGraph(s.nodes, edges)
      return { edges, validation, isDirty: true }
    }),

  onConnect: (connection) =>
    set((s) => {
      const edges = addEdge(
        { ...connection, animated: true, type: 'smoothstep' },
        s.edges,
      )
      const validation = validateCampaignGraph(s.nodes, edges)
      return { edges, validation, isDirty: true }
    }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  updateNodeData: (nodeId, patch) =>
    set((s) => {
      const undo = recordUndo(s)
      return {
        ...undo,
        nodes: s.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
        isDirty: true,
      }
    }),

  addNode: (nodeType) =>
    set((s) => {
      const undo = recordUndo(s)
      const newNode = createNodeFromType(nodeType, s.nodes)
      return {
        ...undo,
        nodes: [...s.nodes, newNode],
        selectedNodeId: newNode.id,
        isDirty: true,
      }
    }),

  duplicateSelectedNode: () =>
    set((s) => {
      if (!s.selectedNodeId) return s
      const node = s.nodes.find((n) => n.id === s.selectedNodeId)
      if (!node) return s
      const undo = recordUndo(s)
      const copy = duplicateNode(node, s.nodes)
      return {
        ...undo,
        nodes: [...s.nodes, copy],
        selectedNodeId: copy.id,
        isDirty: true,
      }
    }),

  deleteSelectedNode: () =>
    set((s) => {
      if (!s.selectedNodeId) return s
      const id = s.selectedNodeId
      if (id === 'start') return s
      const undo = recordUndo(s)
      return {
        ...undo,
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: null,
        isDirty: true,
      }
    }),

  copySelected: () =>
    set((s) => {
      if (!s.selectedNodeId) return s
      const node = s.nodes.find((n) => n.id === s.selectedNodeId)
      if (!node) return s
      const connectedEdges = s.edges.filter(
        (e) => e.source === s.selectedNodeId || e.target === s.selectedNodeId,
      )
      return { clipboard: { nodes: [node], edges: connectedEdges } }
    }),

  paste: () =>
    set((s) => {
      if (!s.clipboard) return s
      const undo = recordUndo(s)
      const idMap = new Map<string, string>()
      const newNodes = s.clipboard.nodes.map((n) => {
        const newId = `${n.data.nodeType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        idMap.set(n.id, newId)
        return {
          ...n,
          id: newId,
          position: { x: n.position.x + 60, y: n.position.y + 60 },
          data: { ...n.data, label: `${n.data.label} (copy)` },
        }
      })
      const newEdges = s.clipboard.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: `e-${idMap.get(e.source)}-${idMap.get(e.target)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        }))
      return {
        ...undo,
        nodes: [...s.nodes, ...newNodes],
        edges: [...s.edges, ...newEdges],
        selectedNodeId: newNodes[0]?.id || null,
        isDirty: true,
      }
    }),

  undo: () =>
    set((s) => {
      const result = popUndo(s.undoStack, { nodes: s.nodes, edges: s.edges })
      if (!result) return s
      const validation = validateCampaignGraph(result.nodes, result.edges)
      return { undoStack: result.stack, nodes: result.nodes, edges: result.edges, validation, isDirty: true }
    }),

  redo: () =>
    set((s) => {
      const result = popRedo(s.undoStack, { nodes: s.nodes, edges: s.edges })
      if (!result) return s
      const validation = validateCampaignGraph(result.nodes, result.edges)
      return { undoStack: result.stack, nodes: result.nodes, edges: result.edges, validation, isDirty: true }
    }),

  autoLayout: () =>
    set((s) => {
      const undo = recordUndo(s)
      const nodes = autoLayoutNodes(s.nodes, s.edges)
      return { ...undo, nodes, isDirty: true }
    }),

  save: async () => {
    const { meta, nodes, edges } = get()
    if (!meta.id) return
    set({ saveState: { status: 'saving', lastSavedAt: null, error: null } })
    try {
      const graphNodes = nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        name: n.data.label,
        positionX: n.position.x,
        positionY: n.position.y,
        subject: n.data.subject,
        body: n.data.body,
        duration: n.data.duration,
        unit: n.data.unit,
        field: n.data.field,
        operator: n.data.operator,
        value: n.data.value,
        url: n.data.url,
        method: n.data.method,
        goalName: n.data.goalName,
        goalType: n.data.goalType,
      }))
      const graphEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
      }))
      await persistCampaign({
        id: meta.id,
        name: meta.name,
        nodes: graphNodes,
        edges: graphEdges,
      })
      set({ saveState: { status: 'saved', lastSavedAt: Date.now(), error: null }, isDirty: false })
    } catch (e) {
      set({ saveState: { status: 'error', lastSavedAt: null, error: e instanceof Error ? e.message : 'Save failed' } })
    }
  },

  refreshValidation: () =>
    set((s) => ({ validation: validateCampaignGraph(s.nodes, s.edges) })),
}))
