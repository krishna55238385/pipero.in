'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Search,
  Plus,
  RefreshCw,
  Shield,
  Bell,
  XCircle,
  Activity,
  Mail,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Key,
  FileText,
  Link2,
  RotateCcw,
  TrendingUp,
  Loader2,
  Globe,
  Radio,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getDeliverabilityDomains,
  getDeliverabilityDomain,
  createDeliverabilityDomain,
  verifyDomain,
  getDomainHistory,
  getDomainDnsRecords,
  getDeliverabilityDashboardStats,
} from '@/app/actions/deliverability'
import { getProviderDnsInstructions, getAllProviders } from '@/services/mail/provider-instructions'
import { DomainOverviewCard } from './deliverability/DomainOverviewCard'
import { HealthScoreBadge } from './deliverability/HealthScoreBadge'
import { ProviderInstructionsPanel } from './deliverability/ProviderInstructionsPanel'
import { HistoryTimeline } from './deliverability/HistoryTimeline'
import { DnsStatusLabel } from './deliverability/DnsStatusIcon'
import { DomainHealthBreakdown } from './deliverability/DomainHealthBreakdown'
import { DeliverabilityNotificationsPanel } from './deliverability/DeliverabilityNotificationsPanel'
import { DeliverabilityFailurePanel } from './deliverability/DeliverabilityFailurePanel'
import { MailboxDomainTree } from './deliverability/MailboxDomainTree'
import { BulkVerificationProgress } from './deliverability/BulkVerificationProgress'
import { ReturnPathManager } from './deliverability/ReturnPathManager'
import { SelectorManager } from './deliverability/SelectorManager'
import { ReputationDashboard } from './deliverability/ReputationDashboard'
import { BlacklistStatusPanel } from './deliverability/BlacklistStatusPanel'
import { PostmasterDashboard } from './deliverability/PostmasterDashboard'
import { SndsDashboard } from './deliverability/SndsDashboard'
import { TrackingDomainManager } from './deliverability/TrackingDomainManager'
import { MonitoringStatusPanel } from './deliverability/MonitoringStatusPanel'
import { BounceIntelligencePanel } from './deliverability/BounceIntelligencePanel'
import { ComplaintStatusPanel } from './deliverability/ComplaintStatusPanel'
import { DeliverabilityReportsPanel } from './deliverability/DeliverabilityReportsPanel'
import type {
  DeliverabilityDomain,
  VerificationHistoryEntry,
  DnsRecord,
  DeliverabilityDashboardStats,
  DnsProvider,
  DomainVerificationResult,
} from '@/types/deliverability'

type CenterTab = 'overview' | 'domains' | 'mailbox-map' | 'notifications' | 'issues' | 'return-paths' | 'dkim' | 'reputation' | 'blacklist' | 'postmaster' | 'snds' | 'tracking' | 'monitoring' | 'bounces' | 'complaints' | 'reports'

const TABS: { key: CenterTab; label: string; icon: typeof Shield }[] = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'domains', label: 'Domains', icon: Shield },
  { key: 'mailbox-map', label: 'Mailbox Map', icon: Mail },
  { key: 'return-paths', label: 'Return Paths', icon: RotateCcw },
  { key: 'dkim', label: 'DKIM', icon: Key },
  { key: 'tracking', label: 'Tracking', icon: Link2 },
  { key: 'reputation', label: 'Reputation', icon: TrendingUp },
  { key: 'blacklist', label: 'Blacklist', icon: AlertTriangle },
  { key: 'bounces', label: 'Bounces', icon: XCircle },
  { key: 'complaints', label: 'Complaints', icon: Bell },
  { key: 'reports', label: 'Reports', icon: FileText },
  { key: 'postmaster', label: 'Postmaster', icon: Globe },
  { key: 'snds', label: 'SNDS', icon: Radio },
  { key: 'monitoring', label: 'Monitoring', icon: Clock },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'issues', label: 'Issues', icon: XCircle },
]

// ============================================================
// Dashboard Stats Cards
// ============================================================

function DashboardStatsCards({ stats }: { stats: DeliverabilityDashboardStats }) {
  const items = [
    { label: 'Total Domains', value: stats.totalDomains, color: 'text-foreground', icon: Shield },
    { label: 'Healthy', value: stats.healthyDomains, color: 'text-emerald-500', icon: CheckCircle2 },
    { label: 'Needs Attention', value: stats.needsAttention, color: 'text-amber-500', icon: AlertTriangle },
    { label: 'Failed', value: stats.failedDomains, color: 'text-red-500', icon: XCircle },
    { label: 'Avg Health', value: `${stats.avgHealthScore}%`, color: 'text-blue-500', icon: TrendingUp },
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2">
              <item.icon className={cn('h-4 w-4', item.color)} />
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </div>
            <p className={cn('text-2xl font-bold tabular-nums mt-1', item.color)}>{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ============================================================
// Add Domain Dialog
// ============================================================

function AddDomainDialog({ onAdd, onClose }: { onAdd: (domain: string) => void; onClose: () => void }) {
  const [domain, setDomain] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (domain.trim() && !isAdding) {
      setIsAdding(true)
      await onAdd(domain.trim())
      setDomain('')
      setIsAdding(false)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Add Domain</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}><XCircle className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              placeholder="e.g. company.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              autoFocus
              disabled={isAdding}
            />
            <p className="text-xs text-muted-foreground">
              DNS records will be automatically verified after adding the domain.
            </p>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isAdding}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!domain.trim() || isAdding}>
                {isAdding ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Adding & Verifying...
                  </>
                ) : (
                  'Add & Verify'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// Overview Tab
// ============================================================

function OverviewTab({
  stats,
  domains,
  onSelectDomain,
}: {
  stats: DeliverabilityDashboardStats
  domains: DeliverabilityDomain[]
  onSelectDomain: (d: DeliverabilityDomain) => void
}) {
  const sortedByHealth = useMemo(
    () => [...domains].sort((a, b) => a.healthScore - b.healthScore),
    [domains]
  )
  const needAttention = sortedByHealth.filter((d) => d.healthStatus === 'fair' || d.healthStatus === 'poor')
  const recentlyChecked = [...domains]
    .filter((d) => d.lastCheckedAt)
    .sort((a, b) => new Date(b.lastCheckedAt!).getTime() - new Date(a.lastCheckedAt!).getTime())
    .slice(0, 5)

  return (
    <div className="space-y-4">
      <DashboardStatsCards stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Needs Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {needAttention.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">All domains healthy</p>
            ) : (
              needAttention.map((domain) => (
                <button
                  key={domain.id}
                  type="button"
                  onClick={() => onSelectDomain(domain)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{domain.domain}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        domain.healthStatus === 'poor' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600'
                      )}
                    >
                      {domain.healthScore}%
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500" />
              Recently Checked
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {recentlyChecked.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No domains checked yet</p>
            ) : (
              recentlyChecked.map((domain) => (
                <button
                  key={domain.id}
                  type="button"
                  onClick={() => onSelectDomain(domain)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{domain.domain}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <HealthScoreBadge score={domain.healthScore} level={domain.healthStatus} size="sm" showLabel={false} />
                    <span className="text-[10px] text-muted-foreground">
                      {domain.lastCheckedAt ? new Date(domain.lastCheckedAt).toLocaleDateString() : 'Never'}
                    </span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DeliverabilityFailurePanel />
        <DeliverabilityNotificationsPanel />
      </div>
    </div>
  )
}

// ============================================================
// Domain Detail Panel
// ============================================================

function DomainDetailPanel({
  domain,
  history,
  records,
  onVerify,
  isVerifying,
  verificationResult,
  onClose,
}: {
  domain: DeliverabilityDomain
  history: VerificationHistoryEntry[]
  records: DnsRecord[]
  onVerify: () => void
  isVerifying: boolean
  verificationResult: DomainVerificationResult | null
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'instructions' | 'history' | 'records' | 'health'>('overview')
  const [selectedProvider, setSelectedProvider] = useState<DnsProvider>('cloudflare')
  const [selectedRecordType, setSelectedRecordType] = useState<'spf' | 'dkim' | 'dmarc' | 'tracking' | 'return_path'>('spf')

  const providers = getAllProviders()
  const instructions = getProviderDnsInstructions(domain.domain, selectedRecordType, selectedProvider, domain.dkimSelector)

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'health', label: 'Health' },
    { key: 'instructions', label: 'DNS Setup' },
    { key: 'history', label: 'History' },
    { key: 'records', label: 'Records' },
  ] as const

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HealthScoreBadge score={domain.healthScore} level={domain.healthStatus} size="sm" />
          <div>
            <h2 className="text-lg font-semibold">{domain.domain}</h2>
            <p className="text-xs text-muted-foreground">
              Last checked: {domain.lastCheckedAt ? new Date(domain.lastCheckedAt).toLocaleString() : 'Never'}
              {domain.nextCheckAt && (
                <> · Next: {new Date(domain.nextCheckAt).toLocaleString()}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onVerify}
            disabled={isVerifying}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isVerifying && 'animate-spin')} />
            {isVerifying ? 'Verifying...' : 'Verify'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-3">
          {verificationResult && (
            <Card>
              <CardContent className="py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">SPF:</span>
                    <DnsStatusLabel status={verificationResult.spf.valid ? 'valid' : (verificationResult.spf.found ? 'invalid' : 'missing')} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">DKIM:</span>
                    <DnsStatusLabel status={verificationResult.dkim.valid ? 'valid' : (verificationResult.dkim.found ? 'invalid' : 'missing')} />
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">DMARC:</span>
                    <DnsStatusLabel status={verificationResult.dmarc.valid ? 'valid' : (verificationResult.dmarc.found ? 'invalid' : 'missing')} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Tracking:</span>
                    <DnsStatusLabel status={verificationResult.tracking.valid ? 'valid' : (verificationResult.tracking.found ? 'invalid' : 'missing')} />
                  </div>
                </div>
                {verificationResult.spf.errors.length > 0 && (
                  <div className="text-xs text-amber-600 bg-amber-500/5 p-2 rounded">
                    {verificationResult.spf.errors.join('. ')}
                  </div>
                )}
                {verificationResult.dkim.errors.length > 0 && (
                  <div className="text-xs text-amber-600 bg-amber-500/5 p-2 rounded">
                    {verificationResult.dkim.errors.join('. ')}
                  </div>
                )}
                {verificationResult.dmarc.errors.length > 0 && (
                  <div className="text-xs text-amber-600 bg-amber-500/5 p-2 rounded">
                    {verificationResult.dmarc.errors.join('. ')}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Verified in {verificationResult.durationMs}ms
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-5 gap-2">
            {[
              { label: 'SPF', icon: Shield, status: domain.spfStatus, raw: domain.spfRaw },
              { label: 'DKIM', icon: Key, status: domain.dkimStatus, raw: domain.dkimCnameTarget },
              { label: 'DMARC', icon: FileText, status: domain.dmarcStatus, raw: domain.dmarcRaw },
              { label: 'Tracking', icon: Link2, status: domain.trackingStatus, raw: domain.trackingCnameTarget },
              { label: 'Return Path', icon: RotateCcw, status: domain.returnPathStatus, raw: domain.returnPathCnameTarget },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent className="py-2 px-3 text-center space-y-1">
                  <item.icon className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  <DnsStatusLabel status={item.status} />
                  {item.raw && (
                    <p className="text-[9px] font-mono text-muted-foreground truncate" title={item.raw}>
                      {item.raw}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {domain.spfRaw && (
            <div className="text-xs">
              <span className="text-muted-foreground">SPF Record:</span>
              <code className="ml-2 font-mono bg-muted/30 px-1.5 py-0.5 rounded break-all">{domain.spfRaw}</code>
            </div>
          )}
          {domain.dmarcRaw && (
            <div className="text-xs">
              <span className="text-muted-foreground">DMARC Record:</span>
              <code className="ml-2 font-mono bg-muted/30 px-1.5 py-0.5 rounded break-all">{domain.dmarcRaw}</code>
            </div>
          )}
        </div>
      )}

      {activeTab === 'health' && (
        <DomainHealthBreakdown
          spfStatus={domain.spfStatus}
          dkimStatus={domain.dkimStatus}
          dmarcStatus={domain.dmarcStatus}
          trackingStatus={domain.trackingStatus}
          overallScore={domain.healthScore}
          overallLevel={domain.healthStatus}
        />
      )}

      {activeTab === 'instructions' && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {(['spf', 'dkim', 'dmarc', 'tracking', 'return_path'] as const).map((type) => (
              <Button
                key={type}
                variant={selectedRecordType === type ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedRecordType(type)}
              >
                {type === 'return_path' ? 'Return Path' : type.toUpperCase()}
              </Button>
            ))}
          </div>
          <ProviderInstructionsPanel
            instructions={instructions}
            providers={providers}
            selectedProvider={selectedProvider}
            onProviderChange={setSelectedProvider}
            domain={domain.domain}
            recordType={selectedRecordType}
          />
        </div>
      )}

      {activeTab === 'history' && (
        <HistoryTimeline entries={history} />
      )}

      {activeTab === 'records' && (
        <Card>
          <CardContent className="py-4">
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No DNS records cached yet. Verify the domain first.</p>
            ) : (
              <div className="space-y-2">
                {records.map((record) => (
                  <div key={record.id} className="flex items-center justify-between p-2 bg-muted/20 rounded text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{record.recordType}</Badge>
                      <code className="font-mono">{record.recordName}</code>
                    </div>
                    <code className="font-mono truncate max-w-[200px] text-muted-foreground">{record.recordValue}</code>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ============================================================
// Main Deliverability Center
// ============================================================

export default function MailDeliverabilityClient() {
  const [activeTab, setActiveTab] = useState<CenterTab>('overview')
  const [domains, setDomains] = useState<DeliverabilityDomain[]>([])
  const [stats, setStats] = useState<DeliverabilityDashboardStats>({
    totalDomains: 0, healthyDomains: 0, needsAttention: 0, failedDomains: 0, avgHealthScore: 0, unreadNotifications: 0,
  })
  const [selectedDomain, setSelectedDomain] = useState<DeliverabilityDomain | null>(null)
  const [search, setSearch] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [isVerifying, setIsVerifying] = useState<string | null>(null)
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>([])
  const [domainHistory, setDomainHistory] = useState<VerificationHistoryEntry[]>([])
  const [domainRecords, setDomainRecords] = useState<DnsRecord[]>([])
  const [verificationResult, setVerificationResult] = useState<DomainVerificationResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [domainsData, statsData] = await Promise.all([
        getDeliverabilityDomains(),
        getDeliverabilityDashboardStats(),
      ])
      setDomains(domainsData)
      setStats(statsData)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data fetching pattern
  useEffect(() => { loadData() }, [loadData])

  const loadDomainDetails = useCallback(async (domain: DeliverabilityDomain) => {
    setSelectedDomain(domain)
    setVerificationResult(null)
    const [history, records] = await Promise.all([
      getDomainHistory(domain.id),
      getDomainDnsRecords(domain.id),
    ])
    setDomainHistory(history)
    setDomainRecords(records)
  }, [])

  const handleAddDomain = async (domainName: string) => {
    const result = await createDeliverabilityDomain({ domain: domainName })
    if (result.success) {
      await loadData()
    }
  }

  const handleVerify = async (domainId: string) => {
    setIsVerifying(domainId)
    setVerificationResult(null)
    try {
      const result = await verifyDomain({ domainId, source: 'manual' })
      if (result.success && result.data) {
        setVerificationResult(result.data)
        await loadData()
        if (selectedDomain?.id === domainId) {
          const updated = await getDeliverabilityDomain(domainId)
          if (updated) {
            setSelectedDomain(updated)
            const [history, records] = await Promise.all([
              getDomainHistory(domainId),
              getDomainDnsRecords(domainId),
            ])
            setDomainHistory(history)
            setDomainRecords(records)
          }
        }
      }
    } finally {
      setIsVerifying(null)
    }
  }

  const handleBulkVerify = async () => {
    if (selectedDomainIds.length === 0) return
    await loadData()
    setSelectedDomainIds([])
  }

  const toggleDomainSelection = (domainId: string) => {
    setSelectedDomainIds((prev) =>
      prev.includes(domainId) ? prev.filter((id) => id !== domainId) : [...prev, domainId]
    )
  }

  const filteredDomains = domains.filter((d) =>
    d.domain.toLowerCase().includes(search.toLowerCase())
  )

  const domainNameMap = useMemo(
    () => Object.fromEntries(domains.map((d) => [d.id, d.domain])),
    [domains]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">DNS Verification & Deliverability Center</h1>
          <p className="text-sm text-muted-foreground">Monitor and verify your domain&apos;s email authentication records</p>
        </div>
        <div className="flex gap-2">
          {selectedDomainIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkVerify}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Verify {selectedDomainIds.length} Domains
            </Button>
          )}
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Domain
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Bulk Verification Progress */}
      {selectedDomainIds.length > 0 && (
        <BulkVerificationProgress
          domainIds={selectedDomainIds}
          domainNames={domainNameMap}
          onComplete={loadData}
          onClear={() => setSelectedDomainIds([])}
        />
      )}

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab
          stats={stats}
          domains={domains}
          onSelectDomain={(d) => { loadDomainDetails(d); setActiveTab('domains') }}
        />
      )}

      {activeTab === 'domains' && (
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search domains..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      )}

      {activeTab === 'domains' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground">Loading domains...</div>
            ) : filteredDomains.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {search ? 'No domains match your search' : 'No domains configured yet. Add a domain to get started.'}
                  </p>
                  {!search && (
                    <Button size="sm" className="mt-3" onClick={() => setShowAddDialog(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Domain
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              filteredDomains.map((domain) => (
                <div key={domain.id} className="relative">
                  <div className="absolute top-3 left-3 z-10">
                    <input
                      type="checkbox"
                      checked={selectedDomainIds.includes(domain.id)}
                      onChange={() => toggleDomainSelection(domain.id)}
                      className="rounded border-gray-300"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <DomainOverviewCard
                    domain={domain}
                    isSelected={selectedDomain?.id === domain.id}
                    onSelect={() => loadDomainDetails(domain)}
                    onVerify={() => handleVerify(domain.id)}
                    isVerifying={isVerifying === domain.id}
                  />
                </div>
              ))
            )}
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start">
            {selectedDomain ? (
              <DomainDetailPanel
                domain={selectedDomain}
                history={domainHistory}
                records={domainRecords}
                onVerify={() => handleVerify(selectedDomain.id)}
                isVerifying={isVerifying === selectedDomain.id}
                verificationResult={verificationResult}
                onClose={() => { setSelectedDomain(null); setVerificationResult(null) }}
              />
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Select a domain to view details</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {activeTab === 'mailbox-map' && (
        <MailboxDomainTree />
      )}

      {activeTab === 'return-paths' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Manage return path domains for bounce handling. Return paths handle undeliverable mail and NDR processing.
          </p>
          {selectedDomain ? (
            <ReturnPathManager domainId={selectedDomain.id} onRefresh={loadData} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <RotateCcw className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Select a domain from the Domains tab first</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'dkim' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Manage DKIM selectors for email signing. Multiple selectors enable key rotation without downtime.
          </p>
          {selectedDomain ? (
            <SelectorManager domainId={selectedDomain.id} onRefresh={loadData} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Key className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Select a domain from the Domains tab first</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'tracking' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Manage tracking domains for open and click tracking. Each domain requires a CNAME pointing to your tracking server.
          </p>
          {selectedDomain ? (
            <TrackingDomainManager domainId={selectedDomain.id} onRefresh={loadData} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Select a domain from the Domains tab first</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'reputation' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ReputationDashboard />
            <div className="space-y-4">
              <ComplaintStatusPanel />
              <BounceIntelligencePanel />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'blacklist' && (
        <div className="space-y-4">
          <BlacklistStatusPanel />
        </div>
      )}

      {activeTab === 'bounces' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hard vs soft bounce classification, retry queues, and suppression outcomes.
          </p>
          <BounceIntelligencePanel />
        </div>
      )}

      {activeTab === 'complaints' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Spam complaint tracking with auto-pause when rates exceed 0.3%.
          </p>
          <ComplaintStatusPanel />
        </div>
      )}

      {activeTab === 'reports' && (
        <DeliverabilityReportsPanel domains={domains} />
      )}

      {activeTab === 'postmaster' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Connect domains to Google Postmaster Tools for spam complaint rates, authentication metrics, and reputation data.
          </p>
          <PostmasterDashboard />
        </div>
      )}

      {activeTab === 'snds' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Connect domains to Microsoft Smart Network Data Services for IP reputation, trap hits, and complaint monitoring.
          </p>
          <SndsDashboard />
        </div>
      )}

      {activeTab === 'monitoring' && (
        <div className="space-y-4">
          <MonitoringStatusPanel />
        </div>
      )}

      {activeTab === 'notifications' && (
        <DeliverabilityNotificationsPanel />
      )}

      {activeTab === 'issues' && (
        <DeliverabilityFailurePanel />
      )}

      {showAddDialog && (
        <AddDomainDialog
          onAdd={handleAddDomain}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  )
}
