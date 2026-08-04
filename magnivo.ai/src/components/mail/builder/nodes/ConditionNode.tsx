'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranch } from 'lucide-react'
import type { CampaignBuilderNode } from '@/types/campaign'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { getNodeSeverity } from '@/lib/campaign-builder/validation'

export default function ConditionNode({ data, selected, id }: NodeProps<CampaignBuilderNode>) {
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const edges = useCampaignBuilderStore((s) => s.edges)
  const severity = getNodeSeverity(id, nodes, edges)

  const borderClass = severity === 'error'
    ? 'border-red-500/60 ring-2 ring-red-500/20'
    : selected
      ? 'border-blue-500/60 ring-2 ring-blue-500/20'
      : 'border-purple-500/30'

  return (
    <div className={`min-w-[220px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm transition-all ${borderClass}`}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white dark:!border-card" />
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-600 grid place-items-center">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Condition</p>
          <p className="text-sm font-semibold truncate">{data.label}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 truncate">
        {data.field ? `${data.field} ${data.operator} ${data.value}` : 'Configure condition'}
      </p>
      <div className="mt-2 flex gap-1">
        <div className="flex-1 h-1.5 rounded-full bg-emerald-400/40" title="True branch" />
        <div className="flex-1 h-1.5 rounded-full bg-red-400/40" title="False branch" />
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-white dark:!border-card !left-[30%]"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="!w-2.5 !h-2.5 !bg-red-400 !border-2 !border-white dark:!border-card !left-[70%]"
      />
    </div>
  )
}
