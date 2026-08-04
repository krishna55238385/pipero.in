'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Activity, Loader2, Stethoscope } from 'lucide-react'
import {
  verifyMailboxConnectionAction,
  reconnectMailboxAction,
  getMailboxWithConfigs,
  getMailboxAuditLogs,
} from '@/app/actions/mail'
import type { Mailbox, MailboxAuditLogEntry } from '@/types/mail'

export function MailboxDiagnosticsPanel({ mailboxId }: { mailboxId: string }) {
  const [mailbox, setMailbox] = useState<Mailbox | null>(null)
  const [logs, setLogs] = useState<MailboxAuditLogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [mb, audit] = await Promise.all([
        getMailboxWithConfigs(mailboxId),
        getMailboxAuditLogs(mailboxId, 30),
      ])
      setMailbox(mb)
      setLogs(Array.isArray(audit) ? audit : [])
    } catch {
      setError('Failed to load mailbox diagnostics')
    } finally {
      setBusy(false)
    }
  }, [mailboxId])

  useEffect(() => {
    void load()
  }, [load])

  async function runVerify() {
    setBusy(true)
    const result = await verifyMailboxConnectionAction(mailboxId)
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Verify failed')
      return
    }
    await load()
  }

  async function runReconnect() {
    setBusy(true)
    const result = await reconnectMailboxAction(mailboxId)
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Reconnect failed')
      return
    }
    const data = result.data as { oauthRedirectUrl?: string } | undefined
    if (data?.oauthRedirectUrl) {
      window.location.href = data.oauthRedirectUrl
      return
    }
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Stethoscope className="h-4 w-4" /> Diagnostics
        </h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {mailbox && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Diag label="Status" value={mailbox.mailboxStatus} />
          <Diag label="Auth" value={mailbox.authType} />
          <Diag label="OAuth" value={mailbox.oauthConfig ? 'configured' : 'n/a'} />
          <Diag label="SMTP" value={mailbox.smtpConfig ? 'configured' : 'n/a'} />
          <Diag label="IMAP" value={mailbox.imapConfig ? 'configured' : 'n/a'} />
          <Diag label="Daily usage" value={`${mailbox.currentDailyUsage}/${mailbox.dailyLimit}`} />
          <Diag label="Warmup" value={mailbox.warmupStatus} />
          <Diag label="Health" value={`${mailbox.healthScore} (${mailbox.healthStatus})`} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void runVerify()}>
          Verify connection
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runReconnect()}>
          Reconnect
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs flex items-center gap-1">
            <Activity className="h-3.5 w-3.5" /> Connection / audit log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-48 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No audit events</p>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="text-[11px] border-b border-border/40 pb-1">
                <span className="font-medium">{l.action}</span>
                <span className="text-muted-foreground"> · {new Date(l.createdAt).toLocaleString()}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Diag({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium truncate">{value}</p>
    </div>
  )
}
