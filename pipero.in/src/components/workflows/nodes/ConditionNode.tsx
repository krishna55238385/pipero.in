'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Split } from 'lucide-react'
import type { WorkflowNode } from '@/types/workflows'

export default function ConditionNode({ data, selected }: NodeProps<WorkflowNode>) {
  const condition = data.condition
  return (
    <div className={`min-w-[220px] rounded-xl border p-3 bg-white dark:bg-card shadow-sm ${selected ? 'ring-2 ring-blue-500/40' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-blue-500/15 text-blue-600 grid place-items-center">
          <Split className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Condition</p>
          <p className="text-sm font-semibold">{data.label}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {condition ? `${condition.field} ${condition.operator} ${condition.value}` : 'Configure condition'}
      </p>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>True/False branch</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

