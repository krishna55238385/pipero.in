'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Play } from 'lucide-react'
import type { CampaignBuilderNode } from '@/types/campaign'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { getNodeSeverity } from '@/lib/campaign-builder/validation'

export default function StartNode({ data, selected, id }: NodeProps<CampaignBuilderNode>) {
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const edges = useCampaignBuilderStore((s) => s.edges)
  const severity = getNodeSeverity(id, nodes, edges)

  const borderClass = severity === 'error'
    ? 'border-red-500/60 ring-2 ring-red-500/20'
    : selected
      ? 'border-blue-500/60 ring-2 ring-blue-500/20'
      : 'border-emerald-500/30'

  return (
    <div className={`min-w-[200px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm transition-all ${borderClass}`}>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 grid place-items-center">
          <Play className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Start</p>
          <p className="text-sm font-semibold">{data.label}</p>
        </div>
      </div>
      <p className="text-xs text-emerald-500 mt-2 font-medium">Campaign entry point</p>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-white dark:!border-card" />
    </div>
  )
}
