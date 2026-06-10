'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DialerLead } from '@/components/dialer/types'
import LeadCard from '@/components/dialer/LeadCard'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

export default function LeadList({
  leads,
  selectedLeadId,
  onSelectLead,
  loading,
}: {
  leads: DialerLead[]
  selectedLeadId: string | null
  onSelectLead: (lead: DialerLead) => void
  loading: boolean
}) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return leads
    return leads.filter((l) =>
      `${l.name} ${l.company} ${l.phone} ${l.status}`.toLowerCase().includes(needle)
    )
  }, [leads, q])

  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Leads</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[70vh] overflow-y-auto">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search leads…"
            className="pl-9 rounded-xl"
            disabled={loading}
          />
        </div>
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-3">
                <div className="h-4 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No leads available.
          </div>
        )}

        {!loading && filtered.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            active={selectedLeadId === lead.id}
            onClick={() => onSelectLead(lead)}
          />
        ))}
      </CardContent>
    </Card>
  )
}

