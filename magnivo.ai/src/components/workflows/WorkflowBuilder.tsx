'use client'

import { useEffect } from 'react'
import { ReactFlow, Background, Controls, MiniMap, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TopBar from '@/components/workflows/TopBar'
import NodePanel from '@/components/workflows/NodePanel'
import ConfigSidebar from '@/components/workflows/ConfigSidebar'
import TriggerNode from '@/components/workflows/nodes/TriggerNode'
import ConditionNode from '@/components/workflows/nodes/ConditionNode'
import ActionNode from '@/components/workflows/nodes/ActionNode'
import { useWorkflowBuilderStore } from '@/stores/workflow-builder'
import type { WorkflowRecord } from '@/types/workflows'

const nodeTypes: NodeTypes = {
  triggerNode: TriggerNode,
  conditionNode: ConditionNode,
  actionNode: ActionNode,
}

export default function WorkflowBuilder({ workflow }: { workflow: WorkflowRecord }) {
  const { nodes, edges, loadGraph, onNodesChange, onEdgesChange, onConnect, setSelectedNode, setMeta } =
    useWorkflowBuilderStore((s) => s)

  useEffect(() => {
    setMeta({
      name: workflow.name,
      status: workflow.status,
      triggerType: workflow.triggerType,
    })
    loadGraph(workflow.graph)
  }, [workflow.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <TopBar workflowId={workflow.id} />

      <div className="grid grid-cols-1 xl:grid-cols-[250px_minmax(0,1fr)_320px] gap-3 h-[calc(100vh-220px)] min-h-[620px]">
        <NodePanel />

        <div className="rounded-2xl border bg-white dark:bg-card overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node.id)}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <ConfigSidebar />
      </div>
    </div>
  )
}

