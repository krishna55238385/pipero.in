'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { PlayCircle } from 'lucide-react'
import type { WorkflowNode } from '@/types/workflows'

export default function ActionNode({ data, selected }: NodeProps<WorkflowNode>) {
  return (
    <div
      className={`min-w-[200px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm ${
        selected ? 'ring-2 ring-blue-500/40' : ''
      } ${data.executed ? 'border-emerald-500/40 bg-emerald-500/5' : ''}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-emerald-500/15 text-emerald-600 grid place-items-center">
          <PlayCircle className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Action</p>
          <p className="text-sm font-semibold">{data.label}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{data.action?.actionType || 'Configure action'}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

