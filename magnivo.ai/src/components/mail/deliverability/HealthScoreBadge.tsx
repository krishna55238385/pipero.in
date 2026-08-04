'use client'

import { cn } from '@/lib/utils'
import type { DomainHealthLevel } from '@/types/deliverability'

type HealthScoreBadgeProps = {
  score: number
  level: DomainHealthLevel
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

const LEVEL_STYLES: Record<DomainHealthLevel, { bg: string; text: string; ring: string; label: string }> = {
  excellent: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', ring: 'ring-emerald-500/20', label: 'Excellent' },
  good: { bg: 'bg-blue-500/10', text: 'text-blue-600', ring: 'ring-blue-500/20', label: 'Good' },
  fair: { bg: 'bg-amber-500/10', text: 'text-amber-600', ring: 'ring-amber-500/20', label: 'Fair' },
  poor: { bg: 'bg-red-500/10', text: 'text-red-600', ring: 'ring-red-500/20', label: 'Poor' },
  unknown: { bg: 'bg-muted/50', text: 'text-muted-foreground', ring: 'ring-muted/20', label: 'Unknown' },
}

const SIZE_STYLES: Record<string, { container: string; text: string; ring: string }> = {
  sm: { container: 'h-16 w-16', text: 'text-lg', ring: '[stroke-width:6]' },
  md: { container: 'h-24 w-24', text: 'text-2xl', ring: '[stroke-width:5]' },
  lg: { container: 'h-32 w-32', text: 'text-3xl', ring: '[stroke-width:4]' },
}

export function HealthScoreBadge({ score, level, size = 'md', showLabel = true }: HealthScoreBadgeProps) {
  const levelStyle = LEVEL_STYLES[level]
  const sizeStyle = SIZE_STYLES[size]
  const circumference = 2 * Math.PI * 42
  const dashOffset = circumference - (score / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn('relative flex items-center justify-center', sizeStyle.container)}>
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="5" />
          <circle
            cx="50" cy="50" r="42"
            fill="none"
            stroke="currentColor"
            className={cn(levelStyle.text, sizeStyle.ring)}
            strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </svg>
        <span className={cn('font-bold tabular-nums', sizeStyle.text, levelStyle.text)}>
          {score}
        </span>
      </div>
      {showLabel && (
        <span className={cn('text-xs font-medium', levelStyle.text)}>
          {levelStyle.label}
        </span>
      )}
    </div>
  )
}

export function HealthScoreBar({ score, level }: { score: number; level: DomainHealthLevel }) {
  const style = LEVEL_STYLES[level]
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', style.text.replace('text-', 'bg-'))}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn('text-xs font-medium w-8 text-right tabular-nums', style.text)}>
        {score}
      </span>
    </div>
  )
}
