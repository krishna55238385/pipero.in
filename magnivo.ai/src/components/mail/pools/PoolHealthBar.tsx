'use client'

import { cn } from '@/lib/utils'
import type { PoolHealthAggregation } from '@/types/mail'

type PoolHealthBarProps = {
  score: number | null
  aggregation: PoolHealthAggregation | null
  size?: 'sm' | 'md'
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 60) return 'bg-blue-500'
  if (score >= 40) return 'bg-amber-500'
  return 'bg-red-500'
}

function getScoreTextColor(score: number): string {
  if (score >= 80) return 'text-emerald-600'
  if (score >= 60) return 'text-blue-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-red-600'
}

export function PoolHealthBar({ score, aggregation, size = 'sm' }: PoolHealthBarProps) {
  const avg = score ?? aggregation?.avgHealthScore ?? 0
  const barColor = getScoreColor(avg)
  const textColor = getScoreTextColor(avg)

  return (
    <div className={cn('flex items-center gap-2', size === 'sm' ? 'text-xs' : 'text-sm')}>
      <div className={cn('flex-1 rounded-full bg-muted/20 overflow-hidden', size === 'sm' ? 'h-1.5' : 'h-2.5')}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${avg}%` }}
        />
      </div>
      <span className={cn('font-bold tabular-nums w-8 text-right', textColor)}>
        {avg}%
      </span>
    </div>
  )
}

export function PoolHealthBadge({ score }: { score: number | null }) {
  const avg = score ?? 0
  const textColor = getScoreTextColor(avg)

  return (
    <span className={cn('text-xs font-bold tabular-nums', textColor)}>
      {avg}%
    </span>
  )
}
