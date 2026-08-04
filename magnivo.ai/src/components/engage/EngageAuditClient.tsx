'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EngageProductShell, EngageEmpty, EngageLoading, EngageToolbar } from '@/components/mail/EngageProductShell'
import { getMailboxes, getMailboxAuditLogs, listUnifiedAuditEventsAction } from '@/app/actions/mail'
import type { Mailbox, MailboxAuditLogEntry } from '@/types/mail'

type UnifiedEvent = {
  id: string
  action: string
  summary: string
  actorEmail: string | null
  entityType: string
  entityId: string | null
  createdAt: string
  source: 'unified' | 'mailbox'
}

export default function EngageAuditClient() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [mailboxId, setMailboxId] = useState<string>('all')
  const [entityType, setEntityType] = useState<string>('all')
  const [logs, setLogs] = useState<UnifiedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const mbs = await getMailboxes()
      setMailboxes(mbs)

      const unified = await listUnifiedAuditEventsAction({
        limit: 200,
        entityType: entityType === 'all' ? undefined : entityType,
        search: search || undefined,
      })

      const targetIds = mailboxId === 'all' ? mbs.slice(0, 20).map((m) => m.id) : [mailboxId]
      const batches = await Promise.all(
        targetIds.map((id) => getMailboxAuditLogs(id, 40).catch(() => [] as MailboxAuditLogEntry[]))
      )
      const mailboxEvents: UnifiedEvent[] = batches.flat().map((l) => ({
        id: l.id,
        action: l.action,
        summary: l.action,
        actorEmail: l.actorEmail,
        entityType: 'mailbox',
        entityId: l.mailboxId,
        createdAt: l.createdAt,
        source: 'mailbox' as const,
      }))

      const unifiedEvents: UnifiedEvent[] = unified.map((e) => ({
        id: e.id,
        action: e.action,
        summary: e.summary || e.action,
        actorEmail: e.actorEmail,
        entityType: e.entityType,
        entityId: e.entityId,
        createdAt: e.createdAt,
        source: 'unified' as const,
      }))

      const merged = [...unifiedEvents, ...mailboxEvents].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      setLogs(merged)
    } catch {
      setError('Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [mailboxId, entityType, search])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = logs.filter((l) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      l.action.toLowerCase().includes(q) ||
      l.summary.toLowerCase().includes(q) ||
      (l.actorEmail || '').toLowerCase().includes(q) ||
      l.entityType.toLowerCase().includes(q)
    )
  })

  function exportCsv() {
    const lines = [
      'source,action,summary,actorEmail,entityType,entityId,createdAt',
      ...filtered.map(
        (l) =>
          `${l.source},${l.action},"${l.summary.replace(/"/g, '""')}",${l.actorEmail || ''},${l.entityType},${l.entityId || ''},${l.createdAt}`
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `engage-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <EngageProductShell title="Audit Logs" description="Workspace and mailbox lifecycle history">
        <EngageLoading />
      </EngageProductShell>
    )
  }

  return (
    <EngageProductShell
      title="Audit Logs"
      description="Unified workspace trail: roles, sub-accounts, grace periods, mailbox lifecycle"
      stats={[
        { label: 'Events loaded', value: logs.length },
        { label: 'Mailboxes', value: mailboxes.length },
        { label: 'Filtered', value: filtered.length },
      ]}
      toolbar={
        <EngageToolbar
          search={search}
          onSearch={setSearch}
          onRefresh={() => void load()}
          onExport={exportCsv}
          filters={
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm max-w-xs"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                aria-label="Entity type"
              >
                <option value="all">All entities</option>
                <option value="workspace">Workspace</option>
                <option value="workspace_member">Team</option>
                <option value="mailbox">Mailbox</option>
              </select>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm max-w-xs"
                value={mailboxId}
                onChange={(e) => setMailboxId(e.target.value)}
                aria-label="Mailbox filter"
              >
                <option value="all">All mailboxes (sample)</option>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.email}
                  </option>
                ))}
              </select>
            </div>
          }
        />
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EngageEmpty title="No audit events" description="Connect mailboxes or change team roles to start the trail." />
          ) : (
            <div className="divide-y max-h-[70vh] overflow-auto">
              {filtered.map((l) => (
                <div key={`${l.source}-${l.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{l.summary}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {l.actorEmail || 'system'} · {l.entityType}
                      {l.entityId ? ` · ${l.entityId}` : ''} · {l.source}
                    </p>
                  </div>
                  <Badge variant="outline">{new Date(l.createdAt).toLocaleString()}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </EngageProductShell>
  )
}
