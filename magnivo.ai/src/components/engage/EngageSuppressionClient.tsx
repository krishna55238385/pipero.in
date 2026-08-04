'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EngageProductShell, EngageEmpty, EngageLoading, EngageToolbar } from '@/components/mail/EngageProductShell'
import { listSuppressionsAction, addSuppressionAction, removeSuppressionAction } from '@/app/actions/mail'
import { Trash2 } from 'lucide-react'

export default function EngageSuppressionClient() {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof listSuppressionsAction>>>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await listSuppressionsAction())
    } catch {
      setError('Failed to load suppression list')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!search) return entries
    const q = search.toLowerCase()
    return entries.filter((e) => e.email.includes(q) || e.reason.toLowerCase().includes(q) || e.source.toLowerCase().includes(q))
  }, [entries, search])

  async function add() {
    if (!email.trim()) return
    const result = await addSuppressionAction(email.trim())
    if (!result.success) {
      setError(result.error || 'Failed to suppress')
      return
    }
    setEmail('')
    setMessage('Email suppressed')
    await load()
  }

  function exportCsv() {
    const lines = ['email,reason,source,createdAt', ...filtered.map((e) => `${e.email},${e.reason},${e.source},${e.createdAt || ''}`)]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `suppression-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <EngageProductShell title="Suppression Center" description="Org-wide do-not-contact enforcement">
        <EngageLoading />
      </EngageProductShell>
    )
  }

  return (
    <EngageProductShell
      title="Suppression Center"
      description="Hard bounces and unsubscribes land here automatically — enforced at enrollment and send time"
      stats={[
        { label: 'Suppressed', value: entries.length },
        { label: 'Matching filter', value: filtered.length },
      ]}
      toolbar={
        <EngageToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search suppressed emails…"
          onRefresh={() => void load()}
          onExport={exportCsv}
        />
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add suppression</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button onClick={() => void add()}>Suppress</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EngageEmpty title="Suppression list empty" description="Add emails manually or wait for bounce/unsubscribe events." />
          ) : (
            <div className="divide-y max-h-[65vh] overflow-auto">
              {filtered.map((entry) => (
                <div key={entry.email} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{entry.email}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {entry.reason} · {entry.source}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await removeSuppressionAction(entry.email)
                      await load()
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
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
