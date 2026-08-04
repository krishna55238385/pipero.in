'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, PlugZap } from 'lucide-react'
import { getMailboxes, reconnectMailboxAction } from '@/app/actions/mail'
import type { Mailbox } from '@/types/mail'

const RECONNECT_STATUSES = new Set([
  'error',
  'disconnected',
  'reconnect_required',
  'oauth_expired',
  'smtp_failed',
  'imap_failed',
  'verification_failed',
  'at_risk',
  'pending_dns',
  'suspended',
])

export default function MailReconnectClient() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setMailboxes(await getMailboxes())
    } catch {
      setError('Failed to load mailboxes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const needingAttention = useMemo(
    () =>
      mailboxes.filter(
        (m) =>
          RECONNECT_STATUSES.has(m.mailboxStatus) ||
          m.verificationStatus === 'failed' ||
          m.healthStatus === 'poor'
      ),
    [mailboxes]
  )

  async function reconnect(id: string) {
    setBusyId(id)
    const result = await reconnectMailboxAction(id)
    setBusyId(null)
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
    <div className="space-y-6">
      <MailPageHeader
        title="Reconnect Center"
        description="Mailboxes that need OAuth reconnect, DNS, or health recovery"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : needingAttention.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            All mailboxes look healthy — nothing to reconnect.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {needingAttention.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.provider} · {m.authType} · health {m.healthScore}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{m.mailboxStatus}</Badge>
                    <Badge variant="secondary">{m.verificationStatus}</Badge>
                    <Button
                      size="sm"
                      disabled={busyId === m.id}
                      onClick={() => void reconnect(m.id)}
                    >
                      {busyId === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <PlugZap className="h-3.5 w-3.5 mr-1" /> Reconnect
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
