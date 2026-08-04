'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CampaignBuilderNode } from '@/types/campaign'
import { NODE_DEFINITIONS } from '@/lib/campaign-builder/constants'
import { getNodeSeverity } from '@/lib/campaign-builder/validation'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import * as Icons from 'lucide-react'

type Props = NodeProps<CampaignBuilderNode> & { showValidation?: boolean }

export default function BaseNode({ data, selected, id }: Props) {
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const edges = useCampaignBuilderStore((s) => s.edges)
  const severity = getNodeSeverity(id, nodes, edges)
  const def = NODE_DEFINITIONS.find((d) => d.type === data.nodeType)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComp = def ? (Icons as any)[def.icon] || Icons.Circle : Icons.Circle

  const borderColor = severity === 'error'
    ? 'border-red-500/60 ring-2 ring-red-500/20'
    : severity === 'warning'
      ? 'border-amber-500/60 ring-2 ring-amber-500/20'
      : selected
        ? 'border-blue-500/60 ring-2 ring-blue-500/20'
        : def?.borderColor || 'border-gray-200'

  const bgClass = def?.bgColor || 'bg-gray-500/10'
  const colorClass = def?.color || 'text-gray-600'

  return (
    <div className={`min-w-[200px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm transition-all ${borderColor}`}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white dark:!border-card" />
      <div className="flex items-center gap-2.5">
        <div className={`h-8 w-8 rounded-lg ${bgClass} ${colorClass} grid place-items-center`}>
          <IconComp className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            {def?.label || data.nodeType}
          </p>
          <p className="text-sm font-semibold truncate">{data.label}</p>
        </div>
      </div>
      <NodeDetail data={data} />
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white dark:!border-card" />
    </div>
  )
}

function NodeDetail({ data }: { data: CampaignBuilderNode['data'] }) {
  switch (data.nodeType) {
    case 'email':
      return (
        <p className="text-xs text-muted-foreground mt-2 truncate">
          {data.subject || 'No subject'}
        </p>
      )
    case 'wait':
    case 'delay':
      return (
        <p className="text-xs text-muted-foreground mt-2">
          {data.duration || 0} {data.unit || 'days'}
        </p>
      )
    case 'condition':
      return (
        <p className="text-xs text-muted-foreground mt-2 truncate">
          {data.field ? `${data.field} ${data.operator} ${data.value}` : 'Configure condition'}
        </p>
      )
    case 'split':
      return (
        <p className="text-xs text-muted-foreground mt-2">A/B Split</p>
      )
    case 'goal':
      return (
        <p className="text-xs text-muted-foreground mt-2 truncate">
          {data.goalName || 'Configure goal'}
        </p>
      )
    case 'webhook':
      return (
        <p className="text-xs text-muted-foreground mt-2 truncate">
          {data.url || 'Configure URL'}
        </p>
      )
    case 'start':
      return (
        <p className="text-xs text-emerald-500 mt-2 font-medium">Campaign entry point</p>
      )
    case 'exit':
      return (
        <p className="text-xs text-gray-500 mt-2 font-medium">End campaign for recipient</p>
      )
    default:
      return null
  }
}
