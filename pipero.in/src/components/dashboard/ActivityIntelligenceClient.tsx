'use client'

import { useState, useEffect, useMemo } from 'react'
import {
    History,
    Search,
    Filter,
    Activity,
    UserCircle,
    Calendar,
    ArrowUpRight,
    TrendingUp,
    Zap,
    Users,
    CheckCircle2,
    Briefcase,
    MessageSquare,
    Clock,
    ChevronDown,
    Loader2,
    Download
} from 'lucide-react'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { getGlobalActivities, getOrgMembers } from '@/app/actions/crm'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { toText } from '@/lib/gtm-render'

export default function ActivityIntelligenceClient({ initialActivities, initialTotal }: { initialActivities: any[], initialTotal: number }) {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'

    const [activities, setActivities] = useState<any[]>(initialActivities)
    const [total, setTotal] = useState(initialTotal)
    const [members, setMembers] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [exporting, setExporting] = useState(false)

    // ... filters state stays ...
    const [search, setSearch] = useState('')
    const [type, setType] = useState('all')
    const [userId, setUserId] = useState('all')
    const [dateRange, setDateRange] = useState('all')
    const [leadId, setLeadId] = useState('all')
    const [dealId, setDealId] = useState('all')
    const [leads, setLeads] = useState<any[]>([])
    const [deals, setDeals] = useState<any[]>([])
    const [page, setPage] = useState(1)
    const limit = 20

    const supabase = createClient()

    useEffect(() => {
        if (!isCoreAdmin) return
        async function fetchInitialData() {
            const [m, l, d] = await Promise.all([
                getOrgMembers(),
                supabase.from('leads').select('id, name').limit(100),
                supabase.from('deals').select('id, title').limit(100)
            ])
            setMembers(m)
            setLeads(l.data || [])
            setDeals(d.data || [])
        }
        fetchInitialData()
    }, [isCoreAdmin])

    // ... getDateBounds and other effects stay (with isCoreAdmin check) ...
    const getDateBounds = (range: string) => {
        const now = new Date()
        const start = new Date()
        if (range === 'today') start.setHours(0, 0, 0, 0)
        else if (range === 'yesterday') {
            const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            yest.setHours(0, 0, 0, 0)
            const end = new Date(yest)
            end.setHours(23, 59, 59, 999)
            return { from: yest.toISOString(), to: end.toISOString() }
        }
        else if (range === 'week') start.setDate(now.getDate() - 7)
        else if (range === 'month') start.setDate(now.getDate() - 30)
        else return { from: undefined, to: undefined }

        return { from: start.toISOString(), to: undefined }
    }

    useEffect(() => {
        if (!isCoreAdmin) return
        async function updateFeed() {
            setLoading(true)
            const { from, to } = getDateBounds(dateRange)
            const result = await getGlobalActivities({
                limit,
                offset: (page - 1) * limit,
                type,
                userId,
                search,
                dateFrom: from,
                dateTo: to,
                leadId,
                dealId
            })

            if (page === 1) {
                setActivities(result.data)
            } else {
                setActivities(prev => [...prev, ...result.data])
            }
            setTotal(result.total)
            setLoading(false)
        }
        const timer = setTimeout(updateFeed, 300)
        return () => clearTimeout(timer)
    }, [search, type, userId, page, dateRange, leadId, dealId, isCoreAdmin])

    // Reset page and list when filters change
    useEffect(() => {
        setPage(1)
    }, [search, type, userId, dateRange, leadId, dealId])

    // Real-time updates
    useEffect(() => {
        if (!isCoreAdmin) return
        const channel = supabase
            .channel('global_activity_feed')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'activity_logs' },
                async (payload) => {
                    const result = await getGlobalActivities({ limit: 1 })
                    if (result.data.length > 0) {
                        setActivities(prev => [result.data[0], ...prev.slice(0, limit - 1)])
                        setTotal(prev => prev + 1)
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [isCoreAdmin])

    const handleExport = async () => {
        if (!isCoreAdmin) return
        setExporting(true)
        const { from, to } = getDateBounds(dateRange)
        const result = await getGlobalActivities({
            limit: 1000,
            type,
            userId,
            search,
            dateFrom: from,
            dateTo: to,
            leadId,
            dealId
        })

        const headers = ['Action', 'Details', 'Member', 'Date', 'Associated Record']
        const csvContent = [
            headers.join(','),
            ...result.data.map((a: any) => [
                toText(a.action),
                `"${toText(a.details).replace(/"/g, '""')}"`,
                a.users?.full_name || '',
                a.created_at ? format(parseISO(a.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
                a.leads?.name || a.deals?.title || 'None'
            ].join(','))
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.setAttribute('download', `crm_audit_${format(new Date(), 'yyyyMMdd')}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setExporting(false)
    }

    const kpis = useMemo(() => {
        const todayCount = activities.filter(a => isToday(parseISO(a.created_at))).length
        const uniqueReps = new Set(activities.map(a => a.actor_id)).size
        const topAction = activities.reduce((acc: any, curr) => {
            acc[curr.action] = (acc[curr.action] || 0) + 1
            return acc
        }, {})
        const mainAction = Object.entries(topAction).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'None'

        return {
            todayCount,
            uniqueReps,
            mainAction: mainAction.replace('_', ' ')
        }
    }, [activities])

    const groupedActivities = useMemo(() => {
        const groups: { [key: string]: any[] } = {}
        activities.forEach(activity => {
            const date = parseISO(activity.created_at)
            let dateKey = format(date, 'MMMM d, yyyy')
            if (isToday(date)) dateKey = 'Today'
            else if (isYesterday(date)) dateKey = 'Yesterday'

            if (!groups[dateKey]) groups[dateKey] = []
            groups[dateKey].push(activity)
        })
        return groups
    }, [activities])

    const getIcon = (rawAction: string) => {
        const action = String(rawAction || '')
        if (action.includes('lead')) return <Users className="w-4 h-4 text-emerald-500" />
        if (action.includes('deal')) return <Briefcase className="w-4 h-4 text-blue-500" />
        if (action.includes('task')) return <CheckCircle2 className="w-4 h-4 text-amber-500" />
        if (action.includes('communication') || action.includes('note')) return <MessageSquare className="w-4 h-4 text-purple-500" />
        return <Activity className="w-4 h-4 text-slate-400" />
    }

    const getColors = (rawAction: string) => {
        const action = String(rawAction || '')
        if (action.includes('lead')) return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
        if (action.includes('deal')) return 'bg-blue-500/10 border-blue-500/20 text-blue-500'
        if (action.includes('task')) return 'bg-amber-500/10 border-amber-500/20 text-amber-500'
        if (action.includes('communication') || action.includes('note')) return 'bg-purple-500/10 border-purple-500/20 text-purple-500'
        return 'bg-slate-500/10 border-slate-500/20 text-slate-500'
    }

    if (!isCoreAdmin) {
        return (
            <div className="p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
                <div className="p-6 bg-rose-50 dark:bg-rose-500/10 rounded-full">
                    <History className="w-12 h-12 text-rose-500" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Access Denied</h2>
                <p className="text-slate-500 font-medium max-w-md">Global Activity Intelligence is restricted to administrators. Please contact your manager if you require audit access.</p>
                <Link href="/home">
                    <Button className="rounded-2xl bg-slate-900 dark:bg-white dark:text-slate-900 font-bold px-8 h-12">Return to Dashboard</Button>
                </Link>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-foreground flex items-center gap-3">
                        <History className="w-8 h-8 text-blue-600" /> Activity Intelligence
                    </h1>
                    <p className="text-slate-500 dark:text-muted-foreground font-medium tracking-tight">Real-time audit stream and organizational velocity.</p>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        className="rounded-2xl border-slate-200 dark:border-border h-11 font-bold text-xs"
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                        Export Audit CSV
                    </Button>
                    <div className="h-10 w-[1px] bg-slate-200 dark:bg-secondary" />
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Stream
                        </span>
                        <span className="text-xs font-bold text-slate-400">{total} Total Events</span>
                    </div>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: "Today's Pulse", value: kpis.todayCount, icon: Zap, color: "text-blue-500", bg: "bg-blue-500/10" },
                    { label: "Active Contributors", value: kpis.uniqueReps, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                    { label: "Primary Focus", value: kpis.mainAction, icon: Activity, color: "text-purple-500", bg: "bg-purple-500/10" }
                ].map((kpi, i) => (
                    <Card key={i} className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-3xl shadow-sm border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className={`p-3 rounded-2xl ${kpi.bg}`}>
                                <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{kpi.label}</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-foreground">{kpi.value}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-4 bg-white dark:bg-background p-4 rounded-3xl border border-slate-100 dark:border-border shadow-sm">
                <div className="relative flex-1 min-w-[300px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                        placeholder="Search audit details..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10 rounded-2xl border-slate-100 dark:border-border h-11 bg-slate-50/50 dark:bg-card/50 font-medium"
                    />
                </div>

                <Select value={dateRange} onValueChange={setDateRange}>
                    <SelectTrigger className="w-[160px] rounded-2xl border-slate-100 dark:border-border h-11 font-bold text-xs">
                        <SelectValue placeholder="Timeframe" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="yesterday">Yesterday</SelectItem>
                        <SelectItem value="week">Past 7 Days</SelectItem>
                        <SelectItem value="month">Past 30 Days</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="w-[180px] rounded-2xl border-slate-100 dark:border-border h-11 font-bold text-xs">
                        <SelectValue placeholder="Action Type" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                        <SelectItem value="all">All Actions</SelectItem>
                        <SelectItem value="add_lead">Leads Added</SelectItem>
                        <SelectItem value="deal_won">Deals Won</SelectItem>
                        <SelectItem value="task_completed">Tasks Done</SelectItem>
                        <SelectItem value="note_added">Notes/Comms</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={userId} onValueChange={setUserId}>
                    <SelectTrigger className="w-[180px] rounded-2xl border-slate-100 dark:border-border h-11 font-bold text-xs">
                        <SelectValue placeholder="Team Member" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                        <SelectItem value="all">Every Rep</SelectItem>
                        {members.map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="h-6 w-[1px] bg-slate-100 dark:bg-secondary mx-1" />

                <Select value={leadId} onValueChange={setLeadId}>
                    <SelectTrigger className="w-[180px] rounded-2xl border-slate-100 dark:border-border h-11 font-bold text-xs">
                        <SelectValue placeholder="Lead Filter" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                        <SelectItem value="all">All Leads</SelectItem>
                        {leads.map(l => (
                            <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={dealId} onValueChange={setDealId}>
                    <SelectTrigger className="w-[180px] rounded-2xl border-slate-100 dark:border-border h-11 font-bold text-xs">
                        <SelectValue placeholder="Deal Filter" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                        <SelectItem value="all">All Deals</SelectItem>
                        {deals.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Timeline Feed */}
            <div className="space-y-12 pb-12">
                {Object.entries(groupedActivities).map(([date, items]) => (
                    <div key={date} className="relative">
                        {/* Date Header */}
                        <div className="sticky top-0 z-10 py-4 bg-slate-50/80 dark:bg-background/80 backdrop-blur-md mb-8">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-black uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10 px-4 py-1.5 rounded-full">
                                    {date}
                                </span>
                                <div className="h-[1px] flex-1 bg-slate-100 dark:bg-secondary" />
                            </div>
                        </div>

                        {/* Activities */}
                        <div className="space-y-1 relative pl-8 border-l-2 border-slate-100 dark:border-border ml-4">
                            <AnimatePresence mode="popLayout">
                                {items.map((activity, idx) => (
                                    <motion.div
                                        key={activity.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        transition={{ duration: 0.3, delay: idx * 0.05 }}
                                        className="relative pb-8"
                                    >
                                        {/* Dot */}
                                        <div className="absolute -left-[41px] top-1.5 w-5 h-5 rounded-full border-4 border-slate-50 dark:border-slate-950 bg-slate-200 dark:bg-secondary z-10" />

                                        <Card className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-3xl shadow-sm border-0 ring-1 ring-slate-100 dark:ring-slate-800 hover:ring-blue-500/30 transition-all group overflow-hidden">
                                            <CardContent className="p-6">
                                                <div className="flex items-start justify-between gap-6">
                                                    <div className="flex items-start gap-4 flex-1">
                                                        <div className={`p-3 rounded-2xl border ${getColors(activity.action)} shrink-0`}>
                                                            {getIcon(activity.action)}
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <p className="text-sm font-bold text-slate-900 dark:text-foreground capitalize tracking-tight break-words">
                                                                    {String(activity.action || '').replace('_', ' ')}
                                                                </p>
                                                                <span className="text-slate-300 dark:text-slate-700 font-bold text-[10px]">•</span>
                                                                <div className="flex items-center gap-1.5 text-xs text-slate-500 font-bold uppercase tracking-wider bg-slate-50 dark:bg-card px-2 py-0.5 rounded-md">
                                                                    <UserCircle className="w-3 h-3" /> {activity.users?.full_name}
                                                                </div>
                                                                <span className="text-slate-300 dark:text-slate-700 font-bold text-[10px]">•</span>
                                                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                                                    <Clock className="w-3 h-3" /> {format(parseISO(activity.created_at), 'HH:mm:ss')}
                                                                </div>
                                                            </div>
                                                            <div className="text-sm text-slate-600 dark:text-muted-foreground font-medium leading-relaxed break-words">
                                                                {toText(activity.details)}
                                                            </div>

                                                            {/* Entity Tags */}
                                                            {(activity.leads || activity.deals) && (
                                                                <div className="flex gap-2 pt-2">
                                                                    {activity.leads && (
                                                                        <Link href={`/leads/${activity.lead_id}`}>
                                                                            <Badge variant="outline" className="h-7 px-3 rounded-xl border-slate-100 dark:border-border hover:bg-slate-50 dark:hover:bg-slate-900 group/link transition-colors cursor-pointer">
                                                                                <Users className="w-3 h-3 mr-1.5 text-emerald-500" />
                                                                                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground">{activity.leads.name}</span>
                                                                                <ArrowUpRight className="w-3 h-3 ml-1.5 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                                                            </Badge>
                                                                        </Link>
                                                                    )}
                                                                    {activity.deals && (
                                                                        <Link href={`/pipeline`}>
                                                                            <Badge variant="outline" className="h-7 px-3 rounded-xl border-slate-100 dark:border-border hover:bg-slate-50 dark:hover:bg-slate-900 group/link transition-colors cursor-pointer">
                                                                                <Briefcase className="w-3 h-3 mr-1.5 text-blue-500" />
                                                                                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground">{activity.deals.title}</span>
                                                                                <ArrowUpRight className="w-3 h-3 ml-1.5 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                                                            </Badge>
                                                                        </Link>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardContent>
                                            {/* Bottom bar for "View Detail" if needed */}
                                        </Card>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                ))}

                {activities.length === 0 && !loading && (
                    <div className="h-[400px] flex flex-col items-center justify-center space-y-4 border-2 border-dashed border-slate-100 dark:border-border rounded-[40px]">
                        <div className="p-4 bg-slate-50 dark:bg-card rounded-full">
                            <Activity className="w-8 h-8 text-slate-300" />
                        </div>
                        <p className="text-slate-400 font-bold tracking-tight">No actions matched your criteria.</p>
                    </div>
                )}

                {loading && (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                    </div>
                )}
            </div>

            {/* Pagination Placeholder */}
            {total > limit && (
                <div className="flex justify-center pt-8">
                    <Button
                        variant="outline"
                        disabled={loading}
                        onClick={() => setPage(p => p + 1)}
                        className="rounded-2xl border-slate-100 dark:border-border h-10 font-black text-xs uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-slate-900"
                    >
                        Load More Records <ChevronDown className="w-4 h-4 ml-2" />
                    </Button>
                </div>
            )}
        </div>
    )
}

