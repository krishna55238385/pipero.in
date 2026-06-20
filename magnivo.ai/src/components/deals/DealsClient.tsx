'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Plus, GripVertical, Trash2, Pencil, CheckCircle, XCircle, MessageSquare, Search, X, ChevronDown, User, Calendar, Target, Filter, Sparkles, MapPin } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { addDeal, updateDeal, deleteDeal, updateDealStage, getOrgMembers } from '@/app/actions/crm'
import { toast } from 'sonner'
import { useSupabaseRealtime } from '@/hooks/useSupabaseRealtime'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { useRouter, usePathname } from 'next/navigation'
import { format, differenceInDays, parseISO, isValid } from 'date-fns'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { formatCurrency } from '@/lib/formatters'

// ── Stage config with probability defaults ─────────────────────────────────
const defaultColumns = [
    { id: 'lead', title: 'Lead In', color: 'bg-slate-400', prob: 10, lightBg: 'bg-slate-50 dark:bg-card/40', border: 'border-slate-200 dark:border-border' },
    { id: 'contacted', title: 'Contacted', color: 'bg-blue-400', prob: 25, lightBg: 'bg-blue-50/40 dark:bg-blue-950/20', border: 'border-blue-100 dark:border-blue-900/30' },
    { id: 'qualified', title: 'Qualified', color: 'bg-indigo-500', prob: 50, lightBg: 'bg-indigo-50/40 dark:bg-indigo-950/20', border: 'border-indigo-100 dark:border-indigo-900/30' },
    { id: 'proposal', title: 'Proposal Sent', color: 'bg-purple-400', prob: 65, lightBg: 'bg-purple-50/40 dark:bg-purple-950/20', border: 'border-purple-100 dark:border-purple-900/30' },
    { id: 'won', title: '🏆 Won', color: 'bg-emerald-500', prob: 100, lightBg: 'bg-emerald-50/40 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900/30' },
    { id: 'lost', title: '❌ Lost', color: 'bg-red-400', prob: 0, lightBg: 'bg-red-50/40 dark:bg-red-950/20', border: 'border-red-100 dark:border-red-900/30' },
]

function getStageColor(label: string) {
    const l = label.toLowerCase()
    if (l.includes('won')) return { color: 'bg-emerald-500', lightBg: 'bg-emerald-50/40 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900/30' }
    if (l.includes('lost')) return { color: 'bg-red-400', lightBg: 'bg-red-50/40 dark:bg-red-950/20', border: 'border-red-100 dark:border-red-900/30' }
    if (l.includes('contacted')) return { color: 'bg-blue-400', lightBg: 'bg-blue-50/40 dark:bg-blue-950/20', border: 'border-blue-100 dark:border-blue-900/30' }
    if (l.includes('qualified')) return { color: 'bg-indigo-500', lightBg: 'bg-indigo-50/40 dark:bg-indigo-950/20', border: 'border-indigo-100 dark:border-indigo-900/30' }
    if (l.includes('proposal')) return { color: 'bg-purple-400', lightBg: 'bg-purple-50/40 dark:bg-purple-950/20', border: 'border-purple-100 dark:border-purple-900/30' }
    return { color: 'bg-slate-400', lightBg: 'bg-slate-50 dark:bg-card/40', border: 'border-slate-200 dark:border-border' }
}

// ── Confetti component ────────────────────────────────────────────────────
function Confetti({ active }: { active: boolean }) {
    if (!active) return null
    const pieces = Array.from({ length: 60 }, (_, i) => i)
    const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316']
    return (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
            {pieces.map(i => (
                <div
                    key={i}
                    className="absolute animate-bounce"
                    style={{
                        left: `${Math.random() * 100}%`,
                        top: `${-10 + Math.random() * 30}%`,
                        width: `${6 + Math.random() * 8}px`,
                        height: `${6 + Math.random() * 8}px`,
                        background: colors[Math.floor(Math.random() * colors.length)],
                        borderRadius: Math.random() > 0.5 ? '50%' : '0',
                        transform: `rotate(${Math.random() * 360}deg)`,
                        animation: `fall ${1.5 + Math.random() * 2}s ease-out ${Math.random() * 0.5}s forwards`,
                    }}
                />
            ))}
            <style>{`
                @keyframes fall {
                    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
                }
            `}</style>
        </div>
    )
}

// ── Deal Detail Slide-Over ─────────────────────────────────────────────────
function DealSlideOver({ deal, members, onClose, onUpdate, onDelete, canEdit, canDelete, columns }: {
    deal: any; members: any[]; onClose: () => void
    onUpdate: (id: string, fields: any) => void
    onDelete: (id: string) => void
    canEdit: boolean
    canDelete: boolean
    columns: any[]
}) {
    const { currency } = useWorkspace()
    const [editing, setEditing] = useState(false)
    const [form, setForm] = useState({
        title: deal.title || '',
        value: deal.value?.toString() || '',
        probability: deal.probability?.toString() || '',
        close_date: deal.close_date || '',
        notes: deal.notes || '',
        assigned_to: deal.assigned_to || '',
    })
    const [saving, setSaving] = useState(false)

    const col = columns.find(c => c.id === deal.status)
    const daysOpen = differenceInDays(new Date(), new Date(deal.created_at))

    const handleSave = async () => {
        setSaving(true)
        const res = await updateDeal(deal.id, {
            title: form.title,
            value: parseFloat(form.value) || 0,
            probability: parseInt(form.probability) || 0,
            close_date: form.close_date || undefined,
            notes: form.notes || undefined,
            assigned_to: form.assigned_to || null,
        })
        if (res?.error) toast.error(res.error)
        else {
            toast.success('Deal updated!')
            onUpdate(deal.id, { ...form, value: parseFloat(form.value), probability: parseInt(form.probability) })
            setEditing(false)
        }
        setSaving(false)
    }

    return (
        <div className="fixed inset-0 z-40 flex" onClick={onClose}>
            <div className="flex-1 bg-black/30 backdrop-blur-sm" />
            <div
                className="w-full max-w-md bg-white dark:bg-card shadow-2xl overflow-y-auto border-l border-slate-200 dark:border-border animate-in slide-in-from-right duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`p-5 border-b dark:border-border ${deal.status === 'won' ? 'bg-emerald-50 dark:bg-emerald-950/30' : deal.status === 'lost' ? 'bg-red-50 dark:bg-red-950/30' : 'bg-slate-50 dark:bg-secondary/50'}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            {editing ? (
                                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                                    className="text-lg font-bold h-8 mb-1" />
                            ) : (
                                <h2 className="text-lg font-bold text-slate-900 dark:text-foreground truncate">{deal.title}</h2>
                            )}
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <Badge variant="secondary" className={`text-xs ${col?.color} text-white border-0`}>
                                    {col?.id === 'won' && '🏆 '}
                                    {col?.id === 'lost' && '❌ '}
                                    {col?.title}
                                </Badge>
                                <span className="text-xs text-slate-500">{daysOpen}d old · {deal.leads?.name}</span>
                            </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                            {editing ? (
                                <>
                                    <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
                                        {saving ? 'Saving...' : 'Save'}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 text-xs">Cancel</Button>
                                </>
                            ) : (
                                canEdit && (
                                    <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="h-7 text-xs gap-1">
                                        <Pencil className="h-3 w-3" /> Edit
                                    </Button>
                                )
                            )}
                            <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 text-slate-400">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="p-5 space-y-5">
                    {/* Value + Probability */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Deal Value</label>
                            {editing ? (
                                <Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} className="h-8 text-sm" />
                            ) : (
                                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(deal.value, currency)}</div>
                            )}
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Win Probability</label>
                            {editing ? (
                                <Input type="number" min="0" max="100" value={form.probability} onChange={e => setForm(f => ({ ...f, probability: e.target.value }))} className="h-8 text-sm" />
                            ) : (
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-2 bg-slate-100 dark:bg-secondary rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-blue-400 to-emerald-500 transition-all" style={{ width: `${deal.probability ?? col?.prob ?? 50}%` }} />
                                    </div>
                                    <span className="text-sm font-bold text-slate-700 dark:text-muted-foreground">{deal.probability ?? col?.prob ?? 50}%</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Close Date */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                            <Calendar className="h-3 w-3" /> Expected Close Date
                        </label>
                        {editing ? (
                            <Input type="date" value={form.close_date} onChange={e => setForm(f => ({ ...f, close_date: e.target.value }))} className="h-8 text-sm" />
                        ) : (
                            <div className="text-sm text-slate-700 dark:text-muted-foreground">
                                {deal.close_date ? format(parseISO(deal.close_date), 'MMM d, yyyy') : <span className="text-slate-400 italic">Not set</span>}
                            </div>
                        )}
                    </div>

                    {/* Assigned To */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                            <User className="h-3 w-3" /> Assigned To
                        </label>
                        {editing ? (
                            <Select value={form.assigned_to} onValueChange={v => setForm(f => ({ ...f, assigned_to: v }))}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="">Unassigned</SelectItem>
                                    {members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="flex items-center gap-2">
                                {deal.assigned_user ? (
                                    <>
                                        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold">
                                            {deal.assigned_user.full_name?.[0]?.toUpperCase()}
                                        </div>
                                        <span className="text-sm text-slate-700 dark:text-muted-foreground">{deal.assigned_user.full_name}</span>
                                    </>
                                ) : (
                                    <span className="text-sm text-slate-400 italic">Unassigned</span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Notes */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" /> Notes
                        </label>
                        {editing ? (
                            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="Add notes about this deal..." rows={4} className="text-sm resize-none" />
                        ) : (
                            <div className="text-sm text-slate-700 dark:text-muted-foreground whitespace-pre-wrap bg-slate-50 dark:bg-secondary/50 rounded-xl p-3 min-h-[60px]">
                                {deal.notes || <span className="text-slate-400 italic">No notes yet</span>}
                            </div>
                        )}
                    </div>

                    {/* Last activity */}
                    {deal.last_activity_at && (
                        <div className="text-xs text-slate-400 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Last updated: {format(new Date(deal.last_activity_at), 'MMM d, yyyy')}
                        </div>
                    )}

                    {/* Delete */}
                    <div className="pt-4 border-t dark:border-border">
                        <Button
                            variant="outline"
                            className="w-full border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30 gap-2"
                            onClick={() => {
                                if (confirm(`Delete "${deal.title}"?`)) {
                                    onDelete(deal.id)
                                    onClose()
                                }
                            }}
                        >
                            <Trash2 className="h-4 w-4" /> Delete Deal
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Quick Add in column ───────────────────────────────────────────────────
function QuickAdd({ columnId, leads, onAdd }: { columnId: string; leads: any[]; onAdd: (deal: any) => void }) {
    const { currency } = useWorkspace()
    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [value, setValue] = useState('')
    const [leadId, setLeadId] = useState(leads[0]?.id || '')
    const [saving, setSaving] = useState(false)

    const handleAdd = async () => {
        if (!title.trim()) { toast.error('Title required'); return }
        setSaving(true)
        const fd = new FormData()
        fd.set('title', title)
        fd.set('value', value || '0')
        fd.set('lead', leadId)
        fd.set('stage', columnId)
        const res = await addDeal(fd)
        if (res?.error) toast.error(res.error)
        else { toast.success('Deal added!'); setTitle(''); setValue(''); setOpen(false) }
        setSaving(false)
    }

    if (!open) return (
        <button onClick={() => setOpen(true)}
            className="w-full mt-2 p-2 text-xs text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20 rounded-xl border border-dashed border-slate-200 dark:border-border transition-colors flex items-center justify-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Add deal
        </button>
    )

    return (
        <div className="mt-2 p-3 bg-white dark:bg-secondary rounded-xl border border-blue-200 dark:border-blue-800 shadow-md space-y-2">
            <Input placeholder="Deal title" value={title} onChange={e => setTitle(e.target.value)}
                className="h-7 text-xs" autoFocus onKeyDown={e => e.key === 'Escape' && setOpen(false)} />
            <Input placeholder="Value" type="number" value={value} onChange={e => setValue(e.target.value)} className="h-7 text-xs" />
            <select value={leadId} onChange={e => setLeadId(e.target.value)}
                className="w-full h-7 text-xs border border-gray-200 dark:border-border rounded-lg bg-white dark:bg-secondary px-2 focus:outline-none">
                {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div className="flex gap-1">
                <Button size="sm" onClick={handleAdd} disabled={saving} className="flex-1 h-6 text-xs">{saving ? '...' : 'Add'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-6 text-xs px-2"><X className="h-3 w-3" /></Button>
            </div>
        </div>
    )
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function DealsClient({
    initialDeals,
    leads = [],
    searchParams,
    pipelineStages = []
}: {
    initialDeals: any[],
    leads?: any[],
    searchParams?: any,
    pipelineStages?: any[]
}) {
    const { currency, permissions, userRole } = useWorkspace()
    useSupabaseRealtime('deals')
    const [deals, setDeals] = useState(initialDeals)

    // Dynamic columns memo
    const columns = useMemo(() => {
        if (!pipelineStages || pipelineStages.length === 0) return defaultColumns
        return pipelineStages.map(s => ({
            id: s.label.toLowerCase(),
            title: s.label,
            prob: s.probability,
            ...getStageColor(s.label)
        }))
    }, [pipelineStages])

    const isCoreAdmin = userRole === 'admin' || userRole === 'Admin' || userRole === 'Super Admin'
    const canCreate = isCoreAdmin || permissions?.deals?.create !== false
    const canEdit = isCoreAdmin || permissions?.deals?.edit !== false
    const canDelete = isCoreAdmin || permissions?.deals?.delete !== false
    const canManageStages = isCoreAdmin || permissions?.deals?.manage_stages !== false
    const [members, setMembers] = useState<any[]>([])
    const [selectedDeal, setSelectedDeal] = useState<any>(null)
    const [confetti, setConfetti] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState(searchParams?.q || '')
    const [filterLead, setFilterLead] = useState('')
    const [showFilters, setShowFilters] = useState(false)
    const [isMounted, setIsMounted] = useState(false)

    const router = useRouter()
    const pathname = usePathname()

    useEffect(() => { setIsMounted(true) }, [])
    useEffect(() => { setDeals(initialDeals) }, [initialDeals])

    useEffect(() => {
        getOrgMembers().then(setMembers)
    }, [])

    // ── Filters ─────────────────────────────────────────────────────────
    const filteredDeals = deals.filter(d => {
        if (searchQuery && !d.title?.toLowerCase().includes(searchQuery.toLowerCase()) &&
            !d.leads?.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false
        if (filterLead && d.lead_id !== filterLead) return false
        return true
    })

    // ── Stats ─────────────────────────────────────────────────────────
    const totalPipeline = filteredDeals.filter(d => !['won', 'lost'].includes(d.status)).reduce((s, d) => s + (Number(d.value) || 0), 0)
    const totalWon = filteredDeals.filter(d => d.status === 'won').reduce((s, d) => s + (Number(d.value) || 0), 0)
    const weightedPipeline = filteredDeals.reduce((s, d) => {
        const col = columns.find(c => c.id === d.status)
        const prob = d.probability ?? col?.prob ?? 50
        return s + (Number(d.value) || 0) * (prob / 100)
    }, 0)

    // ── Drag & Drop ───────────────────────────────────────────────────
    async function onDragEnd(result: DropResult) {
        if (!canManageStages) return
        const { destination, source, draggableId } = result
        if (!destination) return
        if (destination.droppableId === source.droppableId && destination.index === source.index) return

        const newDeals = Array.from(deals)
        const movedIndex = newDeals.findIndex(d => d.id === draggableId)
        if (movedIndex === -1) return
        const [moved] = newDeals.splice(movedIndex, 1)
        const newStage = destination.droppableId
        moved.status = newStage
        if (newStage === 'won') { moved.probability = 100; setConfetti(true); setTimeout(() => setConfetti(false), 3000) }
        if (newStage === 'lost') moved.probability = 0
        newDeals.splice(destination.index, 0, moved)
        setDeals(newDeals)

        toast.loading('Moving deal...', { id: 'move' })
        const res = await updateDealStage(draggableId, newStage)
        if (res.success) toast.success('Deal moved!', { id: 'move' })
        else { toast.error(res.error || 'Failed', { id: 'move' }); setDeals(initialDeals) }
    }

    const handleUpdate = (id: string, fields: any) => {
        setDeals(prev => prev.map(d => d.id === id ? { ...d, ...fields } : d))
        if (selectedDeal?.id === id) setSelectedDeal((p: any) => ({ ...p, ...fields }))
    }

    const handleDelete = async (id: string) => {
        const res = await deleteDeal(id)
        if (res?.error) toast.error(res.error)
        else { toast.success('Deal deleted'); setDeals(prev => prev.filter(d => d.id !== id)) }
    }

    async function handleAction(formData: FormData) {
        toast.loading('Saving deal...', { id: 'save-deal' })
        const res = await addDeal(formData)
        if (res.success) { toast.success('Deal created!', { id: 'save-deal' }); setIsOpen(false) }
        else toast.error(res.error || 'Failed', { id: 'save-deal' })
    }

    return (
        <div className="space-y-4 h-[calc(100vh-6rem)] max-w-full">
            <Confetti active={confetti} />

            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground">Deals Pipeline</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Drag deals between stages · click a card to view details</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <Input placeholder="Search deals..." value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 w-52 bg-white dark:bg-secondary/50 rounded-xl text-sm" />
                    </div>
                    <Button variant={showFilters ? 'secondary' : 'outline'} size="sm" onClick={() => setShowFilters(v => !v)} className="gap-1.5 h-9 rounded-xl">
                        <Filter className="h-4 w-4" /> Filter
                    </Button>
                    {canCreate && (
                        <Dialog open={isOpen} onOpenChange={setIsOpen}>
                            <DialogTrigger asChild>
                                <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 rounded-xl h-9 gap-1.5">
                                    <Plus className="h-4 w-4" /> Create Deal
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px] bg-white dark:bg-card border-gray-200 dark:border-border rounded-2xl">
                                <DialogHeader>
                                    <DialogTitle>Create New Deal</DialogTitle>
                                    <DialogDescription>Add a new opportunity to the pipeline.</DialogDescription>
                                </DialogHeader>
                                <form action={handleAction}>
                                    <div className="grid gap-4 py-4">
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="title" className="text-right">Title</Label>
                                            <Input id="title" name="title" placeholder="Enterprise ERP" className="col-span-3 rounded-xl" required />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right">Lead</Label>
                                            <Select name="lead" required>
                                                <SelectTrigger className="col-span-3 rounded-xl"><SelectValue placeholder="Select Lead" /></SelectTrigger>
                                                <SelectContent className="z-[100]" position="popper" sideOffset={4}>
                                                    {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="value" className="text-right">Value</Label>
                                            <Input id="value" name="value" type="number" placeholder="10000" className="col-span-3 rounded-xl" required />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right">Stage</Label>
                                            <Select name="stage" defaultValue="lead">
                                                <SelectTrigger className="col-span-3 rounded-xl"><SelectValue /></SelectTrigger>
                                                <SelectContent className="z-[100]" position="popper" sideOffset={4}>
                                                    {columns.map(c => (
                                                        <SelectItem key={c.id} value={c.id}>
                                                            {c.id === 'won' ? '🏆 ' : c.id === 'lost' ? '❌ ' : ''}
                                                            {c.title}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="close_date" className="text-right">Close Date</Label>
                                            <Input id="close_date" name="close_date" type="date" className="col-span-3 rounded-xl" />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl w-full">Save Deal</Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            </div>

            {/* ── Filters Bar ───────────────────────────────────────── */}
            {showFilters && (
                <div className="flex items-center gap-3 p-3 bg-white dark:bg-secondary/50 border border-gray-200 dark:border-border rounded-2xl">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Filter by Lead</span>
                    <select value={filterLead} onChange={e => setFilterLead(e.target.value)}
                        className="text-sm bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-border rounded-xl px-3 py-1.5 focus:outline-none text-slate-700 dark:text-muted-foreground">
                        <option value="">All Leads</option>
                        {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    {filterLead && (
                        <Button size="sm" variant="ghost" onClick={() => setFilterLead('')} className="h-7 gap-1 text-xs text-slate-500">
                            <X className="h-3 w-3" /> Clear
                        </Button>
                    )}
                </div>
            )}

            {/* ── Pipeline Summary Bar ──────────────────────────────── */}
            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: 'Active Pipeline', value: formatCurrency(totalPipeline, currency), sub: `${filteredDeals.filter(d => !['won', 'lost'].includes(d.status)).length} deals`, color: 'text-blue-600 dark:text-blue-400' },
                    { label: 'Weighted Pipeline', value: formatCurrency(Math.round(weightedPipeline), currency), sub: 'probability-adjusted', color: 'text-purple-600 dark:text-purple-400' },
                    { label: 'Total Won', value: formatCurrency(totalWon, currency), sub: `${filteredDeals.filter(d => d.status === 'won').length} deals closed`, color: 'text-emerald-600 dark:text-emerald-400', emoji: '🏆' },
                ].map(s => (
                    <div key={s.label} className="bg-white dark:bg-card/50 border border-slate-200 dark:border-border rounded-2xl p-4">
                        <div className={`text-xl font-bold ${s.color}`}>{s.emoji && `${s.emoji} `}{s.value}</div>
                        <div className="text-xs font-semibold text-slate-500 mt-0.5">{s.label}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{s.sub}</div>
                    </div>
                ))}
            </div>

            {/* ── Kanban Board ──────────────────────────────────────── */}
            <div className="flex gap-3 overflow-x-auto overflow-y-hidden pb-4 h-[calc(100%-16rem)] min-h-[400px]">
                {isMounted && (
                    <DragDropContext onDragEnd={onDragEnd}>
                        {columns.map(column => {
                            const colDeals = filteredDeals.filter(d => d.status === column.id)
                            const colTotal = colDeals.reduce((s, d) => s + (Number(d.value) || 0), 0)
                            const isWon = column.id === 'won'
                            const isLost = column.id === 'lost'

                            return (
                                <div key={column.id}
                                    className={`min-w-[290px] w-[290px] flex flex-col shrink-0 rounded-3xl border ${column.border} ${column.lightBg} ${isWon ? 'ring-1 ring-emerald-300 dark:ring-emerald-700' : isLost ? 'ring-1 ring-red-200 dark:ring-red-800' : ''}`}>
                                    {/* Column Header */}
                                    <div className="p-3 border-b border-inherit flex flex-col gap-1 rounded-t-3xl">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className={`h-2.5 w-2.5 rounded-full ${column.color}`} />
                                                <h3 className="font-bold text-xs text-slate-700 dark:text-muted-foreground uppercase tracking-widest">
                                                    {column.id === 'won' ? '🏆 ' : column.id === 'lost' ? '❌ ' : ''}
                                                    {column.title}
                                                </h3>
                                            </div>
                                            <Badge variant="secondary" className="text-xs font-bold h-5 bg-white dark:bg-secondary border border-current/20 shadow-sm">
                                                {colDeals.length}
                                            </Badge>
                                        </div>
                                        {/* Column totals */}
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-semibold text-slate-600 dark:text-muted-foreground">{formatCurrency(colTotal, currency)}</span>
                                            <span className="text-slate-400">{column.prob}% prob</span>
                                        </div>
                                    </div>

                                    {/* Cards */}
                                    <Droppable droppableId={column.id}>
                                        {(provided, snapshot) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                                className={`p-2 flex-1 overflow-y-auto space-y-2 min-h-[80px] rounded-b-3xl transition-colors ${snapshot.isDraggingOver ? 'bg-blue-100/40 dark:bg-blue-900/20' : ''}`}
                                            >
                                                {colDeals.map((deal, index) => {
                                                    const daysOpen = differenceInDays(new Date(), new Date(deal.created_at))
                                                    const isOverdue = deal.close_date && new Date(deal.close_date) < new Date() && !['won', 'lost'].includes(deal.status)
                                                    return (
                                                        <Draggable key={deal.id} draggableId={deal.id} index={index} isDragDisabled={!canManageStages}>
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    style={{ ...provided.draggableProps.style, opacity: snapshot.isDragging ? 0.92 : 1 }}
                                                                >
                                                                    <Card
                                                                        onClick={() => setSelectedDeal(deal)}
                                                                        className={`
                                                                        cursor-pointer transition-all rounded-2xl border-0 shadow-sm group
                                                                        ${snapshot.isDragging ? 'shadow-xl scale-[1.03] rotate-1' : 'hover:shadow-md hover:-translate-y-0.5'}
                                                                        ${isWon ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-800' : ''}
                                                                        ${isLost ? 'bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200 dark:ring-red-800 opacity-70' : ''}
                                                                        ${!isWon && !isLost ? 'bg-white dark:bg-secondary/80' : ''}
                                                                        ${isOverdue ? 'ring-1 ring-orange-300 dark:ring-orange-700' : ''}
                                                                    `}
                                                                    >
                                                                        <CardContent className="p-3 space-y-2">
                                                                            {/* Title row */}
                                                                            <div className="flex items-start justify-between gap-2">
                                                                                <div className="min-w-0 flex-1">
                                                                                    <p className="font-bold text-sm text-slate-900 dark:text-foreground truncate leading-tight">
                                                                                        {isWon && '🏆 '}{isLost && '❌ '}{deal.title}
                                                                                    </p>
                                                                                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{deal.leads?.name}</p>
                                                                                </div>
                                                                                <div {...provided.dragHandleProps} onClick={e => e.stopPropagation()}
                                                                                    className="text-slate-300 hover:text-slate-500 transition-colors shrink-0 mt-0.5 cursor-grab">
                                                                                    <GripVertical className="h-3.5 w-3.5" />
                                                                                </div>
                                                                            </div>

                                                                            {/* Value + probability */}
                                                                            <div className="flex items-center justify-between">
                                                                                <span className={`text-sm font-bold ${isWon ? 'text-emerald-600' : isLost ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                                                    {formatCurrency(deal.value, currency)}
                                                                                </span>
                                                                                <div className="flex items-center gap-1">
                                                                                    <div className="w-12 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                                                        <div className="h-full bg-gradient-to-r from-blue-400 to-emerald-500" style={{ width: `${deal.probability ?? column.prob}%` }} />
                                                                                    </div>
                                                                                    <span className="text-[10px] text-slate-400 font-medium">{deal.probability ?? column.prob}%</span>
                                                                                </div>
                                                                            </div>

                                                                            {/* Footer: days open + assignee + close date + location + creation_time */}
                                                                            <div className="flex items-center justify-between text-[10px] text-slate-400 gap-1 mt-2 border-t dark:border-border pt-1.5">
                                                                                <div className="flex flex-col gap-0.5 min-w-0">
                                                                                    <span className={`${daysOpen > 30 ? 'text-orange-500 font-semibold' : ''}`}>{daysOpen}d open</span>
                                                                                    <span className="text-[9px] uppercase tracking-wider truncate" title={`Created: ${format(new Date(deal.leads?.created_at || deal.created_at), 'MMM d, h:mm a')}`}>
                                                                                        {format(new Date(deal.leads?.created_at || deal.created_at), 'MMM d, h:mm a')}
                                                                                    </span>
                                                                                </div>

                                                                                <div className="flex items-center gap-1 flex-wrap justify-end">
                                                                                    {deal.leads?.location && (
                                                                                        <Badge variant="outline" className="text-[9px] h-4 py-0 px-1 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-card">
                                                                                            <MapPin className="w-2.5 h-2.5 mr-0.5 text-slate-400" />
                                                                                            {deal.leads.location.toUpperCase()}
                                                                                        </Badge>
                                                                                    )}
                                                                                    {deal.close_date && (
                                                                                        <span className={`text-[9px] ${isOverdue ? 'text-orange-500 font-semibold' : ''}`}>
                                                                                            {format(parseISO(deal.close_date), 'MMM d')}
                                                                                        </span>
                                                                                    )}
                                                                                    {deal.assigned_user && (
                                                                                        <div className="flex items-center gap-1 bg-white dark:bg-secondary rounded-full pr-1.5 shadow-sm border border-slate-200 dark:border-border">
                                                                                            <div className="h-4 w-4 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[8px] font-bold"
                                                                                                title={deal.assigned_user.full_name}>
                                                                                                {deal.assigned_user.full_name?.[0]?.toUpperCase()}
                                                                                            </div>
                                                                                            <span className="text-[9px] font-bold text-slate-700 dark:text-muted-foreground">{deal.assigned_user.full_name.split(' ')[0]}</span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </div>

                                                                            {/* Notes preview */}
                                                                            {deal.notes && (
                                                                                <p className="text-[10px] text-slate-400 italic line-clamp-1 border-t dark:border-border pt-1.5">
                                                                                    💬 {deal.notes}
                                                                                </p>
                                                                            )}

                                                                            {/* Quick action buttons */}
                                                                            <div className="hidden group-hover:flex items-center gap-1 border-t dark:border-border pt-1.5" onClick={e => e.stopPropagation()}>
                                                                                {deal.status !== 'won' && (
                                                                                    <button
                                                                                        onClick={async () => {
                                                                                            const res = await updateDealStage(deal.id, 'won')
                                                                                            if (res.success) { handleUpdate(deal.id, { status: 'won', probability: 100 }); setConfetti(true); setTimeout(() => setConfetti(false), 3000) }
                                                                                            else toast.error(res.error || 'Failed')
                                                                                        }}
                                                                                        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 font-semibold transition-colors"
                                                                                        title="Mark as Won"
                                                                                    >
                                                                                        <CheckCircle className="h-3 w-3" /> Won
                                                                                    </button>
                                                                                )}
                                                                                {deal.status !== 'lost' && (
                                                                                    <button
                                                                                        onClick={async () => {
                                                                                            const res = await updateDealStage(deal.id, 'lost')
                                                                                            if (res.success) handleUpdate(deal.id, { status: 'lost', probability: 0 })
                                                                                            else toast.error(res.error || 'Failed')
                                                                                        }}
                                                                                        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 font-semibold transition-colors"
                                                                                        title="Mark as Lost"
                                                                                    >
                                                                                        <XCircle className="h-3 w-3" /> Lost
                                                                                    </button>
                                                                                )}
                                                                                <button
                                                                                    onClick={() => setSelectedDeal(deal)}
                                                                                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 font-semibold transition-colors ml-auto"
                                                                                >
                                                                                    <Pencil className="h-2.5 w-2.5" /> Edit
                                                                                </button>
                                                                                <button
                                                                                    onClick={async () => {
                                                                                        if (confirm(`Delete "${deal.title}"?`)) handleDelete(deal.id)
                                                                                    }}
                                                                                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-950/40 font-semibold transition-colors"
                                                                                >
                                                                                    <Trash2 className="h-2.5 w-2.5" />
                                                                                </button>
                                                                            </div>
                                                                        </CardContent>
                                                                    </Card>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    )
                                                })}
                                                {provided.placeholder}

                                                {/* Per-column quick add */}
                                                {!['won', 'lost'].includes(column.id) && (
                                                    <QuickAdd columnId={column.id} leads={leads} onAdd={() => { }} />
                                                )}
                                            </div>
                                        )}
                                    </Droppable>
                                </div>
                            )
                        })}
                    </DragDropContext>
                )}
            </div>

            {/* ── Deal Slide-Over ──────────────────────────────────── */}
            {selectedDeal && (
                <DealSlideOver
                    deal={selectedDeal}
                    members={members}
                    onClose={() => setSelectedDeal(null)}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    columns={columns}
                />
            )}
        </div>
    )
}

