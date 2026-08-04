'use client'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Users,
  Mail,
  Flame,
  Activity,
  RotateCcw,
  Zap,
  Clock,
  Globe,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PoolHealthBar } from './PoolHealthBar'
import { PoolCapacityBar } from './PoolCapacityBar'
import type { MailboxPoolResponse } from '@/types/mail'

type PoolCardProps = {
  pool: MailboxPoolResponse
  isSelected: boolean
  onSelect: () => void
  onVerify: () => void
  isVerifying: boolean
}

const STRATEGY_LABELS: Record<string, { label: string; icon: typeof Zap }> = {
  standard: { label: 'Standard', icon: Zap },
  throttled: { label: 'Throttled', icon: Clock },
  aggressive: { label: 'Aggressive', icon: Zap },
  conservative: { label: 'Conservative', icon: Clock },
}

const ROTATION_LABELS: Record<string, { label: string; icon: typeof RotateCcw }> = {
  round_robin: { label: 'Round Robin', icon: RotateCcw },
  weighted: { label: 'Weighted', icon: Activity },
  least_used: { label: 'Least Used', icon: Activity },
  random: { label: 'Random', icon: RotateCcw },
  priority: { label: 'Priority', icon: Activity },
  adaptive: { label: 'Adaptive', icon: Activity },
}

export function PoolCard({ pool, isSelected, onSelect, onVerify, isVerifying }: PoolCardProps) {
  const health = pool.healthAggregation
  const strategy = STRATEGY_LABELS[pool.sendingStrategy] ?? STRATEGY_LABELS.standard
  const rotation = ROTATION_LABELS[pool.rotationStrategy] ?? ROTATION_LABELS.round_robin
  const StrategyIcon = strategy.icon
  const RotationIcon = rotation.icon

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        isSelected && 'ring-2 ring-primary'
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold truncate">{pool.name}</h3>
              <Badge variant={pool.status === 'active' ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                {pool.status}
              </Badge>
            </div>
            {pool.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{pool.description}</p>
            )}
          </div>
          <PoolHealthBadge score={health?.avgHealthScore ?? null} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <PoolHealthBar score={health?.avgHealthScore ?? null} aggregation={health} />

        <PoolCapacityBar
          totalCapacity={health?.totalDailyCapacity ?? 0}
          used={health?.usedToday ?? 0}
          limit={pool.dailyPoolLimit}
          size="sm"
        />

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-1.5 rounded bg-muted/20">
            <Users className="h-3 w-3 text-muted-foreground mx-auto mb-0.5" />
            <p className="text-[10px] text-muted-foreground">Members</p>
            <p className="text-xs font-bold">{pool.memberCount}</p>
          </div>
          <div className="p-1.5 rounded bg-muted/20">
            <Mail className="h-3 w-3 text-muted-foreground mx-auto mb-0.5" />
            <p className="text-[10px] text-muted-foreground">Connected</p>
            <p className="text-xs font-bold">{health?.connectedCount ?? 0}</p>
          </div>
          <div className="p-1.5 rounded bg-muted/20">
            <Flame className="h-3 w-3 text-muted-foreground mx-auto mb-0.5" />
            <p className="text-[10px] text-muted-foreground">Warming</p>
            <p className="text-xs font-bold">{health?.warmingCount ?? 0}</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <StrategyIcon className="h-3 w-3" />
            <span>{strategy.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <RotationIcon className="h-3 w-3" />
            <span>{rotation.label}</span>
          </div>
        </div>

        {health && health.warnings.length > 0 && (
          <div className="space-y-1">
            {health.warnings.slice(0, 2).map((w, i) => (
              <div
                key={i}
                className={cn(
                  'text-[10px] px-2 py-1 rounded',
                  w.severity === 'critical' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600'
                )}
              >
                {w.message}
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onVerify() }}
          disabled={isVerifying}
          className={cn(
            'w-full text-xs font-medium py-1.5 rounded-md transition-colors',
            'bg-primary/10 text-primary hover:bg-primary/20',
            isVerifying && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isVerifying ? 'Verifying...' : 'View Details'}
        </button>
      </CardContent>
    </Card>
  )
}

function PoolHealthBadge({ score }: { score: number | null }) {
  const avg = score ?? 0
  const color = avg >= 80 ? 'text-emerald-600' : avg >= 60 ? 'text-blue-600' : avg >= 40 ? 'text-amber-600' : 'text-red-600'
  return (
    <div className="flex flex-col items-center">
      <span className={cn('text-lg font-bold tabular-nums', color)}>{avg}</span>
      <span className="text-[10px] text-muted-foreground">health</span>
    </div>
  )
}
