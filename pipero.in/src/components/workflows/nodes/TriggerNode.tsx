'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Zap } from 'lucide-react'
import type { WorkflowNode } from '@/types/workflows'

export default function TriggerNode({ data, selected }: NodeProps<WorkflowNode>) {
  return (
    <div className={`min-w-[180px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm ${selected ? 'ring-2 ring-blue-500/40' : ''}`}>
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-amber-500/15 text-amber-600 grid place-items-center">
          <Zap className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Trigger</p>
          <p className="text-sm font-semibold">{data.label}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{data.trigger?.event || 'Select event'}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

