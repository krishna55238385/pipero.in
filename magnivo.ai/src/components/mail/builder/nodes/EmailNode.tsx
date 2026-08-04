'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Mail } from 'lucide-react'
import type { CampaignBuilderNode } from '@/types/campaign'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { getNodeSeverity } from '@/lib/campaign-builder/validation'

export default function EmailNode({ data, selected, id }: NodeProps<CampaignBuilderNode>) {
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const edges = useCampaignBuilderStore((s) => s.edges)
  const severity = getNodeSeverity(id, nodes, edges)

  const borderClass = severity === 'error'
    ? 'border-red-500/60 ring-2 ring-red-500/20'
    : severity === 'warning'
      ? 'border-amber-500/60 ring-2 ring-amber-500/20'
      : selected
        ? 'border-blue-500/60 ring-2 ring-blue-500/20'
        : 'border-blue-500/30'

  return (
    <div className={`min-w-[200px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm transition-all ${borderClass}`}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white dark:!border-card" />
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 grid place-items-center">
          <Mail className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Email</p>
          <p className="text-sm font-semibold truncate">{data.label}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 truncate">
        {data.subject || 'No subject set'}
      </p>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white dark:!border-card" />
    </div>
  )
}
