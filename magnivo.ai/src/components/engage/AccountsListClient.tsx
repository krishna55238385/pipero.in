'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  updateAccountSettings,
  bulkUpdateAccounts,
  applyTagsToAccounts,
  removeTagFromAccount,
  createAccountTag,
} from '@/app/actions/engage'
import type { EmailAccount, AccountTag, AccountSettingsInput, AccountStatus } from '@/types/engage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MoreHorizontal,
  Search,
  Mail,
  Zap,
  ZapOff,
  Play,
  Pause,
  Tag,
  Plus,
  ChevronDown,
  Flame,
  Activity,
  RefreshCw,
} from 'lucide-react'
import { useRouter } from 'next/navigation'

// ─── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string | null) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'Just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function HealthBar({ score }: { score: number | null }) {
  if (score === null)
    return <span className="text-xs text-muted-foreground">No warmup data</span>
  const color =
    score >= 90 ? 'bg-emerald-500' : score >= 70 ? 'bg-amber-400' : 'bg-red-500'
  const textColor =
    score >= 90 ? 'text-emerald-700 dark:text-emerald-400' : score >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${textColor}`}>{score}%</span>
    </div>
  )
}

function CombinedScoreBadge({ score, sent }: { score: number | null; sent: number }) {
  if (sent < 100)
    return <span className="text-xs text-muted-foreground">Low data</span>
  if (score === null)
    return <span className="text-xs text-muted-foreground">—</span>
  const cls =
    score >= 30
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
      : score >= 15
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
      : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
  return <Badge className={`text-xs font-semibold ${cls}`}>{score}</Badge>
}

const STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  warming: 'Warming',
  error: 'Error',
  disconnected: 'Disconnected',
}
const STATUS_CLASS: Record<AccountStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  paused: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  warming: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  disconnected: 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-500',
}
const PROVIDER_ICON: Record<string, string> = { gmail: 'G', smtp: 'S', microsoft: 'M' }

// ─── Tag pill ─────────────────────────────────────────────────────────────────

function TagPill({
  tag,
  onRemove,
}: {
  tag: AccountTag
  onRemove?: () => void
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border"
      style={{
        backgroundColor: `${tag.color}18`,
        color: tag.color,
        borderColor: `${tag.color}40`,
      }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-60 transition-opacity text-[10px] ml-0.5">
          ×
        </button>
      )}
    </span>
  )
}

// ─── Settings drawer ──────────────────────────────────────────────────────────

function SettingsDrawer({
  account,
  open,
  onClose,
}: {
  account: EmailAccount | null
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<AccountSettingsInput>({})

  if (!account) return null

  const merged = {
    dailySendLimit: form.dailySendLimit ?? account.dailySendLimit,
    warmupEnabled: form.warmupEnabled ?? account.warmupEnabled,
    warmupDailyLimit: form.warmupDailyLimit ?? account.warmupDailyLimit,
    warmupReplyRate: form.warmupReplyRate ?? account.warmupReplyRate,
    warmupOpenRate: form.warmupOpenRate ?? account.warmupOpenRate,
    warmupSpamRescuePct: form.warmupSpamRescuePct ?? account.warmupSpamRescuePct,
    warmupMarkImportantPct: form.warmupMarkImportantPct ?? account.warmupMarkImportantPct,
  }

  function save() {
    startTransition(async () => {
      await updateAccountSettings(account!.id, form)
      router.refresh()
      onClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-[440px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
              {PROVIDER_ICON[account.provider] ?? 'E'}
            </span>
            {account.email}
          </SheetTitle>
          <SheetDescription>
            Configure sending limits and warmup settings for this account.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          {/* Analytics panel */}
          {(() => {
            const openRate  = account.sent > 0 ? (account.opens   / account.sent) * 100 : 0
            const clickRate = account.sent > 0 ? (account.clicks  / account.sent) * 100 : 0
            const replyRate = account.sent > 0 ? (account.replies / account.sent) * 100 : 0
            const fmtPct    = (n: number) => n.toFixed(1) + '%'
            const scoreCls  =
              account.combinedScore === null || account.sent < 100
                ? null
                : account.combinedScore >= 30
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                : account.combinedScore >= 15
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
            return (
              <div className="bg-muted/40 rounded-xl p-4 space-y-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                  Account analytics
                </p>

                {/* 2×2 stat tiles */}
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { label: 'Sent (all-time)', value: account.sent },
                      { label: 'Opens',           value: account.opens },
                      { label: 'Clicks',          value: account.clicks },
                      { label: 'Replies',         value: account.replies },
                    ] as Array<{ label: string; value: number }>
                  ).map(({ label, value }) => (
                    <div
                      key={label}
                      className="bg-background rounded-lg px-3 py-2.5 border"
                    >
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none mb-1">
                        {label}
                      </p>
                      <p className="text-lg font-bold tabular-nums leading-none">{value.toLocaleString()}</p>
                    </div>
                  ))}
                </div>

                {/* Rate rows */}
                <div className="space-y-1.5">
                  {(
                    [
                      { label: 'Open rate',  value: fmtPct(openRate)  },
                      { label: 'Click rate', value: fmtPct(clickRate) },
                      { label: 'Reply rate', value: fmtPct(replyRate) },
                    ] as Array<{ label: string; value: string }>
                  ).map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-semibold tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Combined score */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Combined score
                  </p>
                  <div className="flex items-center gap-2">
                    {scoreCls !== null ? (
                      <Badge className={`text-xs font-semibold ${scoreCls}`}>{account.combinedScore}</Badge>
                    ) : account.sent < 100 ? (
                      <span className="text-xs text-muted-foreground">Low data</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Above 30 = good performance (n≥100 contacts)
                  </p>
                </div>

                {/* Warmup health */}
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Health score (7d)
                  </p>
                  <HealthBar score={account.healthScore} />
                  <p className="text-[10px] text-muted-foreground">
                    {account.warmupEmails7d} warmup emails sent
                  </p>
                </div>
              </div>
            )
          })()}

          {/* Daily send limit */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Daily send limit</Label>
            <p className="text-xs text-muted-foreground">
              Max campaign emails sent per day from this account.
            </p>
            <div className="flex items-center gap-3">
              <Slider
                min={1}
                max={500}
                step={1}
                value={[merged.dailySendLimit]}
                onValueChange={([v]) => setForm((f) => ({ ...f, dailySendLimit: v }))}
                className="flex-1"
              />
              <span className="text-sm font-semibold w-10 text-right tabular-nums">
                {merged.dailySendLimit}
              </span>
            </div>
          </div>

          {/* Warmup toggle */}
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-500" />
                Email warmup
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ramps up sending gradually to build sender reputation.
              </p>
            </div>
            <Switch
              checked={merged.warmupEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, warmupEnabled: v }))}
            />
          </div>

          {merged.warmupEnabled && (
            <div className="space-y-5 pl-1">
              {/* Warmup daily limit */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Daily warmup limit
                </Label>
                <div className="flex items-center gap-3">
                  <Slider
                    min={1}
                    max={50}
                    step={1}
                    value={[merged.warmupDailyLimit]}
                    onValueChange={([v]) => setForm((f) => ({ ...f, warmupDailyLimit: v }))}
                    className="flex-1"
                  />
                  <span className="text-sm font-semibold w-8 text-right tabular-nums">
                    {merged.warmupDailyLimit}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Ramp starts at 1/day, +1 each day up to this limit.
                </p>
              </div>

              {/* Reply rate */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Reply rate
                  </Label>
                  <span className="text-xs font-semibold tabular-nums">{merged.warmupReplyRate}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[merged.warmupReplyRate]}
                  onValueChange={([v]) => setForm((f) => ({ ...f, warmupReplyRate: v }))}
                />
                <p className="text-xs text-muted-foreground">
                  % of warmup emails that receive automated replies. Default 30%.
                </p>
              </div>

              {/* Open rate */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Open rate
                  </Label>
                  <span className="text-xs font-semibold tabular-nums">{merged.warmupOpenRate}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[merged.warmupOpenRate]}
                  onValueChange={([v]) => setForm((f) => ({ ...f, warmupOpenRate: v }))}
                />
              </div>

              {/* Spam rescue */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Spam rescue
                  </Label>
                  <span className="text-xs font-semibold tabular-nums">{merged.warmupSpamRescuePct}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[merged.warmupSpamRescuePct]}
                  onValueChange={([v]) => setForm((f) => ({ ...f, warmupSpamRescuePct: v }))}
                />
                <p className="text-xs text-muted-foreground">
                  % of warmup emails auto-moved from spam → inbox.
                </p>
              </div>

              {/* Mark important */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Mark important
                  </Label>
                  <span className="text-xs font-semibold tabular-nums">{merged.warmupMarkImportantPct}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[merged.warmupMarkImportantPct]}
                  onValueChange={([v]) => setForm((f) => ({ ...f, warmupMarkImportantPct: v }))}
                />
                <p className="text-xs text-muted-foreground">
                  % of warmup emails flagged as important to signal positive engagement.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={pending || !Object.keys(form).length} className="flex-1">
              {pending ? 'Saving…' : 'Save settings'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AccountsListClient({
  initialAccounts,
  availableTags,
}: {
  initialAccounts: EmailAccount[]
  availableTags: AccountTag[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [accounts] = useState(initialAccounts)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editAccount, setEditAccount] = useState<EmailAccount | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [addingTag, setAddingTag] = useState(false)

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      if (tagFilter !== 'all' && !a.tags.some((t) => t.id === tagFilter)) return false
      if (search && !a.email.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [accounts, statusFilter, tagFilter, search])

  const allSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id))

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((a) => a.id)))
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function runBulk(action: Parameters<typeof bulkUpdateAccounts>[1]) {
    startTransition(async () => {
      await bulkUpdateAccounts([...selectedIds], action)
      setSelectedIds(new Set())
      router.refresh()
    })
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return
    setAddingTag(true)
    await createAccountTag(newTagName.trim())
    setNewTagName('')
    setAddingTag(false)
    router.refresh()
  }

  async function handleRemoveTag(accountId: string, tagId: string) {
    await removeTagFromAccount(accountId, tagId)
    router.refresh()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b">
        <div>
          <h1 className="text-xl font-bold">Email Accounts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} connected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { startTransition(() => router.refresh()) }}
            disabled={pending}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${pending ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              window.location.href = '/api/engage/gmail/connect?returnTo=/engage/accounts'
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Connect account
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as AccountStatus | 'all')}>
          <SelectTrigger className="h-8 text-sm w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as AccountStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="h-8 text-sm w-36">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {availableTags.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
            <DropdownMenuSeparator />
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <Input
                placeholder="New tag…"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
                className="h-6 text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCreateTag}
                disabled={addingTag || !newTagName.trim()}
                className="h-6 px-2 text-xs"
              >
                Add
              </Button>
            </div>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {accounts.length}
        </span>
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-6 py-2 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-1.5 ml-4">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => runBulk('enable_warmup')}
              disabled={pending}
            >
              <Flame className="w-3 h-3 mr-1 text-orange-500" />
              Enable warmup
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => runBulk('pause_warmup')}
              disabled={pending}
            >
              <ZapOff className="w-3 h-3 mr-1" />
              Pause warmup
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => runBulk('unpause')}
              disabled={pending}
            >
              <Play className="w-3 h-3 mr-1" />
              Unpause
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => runBulk('pause')}
              disabled={pending}
            >
              <Pause className="w-3 h-3 mr-1" />
              Pause
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs ml-auto text-muted-foreground"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
            <Mail className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              {accounts.length === 0 ? 'No accounts connected yet' : 'No accounts match your filters'}
            </p>
            {accounts.length === 0 && (
              <Button
                size="sm"
                onClick={() => {
                  window.location.href = '/api/engage/gmail/connect?returnTo=/engage/accounts'
                }}
              >
                Connect your first account
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Health score</th>
                <th className="px-4 py-3 text-right">Sent today</th>
                <th className="px-4 py-3 text-right">Warmup (7d)</th>
                <th className="px-4 py-3 text-right">Score</th>
                <th className="px-4 py-3 text-left">Tags</th>
                <th className="px-4 py-3 text-left">Last sync</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((account) => (
                <tr
                  key={account.id}
                  className={`hover:bg-muted/20 transition-colors ${
                    selectedIds.has(account.id) ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selectedIds.has(account.id)}
                      onCheckedChange={() => toggle(account.id)}
                      aria-label={`Select ${account.email}`}
                    />
                  </td>

                  {/* Email / provider */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {PROVIDER_ICON[account.provider] ?? 'E'}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{account.email}</p>
                        <p className="text-[11px] text-muted-foreground capitalize">{account.provider}</p>
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Badge className={`text-xs ${STATUS_CLASS[account.status]}`}>
                        {STATUS_LABELS[account.status]}
                      </Badge>
                      {account.warmupEnabled && (
                        <span title="Warmup active">
                          <Flame className="w-3.5 h-3.5 text-orange-400" />
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Health score */}
                  <td className="px-4 py-3">
                    <HealthBar score={account.healthScore} />
                  </td>

                  {/* Sent today */}
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="font-medium">{account.sentToday}</span>
                    <span className="text-muted-foreground text-xs"> / {account.dailySendLimit}</span>
                  </td>

                  {/* Warmup 7d */}
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {account.warmupEnabled ? (
                      account.warmupEmails7d > 0 ? account.warmupEmails7d : '—'
                    ) : (
                      <span className="text-xs">Off</span>
                    )}
                  </td>

                  {/* Combined score */}
                  <td className="px-4 py-3 text-right">
                    <CombinedScoreBadge score={account.combinedScore} sent={account.sent} />
                  </td>

                  {/* Tags */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                      {account.tags.map((t) => (
                        <TagPill
                          key={t.id}
                          tag={t}
                          onRemove={() => handleRemoveTag(account.id, t.id)}
                        />
                      ))}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-dashed hover:border-solid transition-all"
                            title="Add tag"
                          >
                            <Tag className="w-2.5 h-2.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          {availableTags.length === 0 && (
                            <div className="px-2 py-2 text-xs text-muted-foreground">No tags yet</div>
                          )}
                          {availableTags
                            .filter((t) => !account.tags.some((at) => at.id === t.id))
                            .map((t) => (
                              <DropdownMenuItem
                                key={t.id}
                                onClick={() =>
                                  startTransition(async () => {
                                    await applyTagsToAccounts([account.id], [t.id])
                                    router.refresh()
                                  })
                                }
                              >
                                <TagPill tag={t} />
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>

                  {/* Last sync */}
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {relTime(account.lastSyncedAt)}
                  </td>

                  {/* Row actions */}
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => setEditAccount(account)}>
                          <Activity className="w-3.5 h-3.5 mr-2" />
                          Account settings
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            startTransition(async () => {
                              await updateAccountSettings(account.id, {
                                warmupEnabled: !account.warmupEnabled,
                              })
                              router.refresh()
                            })
                          }
                        >
                          {account.warmupEnabled ? (
                            <>
                              <ZapOff className="w-3.5 h-3.5 mr-2" /> Pause warmup
                            </>
                          ) : (
                            <>
                              <Flame className="w-3.5 h-3.5 mr-2 text-orange-500" /> Enable warmup
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            startTransition(async () => {
                              await updateAccountSettings(account.id, {
                                status: account.status === 'paused' ? 'active' : 'paused',
                              })
                              router.refresh()
                            })
                          }
                        >
                          {account.status === 'paused' ? (
                            <>
                              <Play className="w-3.5 h-3.5 mr-2" /> Unpause
                            </>
                          ) : (
                            <>
                              <Pause className="w-3.5 h-3.5 mr-2" /> Pause
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Settings drawer */}
      <SettingsDrawer
        account={editAccount}
        open={!!editAccount}
        onClose={() => setEditAccount(null)}
      />
    </div>
  )
}
