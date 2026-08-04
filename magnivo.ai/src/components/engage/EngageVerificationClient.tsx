'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EngageProductShell, EngageEmpty, EngageLoading, EngageToolbar } from '@/components/mail/EngageProductShell'
import {
  getMailLeads,
  reverifyMailLeadAction,
  getLeadVerificationStatsAction,
} from '@/app/actions/mail'
import type { Lead } from '@/types/mail'

export default function EngageVerificationClient() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getLeadVerificationStatsAction>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, s] = await Promise.all([getMailLeads(), getLeadVerificationStatsAction()])
      setLeads(list)
      setStats(s)
    } catch {
      setError('Failed to load verification center')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (filter !== 'all' && (l.verifiedStatus || 'unverified') !== filter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return l.email.includes(q) || l.name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q)
    })
  }, [leads, search, filter])

  async function verifyOne(id: string) {
    setBusyId(id)
    const result = await reverifyMailLeadAction(id)
    setBusyId(null)
    if (!result.success) {
      setError(result.error || 'Verify failed')
      return
    }
    await load()
  }

  async function verifySelected() {
    if (selected.size === 0) return
    setBulkBusy(true)
    for (const id of selected) {
      await reverifyMailLeadAction(id)
    }
    setBulkBusy(false)
    setSelected(new Set())
    await load()
  }

  if (loading) {
    return (
      <EngageProductShell title="Email Verification Center" description="Syntax, MX, and catch-all hygiene">
        <EngageLoading />
      </EngageProductShell>
    )
  }

  return (
    <EngageProductShell
      title="Email Verification Center"
      description="Verify leads before enrollment — invalid and no-MX addresses are blocked from sequences"
      stats={[
        { label: 'Total', value: stats?.total ?? 0 },
        { label: 'Valid', value: stats?.valid ?? 0, tone: 'good' },
        { label: 'Risky / catch-all', value: stats?.risky ?? 0, tone: 'warn' },
        { label: 'Invalid', value: stats?.invalid ?? 0, tone: 'bad' },
        { label: 'Unverified', value: stats?.unverified ?? 0 },
        { label: 'Suppressed', value: stats?.suppressed ?? 0 },
      ]}
      toolbar={
        <EngageToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search leads…"
          onRefresh={() => void load()}
          filters={
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {['all', 'valid', 'risky', 'catch_all', 'invalid', 'no_mx', 'unverified'].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          }
          actions={
            <Button size="sm" disabled={selected.size === 0 || bulkBusy} onClick={() => void verifySelected()}>
              {bulkBusy ? 'Verifying…' : `Verify selected (${selected.size})`}
            </Button>
          }
        />
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EngageEmpty title="No leads match" description="Import leads or clear filters." />
          ) : (
            <div className="divide-y max-h-[70vh] overflow-auto">
              {filtered.map((lead) => (
                <div key={lead.id} className="flex items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(lead.id)
                      else next.delete(lead.id)
                      setSelected(next)
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{lead.email}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[lead.name, lead.company].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <Badge variant="outline">{lead.verifiedStatus || 'unverified'}</Badge>
                  <Button size="sm" variant="outline" disabled={busyId === lead.id} onClick={() => void verifyOne(lead.id)}>
                    {busyId === lead.id ? '…' : 'Verify'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </EngageProductShell>
  )
}
