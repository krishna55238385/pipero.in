'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { LogOut } from 'lucide-react'
import type { CampaignBuilderNode } from '@/types/campaign'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { getNodeSeverity } from '@/lib/campaign-builder/validation'

export default function ExitNode({ data, selected, id }: NodeProps<CampaignBuilderNode>) {
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const edges = useCampaignBuilderStore((s) => s.edges)
  const severity = getNodeSeverity(id, nodes, edges)

  const borderClass = severity === 'error'
    ? 'border-red-500/60 ring-2 ring-red-500/20'
    : selected
      ? 'border-blue-500/60 ring-2 ring-blue-500/20'
      : 'border-gray-300 dark:border-gray-600'

  return (
    <div className={`min-w-[200px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm transition-all ${borderClass}`}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white dark:!border-card" />
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-gray-500/10 text-gray-600 grid place-items-center">
          <LogOut className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Exit</p>
          <p className="text-sm font-semibold truncate">{data.label}</p>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-2 font-medium">End campaign for recipient</p>
    </div>
  )
}
