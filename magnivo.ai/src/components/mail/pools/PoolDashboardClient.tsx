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
  Trash2,
  Users,
  Activity,
  Zap,
  RotateCcw,
  Clock,
  Globe,
  Mail,
  BarChart3,
  Settings,
  ChevronRight,
  XCircle,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getMailboxPools,
  getMailboxPool,
  createMailboxPool,
  updateMailboxPool,
  deleteMailboxPool,
} from '@/app/actions/mail'
import { PoolCard } from './PoolCard'
import { PoolCreateEditDialog } from './PoolCreateEditDialog'
import { PoolMembershipManager } from './PoolMembershipManager'
import { PoolHealthBar } from './PoolHealthBar'
import { PoolCapacityBar } from './PoolCapacityBar'
import type {
  MailboxPoolResponse,
  CreateMailboxPoolRequest,
  UpdateMailboxPoolRequest,
} from '@/types/mail'

// ============================================================
// Stats Cards
// ============================================================

function PoolStatsCards({ pools }: { pools: MailboxPoolResponse[] }) {
  const totalMembers = pools.reduce((acc, p) => acc + p.memberCount, 0)
  const totalCapacity = pools.reduce((acc, p) => acc + (p.healthAggregation?.totalDailyCapacity ?? 0), 0)
  const activePools = pools.filter((p) => p.status === 'active').length
  const avgHealth = pools.length > 0
    ? Math.round(pools.reduce((acc, p) => acc + (p.healthAggregation?.avgHealthScore ?? 0), 0) / pools.length)
    : 0

  const items = [
    { label: 'Total Pools', value: pools.length, icon: Users },
    { label: 'Active', value: activePools, icon: Activity, color: 'text-emerald-500' },
    { label: 'Total Mailboxes', value: totalMembers, icon: Mail },
    { label: 'Daily Capacity', value: totalCapacity.toLocaleString(), icon: Zap, color: 'text-blue-500' },
    { label: 'Avg Health', value: `${avgHealth}%`, icon: BarChart3, color: 'text-blue-500' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2">
              <item.icon className={cn('h-4 w-4', item.color ?? 'text-muted-foreground')} />
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </div>
            <p className={cn('text-2xl font-bold tabular-nums mt-1', item.color ?? 'text-foreground')}>
              {item.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ============================================================
// Pool Detail Panel
// ============================================================

function PoolDetailPanel({
  pool,
  onEdit,
  onDelete,
  onRefresh,
}: {
  pool: MailboxPoolResponse
  onEdit: () => void
  onDelete: () => void
  onRefresh: () => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'settings'>('overview')
  const health = pool.healthAggregation

  const tabs = [
    { key: 'overview', label: 'Overview', icon: Activity },
    { key: 'members', label: 'Members', icon: Users },
    { key: 'settings', label: 'Settings', icon: Settings },
  ] as const

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{pool.name}</h2>
            <Badge variant={pool.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
              {pool.status}
            </Badge>
          </div>
          {pool.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{pool.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Settings className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <PoolHealthBar score={health?.avgHealthScore ?? null} aggregation={health} size="md" />

          <PoolCapacityBar
            totalCapacity={health?.totalDailyCapacity ?? 0}
            used={health?.usedToday ?? 0}
            limit={pool.dailyPoolLimit}
            size="md"
          />

          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Members', value: pool.memberCount, icon: Users },
              { label: 'Connected', value: health?.connectedCount ?? 0, icon: Mail, color: 'text-emerald-500' },
              { label: 'Warming', value: health?.warmingCount ?? 0, icon: Clock, color: 'text-blue-500' },
              { label: 'Errors', value: health?.errorCount ?? 0, icon: XCircle, color: 'text-red-500' },
            ].map((item) => (
              <div key={item.label} className="text-center p-2 rounded bg-muted/20">
                <item.icon className={cn('h-3.5 w-3.5 mx-auto mb-1', item.color ?? 'text-muted-foreground')} />
                <p className="text-[10px] text-muted-foreground">{item.label}</p>
                <p className={cn('text-sm font-bold tabular-nums', item.color ?? 'text-foreground')}>{item.value}</p>
              </div>
            ))}
          </div>

          {health && health.warnings.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold">Warnings</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {health.warnings.map((w, i) => (
                  <div
                    key={i}
                    className={cn(
                      'text-xs px-2 py-1.5 rounded',
                      w.severity === 'critical' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600'
                    )}
                  >
                    {w.message}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/20 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Zap className="h-3 w-3 text-primary" />
                Sending Strategy
              </div>
              <p className="text-sm font-semibold capitalize">{pool.sendingStrategy.replace('_', ' ')}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/20 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <RotateCcw className="h-3 w-3 text-primary" />
                Rotation Strategy
              </div>
              <p className="text-sm font-semibold capitalize">{pool.rotationStrategy.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <PoolMembershipManager
          poolId={pool.id}
          poolName={pool.name}
          onUpdate={onRefresh}
        />
      )}

      {activeTab === 'settings' && (
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Daily Limit:</span>
                <span className="ml-2 font-medium">{pool.dailyPoolLimit.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Max Concurrent:</span>
                <span className="ml-2 font-medium">{pool.maxConcurrentSends}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Timezone:</span>
                <span className="ml-2 font-medium">{pool.timezone}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>
                <span className="ml-2 font-medium">{new Date(pool.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={onEdit}>
              <Settings className="h-3 w-3 mr-1" />
              Edit Pool Settings
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ============================================================
// Main Pool Dashboard
// ============================================================

export default function PoolDashboardClient() {
  const [pools, setPools] = useState<MailboxPoolResponse[]>([])
  const [selectedPool, setSelectedPool] = useState<MailboxPoolResponse | null>(null)
  const [search, setSearch] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingPool, setEditingPool] = useState<MailboxPoolResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getMailboxPools()
      setPools(data)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleSelectPool = useCallback(async (pool: MailboxPoolResponse) => {
    const full = await getMailboxPool(pool.id)
    if (full) {
      const response: MailboxPoolResponse = {
        ...full,
        memberCount: full.healthAggregation?.totalMailboxes ?? 0,
      }
      setSelectedPool(response)
    }
  }, [])

  const handleCreate = async (data: CreateMailboxPoolRequest | UpdateMailboxPoolRequest) => {
    const result = await createMailboxPool(data as CreateMailboxPoolRequest)
    if (result.success) {
      setShowCreateDialog(false)
      await loadData()
    }
  }

  const handleUpdate = async (data: CreateMailboxPoolRequest | UpdateMailboxPoolRequest) => {
    if (!editingPool) return
    const result = await updateMailboxPool(editingPool.id, data as UpdateMailboxPoolRequest)
    if (result.success) {
      setEditingPool(null)
      await loadData()
      if (selectedPool?.id === editingPool.id) {
        const updated = await getMailboxPool(editingPool.id)
        if (updated) {
          setSelectedPool({
            ...updated,
            memberCount: updated.healthAggregation?.totalMailboxes ?? 0,
          })
        }
      }
    }
  }

  const handleDelete = async (poolId: string) => {
    await deleteMailboxPool(poolId)
    if (selectedPool?.id === poolId) setSelectedPool(null)
    await loadData()
  }

  const filteredPools = pools.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mailbox Pool Management</h1>
          <p className="text-sm text-muted-foreground">Manage sending pools, rotation strategies, and mailbox assignments</p>
        </div>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Create Pool
        </Button>
      </div>

      <PoolStatsCards pools={pools} />

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search pools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={loadData}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading pools...</div>
          ) : filteredPools.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {search ? 'No pools match your search' : 'No pools created yet. Create your first pool to start.'}
                </p>
                {!search && (
                  <Button size="sm" className="mt-3" onClick={() => setShowCreateDialog(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Create Pool
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            filteredPools.map((pool) => (
              <PoolCard
                key={pool.id}
                pool={pool}
                isSelected={selectedPool?.id === pool.id}
                onSelect={() => handleSelectPool(pool)}
                onVerify={() => handleSelectPool(pool)}
                isVerifying={false}
              />
            ))
          )}
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          {selectedPool ? (
            <PoolDetailPanel
              pool={selectedPool}
              onEdit={() => setEditingPool(selectedPool)}
              onDelete={() => handleDelete(selectedPool.id)}
              onRefresh={loadData}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Select a pool to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {showCreateDialog && (
        <PoolCreateEditDialog
          onSave={handleCreate}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {editingPool && (
        <PoolCreateEditDialog
          pool={editingPool}
          onSave={handleUpdate}
          onClose={() => setEditingPool(null)}
        />
      )}
    </div>
  )
}
