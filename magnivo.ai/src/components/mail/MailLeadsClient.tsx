'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { MailTableSkeleton } from '@/components/mail/MailSkeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Users, Upload, Search, Trash2, ShieldBan, List } from 'lucide-react'
import type { Lead } from '@/types/mail'
import {
  getMailLeads,
  createMailLead,
  deleteMailLead,
  importMailLeadsAction,
  previewMailLeadsImportAction,
  listSuppressionsAction,
  addSuppressionAction,
  removeSuppressionAction,
  reverifyMailLeadAction,
  getLeadVerificationStatsAction,
  exportMailLeadsCsvAction,
  bulkDeleteMailLeadsAction,
  bulkSuppressMailLeadsAction,
} from '@/app/actions/mail'
import type { CsvImportPreview } from '@/services/mail/lead-service'
import type { SuppressionEntry } from '@/services/mail/suppression-service'
import { LeadListsPanel } from '@/components/mail/leads/LeadListsPanel'

type ColumnMapping = {
  email: string
  name?: string
  company?: string
  jobTitle?: string
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cols[i] || ''
    })
    return row
  })
  return { headers, rows }
}

function guessMapping(headers: string[]): ColumnMapping {
  const email = headers.find((h) => /email/i.test(h)) || headers[0] || ''
  const name = headers.find((h) => /^(full.?)?name$/i.test(h) || /first.?name/i.test(h))
  const company = headers.find((h) => /company|organization|org/i.test(h))
  const jobTitle = headers.find((h) => /job.?title|title|role|position/i.test(h))
  return { email, name, company, jobTitle }
}

export default function MailLeadsClient({ isLoading: initialLoading = false }: { isLoading?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(initialLoading)
  const [search, setSearch] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [importSummary, setImportSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({ email: '' })
  const [preview, setPreview] = useState<CsvImportPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  const [suppressions, setSuppressions] = useState<SuppressionEntry[]>([])
  const [suppressionSearch, setSuppressionSearch] = useState('')
  const [suppressionEmail, setSuppressionEmail] = useState('')
  const [verifyStats, setVerifyStats] = useState<Awaited<ReturnType<typeof getLeadVerificationStatsAction>> | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [tab, setTab] = useState<'leads' | 'lists' | 'suppression'>('leads')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const pageSize = 25

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [data, suppressed, stats] = await Promise.all([
        getMailLeads(),
        listSuppressionsAction(),
        getLeadVerificationStatsAction(),
      ])
      setLeads(data)
      setSuppressions(suppressed)
      setVerifyStats(stats)
    } catch {
      setError('Failed to load leads')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!search) return leads
    const q = search.toLowerCase()
    return leads.filter(
      (l) =>
        l.email.includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.company.toLowerCase().includes(q)
    )
  }, [leads, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page])

  useEffect(() => {
    setPage(1)
  }, [search])

  async function handleExport() {
    const csv = await exportMailLeadsCsvAction()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredSuppressions = useMemo(() => {
    if (!suppressionSearch) return suppressions
    const q = suppressionSearch.toLowerCase()
    return suppressions.filter((s) => s.email.includes(q) || s.reason.toLowerCase().includes(q))
  }, [suppressions, suppressionSearch])

  async function handleAdd() {
    const result = await createMailLead({ email, name, source: 'manual' })
    if (!result) {
      setError('Could not add lead (duplicate, suppressed, or invalid)')
      return
    }
    setEmail('')
    setName('')
    await load()
  }

  async function handleDelete(id: string) {
    await deleteMailLead(id)
    await load()
  }

  async function handleCsv(file: File) {
    const text = await file.text()
    const parsed = parseCsv(text)
    if (!parsed.headers.length || !parsed.rows.length) {
      setError('CSV must include a header row and at least one data row')
      return
    }
    const guessed = guessMapping(parsed.headers)
    if (!guessed.email) {
      setError('CSV must include an email column')
      return
    }
    setCsvHeaders(parsed.headers)
    setCsvRows(parsed.rows)
    setMapping(guessed)
    setPreview(null)
    setImportSummary(null)
    setError(null)
  }

  async function handlePreviewImport() {
    if (!mapping.email || csvRows.length === 0) return
    setPreviewLoading(true)
    setError(null)
    const result = await previewMailLeadsImportAction(csvRows, mapping)
    setPreviewLoading(false)
    if (!result.success || !result.data) {
      setError(!result.success ? result.error : 'Preview failed')
      return
    }
    setPreview(result.data)
  }

  async function handleConfirmImport() {
    if (!mapping.email || csvRows.length === 0) return
    setImporting(true)
    setError(null)
    const result = await importMailLeadsAction(csvRows, mapping)
    setImporting(false)
    if (!result.success || !result.data) {
      setError(!result.success ? result.error : 'Import failed')
      return
    }
    const s = result.data
    setImportSummary(
      `Imported ${s.imported}: ${s.valid} valid, ${s.risky} risky, ${s.invalid} invalid, ${s.duplicates} duplicates, ${s.suppressed} suppressed`
    )
    setCsvHeaders([])
    setCsvRows([])
    setPreview(null)
    await load()
  }

  async function handleAddSuppression() {
    if (!suppressionEmail.trim()) return
    const result = await addSuppressionAction(suppressionEmail.trim())
    if (!result.success) {
      setError(result.error || 'Failed to add suppression')
      return
    }
    setSuppressionEmail('')
    await load()
  }

  async function handleRemoveSuppression(emailToRemove: string) {
    await removeSuppressionAction(emailToRemove)
    await load()
  }

  async function handleReverify(id: string) {
    setVerifyingId(id)
    const result = await reverifyMailLeadAction(id)
    setVerifyingId(null)
    if (!result.success) {
      setError(result.error || 'Verification failed')
      return
    }
    await load()
  }

  if (isLoading && leads.length === 0) {
    return (
      <div className="space-y-6">
        <MailPageHeader title="Leads" description="Manage leads for your mail campaigns" />
        <MailTableSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <MailPageHeader title="Leads" description="Import, verify, list, and suppress outreach leads" />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {importSummary && <p className="text-sm text-muted-foreground">{importSummary}</p>}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['leads', 'Leads', Users],
            ['lists', 'Lists', List],
            ['suppression', 'Suppression', ShieldBan],
          ] as const
        ).map(([key, label, Icon]) => (
          <Button key={key} size="sm" variant={tab === key ? 'default' : 'outline'} onClick={() => setTab(key)}>
            <Icon className="h-3.5 w-3.5 mr-1" />
            {label}
          </Button>
        ))}
      </div>

      {verifyStats && tab === 'leads' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            ['Total', verifyStats.total],
            ['Valid', verifyStats.valid],
            ['Risky', verifyStats.risky],
            ['Invalid', verifyStats.invalid],
            ['Unverified', verifyStats.unverified],
            ['Suppressed', verifyStats.suppressed],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'lists' && <LeadListsPanel availableLeadIds={leads.map((l) => l.id)} />}

      {tab === 'suppression' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldBan className="h-4 w-4" />
            Suppression list
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Search suppressed emails"
              value={suppressionSearch}
              onChange={(e) => setSuppressionSearch(e.target.value)}
            />
            <Input
              placeholder="Add email to suppress"
              value={suppressionEmail}
              onChange={(e) => setSuppressionEmail(e.target.value)}
            />
            <Button variant="outline" onClick={() => void handleAddSuppression()}>
              Suppress
            </Button>
          </div>
          {filteredSuppressions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No suppressed emails</p>
          ) : (
            <div className="divide-y rounded-md border max-h-48 overflow-y-auto">
              {filteredSuppressions.map((entry) => (
                <div key={entry.email} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{entry.reason} · {entry.source}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${entry.email} from suppression list`}
                    onClick={() => void handleRemoveSuppression(entry.email)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {tab === 'leads' && (
      <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add lead</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={() => void handleAdd()}>Add</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">CSV import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <Upload className="h-4 w-4" />
              <span>Upload CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleCsv(f)
                }}
              />
            </label>
            {csvRows.length > 0 && (
              <div className="space-y-3 pt-2 border-t">
                <p className="text-xs text-muted-foreground">{csvRows.length} rows detected — map columns</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ['email', 'Email *'],
                    ['name', 'Name'],
                    ['company', 'Company'],
                    ['jobTitle', 'Job title'],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs">{label}</Label>
                      <select
                        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        value={mapping[key] || ''}
                        onChange={(e) =>
                          setMapping((prev) => ({
                            ...prev,
                            [key]: e.target.value || undefined,
                          }))
                        }
                      >
                        <option value="">{key === 'email' ? 'Select column' : '— skip —'}</option>
                        {csvHeaders.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!mapping.email || previewLoading}
                    onClick={() => void handlePreviewImport()}
                  >
                    {previewLoading ? 'Analyzing…' : 'Preview import'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!mapping.email || !preview || importing}
                    onClick={() => void handleConfirmImport()}
                  >
                    {importing ? 'Importing…' : 'Confirm import'}
                  </Button>
                </div>
                {preview && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <Badge variant="outline">{preview.valid} valid</Badge>
                    <Badge variant="outline">{preview.risky} risky</Badge>
                    <Badge variant="outline">{preview.invalid} invalid</Badge>
                    <Badge variant="outline">{preview.duplicates} duplicates</Badge>
                    <Badge variant="outline">{preview.suppressed} suppressed</Badge>
                    <Badge variant="secondary">{preview.imported} ready to import</Badge>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleExport()}>
          Export CSV
        </Button>
        {selectedIds.size > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void bulkSuppressMailLeadsAction([...selectedIds]).then(() => {
                  setSelectedIds(new Set())
                  void load()
                })
              }
            >
              Suppress ({selectedIds.size})
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                void bulkDeleteMailLeadsAction([...selectedIds]).then(() => {
                  setSelectedIds(new Set())
                  void load()
                })
              }
            >
              Delete ({selectedIds.size})
            </Button>
          </>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-sm font-medium">No leads yet</p>
              <p className="text-xs mt-1">Import a CSV or add leads manually</p>
            </div>
          ) : (
            <>
            <div className="divide-y">
              {paged.map((lead) => (
                <div key={lead.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedIds.has(lead.id)}
                      aria-label={`Select ${lead.email}`}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(lead.id)
                          else next.delete(lead.id)
                          return next
                        })
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{lead.email}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[lead.name, lead.company, lead.jobTitle].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{lead.verifiedStatus || 'unverified'}</Badge>
                    <Badge variant="secondary">{lead.status}</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verifyingId === lead.id}
                      onClick={() => void handleReverify(lead.id)}
                    >
                      {verifyingId === lead.id ? '…' : 'Verify'}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void handleDelete(lead.id)} aria-label="Delete lead">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages} · {filtered.length} leads
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
            </>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  )
}
