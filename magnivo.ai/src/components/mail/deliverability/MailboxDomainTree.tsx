'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Mail,
  Globe,
  Shield,
  Key,
  FileText,
  Link2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DnsStatusLabel } from './DnsStatusIcon'
import { HealthScoreBadge } from './HealthScoreBadge'
import {
  getDomainWithMailboxes,
  verifyDomain,
} from '@/app/actions/deliverability'
import type { DeliverabilityDomain } from '@/types/deliverability'
import type { MailboxDomainGroup } from '@/repositories/mail/mailbox-repository'

const MAILBOX_STATUS_COLORS: Record<string, string> = {
  connected: 'bg-emerald-500/10 text-emerald-600',
  disconnected: 'bg-red-500/10 text-red-600',
  warming: 'bg-blue-500/10 text-blue-600',
  error: 'bg-red-500/10 text-red-600',
  pending: 'bg-muted/50 text-muted-foreground',
  testing: 'bg-blue-500/10 text-blue-600',
  disabled: 'bg-muted/50 text-muted-foreground',
}

function MailboxRow({ mailbox }: { mailbox: MailboxDomainGroup['mailboxes'][0] }) {
  const statusColor = MAILBOX_STATUS_COLORS[mailbox.mailboxStatus] ?? 'bg-muted/50 text-muted-foreground'
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">{mailbox.email}</span>
        <Badge variant="outline" className={cn('text-[10px] px-1 py-0 shrink-0', statusColor)}>
          {mailbox.mailboxStatus}
        </Badge>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {mailbox.healthScore != null && (
          <span className={cn(
            'text-[10px] font-medium tabular-nums',
            mailbox.healthScore >= 70 ? 'text-emerald-600' :
            mailbox.healthScore >= 50 ? 'text-amber-600' : 'text-red-600'
          )}>
            {mailbox.healthScore}%
          </span>
        )}
      </div>
    </div>
  )
}

function DomainGroupCard({
  group,
  domain,
  isExpanded,
  onToggle,
  onVerify,
  isVerifying,
}: {
  group: MailboxDomainGroup
  domain: DeliverabilityDomain | undefined
  isExpanded: boolean
  onToggle: () => void
  onVerify: () => void
  isVerifying: boolean
}) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-sm font-semibold">{group.domain}</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {group.totalCount} mailbox{group.totalCount !== 1 ? 'es' : ''}
          </Badge>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {domain && (
            <>
              <DnsStatusLabel status={domain.spfStatus} />
              <DnsStatusLabel status={domain.dkimStatus} />
              <DnsStatusLabel status={domain.dmarcStatus} />
              <HealthScoreBadge score={domain.healthScore} level={domain.healthStatus} size="sm" showLabel={false} />
            </>
          )}
          {!domain && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Not configured
            </Badge>
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="border-t px-3 pb-3 space-y-2">
          {domain ? (
            <div className="space-y-2 pt-2">
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { label: 'SPF', status: domain.spfStatus },
                  { label: 'DKIM', status: domain.dkimStatus },
                  { label: 'DMARC', status: domain.dmarcStatus },
                  { label: 'Tracking', status: domain.trackingStatus },
                  { label: 'Return Path', status: domain.returnPathStatus },
                ].map((item) => (
                  <div key={item.label} className="text-center p-1.5 rounded bg-muted/20">
                    <p className="text-[10px] text-muted-foreground">{item.label}</p>
                    <DnsStatusLabel status={item.status} />
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                Last checked: {domain.lastCheckedAt ? new Date(domain.lastCheckedAt).toLocaleString() : 'Never'}
                {domain.nextCheckAt && (
                  <> · Next: {new Date(domain.nextCheckAt).toLocaleString()}</>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-2">
              This domain is not in the deliverability center. Add it to start monitoring.
            </p>
          )}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Mailboxes</p>
            {group.mailboxes.map((mailbox) => (
              <MailboxRow key={mailbox.id} mailbox={mailbox} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function MailboxDomainTree() {
  const [domains, setDomains] = useState<DeliverabilityDomain[]>([])
  const [mailboxGroups, setMailboxGroups] = useState<MailboxDomainGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set())
  const [verifyingDomain, setVerifyingDomain] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getDomainWithMailboxes()
      setDomains(result.domains)
      setMailboxGroups(result.mailboxGroups)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  const handleVerify = async (domainId: string) => {
    setVerifyingDomain(domainId)
    try {
      await verifyDomain({ domainId, source: 'manual' })
      await loadData()
    } finally {
      setVerifyingDomain(null)
    }
  }

  const totalMailboxes = mailboxGroups.reduce((acc, g) => acc + g.totalCount, 0)
  const configuredDomains = mailboxGroups.filter((g) =>
    domains.some((d) => d.domain === g.domain)
  ).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Mailbox → Domain Map</CardTitle>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {totalMailboxes} mailboxes · {mailboxGroups.length} domains · {configuredDomains} configured
            </Badge>
          </div>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={loadData}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading ? (
          <div className="text-center py-6 text-xs text-muted-foreground">Loading mailbox map...</div>
        ) : mailboxGroups.length === 0 ? (
          <div className="text-center py-6">
            <Mail className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No mailboxes configured yet</p>
          </div>
        ) : (
          mailboxGroups.map((group) => {
            const domain = domains.find((d) => d.domain === group.domain)
            return (
              <DomainGroupCard
                key={group.domain}
                group={group}
                domain={domain}
                isExpanded={expandedDomains.has(group.domain)}
                onToggle={() => toggleDomain(group.domain)}
                onVerify={() => domain && handleVerify(domain.id)}
                isVerifying={verifyingDomain === domain?.id}
              />
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
