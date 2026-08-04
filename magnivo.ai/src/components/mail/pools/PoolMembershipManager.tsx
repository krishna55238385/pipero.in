'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Users,
  Search,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Mail,
  Shield,
  Key,
  Loader2,
  GripVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getPoolMembersList,
  getAvailableMailboxesForPoolAssignment,
  addMailboxToPoolWithMemberRole,
  removeMailboxFromPoolAction,
  updatePoolMemberRoleAction,
  bulkAddMailboxesToPool,
  bulkRemoveMailboxesFromPool,
} from '@/app/actions/mail'
import type { PoolMembershipRole } from '@/types/mail'

type PoolMember = {
  mailboxId: string
  email: string
  role: PoolMembershipRole
  healthScore: number | null
  healthStatus: string
  mailboxStatus: string
  dailyLimit: number
  currentUsage: number
  provider: string
  addedAt: string
}

type AvailableMailbox = {
  id: string
  email: string
  provider: string
  healthScore: number | null
  healthStatus: string
  mailboxStatus: string
  poolId: string | null
  poolName: string | null
}

type PoolMembershipManagerProps = {
  poolId: string
  poolName: string
  onUpdate: () => void
}

const ROLE_CONFIG: Record<PoolMembershipRole, { label: string; color: string; bg: string }> = {
  primary: { label: 'Primary', color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
  backup: { label: 'Backup', color: 'text-blue-600', bg: 'bg-blue-500/10' },
  disabled: { label: 'Disabled', color: 'text-muted-foreground', bg: 'bg-muted/30' },
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-emerald-500/10 text-emerald-600',
  disconnected: 'bg-red-500/10 text-red-600',
  warming: 'bg-blue-500/10 text-blue-600',
  error: 'bg-red-500/10 text-red-600',
  pending: 'bg-muted/50 text-muted-foreground',
}

function MemberRow({
  member,
  onRoleChange,
  onRemove,
}: {
  member: PoolMember
  onRoleChange: (mailboxId: string, role: PoolMembershipRole) => void
  onRemove: (mailboxId: string) => void
}) {
  const roleConfig = ROLE_CONFIG[member.role]
  const statusColor = STATUS_COLORS[member.mailboxStatus] ?? 'bg-muted/50 text-muted-foreground'

  return (
    <div className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0 cursor-grab" />
        <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">{member.email}</span>
        <Badge variant="outline" className={cn('text-[10px] px-1 py-0 shrink-0', statusColor)}>
          {member.mailboxStatus}
        </Badge>
        {member.healthScore != null && (
          <span className={cn(
            'text-[10px] font-medium tabular-nums shrink-0',
            member.healthScore >= 70 ? 'text-emerald-600' :
            member.healthScore >= 50 ? 'text-amber-600' : 'text-red-600'
          )}>
            {member.healthScore}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <select
          value={member.role}
          onChange={(e) => onRoleChange(member.mailboxId, e.target.value as PoolMembershipRole)}
          className="text-[10px] border rounded px-1 py-0.5 bg-background"
        >
          <option value="primary">Primary</option>
          <option value="backup">Backup</option>
          <option value="disabled">Disabled</option>
        </select>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-red-500 hover:text-red-700"
          onClick={() => onRemove(member.mailboxId)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

function AvailableMailboxRow({
  mailbox,
  onAdd,
  isAdding,
}: {
  mailbox: AvailableMailbox
  onAdd: (mailboxId: string) => void
  isAdding: boolean
}) {
  const statusColor = STATUS_COLORS[mailbox.mailboxStatus] ?? 'bg-muted/50 text-muted-foreground'

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs truncate">{mailbox.email}</span>
        <Badge variant="outline" className={cn('text-[10px] px-1 py-0 shrink-0', statusColor)}>
          {mailbox.mailboxStatus}
        </Badge>
        {mailbox.poolName && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
            {mailbox.poolName}
          </Badge>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 text-[10px] text-primary"
        onClick={() => onAdd(mailbox.id)}
        disabled={isAdding}
      >
        <Plus className="h-3 w-3 mr-0.5" />
        Add
      </Button>
    </div>
  )
}

export function PoolMembershipManager({ poolId, poolName, onUpdate }: PoolMembershipManagerProps) {
  const [members, setMembers] = useState<PoolMember[]>([])
  const [available, setAvailable] = useState<AvailableMailbox[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [showAvailable, setShowAvailable] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [membersData, availableData] = await Promise.all([
        getPoolMembersList(poolId),
        getAvailableMailboxesForPoolAssignment(),
      ])
      setMembers(membersData as PoolMember[])
      setAvailable(availableData as AvailableMailbox[])
    } finally {
      setIsLoading(false)
    }
  }, [poolId])

  useEffect(() => { loadData() }, [loadData])

  const handleAdd = async (mailboxId: string) => {
    setAddingId(mailboxId)
    try {
      await addMailboxToPoolWithMemberRole(poolId, mailboxId, 'primary')
      await loadData()
      onUpdate()
    } finally {
      setAddingId(null)
    }
  }

  const handleBulkAdd = async () => {
    if (selectedIds.size === 0) return
    await bulkAddMailboxesToPool(poolId, Array.from(selectedIds), 'primary')
    setSelectedIds(new Set())
    setShowAvailable(false)
    await loadData()
    onUpdate()
  }

  const handleRemove = async (mailboxId: string) => {
    await removeMailboxFromPoolAction(poolId, mailboxId)
    await loadData()
    onUpdate()
  }

  const handleBulkRemove = async () => {
    if (selectedIds.size === 0) return
    await bulkRemoveMailboxesFromPool(poolId, Array.from(selectedIds))
    setSelectedIds(new Set())
    await loadData()
    onUpdate()
  }

  const handleRoleChange = async (mailboxId: string, role: PoolMembershipRole) => {
    await updatePoolMemberRoleAction(poolId, mailboxId, role)
    await loadData()
    onUpdate()
  }

  const filteredAvailable = available.filter((m) =>
    m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.provider.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const primaryCount = members.filter((m) => m.role === 'primary').length
  const backupCount = members.filter((m) => m.role === 'backup').length
  const disabledCount = members.filter((m) => m.role === 'disabled').length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Pool Members</CardTitle>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {members.length} total · {primaryCount} primary · {backupCount} backup · {disabledCount} disabled
            </Badge>
          </div>
          <div className="flex gap-2">
            {selectedIds.size > 0 && (
              <Button variant="destructive" size="sm" className="h-6 text-xs" onClick={handleBulkRemove}>
                Remove {selectedIds.size}
              </Button>
            )}
            <Button
              variant={showAvailable ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-xs"
              onClick={() => setShowAvailable(!showAvailable)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Mailboxes
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {isLoading ? (
          <div className="text-center py-6 text-xs text-muted-foreground">Loading members...</div>
        ) : members.length === 0 ? (
          <div className="text-center py-6">
            <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No mailboxes in this pool yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {members.map((member) => (
              <MemberRow
                key={member.mailboxId}
                member={member}
                onRoleChange={handleRoleChange}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}

        {showAvailable && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search mailboxes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 h-7 text-xs"
                />
              </div>
              {selectedIds.size > 0 && (
                <Button size="sm" className="h-7 text-xs" onClick={handleBulkAdd}>
                  Add {selectedIds.size} Selected
                </Button>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filteredAvailable.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {searchQuery ? 'No mailboxes match your search' : 'No available mailboxes'}
                </p>
              ) : (
                filteredAvailable.map((mailbox) => (
                  <AvailableMailboxRow
                    key={mailbox.id}
                    mailbox={mailbox}
                    onAdd={handleAdd}
                    isAdding={addingId === mailbox.id}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
