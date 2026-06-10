'use client'

import React, { useState, useMemo } from 'react'
import {
    CheckCircle2, Circle, Clock, AlertTriangle, ListTodo, Plus, Search,
    CalendarDays, Building, ArrowUpDown, X, ChevronDown, SlidersHorizontal,
    Flame, Inbox, BarChart2, User, ShieldCheck, Users
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { format, isPast, isToday, isTomorrow, isThisWeek, startOfDay, endOfDay, parseISO } from 'date-fns'
import { toggleTaskCompletion, addTask } from '@/app/actions/crm'

type SortKey = 'due_date_asc' | 'due_date_desc' | 'priority'

interface Member { id: string; full_name: string | null; role: string }

const ROLE_LABELS: Record<string, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    user: 'Sales Rep',
}

const ROLE_BADGE: Record<string, string> = {
    super_admin: 'bg-purple-100 text-purple-700',
    admin: 'bg-blue-100 text-blue-700',
    user: 'bg-slate-100 text-slate-600',
}

const PRIORITY_DOT: Record<string, string> = {
    high: 'bg-red-500', medium: 'bg-orange-400', low: 'bg-emerald-400', normal: 'bg-slate-300'
}

export default function FollowUpsClient({
    tasks: initialTasks,
    leads,
    members,
    currentUserRole,
}: {
    tasks: any[]
    leads: any[]
    members: Member[]
    currentUserRole: string
}) {
    const isAdmin = currentUserRole === 'admin' || currentUserRole === 'super_admin'

    const [tasks, setTasks] = useState(initialTasks || [])
    const [search, setSearch] = useState('')
    const [priorityFilter, setPriorityFilter] = useState('all')
    const [leadFilter, setLeadFilter] = useState('all')
    const [repFilter, setRepFilter] = useState('all')          // admin only
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [sortKey, setSortKey] = useState<SortKey>('due_date_asc')
    const [showFilters, setShowFilters] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [activeTab, setActiveTab] = useState('pending')

    // ─── Top-level stats ───────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const overdue = tasks.filter(t => t.status !== 'completed' && t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date)))
        const dueToday = tasks.filter(t => t.status !== 'completed' && t.due_date && isToday(new Date(t.due_date)))
        const thisWeek = tasks.filter(t => t.status !== 'completed' && t.due_date && isThisWeek(new Date(t.due_date)) && !isToday(new Date(t.due_date)))
        const completed = tasks.filter(t => t.status === 'completed')
        const total = tasks.length
        const completionPct = total > 0 ? Math.round((completed.length / total) * 100) : 0
        return { overdue, dueToday, thisWeek, completed, total, completionPct }
    }, [tasks])

    // ─── Per-rep stats (admin only) ────────────────────────────────────────────
    const repStats = useMemo(() => {
        if (!isAdmin) return []
        return members.map(m => {
            const myTasks = tasks.filter(t => t.assigned_to === m.id)
            const done = myTasks.filter(t => t.status === 'completed').length
            const pending = myTasks.filter(t => t.status !== 'completed').length
            const overdue = myTasks.filter(t => t.status !== 'completed' && t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date))).length
            const pct = myTasks.length > 0 ? Math.round((done / myTasks.length) * 100) : 0
            return { ...m, total: myTasks.length, done, pending, overdue, pct }
        }).filter(r => r.total > 0)
    }, [tasks, members, isAdmin])

    // Unassigned tasks (no assigned_to)
    const unassignedStats = useMemo(() => {
        const myTasks = tasks.filter(t => !t.assigned_to)
        const done = myTasks.filter(t => t.status === 'completed').length
        const pending = myTasks.filter(t => t.status !== 'completed').length
        return { total: myTasks.length, done, pending }
    }, [tasks])

    // ─── Filtered & sorted tasks ───────────────────────────────────────────────
    const filteredTasks = useMemo(() => {
        let result = [...tasks]

        if (activeTab === 'pending') result = result.filter(t => t.status !== 'completed')
        else if (activeTab === 'completed') result = result.filter(t => t.status === 'completed')
        else if (activeTab === 'overdue') result = result.filter(t => t.status !== 'completed' && t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date)))
        else if (activeTab === 'today') result = result.filter(t => t.status !== 'completed' && t.due_date && isToday(new Date(t.due_date)))

        if (search) {
            const q = search.toLowerCase()
            result = result.filter(t =>
                t.title?.toLowerCase().includes(q) ||
                t.description?.toLowerCase().includes(q) ||
                (t.leads?.name || '').toLowerCase().includes(q) ||
                (t.users?.full_name || '').toLowerCase().includes(q)
            )
        }
        if (priorityFilter !== 'all') result = result.filter(t => t.priority === priorityFilter)
        if (leadFilter !== 'all') result = result.filter(t => t.lead_id === leadFilter || (leadFilter === '__none__' && !t.lead_id))
        if (isAdmin && repFilter !== 'all') {
            if (repFilter === '__unassigned__') result = result.filter(t => !t.assigned_to)
            else result = result.filter(t => t.assigned_to === repFilter)
        }
        if (dateFrom) result = result.filter(t => t.due_date && new Date(t.due_date) >= startOfDay(parseISO(dateFrom)))
        if (dateTo) result = result.filter(t => t.due_date && new Date(t.due_date) <= endOfDay(parseISO(dateTo)))

        result.sort((a, b) => {
            if (sortKey === 'due_date_asc') return new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime()
            if (sortKey === 'due_date_desc') return new Date(b.due_date || 0).getTime() - new Date(a.due_date || 0).getTime()
            if (sortKey === 'priority') {
                const p: Record<string, number> = { high: 0, medium: 1, low: 2, normal: 3 }
                return (p[a.priority] ?? 3) - (p[b.priority] ?? 3)
            }
            return 0
        })
        return result
    }, [tasks, activeTab, search, priorityFilter, leadFilter, repFilter, dateFrom, dateTo, sortKey, isAdmin])

    const activeFilterCount = [
        priorityFilter !== 'all', leadFilter !== 'all',
        isAdmin && repFilter !== 'all', dateFrom, dateTo
    ].filter(Boolean).length

    // ─── Handlers ──────────────────────────────────────────────────────────────
    const handleToggle = async (taskId: string, currentStatus: string) => {
        const newStatus = currentStatus === 'completed' ? 'pending' : 'completed'
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
        try {
            await toggleTaskCompletion(taskId, newStatus === 'completed')
            toast.success(newStatus === 'completed' ? '✅ Task marked complete!' : 'Task reopened')
        } catch {
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: currentStatus } : t))
            toast.error('Failed to update task')
        }
    }

    const handleBulkComplete = async () => {
        const ids = Array.from(selectedIds)
        setTasks(prev => prev.map(t => selectedIds.has(t.id) ? { ...t, status: 'completed' } : t))
        setSelectedIds(new Set())
        await Promise.all(ids.map(id => toggleTaskCompletion(id, true)))
        toast.success(`${ids.length} task${ids.length > 1 ? 's' : ''} marked complete!`)
    }

    const toggleSelect = (id: string) =>
        setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

    const clearFilters = () => {
        setSearch(''); setPriorityFilter('all'); setLeadFilter('all'); setRepFilter('all'); setDateFrom(''); setDateTo('')
    }

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsSubmitting(true)
        const formData = new FormData(e.currentTarget)
        try {
            const res = await addTask(formData)
            if (res?.error) throw new Error(res.error)
            toast.success('Follow-up scheduled!')
            setIsDialogOpen(false)
            const assignedId = formData.get('assigned_to') as string
            const assignedMember = members.find(m => m.id === assignedId) || null
            setTasks(prev => [{
                id: Math.random().toString(),
                title: formData.get('title') as string,
                description: formData.get('description') as string,
                priority: formData.get('priority') as string,
                due_date: formData.get('due_date') as string,
                status: 'pending',
                lead_id: formData.get('lead_id') as string,
                leads: leads.find(l => l.id === formData.get('lead_id')) || null,
                assigned_to: assignedId || null,
                users: assignedMember,
            }, ...prev])
        } catch (err: any) {
            toast.error(err.message || 'Failed to schedule follow-up')
        } finally {
            setIsSubmitting(false)
        }
    }

    // ─── UI helpers ────────────────────────────────────────────────────────────
    const getDueBadge = (task: any) => {
        if (task.status === 'completed') return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">Done</Badge>
        if (!task.due_date) return null
        const d = new Date(task.due_date)
        if (isPast(d) && !isToday(d)) return <Badge className="bg-red-100 text-red-600 border-red-200 text-[10px]">Overdue</Badge>
        if (isToday(d)) return <Badge className="bg-orange-100 text-orange-600 border-orange-200 text-[10px]">Today</Badge>
        if (isTomorrow(d)) return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px]">Tomorrow</Badge>
        return <Badge className="bg-slate-100 text-slate-500 border-slate-200 text-[10px]">{format(d, 'MMM d')}</Badge>
    }

    const tabCounts = {
        pending: tasks.filter(t => t.status !== 'completed').length,
        today: stats.dueToday.length,
        overdue: stats.overdue.length,
        completed: stats.completed.length,
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-gray-200 dark:border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground flex items-center gap-3">
                        <ListTodo className="h-8 w-8 text-purple-500" />
                        Follow-ups
                        {isAdmin && (
                            <Badge className="bg-purple-100 text-purple-700 border-purple-200 gap-1 text-xs font-medium">
                                <ShieldCheck className="h-3 w-3" /> Admin View
                            </Badge>
                        )}
                    </h1>
                    <p className="text-slate-500 dark:text-muted-foreground mt-1 text-sm">
                        Scheduled tasks and reminders for your leads and pipeline.
                    </p>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2 shrink-0"><Plus className="h-4 w-4" /> Schedule Follow-up</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[520px]">
                        <DialogHeader>
                            <DialogTitle>Schedule a Follow-up</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleCreate} className="space-y-4 mt-2">
                            <div className="space-y-1">
                                <Label htmlFor="fu-title">Task Title <span className="text-red-500">*</span></Label>
                                <Input id="fu-title" name="title" placeholder="e.g., Call to follow up on proposal" required />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="fu-desc">Notes (optional)</Label>
                                <Textarea id="fu-desc" name="description" placeholder="Any context or reminders..." className="resize-none min-h-[80px]" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label htmlFor="fu-lead">Link to Lead</Label>
                                    <Select name="lead_id" defaultValue="none">
                                        <SelectTrigger id="fu-lead"><SelectValue placeholder="No lead" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">No lead</SelectItem>
                                            {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {isAdmin && (
                                    <div className="space-y-1">
                                        <Label htmlFor="fu-assignee">Assign to Rep</Label>
                                        <Select name="assigned_to" defaultValue="unassigned">
                                            <SelectTrigger id="fu-assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                                {members.map(m => (
                                                    <SelectItem key={m.id} value={m.id}>
                                                        {m.full_name || 'Unnamed'} · {ROLE_LABELS[m.role] ?? m.role}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label htmlFor="fu-due">Due Date <span className="text-red-500">*</span></Label>
                                    <Input id="fu-due" name="due_date" type="datetime-local" required />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="fu-priority">Priority</Label>
                                    <Select name="priority" defaultValue="medium">
                                        <SelectTrigger id="fu-priority"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="high">🔴 High</SelectItem>
                                            <SelectItem value="medium">🟠 Medium</SelectItem>
                                            <SelectItem value="low">🟢 Low</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <Button type="submit" className="w-full" disabled={isSubmitting}>
                                {isSubmitting ? 'Scheduling...' : 'Schedule Follow-up'}
                            </Button>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {/* ── Stats bar ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Overdue', value: stats.overdue.length, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30 border-red-100 dark:border-red-900/30', icon: <AlertTriangle className="h-4 w-4 text-red-500" />, tab: 'overdue' },
                    { label: 'Due Today', value: stats.dueToday.length, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30 border-orange-100 dark:border-orange-900/30', icon: <Flame className="h-4 w-4 text-orange-500" />, tab: 'today' },
                    { label: 'This Week', value: stats.thisWeek.length, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/30', icon: <CalendarDays className="h-4 w-4 text-blue-500" />, tab: 'pending' },
                    { label: 'Completed', value: stats.completed.length, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30 border-green-100 dark:border-green-900/30', icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, tab: 'completed' },
                ].map(s => (
                    <button key={s.label} onClick={() => setActiveTab(s.tab)}
                        className={`text-left rounded-xl border p-4 hover:opacity-90 transition-opacity ${s.bg}`}>
                        <div className="flex items-center justify-between mb-2">{s.icon}<BarChart2 className="h-3 w-3 text-slate-300" /></div>
                        <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                    </button>
                ))}
            </div>

            {/* ── Progress bar ─────────────────────────────────────────────── */}
            {stats.total > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-border p-4 bg-white dark:bg-card/30">
                    <div className="flex justify-between mb-2 text-sm">
                        <span className="font-medium text-slate-700 dark:text-muted-foreground">Overall Completion</span>
                        <span className="font-bold text-slate-900 dark:text-foreground">
                            {stats.completionPct}%
                            <span className="text-xs font-normal text-slate-400 ml-1">({stats.completed.length}/{stats.total} tasks)</span>
                        </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-500 to-green-500 rounded-full transition-all duration-700"
                            style={{ width: `${stats.completionPct}%` }} />
                    </div>
                </div>
            )}

            {/* ── Admin: Per-rep breakdown ──────────────────────────────────── */}
            {isAdmin && (repStats.length > 0 || unassignedStats.total > 0) && (
                <div className="rounded-xl border border-slate-200 dark:border-border bg-white dark:bg-card/30 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-border bg-slate-50/60 dark:bg-secondary/30">
                        <Users className="h-4 w-4 text-purple-500" />
                        <span className="font-semibold text-sm text-slate-800 dark:text-foreground">Team Task Breakdown</span>
                        <span className="text-xs text-slate-400 ml-1">(Admin only)</span>
                    </div>
                    <div className="divide-y dark:divide-slate-800">
                        {repStats.map(rep => (
                            <button
                                key={rep.id}
                                onClick={() => setRepFilter(prev => prev === rep.id ? 'all' : rep.id)}
                                className={`w-full flex items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left
                                    ${repFilter === rep.id ? 'bg-purple-50 dark:bg-purple-950/20' : ''}`}
                            >
                                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                                    {(rep.full_name || 'U')[0].toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-900 dark:text-foreground truncate">
                                            {rep.full_name || 'Unnamed'}
                                        </span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ROLE_BADGE[rep.role] ?? 'bg-slate-100 text-slate-500'}`}>
                                            {ROLE_LABELS[rep.role] ?? rep.role}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 mt-1">
                                        <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-purple-400 to-green-400 rounded-full"
                                                style={{ width: `${rep.pct}%` }} />
                                        </div>
                                        <span className="text-[10px] text-slate-400">{rep.pct}%</span>
                                    </div>
                                </div>
                                <div className="flex gap-3 text-xs flex-shrink-0">
                                    <span className="flex items-center gap-1 text-green-600 font-medium"><CheckCircle2 className="h-3 w-3" />{rep.done}</span>
                                    <span className="flex items-center gap-1 text-slate-400"><Clock className="h-3 w-3" />{rep.pending}</span>
                                    {rep.overdue > 0 && <span className="flex items-center gap-1 text-red-500 font-medium"><AlertTriangle className="h-3 w-3" />{rep.overdue}</span>}
                                </div>
                            </button>
                        ))}
                        {unassignedStats.total > 0 && (
                            <button
                                onClick={() => setRepFilter(prev => prev === '__unassigned__' ? 'all' : '__unassigned__')}
                                className={`w-full flex items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left
                                    ${repFilter === '__unassigned__' ? 'bg-purple-50 dark:bg-purple-950/20' : ''}`}
                            >
                                <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                                    <User className="h-4 w-4 text-slate-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-slate-500">Unassigned tasks</span>
                                </div>
                                <div className="flex gap-3 text-xs flex-shrink-0">
                                    <span className="flex items-center gap-1 text-green-600 font-medium"><CheckCircle2 className="h-3 w-3" />{unassignedStats.done}</span>
                                    <span className="flex items-center gap-1 text-slate-400"><Clock className="h-3 w-3" />{unassignedStats.pending}</span>
                                </div>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Search + Filters ─────────────────────────────────────────── */}
            <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input placeholder="Search tasks, leads, or reps..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <Button variant="outline" onClick={() => setShowFilters(v => !v)}
                        className={`gap-2 ${showFilters ? 'border-purple-400 text-purple-600' : ''}`}>
                        <SlidersHorizontal className="h-4 w-4" />
                        Filters
                        {activeFilterCount > 0 && (
                            <Badge className="h-5 w-5 p-0 flex items-center justify-center text-[10px] bg-purple-500 text-white rounded-full">
                                {activeFilterCount}
                            </Badge>
                        )}
                        <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    </Button>
                    <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
                        <SelectTrigger className="w-[190px]">
                            <ArrowUpDown className="h-4 w-4 mr-2 text-slate-400" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="due_date_asc">Due Date ↑ (soonest)</SelectItem>
                            <SelectItem value="due_date_desc">Due Date ↓ (latest)</SelectItem>
                            <SelectItem value="priority">Priority (high first)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {showFilters && (
                    <div className={`grid gap-3 p-4 bg-slate-50 dark:bg-card/40 border border-slate-200 dark:border-border rounded-xl ${isAdmin ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
                        <div className="space-y-1">
                            <Label className="text-xs text-slate-500">Priority</Label>
                            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All priorities</SelectItem>
                                    <SelectItem value="high">🔴 High</SelectItem>
                                    <SelectItem value="medium">🟠 Medium</SelectItem>
                                    <SelectItem value="low">🟢 Low</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-slate-500">Lead</Label>
                            <Select value={leadFilter} onValueChange={setLeadFilter}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All leads</SelectItem>
                                    <SelectItem value="__none__">No lead linked</SelectItem>
                                    {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        {isAdmin && (
                            <div className="space-y-1 col-span-2 sm:col-span-1">
                                <Label className="text-xs text-slate-500 flex items-center gap-1">
                                    <ShieldCheck className="h-3 w-3 text-purple-500" /> Sales Rep
                                </Label>
                                <Select value={repFilter} onValueChange={setRepFilter}>
                                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All reps</SelectItem>
                                        <SelectItem value="__unassigned__">Unassigned</SelectItem>
                                        {members.map(m => (
                                            <SelectItem key={m.id} value={m.id}>
                                                {m.full_name || 'Unnamed'} ({ROLE_LABELS[m.role] ?? m.role})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-1">
                            <Label className="text-xs text-slate-500">From date</Label>
                            <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-slate-500">To date</Label>
                            <Input type="date" className="h-9 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                        </div>
                        {activeFilterCount > 0 && (
                            <div className="col-span-2 sm:col-span-3 flex justify-end">
                                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-slate-500 gap-1">
                                    <X className="h-3.5 w-3.5" /> Clear all filters
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Bulk action ──────────────────────────────────────────────── */}
            {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-xl">
                    <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                        {selectedIds.size} task{selectedIds.size > 1 ? 's' : ''} selected
                    </span>
                    <Button size="sm" onClick={handleBulkComplete} className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark all complete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="h-7 text-xs text-slate-500">Deselect</Button>
                </div>
            )}

            {/* ── Results count ────────────────────────────────────────────── */}
            <div className="text-xs text-slate-400">
                Showing <span className="font-semibold text-slate-600 dark:text-muted-foreground">{filteredTasks.length}</span> of {tasks.length} tasks
                {(search || activeFilterCount > 0) && (
                    <button onClick={clearFilters} className="ml-2 text-purple-500 hover:underline">Clear filters</button>
                )}
            </div>

            {/* ── Tabs ─────────────────────────────────────────────────────── */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4 bg-slate-100 dark:bg-secondary/50">
                    <TabsTrigger value="pending">
                        <Inbox className="h-3.5 w-3.5 mr-1.5" />Pending
                        <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1.5">{tabCounts.pending}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="today">
                        <Clock className="h-3.5 w-3.5 mr-1.5" />Today
                        {tabCounts.today > 0 && <Badge className="ml-2 text-[10px] h-4 px-1.5 bg-orange-500 text-white">{tabCounts.today}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="overdue" className="data-[state=active]:text-red-600">
                        <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />Overdue
                        {tabCounts.overdue > 0 && <Badge className="ml-2 text-[10px] h-4 px-1.5 bg-red-500 text-white">{tabCounts.overdue}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="completed">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Done
                        <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1.5">{tabCounts.completed}</Badge>
                    </TabsTrigger>
                </TabsList>

                {['pending', 'today', 'overdue', 'completed'].map(tab => (
                    <TabsContent key={tab} value={tab} className="mt-4">
                        {filteredTasks.length === 0 ? (
                            <div className="text-center py-20 border border-dashed border-slate-200 dark:border-border rounded-xl">
                                <CheckCircle2 className="h-12 w-12 mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                                <p className="text-slate-500 font-medium text-sm">
                                    {tab === 'completed' ? 'No completed follow-ups yet.' :
                                        tab === 'overdue' ? '🎉 No overdue tasks! Great work.' :
                                            tab === 'today' ? '✅ Nothing due today.' :
                                                search || activeFilterCount > 0 ? 'No tasks match your filters.' :
                                                    'No follow-ups scheduled yet.'}
                                </p>
                                {tab === 'pending' && !search && activeFilterCount === 0 && (
                                    <Button variant="outline" className="mt-4" onClick={() => setIsDialogOpen(true)}>
                                        <Plus className="h-4 w-4 mr-2" /> Schedule your first follow-up
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-xl border border-slate-200 dark:border-border overflow-hidden divide-y dark:divide-slate-800">
                                {filteredTasks.map(task => {
                                    const isSelected = selectedIds.has(task.id)
                                    const isOverdue = task.status !== 'completed' && task.due_date && isPast(new Date(task.due_date)) && !isToday(new Date(task.due_date))
                                    const rep = task.users
                                    return (
                                        <div key={task.id}
                                            className={`flex items-start gap-3 p-4 transition-colors
                                                ${isSelected ? 'bg-purple-50 dark:bg-purple-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'}
                                                ${task.status === 'completed' ? 'opacity-55' : ''}
                                                ${isOverdue ? 'border-l-2 border-red-400' : ''}`}
                                        >
                                            {task.status !== 'completed' && (
                                                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(task.id)}
                                                    className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-purple-600 cursor-pointer flex-shrink-0" />
                                            )}
                                            <button onClick={() => handleToggle(task.id, task.status)} className="mt-0.5 flex-shrink-0 focus:outline-none">
                                                {task.status === 'completed'
                                                    ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                                                    : <Circle className="h-5 w-5 text-slate-300 dark:text-slate-600 hover:text-purple-400 transition-colors" />}
                                            </button>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] || 'bg-slate-300'}`} />
                                                    <p className={`text-sm font-medium leading-snug ${task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-900 dark:text-foreground'}`}>
                                                        {task.title}
                                                    </p>
                                                    {getDueBadge(task)}
                                                </div>
                                                {task.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{task.description}</p>}
                                                <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-400">
                                                    {task.due_date && (
                                                        <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
                                                            <CalendarDays className="h-3 w-3" />
                                                            {format(new Date(task.due_date), 'EEE, MMM d · h:mm a')}
                                                        </span>
                                                    )}
                                                    {task.leads?.name && (
                                                        <span className="flex items-center gap-1 bg-slate-100 dark:bg-secondary px-2 py-0.5 rounded-full">
                                                            <Building className="h-2.5 w-2.5" />{task.leads.name}
                                                        </span>
                                                    )}
                                                    {/* Rep tag — shown to admins */}
                                                    {isAdmin && (
                                                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                                                            ${rep ? 'bg-purple-50 dark:bg-purple-950/30 text-purple-600' : 'bg-slate-100 dark:bg-secondary text-slate-400'}`}>
                                                            <User className="h-2.5 w-2.5" />
                                                            {rep ? (rep.full_name || 'Unknown') : 'Unassigned'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-shrink-0 self-center">
                                                <Badge variant="outline" className={`text-[10px] capitalize px-2 ${task.priority === 'high' ? 'border-red-400 text-red-500' :
                                                    task.priority === 'medium' ? 'border-orange-400 text-orange-500' :
                                                        task.priority === 'low' ? 'border-emerald-400 text-emerald-600' :
                                                            'border-slate-200 text-slate-400'}`}>
                                                    {task.priority ?? 'normal'}
                                                </Badge>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    )
}

