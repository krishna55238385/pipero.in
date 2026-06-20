'use client'

import { useState, useTransition } from 'react'
import { Copy, ArrowRight, X, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { dismissLeadDuplicate } from '@/app/actions/lead-management'

type LeadRef = {
    id: string
    name: string | null
    email: string | null
    phone_number: string | null
    contact_person: string | null
} | null

type DuplicateRow = {
    id: string
    similarity_score: number | null
    status: string
    created_at: string
    original_lead: LeadRef | LeadRef[]
    duplicate_lead: LeadRef | LeadRef[]
}

function pickLead(value: LeadRef | LeadRef[]): LeadRef {
    return Array.isArray(value) ? (value[0] ?? null) : value
}

function LeadCell({ lead, label }: { lead: LeadRef; label: string }) {
    return (
        <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="truncate font-medium">{lead?.name || lead?.contact_person || '—'}</div>
            <div className="truncate text-xs text-muted-foreground">
                {lead?.email || lead?.phone_number || 'No contact info'}
            </div>
        </div>
    )
}

export default function DuplicatesPanel({ initialDuplicates = [] }: { initialDuplicates?: DuplicateRow[] }) {
    const [rows, setRows] = useState<DuplicateRow[]>(initialDuplicates)
    const [pendingId, setPendingId] = useState<string | null>(null)
    const [, startTransition] = useTransition()

    const handleDismiss = (id: string) => {
        setPendingId(id)
        startTransition(async () => {
            const res = await dismissLeadDuplicate(id)
            setPendingId(null)
            if (res?.error) {
                toast.error(res.error)
                return
            }
            setRows((prev) => prev.filter((r) => r.id !== id))
            toast.success('Duplicate dismissed')
        })
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Copy className="h-4 w-4" />
                    Duplicate Leads
                    {rows.length > 0 && (
                        <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
                    )}
                </CardTitle>
                <CardDescription>
                    Potential duplicate leads detected by lead hygiene rules. Dismiss to keep them as separate records.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {rows.length === 0 ? (
                    <div className="py-12 text-center">
                        <p className="text-sm font-medium text-muted-foreground">No duplicate leads detected</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Matches surface here automatically when hygiene rules flag overlapping leads.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {rows.map((row) => {
                            const original = pickLead(row.original_lead)
                            const duplicate = pickLead(row.duplicate_lead)
                            const score = row.similarity_score != null ? Math.round(Number(row.similarity_score)) : null
                            const isPending = pendingId === row.id
                            return (
                                <div
                                    key={row.id}
                                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
                                >
                                    <div className="flex flex-1 items-center gap-3">
                                        <LeadCell lead={original} label="Original" />
                                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <LeadCell lead={duplicate} label="Possible duplicate" />
                                    </div>
                                    <div className="flex items-center justify-end gap-2">
                                        {score != null && (
                                            <Badge variant="outline" className="whitespace-nowrap">
                                                {score}% match
                                            </Badge>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDismiss(row.id)}
                                            disabled={isPending}
                                        >
                                            {isPending ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <X className="h-4 w-4" />
                                            )}
                                            <span className="ml-1">Dismiss</span>
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
