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
import { useMailFiltersStore } from '@/stores/mail-filters'
import {
  getMailboxWithConfigs,
  reconnectMailboxAction,
  verifyMailboxConnectionAction,
  disableMailboxAction,
  enableMailboxAction,
  archiveMailboxAction,
  restoreMailboxAction,
  softDeleteMailboxAction,
  getMailboxAuditLogs,
  overrideMailboxDnsRiskAction,
  applyMailboxDnsGateAction,
} from '@/app/actions/mail'
import type { Mailbox, MailboxAuditLogEntry, MailUserPermissions } from '@/types/mail'
import { getMailErrorMessage } from '@/types/mail'
import { MailboxDiagnosticsPanel } from '@/components/mail/diagnostics/MailboxDiagnosticsPanel'

function Separator() {
  return <div className="h-px bg-border/20" />
}

const STATUS_BADGE_MAP: Record<string, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-600/10 text-emerald-700' },
  disconnected: { label: 'Disconnected', className: 'bg-muted text-muted-foreground' },
  warming: { label: 'Warming', className: 'bg-blue-600/10 text-blue-700' },
  error: { label: 'Error', className: 'bg-destructive/10 text-destructive' },
  suspended: { label: 'Suspended', className: 'bg-amber-600/10 text-amber-700' },
  pending: { label: 'Pending', className: 'bg-yellow-600/10 text-yellow-700' },
  testing: { label: 'Testing', className: 'bg-indigo-600/10 text-indigo-700' },
  disabled: { label: 'Disabled', className: 'bg-gray-600/10 text-gray-700' },
  archived: { label: 'Archived', className: 'bg-slate-600/10 text-slate-700' },
  deleted: { label: 'Deleted', className: 'bg-red-600/10 text-red-700' },
  reconnect_required: { label: 'Reconnect Required', className: 'bg-orange-600/10 text-orange-700' },
  oauth_expired: { label: 'OAuth Expired', className: 'bg-orange-600/10 text-orange-700' },
  smtp_failed: { label: 'SMTP Failed', className: 'bg-red-600/10 text-red-700' },
  imap_failed: { label: 'IMAP Failed', className: 'bg-red-600/10 text-red-700' },
  verification_failed: { label: 'Verification Failed', className: 'bg-red-600/10 text-red-700' },
  pending_dns: { label: 'Pending DNS Setup', className: 'bg-amber-600/10 text-amber-800' },
  pending_warmup: { label: 'Pending Warmup', className: 'bg-sky-600/10 text-sky-800' },
  at_risk: { label: 'At Risk', className: 'bg-rose-600/10 text-rose-800' },
}

const HEALTH_BADGE_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  excellent: { label: 'Excellent', variant: 'default' },
  good: { label: 'Good', variant: 'default' },
  fair: { label: 'Fair', variant: 'secondary' },
  poor: { label: 'Poor', variant: 'destructive' },
  unknown: { label: 'Unknown', variant: 'outline' },
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  enabled: 'Enabled',
  disabled: 'Disabled',
  archived: 'Archived',
  restored: 'Restored',
  soft_deleted: 'Deleted',
  status_changed: 'Status Changed',
  reconnect_attempted: 'Reconnect Attempted',
  reconnect_succeeded: 'Reconnect Succeeded',
  reconnect_failed: 'Reconnect Failed',
  verified: 'Verified',
  verification_failed: 'Verification Failed',
  pool_assigned: 'Pool Assigned',
  pool_removed: 'Pool Removed',
  updated: 'Updated',
  bulk_action: 'Bulk Action',
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  zoho: 'Zoho',
  custom: 'Custom',
}

type MailboxDetailDrawerProps = {
  onComplete: () => void
  userPermissions?: MailUserPermissions
}

export function MailboxDetailDrawer({ onComplete, userPermissions }: MailboxDetailDrawerProps) {
  const { drawer, setDrawer } = useMailFiltersStore()
  const [mailbox, setMailbox] = useState<Mailbox | null>(null)
  const [auditLogs, setAuditLogs] = useState<MailboxAuditLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'audit'>('details')
  const [actionError, setActionError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const isOpen = drawer.open && drawer.mailboxId !== null
  const canManage = userPermissions?.canManage ?? true
  const canAdmin = userPermissions?.canAdmin ?? true

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen || !drawer.mailboxId) {
      setMailbox(null)
      setAuditLogs([])
      setActiveTab('details')
      setActionError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      getMailboxWithConfigs(drawer.mailboxId),
      getMailboxAuditLogs(drawer.mailboxId, 20),
    ])
      .then(([m, logs]) => {
        if (!cancelled && mountedRef.current) {
          setMailbox(m)
          setAuditLogs(logs)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled && mountedRef.current) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, drawer.mailboxId])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleClose() {
    setDrawer({ open: false, mailboxId: null })
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

  async function handleReconnect() {
    if (!drawer.mailboxId) return
    await withActionError(async () => {
      const result = await reconnectMailboxAction(drawer.mailboxId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleVerify() {
    if (!drawer.mailboxId) return
    await withActionError(async () => {
      const result = await verifyMailboxConnectionAction(drawer.mailboxId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleApplyDnsGate() {
    if (!drawer.mailboxId) return
    await withActionError(async () => {
      const result = await applyMailboxDnsGateAction(drawer.mailboxId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
    })
  }

  async function handleDnsRiskOverride() {
    if (!drawer.mailboxId) return
    const confirmed = window.confirm(
      'Proceed without DMARC? Mailbox will be marked At Risk. SPF+DKIM must still pass.'
    )
    if (!confirmed) return
    await withActionError(async () => {
      const result = await overrideMailboxDnsRiskAction(drawer.mailboxId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
    })
  }

  async function handleToggleStatus() {
    if (!drawer.mailboxId || !mailbox) return
    await withActionError(async () => {
      let result
      if (mailbox.mailboxStatus === 'connected') {
        result = await disableMailboxAction(drawer.mailboxId!)
      } else {
        result = await enableMailboxAction(drawer.mailboxId!)
      }
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleArchive() {
    if (!drawer.mailboxId) return
    await withActionError(async () => {
      const result = await archiveMailboxAction(drawer.mailboxId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleRestore() {
    if (!drawer.mailboxId) return
    await withActionError(async () => {
      const result = await restoreMailboxAction(drawer.mailboxId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  async function handleDelete() {
    if (!drawer.mailboxId) return
    await withActionError(async () => {
      const result = await softDeleteMailboxAction(drawer.mailboxId!)
      if (!result.success) {
        setActionError(getMailErrorMessage(result.error))
        return
      }
      onComplete()
      handleClose()
    })
  }

  function handleEdit() {
    if (drawer.mailboxId) {
      handleClose()
    }
  }

  function canEnable() {
    if (!mailbox) return false
    return ['disconnected', 'disabled', 'error', 'reconnect_required', 'oauth_expired', 'smtp_failed', 'imap_failed', 'verification_failed'].includes(mailbox.mailboxStatus)
  }

  function canDisable() {
    if (!mailbox) return false
    return mailbox.mailboxStatus === 'connected'
  }

  function canArchive() {
    if (!mailbox) return false
    return !['archived', 'deleted'].includes(mailbox.mailboxStatus)
  }

  function canRestore() {
    if (!mailbox) return false
    return mailbox.mailboxStatus === 'archived'
  }

  function canDelete() {
    if (!mailbox) return false
    return !['deleted'].includes(mailbox.mailboxStatus)
  }

  function canReconnect() {
    if (!mailbox) return false
    return ['reconnect_required', 'oauth_expired', 'smtp_failed', 'imap_failed', 'error', 'verification_failed'].includes(mailbox.mailboxStatus)
  }

  function canVerify() {
    if (!mailbox) return false
    return ['connected', 'disconnected', 'reconnect_required'].includes(mailbox.mailboxStatus)
  }

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Mailbox Details</SheetTitle>
          <SheetDescription>
            {mailbox ? mailbox.email : 'Loading...'}
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
        ) : mailbox ? (
          <div className="space-y-6 p-4">
            {actionError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                {actionError}
              </div>
            )}

            {/* Tab Navigation */}
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
                  activeTab === 'audit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('audit')}
              >
                Audit Log ({auditLogs.length})
              </button>
            </div>

            {activeTab === 'details' ? (
              <>
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Overview</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoRow label="Status">
                      <StatusBadge status={mailbox.mailboxStatus} />
                    </InfoRow>
                    <InfoRow label="Health">
                      <HealthBadge health={mailbox.healthStatus} score={mailbox.healthScore} />
                    </InfoRow>
                    <InfoRow label="Provider">
                      <span className="text-sm">{PROVIDER_LABELS[mailbox.provider] ?? mailbox.provider}</span>
                    </InfoRow>
                    <InfoRow label="Auth Type">
                      <Badge variant="outline" className="text-xs">{mailbox.authType}</Badge>
                    </InfoRow>
                    <InfoRow label="Display Name">
                      <span className="text-sm">{mailbox.displayName || '—'}</span>
                    </InfoRow>
                    <InfoRow label="Timezone">
                      <span className="text-sm">{mailbox.timezone}</span>
                    </InfoRow>
                    <InfoRow label="Verification">
                      <Badge variant={mailbox.verificationStatus === 'verified' ? 'default' : mailbox.verificationStatus === 'failed' ? 'destructive' : 'outline'} className="text-xs">
                        {mailbox.verificationStatus}
                      </Badge>
                    </InfoRow>
                    <InfoRow label="Warmup">
                      <span className="text-sm text-muted-foreground">{mailbox.warmupStatus}</span>
                    </InfoRow>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Daily Limits</h3>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Usage</p>
                      <p className="text-lg font-semibold">
                        {mailbox.currentDailyUsage}
                        <span className="text-sm font-normal text-muted-foreground"> / {mailbox.dailyLimit}</span>
                      </p>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.min(100, (mailbox.currentDailyUsage / Math.max(1, mailbox.dailyLimit)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {mailbox.poolId && (
                  <>
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-muted-foreground">Pool Membership</h3>
                      <div className="rounded-lg border border-border/20 p-3 text-sm">
                        <p className="text-muted-foreground">Pool ID: {mailbox.poolId}</p>
                      </div>
                    </div>
                    <Separator />
                  </>
                )}

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">OAuth</h3>
                  {mailbox.oauthConfig ? (
                    <div className="rounded-lg border border-border/20 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span>Provider: {mailbox.oauthConfig.provider}</span>
                        <Badge variant={mailbox.oauthConfig.tokenExpiresAt && new Date(mailbox.oauthConfig.tokenExpiresAt) < new Date() ? 'destructive' : 'default'} className="text-xs">
                          {mailbox.oauthConfig.tokenExpiresAt && new Date(mailbox.oauthConfig.tokenExpiresAt) < new Date() ? 'Expired' : 'Valid'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Account: {mailbox.oauthConfig.providerAccountId}</p>
                      {mailbox.oauthConfig.tokenExpiresAt && (
                        <p className="text-xs text-muted-foreground">Expires: {new Date(mailbox.oauthConfig.tokenExpiresAt).toLocaleString()}</p>
                      )}
                      {mailbox.oauthConfig.lastRotatedAt && (
                        <p className="text-xs text-muted-foreground">Last rotated: {new Date(mailbox.oauthConfig.lastRotatedAt).toLocaleString()}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No OAuth configuration</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">SMTP</h3>
                  {mailbox.smtpConfig ? (
                    <div className="rounded-lg border border-border/20 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span>{mailbox.smtpConfig.smtpHost}:{mailbox.smtpConfig.smtpPort}</span>
                        <Badge variant={mailbox.smtpConfig.validationStatus === 'valid' ? 'default' : 'destructive'} className="text-xs">
                          {mailbox.smtpConfig.validationStatus}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {mailbox.smtpConfig.encryption.toUpperCase()} / {mailbox.smtpConfig.authenticationType}
                      </p>
                      {mailbox.smtpConfig.lastValidatedAt && (
                        <p className="text-xs text-muted-foreground">Last validated: {new Date(mailbox.smtpConfig.lastValidatedAt).toLocaleString()}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No SMTP configuration</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">IMAP</h3>
                  {mailbox.imapConfig ? (
                    <div className="rounded-lg border border-border/20 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span>{mailbox.imapConfig.host}:{mailbox.imapConfig.port}</span>
                        <Badge variant={mailbox.imapConfig.validationStatus === 'valid' ? 'default' : 'destructive'} className="text-xs">
                          {mailbox.imapConfig.validationStatus}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        SSL: {mailbox.imapConfig.ssl ? 'Yes' : 'No'} / {mailbox.imapConfig.authentication}
                      </p>
                      {mailbox.imapConfig.lastValidatedAt && (
                        <p className="text-xs text-muted-foreground">Last validated: {new Date(mailbox.imapConfig.lastValidatedAt).toLocaleString()}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No IMAP configuration</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Verification</h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{mailbox.verificationStatus}</Badge>
                  </div>
                  {mailbox.lastVerifiedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last verified: {new Date(mailbox.lastVerifiedAt).toLocaleString()}
                      {mailbox.lastVerificationDurationMs != null && ` (${mailbox.lastVerificationDurationMs}ms)`}
                    </p>
                  )}
                  {mailbox.lastVerificationResult && (
                    <p className="text-xs text-muted-foreground">{mailbox.lastVerificationResult}</p>
                  )}
                </div>

                <Separator />

                <Separator />

                <MailboxDiagnosticsPanel mailboxId={mailbox.id} />

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {canManage && canReconnect() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleReconnect}>
                        Reconnect
                      </Button>
                    )}
                    {canManage && canVerify() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleVerify}>
                        Verify
                      </Button>
                    )}
                    {canManage && mailbox.mailboxStatus === 'pending_dns' && (
                      <>
                        <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleApplyDnsGate}>
                          Check DNS gate
                        </Button>
                        <Button variant="secondary" size="sm" disabled={actionLoading} onClick={handleDnsRiskOverride}>
                          I&apos;ll do this later (at risk)
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleEdit}>
                      Edit
                    </Button>
                    {canManage && canDisable() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleToggleStatus}>
                        Disable
                      </Button>
                    )}
                    {canManage && canEnable() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleToggleStatus}>
                        Enable
                      </Button>
                    )}
                    {canManage && canArchive() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleArchive}>
                        Archive
                      </Button>
                    )}
                    {canManage && canRestore() && (
                      <Button variant="outline" size="sm" disabled={actionLoading} onClick={handleRestore}>
                        Restore
                      </Button>
                    )}
                    {canAdmin && canDelete() && (
                      <Button variant="destructive" size="sm" disabled={actionLoading} onClick={handleDelete}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Metadata</h3>
                  <pre className="rounded-lg bg-muted p-3 text-xs overflow-auto">
                    {JSON.stringify(mailbox.metadata, null, 2) || '{}'}
                  </pre>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Created: {new Date(mailbox.createdAt).toLocaleString()}</p>
                  <p>Updated: {new Date(mailbox.updatedAt).toLocaleString()}</p>
                  <p>ID: {mailbox.id}</p>
                </div>
              </>
            ) : (
              /* Audit Log Tab */
              <div className="space-y-3">
                {auditLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No audit events recorded yet.</p>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-border/20 p-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        by {log.actorEmail}
                      </p>
                      {log.previousStatus && log.newStatus && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {log.previousStatus} → {log.newStatus}
                        </p>
                      )}
                      {Object.keys(log.metadata).length > 0 && (
                        <pre className="mt-2 rounded bg-muted p-2 text-xs overflow-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Mailbox not found.</div>
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

function StatusBadge({ status }: { status: string }) {
  const badge = STATUS_BADGE_MAP[status] ?? STATUS_BADGE_MAP.disconnected
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
      {badge.label}
    </span>
  )
}

function HealthBadge({ health, score }: { health: string; score: number | null }) {
  const badge = HEALTH_BADGE_MAP[health] ?? HEALTH_BADGE_MAP.unknown
  return (
    <Badge variant={badge.variant} className="text-xs">
      {score != null ? `${score} ` : ''}{badge.label}
    </Badge>
  )
}
