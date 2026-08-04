'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Shield, Key, FileText, Link2, RotateCcw, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DnsRecordStatus, DomainHealthLevel } from '@/types/deliverability'

type HealthBreakdownItem = {
  label: string
  icon: typeof Shield
  status: DnsRecordStatus
  score: number
  weight: number
}

type DomainHealthBreakdownProps = {
  spfStatus: DnsRecordStatus
  dkimStatus: DnsRecordStatus
  dmarcStatus: DnsRecordStatus
  trackingStatus: DnsRecordStatus
  overallScore: number
  overallLevel: DomainHealthLevel
}

const STATUS_SCORES: Record<DnsRecordStatus, number> = {
  valid: 100,
  missing: 0,
  invalid: 20,
  unverified: 30,
}

const STATUS_COLORS: Record<DnsRecordStatus, { bar: string; text: string }> = {
  valid: { bar: 'bg-emerald-500', text: 'text-emerald-600' },
  invalid: { bar: 'bg-red-500', text: 'text-red-600' },
  missing: { bar: 'bg-amber-500', text: 'text-amber-600' },
  unverified: { bar: 'bg-muted-foreground/30', text: 'text-muted-foreground' },
}

const LEVEL_COLORS: Record<DomainHealthLevel, string> = {
  excellent: 'text-emerald-600',
  good: 'text-blue-600',
  fair: 'text-amber-600',
  poor: 'text-red-600',
  unknown: 'text-muted-foreground',
}

const WEIGHTS = { spf: 30, dkim: 30, dmarc: 25, tracking: 15 }

function BreakdownRow({ item }: { item: HealthBreakdownItem }) {
  const colors = STATUS_COLORS[item.status]
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{item.label}</span>
          <span className="text-[10px] text-muted-foreground">({item.weight}%)</span>
        </div>
        <span className={cn('text-xs font-medium tabular-nums', colors.text)}>
          {item.score}/100
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/20 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', colors.bar)}
          style={{ width: `${item.score}%` }}
        />
      </div>
    </div>
  )
}

export function DomainHealthBreakdown({
  spfStatus,
  dkimStatus,
  dmarcStatus,
  trackingStatus,
  overallScore,
  overallLevel,
}: DomainHealthBreakdownProps) {
  const items: HealthBreakdownItem[] = [
    { label: 'SPF', icon: Shield, status: spfStatus, score: STATUS_SCORES[spfStatus], weight: WEIGHTS.spf },
    { label: 'DKIM', icon: Key, status: dkimStatus, score: STATUS_SCORES[dkimStatus], weight: WEIGHTS.dkim },
    { label: 'DMARC', icon: FileText, status: dmarcStatus, score: STATUS_SCORES[dmarcStatus], weight: WEIGHTS.dmarc },
    { label: 'Tracking', icon: Link2, status: trackingStatus, score: STATUS_SCORES[trackingStatus], weight: WEIGHTS.tracking },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Health Breakdown</CardTitle>
          <div className="flex items-center gap-1.5">
            <TrendingUp className={cn('h-4 w-4', LEVEL_COLORS[overallLevel])} />
            <span className={cn('text-lg font-bold tabular-nums', LEVEL_COLORS[overallLevel])}>
              {overallScore}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {items.map((item) => (
          <BreakdownRow key={item.label} item={item} />
        ))}
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Formula</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              SPF×{WEIGHTS.spf/100} + DKIM×{WEIGHTS.dkim/100} + DMARC×{WEIGHTS.dmarc/100} + Tracking×{WEIGHTS.tracking/100}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
