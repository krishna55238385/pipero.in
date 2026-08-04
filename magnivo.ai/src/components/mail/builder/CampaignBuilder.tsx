'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, type NodeTypes, type OnConnect, type NodeChange, type EdgeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { useCampaignAutosave, useCampaignDragAndDrop } from '@/hooks/mail/useCampaignBuilder'
import CampaignBuilderToolbar from './CampaignBuilderToolbar'
import CampaignNodeLibrary from './CampaignNodeLibrary'
import CampaignPropertiesPanel from './CampaignPropertiesPanel'
import CampaignValidationPanel from './CampaignValidationPanel'
import CampaignVersionHistory from './CampaignVersionHistory'
import StartNode from './nodes/StartNode'
import EmailNode from './nodes/EmailNode'
import WaitNode from './nodes/WaitNode'
import ConditionNode from './nodes/ConditionNode'
import SplitNode from './nodes/SplitNode'
import GoalNode from './nodes/GoalNode'
import WebhookNode from './nodes/WebhookNode'
import DelayNode from './nodes/DelayNode'
import ExitNode from './nodes/ExitNode'
import type { CampaignBuilderNode, CampaignBuilderEdge, CampaignRecord } from '@/types/campaign'

const nodeTypes: NodeTypes = {
  startNode: StartNode as never,
  emailNode: EmailNode as never,
  waitNode: WaitNode as never,
  conditionNode: ConditionNode as never,
  splitNode: SplitNode as never,
  goalNode: GoalNode as never,
  webhookNode: WebhookNode as never,
  delayNode: DelayNode as never,
  exitNode: ExitNode as never,
}

type Props = {
  campaign: CampaignRecord
}

export default function CampaignBuilder({ campaign }: Props) {
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const edges = useCampaignBuilderStore((s) => s.edges)
  const loadCampaign = useCampaignBuilderStore((s) => s.loadCampaign)
  const onNodesChange = useCampaignBuilderStore((s) => s.onNodesChange)
  const onEdgesChange = useCampaignBuilderStore((s) => s.onEdgesChange)
  const onConnect = useCampaignBuilderStore((s) => s.onConnect)
  const setSelectedNode = useCampaignBuilderStore((s) => s.setSelectedNode)

  const [showHistory, setShowHistory] = useState(false)

  useCampaignAutosave(campaign.id)
  const { onDragOver, onDrop } = useCampaignDragAndDrop()

  useEffect(() => {
    loadCampaign(campaign)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id, loadCampaign])

  const handleNodesChange = useCallback(
    (changes: NodeChange<CampaignBuilderNode>[]) => onNodesChange(changes),
    [onNodesChange],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CampaignBuilderEdge>[]) => onEdgesChange(changes),
    [onEdgesChange],
  )

  const handleConnect: OnConnect = useCallback(
    (connection) => onConnect(connection),
    [onConnect],
  )

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: CampaignBuilderNode) => setSelectedNode(node.id),
    [setSelectedNode],
  )

  const handlePaneClick = useCallback(
    () => setSelectedNode(null),
    [setSelectedNode],
  )

  const typedNodes = useMemo(() => nodes.map((n) => ({ ...n, type: n.type || 'emailNode' })), [nodes])
  const typedEdges = useMemo(() => edges.map((e) => ({ ...e, type: 'smoothstep' as const })), [edges])

  return (
    <div className="space-y-3 h-full flex flex-col">
      <CampaignBuilderToolbar
        onToggleHistory={() => setShowHistory(!showHistory)}
        showHistory={showHistory}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_280px] gap-3" style={{ height: 'calc(100vh - 200px)' }}>
        <CampaignNodeLibrary />

        <div
          className="rounded-2xl border bg-white dark:bg-card overflow-hidden"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={typedNodes}
            edges={typedEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <div className="space-y-3 overflow-y-auto">
          {showHistory ? (
            <CampaignVersionHistory campaignId={campaign.id} />
          ) : (
            <CampaignPropertiesPanel />
          )}
          <CampaignValidationPanel />
        </div>
      </div>
    </div>
  )
}
