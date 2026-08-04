'use client'

import { cn } from '@/lib/utils'

type PoolCapacityBarProps = {
  totalCapacity: number
  used: number
  limit: number
  showLabel?: boolean
  size?: 'sm' | 'md'
}

export function PoolCapacityBar({ totalCapacity, used, limit, showLabel = true, size = 'sm' }: PoolCapacityBarProps) {
  const effectiveCapacity = Math.min(totalCapacity, limit)
  const usagePercent = effectiveCapacity > 0 ? Math.round((used / effectiveCapacity) * 100) : 0
  const barColor = usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
  const textColor = usagePercent > 90 ? 'text-red-600' : usagePercent > 70 ? 'text-amber-600' : 'text-emerald-600'

  return (
    <div className="space-y-1">
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Capacity</span>
          <span className="text-muted-foreground">
            <span className={cn('font-medium', textColor)}>{used}</span>
            {' / '}
            <span>{effectiveCapacity}</span>
            {' / '}
            <span>{limit} limit</span>
          </span>
        </div>
      )}
      <div className={cn('rounded-full bg-muted/20 overflow-hidden', size === 'sm' ? 'h-1.5' : 'h-2.5')}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${Math.min(usagePercent, 100)}%` }}
        />
      </div>
    </div>
  )
}
