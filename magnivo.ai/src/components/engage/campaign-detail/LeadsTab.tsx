'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setRecipientInterest } from '@/app/actions/engage'
import { INTEREST_STATUSES, type CampaignLeadRow, type InterestStatus } from '@/types/engage'
import { DELIVERY_BADGE, INTEREST_LABELS, deliveryLabel, skipReasonLabel } from './shared'

function InterestSelect({ row }: { row: CampaignLeadRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const onChange = (value: string) => {
    startTransition(async () => {
      try {
        await setRecipientInterest(row.recipientId, value as InterestStatus)
        router.refresh()
      } catch {
        // swallow — UI stays on previous value until refresh
      }
    })
  }

  return (
    <Select value={row.interestStatus} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-8 w-[160px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INTEREST_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {INTEREST_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function LeadsTab({ leads }: { leads: CampaignLeadRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return leads
    return leads.filter((l) =>
      [l.email, l.name, l.company].some((v) => (v ?? '').toLowerCase().includes(q)),
    )
  }, [leads, query])

  return (
    <Card className="rounded-2xl border bg-card">
      <CardContent className="space-y-3 pt-6">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search email, name or company"
            className="pl-8"
          />
        </div>

        {leads.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No leads in this campaign yet. Run the worker to enroll the audience.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">No leads match &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Job title</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row, i) => (
                  <TableRow key={row.recipientId}>
                    <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.email || '—'}</TableCell>
                    <TableCell>
                      {row.provider ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                          {row.provider}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                          DELIVERY_BADGE[row.deliveryStatus] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {deliveryLabel(row.deliveryStatus)}
                      </span>
                      {row.deliveryStatus === 'skipped' && row.skipReason ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {skipReasonLabel(row.skipReason)}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>{row.name || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{row.jobTitle || '—'}</TableCell>
                    <TableCell>{row.company || '—'}</TableCell>
                    <TableCell>
                      <InterestSelect row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
