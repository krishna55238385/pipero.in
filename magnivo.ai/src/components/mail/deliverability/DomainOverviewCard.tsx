'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DnsStatusLabel } from './DnsStatusIcon'
import { HealthScoreBadge, HealthScoreBar } from './HealthScoreBadge'
import { Shield, Key, FileText, Link2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeliverabilityDomain, DnsRecordStatus } from '@/types/deliverability'

type DomainOverviewCardProps = {
  domain: DeliverabilityDomain
  isSelected: boolean
  onSelect: () => void
  onVerify: () => void
  isVerifying: boolean
}

function StatusRow({
  icon: Icon,
  label,
  status,
  detail,
}: {
  icon: typeof Shield
  label: string
  status: DnsRecordStatus
  detail?: string | null
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {detail && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{detail}</span>}
        <DnsStatusLabel status={status} />
      </div>
    </div>
  )
}

export function DomainOverviewCard({ domain, isSelected, onSelect, onVerify, isVerifying }: DomainOverviewCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        isSelected && 'ring-2 ring-primary'
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold truncate">{domain.domain}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last checked: {domain.lastCheckedAt
                ? new Date(domain.lastCheckedAt).toLocaleDateString()
                : 'Never'}
            </p>
          </div>
          <HealthScoreBadge score={domain.healthScore} level={domain.healthStatus} size="sm" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-0.5 divide-y divide-border/50">
          <StatusRow icon={Shield} label="SPF" status={domain.spfStatus} />
          <StatusRow icon={Key} label="DKIM" status={domain.dkimStatus} detail={domain.dkimSelector} />
          <StatusRow icon={FileText} label="DMARC" status={domain.dmarcStatus} detail={domain.dmarcPolicy} />
          <StatusRow icon={Link2} label="Tracking" status={domain.trackingStatus} />
          <StatusRow icon={RotateCcw} label="Return Path" status={domain.returnPathStatus} />
        </div>
        <div className="mt-3">
          <HealthScoreBar score={domain.healthScore} level={domain.healthStatus} />
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onVerify() }}
          disabled={isVerifying}
          className={cn(
            'mt-3 w-full text-xs font-medium py-1.5 rounded-md transition-colors',
            'bg-primary/10 text-primary hover:bg-primary/20',
            isVerifying && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isVerifying ? 'Verifying...' : 'Verify Now'}
        </button>
      </CardContent>
    </Card>
  )
}
