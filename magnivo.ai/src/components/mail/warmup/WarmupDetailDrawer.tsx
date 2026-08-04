'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useWarmupFiltersStore } from '@/stores/warmup-filters'
import {
  getWarmupAction,
  startWarmupAction,
  pauseWarmupAction,
  resumeWarmupAction,
  restartWarmupAction,
  graduateWarmupAction,
  deleteWarmupAction,
} from '@/app/actions/mail'
import type { WarmupConfigWithStats } from '@/types/mail'
import { getMailErrorMessage } from '@/types/mail'

function Separator() {
  return <div className="h-px bg-border/20" />
}

const STATUS_BADGE_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-600/10 text-slate-700' },
  pending: { label: 'Pending', className: 'bg-yellow-600/10 text-yellow-700' },
  running: { label: 'Running', className: 'bg-emerald-600/10 text-emerald-700' },
  paused: { label: 'Paused', className: 'bg-amber-600/10 text-amber-700' },
  completed: { label: 'Completed', className: 'bg-blue-600/10 text-blue-700' },
  graduated: { label: 'Graduated', className: 'bg-violet-600/10 text-violet-700' },
  disabled: { label: 'Disabled', className: 'bg-gray-600/10 text-gray-700' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
}

const HEALTH_BADGE_MAP: Record<string, { label: string; className: string; prd: string }> = {
  excellent: { label: 'Excellent', className: 'bg-emerald-600/10 text-emerald-700', prd: 'Warm' },
  healthy: { label: 'Healthy', className: 'bg-blue-600/10 text-blue-700', prd: 'Warming' },
  warning: { label: 'Warning', className: 'bg-amber-600/10 text-amber-700', prd: 'Warming' },
  critical: { label: 'Critical', className: 'bg-destructive/10 text-destructive', prd: 'Cold' },
}

const STAGE_LABELS: Record<string, string> = {
  initial: 'Initial',
  learning: 'Learning',
  growing: 'Growing',
  established: 'Established',
  graduated: 'Graduated',
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  created: 'Created',
  started: 'Started',
  paused: 'Paused',
  resumed: 'Resumed',
  graduated: 'Graduated',
  archived: 'Archived',
  deleted: 'Deleted',
  updated: 'Updated',
  stage_changed: 'Stage Changed',
  health_changed: 'Health Changed',
  configured: 'Configured',
  error: 'Error',
  reset: 'Reset',
}

type WarmupDetailDrawerProps = {
  onComplete: () => void
  userPermissions?: { canManage?: boolean; canAdmin?: boolean }
}

export function WarmupDetailDrawer({ onComplete, userPermissions }: WarmupDetailDrawerProps) {
  const canAdmin = userPermissions?.canAdmin === true
  const [graduateOpen, setGraduateOpen] = useState(false)
  const [forceGraduate, setForceGraduate] = useState(false)
  const { drawer, setDrawer } = useWarmupFiltersStore()
  const [config, setConfig] = useState<WarmupConfigWithStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'events'>('details')
  const [actionError, setActionError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const isOpen = drawer.open && drawer.configId !== null

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen || !drawer.configId) {
      setConfig(null)
      setActiveTab('details')
      setActionError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getWarmupAction(drawer.configId)
      .then((result) => {
        if (!cancelled && mountedRef.current) {
          if (result.success) {
            setConfig(result.data)
          } else {
            setActionError(result.error)
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled && mountedRef.current) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, drawer.configId])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleClose() {
    setDrawer({ open: false, configId: null })
  }

  async function withActionError(fn: () => Promise<void>) {
    setActionError(null)
    setActionLoading(true)
    try {
      await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed'
      setActionError(getMailErrorMessage(msg))
    } finally {
      setActionLoading(false)
    }
  }

  async function handleStart() {
    if (!drawer.configId) return
    await withActionError(async () => {
      const result = await startWarmupAction(drawer.configId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handlePause() {
    if (!drawer.configId) return
    await withActionError(async () => {
      const result = await pauseWarmupAction(drawer.configId!, 'Paused by user')
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleResume() {
    if (!drawer.configId) return
    await withActionError(async () => {
      const result = await resumeWarmupAction(drawer.configId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleRestart() {
    if (!drawer.configId) return
    await withActionError(async () => {
      const result = await restartWarmupAction(drawer.configId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleGraduateConfirm() {
    if (!drawer.configId) return
    await withActionError(async () => {
      const result = await graduateWarmupAction(drawer.configId!, forceGraduate)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      setGraduateOpen(false)
      setForceGraduate(false)
      onComplete()
      handleClose()
    })
  }

  async function handleDelete() {
    if (!drawer.configId) return
    await withActionError(async () => {
      const result = await deleteWarmupAction(drawer.configId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  function canStart() { return config?.status === 'draft' || config?.status === 'pending' }
  function canPause() { return config?.status === 'running' }
  function canResume() { return config?.status === 'paused' }
  function canRestart() { return config?.status === 'failed' || config?.status === 'completed' }
  function canGraduate() { return config?.status === 'running' && config?.health === 'excellent' }
  function canDelete() { return config?.status !== 'running' }

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Warmup Details</SheetTitle>
          <SheetDescription>
            {config ? config.mailboxEmail : 'Loading...'}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="h-8 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : config ? (
          <div className="space-y-6 p-4">
            {actionError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                {actionError}
              </div>
            )}

            <div className="flex gap-1 rounded-lg border border-border/20 p-1">
              <button
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === 'details' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('details')}
              >
                Details
              </button>
              <button
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === 'events' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('events')}
              >
                Events ({config.recentEvents.length})
              </button>
            </div>

            {activeTab === 'details' ? (
              <>
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Overview</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoRow label="Status">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${(STATUS_BADGE_MAP[config.status] ?? STATUS_BADGE_MAP.draft).className}`}>
                        {(STATUS_BADGE_MAP[config.status] ?? STATUS_BADGE_MAP.draft).label}
                      </span>
                    </InfoRow>
                    <InfoRow label="Stage">
                      <Badge variant="outline" className="text-xs">{STAGE_LABELS[config.stage] ?? config.stage}</Badge>
                    </InfoRow>
                    <InfoRow label="Health">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${(HEALTH_BADGE_MAP[config.health] ?? HEALTH_BADGE_MAP.healthy).className}`}>
                        {(HEALTH_BADGE_MAP[config.health] ?? HEALTH_BADGE_MAP.healthy).prd}
                        <span className="ml-1 opacity-70">({(HEALTH_BADGE_MAP[config.health] ?? HEALTH_BADGE_MAP.healthy).label})</span>
                      </span>
                    </InfoRow>
                    <InfoRow label="Provider">
                      <span className="text-sm">{config.mailboxProvider}</span>
                    </InfoRow>
                    <InfoRow label="Timezone">
                      <span className="text-sm">{config.timezone}</span>
                    </InfoRow>
                    <InfoRow label="Notifications">
                      <Badge variant={config.activeNotifications > 0 ? 'destructive' : 'outline'} className="text-xs">
                        {config.activeNotifications}
                      </Badge>
                    </InfoRow>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Progress</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Day {config.currentDay} of {config.totalDays}</span>
                        <span className="text-xs font-medium">{config.totalDays > 0 ? Math.round((config.currentDay / config.totalDays) * 100) : 0}%</span>
                      </div>
                      <Progress value={config.totalDays > 0 ? (config.currentDay / config.totalDays) * 100 : 0} className="h-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <InfoRow label="Daily Target">
                        <span className="text-sm font-medium">{config.currentDailyTarget}</span>
                      </InfoRow>
                      <InfoRow label="Max Sends">
                        <span className="text-sm">{config.maxDailySends}</span>
                      </InfoRow>
                      <InfoRow label="Initial Sends">
                        <span className="text-sm">{config.initialSends}</span>
                      </InfoRow>
                      <InfoRow label="Daily Increase">
                        <span className="text-sm">+{config.dailyIncrease}</span>
                      </InfoRow>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Configuration</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoRow label="Weekend Sending">
                      <Badge variant={config.weekendSending ? 'default' : 'outline'} className="text-xs">
                        {config.weekendSending ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </InfoRow>
                    <InfoRow label="Hours">
                      <span className="text-sm">{config.businessHoursStart}:00 – {config.businessHoursEnd}:00</span>
                    </InfoRow>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Simulation</h3>
                  <div className="flex flex-wrap gap-2">
                    {config.replySimulation && <Badge variant="secondary" className="text-xs">Reply</Badge>}
                    {config.readSimulation && <Badge variant="secondary" className="text-xs">Read</Badge>}
                    {config.openSimulation && <Badge variant="secondary" className="text-xs">Open</Badge>}
                    {config.clickSimulation && <Badge variant="secondary" className="text-xs">Click</Badge>}
                    {config.spamRescue && <Badge variant="secondary" className="text-xs">Spam Rescue</Badge>}
                    {!config.replySimulation && !config.readSimulation && !config.openSimulation && !config.clickSimulation && !config.spamRescue && (
                      <span className="text-xs text-muted-foreground">None enabled</span>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Thresholds</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <InfoRow label="Target Health">
                      <span className="text-sm">{config.targetHealthScore}</span>
                    </InfoRow>
                    <InfoRow label="Graduation">
                      <span className="text-sm">{config.graduationThreshold}</span>
                    </InfoRow>
                    <InfoRow label="Pause/Resume">
                      <span className="text-sm">{config.pauseThreshold}/{config.resumeThreshold}</span>
                    </InfoRow>
                  </div>
                </div>

                {config.pauseReason && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground">Pause Reason</h3>
                      <p className="text-sm text-destructive">{config.pauseReason}</p>
                    </div>
                  </>
                )}

                {config.failureReason && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-destructive">Failure Reason</h3>
                    <p className="text-sm text-destructive">{config.failureReason}</p>
                  </div>
                )}

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {canStart() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleStart}>Start</Button>
                    )}
                    {canPause() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handlePause}>Pause</Button>
                    )}
                    {canResume() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleResume}>Resume</Button>
                    )}
                    {canRestart() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleRestart}>Restart</Button>
                    )}
                    {canGraduate() && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => {
                          setForceGraduate(false)
                          setGraduateOpen(true)
                        }}
                      >
                        Graduate
                      </Button>
                    )}
                    {!canGraduate() && canAdmin && (config.status === 'running' || config.status === 'paused') && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => {
                          setForceGraduate(true)
                          setGraduateOpen(true)
                        }}
                      >
                        Force graduate
                      </Button>
                    )}
                    {canDelete() && (
                      <Button variant="destructive" size="sm" disabled={actionLoading} onClick={handleDelete}>Delete</Button>
                    )}
                  </div>
                  {graduateOpen && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3" role="dialog" aria-label="Confirm graduate">
                      <p className="text-sm font-medium">
                        {forceGraduate ? 'Force graduate this mailbox?' : 'Graduate this mailbox from warmup?'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {forceGraduate
                          ? 'Admin override: mailbox will be marked Warm even if health thresholds are not met. Campaign sends may start immediately — reputation risk applies.'
                          : 'This marks the mailbox as Warm and eligible for campaign sending. Confirm only if inbox placement looks healthy.'}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={actionLoading} onClick={() => void handleGraduateConfirm()}>
                          Confirm {forceGraduate ? 'force ' : ''}graduate
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={actionLoading}
                          onClick={() => {
                            setGraduateOpen(false)
                            setForceGraduate(false)
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                <div className="space-y-1 text-xs text-muted-foreground">
                  {config.startDate && <p>Started: {new Date(config.startDate).toLocaleString()}</p>}
                  {config.endDate && <p>Ended: {new Date(config.endDate).toLocaleString()}</p>}
                  <p>Created: {new Date(config.createdAt).toLocaleString()}</p>
                  <p>Updated: {new Date(config.updatedAt).toLocaleString()}</p>
                  <p>ID: {config.id}</p>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                {config.recentEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No events recorded yet.</p>
                ) : (
                  config.recentEvents.map((event) => (
                    <div key={event.id} className="rounded-lg border border-border/20 p-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{event.message}</p>
                      {(event.previousHealth || event.newHealth) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Health: {event.previousHealth ?? '—'} → {event.newHealth ?? '—'}
                        </p>
                      )}
                      {(event.previousStage || event.newStage) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Stage: {event.previousStage ?? '—'} → {event.newStage ?? '—'}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Warmup configuration not found.</div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {children}
    </div>
  )
}
