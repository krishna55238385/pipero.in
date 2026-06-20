'use client'

import React, { useState } from 'react'
import { Share2, Inbox, Send, CheckCircle2, XCircle, Clock, Building, Phone, User, MapPin, CalendarDays, ChevronRight, Search, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { format } from 'date-fns'
import { toast } from 'sonner'
import Link from 'next/link'
import { updateForwardedLeadStatus } from '@/app/actions/crm'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { forwardLead } from '@/app/actions/crm'
import { formatPhoneUS } from '@/lib/formatters'

const TEMP_COLORS: Record<string, string> = {
    hot: 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400',
    warm: 'bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400',
    cold: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400',
}

const STATUS_DOT: Record<string, string> = {
    sent: 'bg-yellow-400',
    accepted: 'bg-green-500',
    rejected: 'bg-red-500',
}

const STATUS_LABEL: Record<string, string> = {
    sent: 'Pending',
    accepted: 'Accepted',
    rejected: 'Rejected',
}

function LeadMiniCard({ lead }: { lead: any }) {
    return (
        <Link href={`/leads/${lead.id}`} className="group">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-secondary/50 hover:bg-blue-50 dark:hover:bg-slate-800 border border-slate-100 dark:border-border transition-colors">
                <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {(lead.name || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 dark:text-foreground truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {lead.name}
                    </p>
                    <p className="text-xs text-slate-400 truncate">{lead.contact_person || formatPhoneUS(lead.phone_number)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {lead.temperature && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${TEMP_COLORS[lead.temperature] || 'bg-slate-100 text-slate-500'}`}>
                            {lead.temperature}
                        </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-400" />
                </div>
            </div>
        </Link>
    )
}

function ForwardCard({ fwd, type, onStatusChange }: { fwd: any; type: 'received' | 'sent'; onStatusChange: (id: string, status: 'accepted' | 'rejected') => void }) {
    const [loading, setLoading] = useState<string | null>(null)

    const handleStatus = async (status: 'accepted' | 'rejected') => {
        setLoading(status)
        const res = await updateForwardedLeadStatus(fwd.id, status)
        if (res?.error) toast.error(res.error)
        else { toast.success(status === 'accepted' ? '✅ Lead accepted!' : '❌ Lead rejected'); onStatusChange(fwd.id, status) }
        setLoading(null)
    }

    const otherUser = type === 'received' ? fwd.from_user : fwd.to_user
    const otherLabel = type === 'received' ? 'From' : 'To'

    return (
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card/30 overflow-hidden hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-border bg-slate-50/60 dark:bg-secondary/30">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[fwd.status] ?? 'bg-slate-300'}`} />
                    <span className="font-medium">{STATUS_LABEL[fwd.status] ?? fwd.status}</span>
                    <span className="text-slate-300">·</span>
                    <CalendarDays className="h-3 w-3" />
                    <span>{format(new Date(fwd.created_at), 'MMM d, yyyy · h:mm a')}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <User className="h-3 w-3" />
                    <span className="font-medium">{otherLabel}:</span>
                    <span className="text-slate-700 dark:text-muted-foreground font-semibold">
                        {otherUser?.full_name || 'Unknown'}
                    </span>
                </div>
            </div>

            {/* Lead Card */}
            <div className="p-4">
                {fwd.leads ? (
                    <LeadMiniCard lead={fwd.leads} />
                ) : (
                    <div className="text-xs text-slate-400 italic">Lead data unavailable (may have been deleted)</div>
                )}

                {/* Note */}
                {fwd.note && (
                    <div className="mt-3 p-2.5 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-100 dark:border-yellow-900/30 rounded-xl text-xs text-slate-600 dark:text-muted-foreground">
                        <span className="font-semibold text-yellow-700 dark:text-yellow-400">Note: </span>{fwd.note}
                    </div>
                )}

                {/* Actions for received + pending */}
                {type === 'received' && fwd.status === 'sent' && (
                    <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => handleStatus('accepted')} disabled={!!loading}
                            className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white h-8 text-xs">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {loading === 'accepted' ? 'Accepting...' : 'Accept'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleStatus('rejected')} disabled={!!loading}
                            className="flex-1 gap-1.5 border-red-200 text-red-500 hover:bg-red-50 h-8 text-xs dark:border-red-800 dark:hover:bg-red-950/30">
                            <XCircle className="h-3.5 w-3.5" />
                            {loading === 'rejected' ? 'Rejecting...' : 'Decline'}
                        </Button>
                    </div>
                )}

                {/* Sent+accepted  */}
                {type === 'sent' && fwd.status === 'accepted' && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Accepted by {otherUser?.full_name || 'recipient'}
                    </div>
                )}
                {type === 'sent' && fwd.status === 'rejected' && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 font-medium">
                        <XCircle className="h-3.5 w-3.5" /> Declined by {otherUser?.full_name || 'recipient'}
                    </div>
                )}
            </div>
        </div>
    )
}

// Quick-Forward dialog (standalone usage from this page)
function QuickForwardDialog({ leads, members }: { leads: any[]; members: any[] }) {
    const [open, setOpen] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [selectedLead, setSelectedLead] = useState('')
    const [selectedMember, setSelectedMember] = useState('')
    const [note, setNote] = useState('')

    const handleForward = async () => {
        if (!selectedLead || !selectedMember) { toast.error('Please select a lead and a team member'); return }
        setIsSubmitting(true)
        const res = await forwardLead(selectedLead, selectedMember, note || undefined)
        if (res?.error) toast.error(res.error)
        else { toast.success('Lead forwarded!'); setOpen(false); setSelectedLead(''); setSelectedMember(''); setNote('') }
        setIsSubmitting(false)
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-md">
                    <Share2 className="h-4 w-4" /> Forward a Lead
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader><DialogTitle>Forward a Lead</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                    <div className="space-y-1">
                        <Label>Select Lead</Label>
                        <Select value={selectedLead} onValueChange={setSelectedLead}>
                            <SelectTrigger><SelectValue placeholder="Choose a lead..." /></SelectTrigger>
                            <SelectContent>
                                {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Forward To</Label>
                        <Select value={selectedMember} onValueChange={setSelectedMember}>
                            <SelectTrigger><SelectValue placeholder="Select team member..." /></SelectTrigger>
                            <SelectContent>
                                {members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name || 'Unnamed'}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Note (optional)</Label>
                        <Textarea placeholder="Any context for the recipient..." className="resize-none" rows={3} value={note} onChange={e => setNote(e.target.value)} />
                    </div>
                    <Button onClick={handleForward} disabled={isSubmitting} className="w-full gap-2">
                        <ArrowRight className="h-4 w-4" />
                        {isSubmitting ? 'Forwarding...' : 'Forward Lead'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default function ForwardedLeadsClient({
    initialReceived,
    initialSent,
    leads,
    members,
}: {
    initialReceived: any[]
    initialSent: any[]
    leads: any[]
    members: any[]
}) {
    const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received')
    const [received, setReceived] = useState(initialReceived)
    const [sent, setSent] = useState(initialSent)
    const [search, setSearch] = useState('')

    const handleStatusChange = (id: string, status: 'accepted' | 'rejected') => {
        setReceived(prev => prev.map(f => f.id === id ? { ...f, status } : f))
    }

    const filterList = (list: any[]) => {
        if (!search) return list
        const q = search.toLowerCase()
        return list.filter(f =>
            f.leads?.name?.toLowerCase().includes(q) ||
            f.from_user?.full_name?.toLowerCase().includes(q) ||
            f.to_user?.full_name?.toLowerCase().includes(q)
        )
    }

    const displayList = activeTab === 'received' ? filterList(received) : filterList(sent)

    const receivedCounts = { pending: received.filter(f => f.status === 'sent').length, total: received.length }
    const sentCounts = { pending: sent.filter(f => f.status === 'sent').length, total: sent.length }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-gray-200 dark:border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground flex items-center gap-3">
                        <Share2 className="h-8 w-8 text-blue-500" /> Forwarded Leads
                    </h1>
                    <p className="text-slate-500 dark:text-muted-foreground mt-1 text-sm">
                        Leads shared with you and forwarded by you to team members.
                    </p>
                </div>
                <QuickForwardDialog leads={leads} members={members} />
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Received', value: received.length, sub: `${receivedCounts.pending} pending`, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/30' },
                    { label: 'Accepted', value: received.filter(f => f.status === 'accepted').length, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30 border-green-100 dark:border-green-900/30' },
                    { label: 'Sent by Me', value: sent.length, sub: `${sentCounts.pending} awaiting`, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30 border-purple-100 dark:border-purple-900/30' },
                    { label: 'Declined', value: received.filter(f => f.status === 'rejected').length, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30 border-red-100 dark:border-red-900/30' },
                ].map(s => (
                    <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
                        <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                        <div className="text-xs font-medium text-slate-600 dark:text-muted-foreground mt-0.5">{s.label}</div>
                        {s.sub && <div className="text-[10px] text-slate-400 mt-0.5">{s.sub}</div>}
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input placeholder="Search by lead name or team member..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200 dark:border-border pb-px">
                <button
                    onClick={() => setActiveTab('received')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'received' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    <Inbox className="h-4 w-4" />
                    Received
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'received' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500 dark:bg-secondary'}`}>
                        {received.length}
                    </span>
                    {receivedCounts.pending > 0 && (
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-semibold">{receivedCounts.pending} new</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('sent')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'sent' ? 'border-purple-600 text-purple-600 dark:border-purple-400 dark:text-purple-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    <Send className="h-4 w-4" />
                    Sent by Me
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'sent' ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-500 dark:bg-secondary'}`}>
                        {sent.length}
                    </span>
                </button>
            </div>

            {/* List */}
            {displayList.length === 0 ? (
                <div className="text-center py-20 border border-dashed border-slate-200 dark:border-border rounded-2xl">
                    <Share2 className="h-12 w-12 mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                    <p className="text-slate-500 font-medium text-sm">
                        {search
                            ? 'No results match your search.'
                            : activeTab === 'received'
                                ? 'No leads have been forwarded to you yet.'
                                : 'You haven\'t forwarded any leads yet.'}
                    </p>
                    {activeTab === 'sent' && !search && (
                        <p className="text-xs text-slate-400 mt-1">
                            Use the "Forward a Lead" button above or forward from the Leads page.
                        </p>
                    )}
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    {displayList.map(fwd => (
                        <ForwardCard key={fwd.id} fwd={fwd} type={activeTab} onStatusChange={handleStatusChange} />
                    ))}
                </div>
            )}
        </div>
    )
}

