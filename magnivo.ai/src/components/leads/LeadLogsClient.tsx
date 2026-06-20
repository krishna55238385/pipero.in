'use client'

import { useState, useEffect } from 'react'
import {
    Search,
    Filter,
    Download,
    ChevronLeft,
    ChevronRight,
    Activity,
    Shuffle,
    UserPlus,
    AlertCircle,
    Calendar,
    Users,
    FileText,
    ArrowUpDown,
    CheckCircle2,
    XCircle,
    GitBranch
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { getLeadAuditLogs } from '@/app/actions/lead-management'
import { toast } from 'sonner'

export default function LeadLogsClient({ initialLogs, members }: { initialLogs: any[], members: any[] }) {
    const [logs, setLogs] = useState(initialLogs)
    const [loading, setLoading] = useState(false)
    const [filters, setFilters] = useState({
        search: '',
        event_type: 'all',
        user_id: 'all',
        startDate: '',
        endDate: ''
    })

    const fetchLogs = async () => {
        setLoading(true)
        try {
            const data = await getLeadAuditLogs({
                event_type: filters.event_type,
                user_id: filters.user_id,
                start_date: filters.startDate,
                end_date: filters.endDate
            })
            setLogs(data)
        } catch (error) {
            toast.error('Failed to refresh logs')
        } finally {
            setLoading(false)
        }
    }

    // Effect for filtering (debounced or automatic)
    useEffect(() => {
        fetchLogs()
    }, [filters.event_type, filters.user_id, filters.startDate, filters.endDate])

    const filteredLogs = logs.filter(log =>
        log.description.toLowerCase().includes(filters.search.toLowerCase()) ||
        log.event_type.toLowerCase().includes(filters.search.toLowerCase())
    )

    const exportToCSV = () => {
        const headers = ["Date", "Event", "Description", "Assigned To", "Method"]
        const data = filteredLogs.map(log => [
            new Date(log.created_at).toLocaleString(),
            log.event_type,
            log.description,
            members.find(m => m.id === log.target_user_id)?.full_name || 'N/A',
            log.metadata?.mode || 'N/A'
        ])

        const csvContent = "data:text/csv;charset=utf-8,"
            + headers.join(",") + "\n"
            + data.map(e => e.join(",")).join("\n")

        const encodedUri = encodeURI(csvContent)
        const link = document.createElement("a")
        link.setAttribute("href", encodedUri)
        link.setAttribute("download", `lead_audit_log_${new Date().toISOString().split('T')[0]}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        toast.success('Log exported successfully')
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">Lead Audit Trail</h2>
                    <p className="text-sm text-slate-500 dark:text-muted-foreground font-medium">Complete history of lead assignments, distribution logic, and hygiene events.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        onClick={exportToCSV}
                        className="rounded-2xl h-11 px-6 font-bold gap-2 border-slate-200 dark:border-border hover:bg-slate-50 dark:hover:bg-secondary/50 transition-all"
                    >
                        <Download className="w-4 h-4" /> Export CSV
                    </Button>
                </div>
            </div>

            <Card className="rounded-3xl border-slate-100 dark:border-border shadow-sm overflow-hidden bg-white dark:bg-slate-900/50 border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                <CardHeader className="p-8 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        <div className="relative col-span-1 md:col-span-2">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="Search event description..."
                                value={filters.search}
                                onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                                className="pl-11 h-12 rounded-2xl border-slate-100 dark:border-border bg-white dark:bg-slate-900/50 font-medium"
                            />
                        </div>
                        <Select value={filters.event_type} onValueChange={(v) => setFilters(f => ({ ...f, event_type: v }))}>
                            <SelectTrigger className="h-12 rounded-2xl border-slate-100 dark:border-border bg-white dark:bg-slate-900/50 font-semibold text-xs uppercase tracking-wider">
                                <SelectValue placeholder="Event Type" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-slate-100">
                                <SelectItem value="all">All Events</SelectItem>
                                <SelectItem value="lead_created">Creation</SelectItem>
                                <SelectItem value="lead_updated">Updates</SelectItem>
                                <SelectItem value="status_changed">Status Changes</SelectItem>
                                <SelectItem value="lead_assignment">Assignments</SelectItem>
                                <SelectItem value="lead_forwarded">Forwarding</SelectItem>
                                <SelectItem value="lead_duplicate">Duplicates</SelectItem>
                                <SelectItem value="lead_deleted">Deletions</SelectItem>
                                <SelectItem value="interaction_logged">Interactions</SelectItem>
                                <SelectItem value="hygiene_alert">Hygiene</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={filters.user_id} onValueChange={(v) => setFilters(f => ({ ...f, user_id: v }))}>
                            <SelectTrigger className="h-12 rounded-2xl border-slate-100 dark:border-border bg-white dark:bg-slate-900/50 font-semibold text-xs uppercase tracking-wider">
                                <SelectValue placeholder="Team Member" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-slate-100">
                                <SelectItem value="all">All Members</SelectItem>
                                {members.map(m => (
                                    <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="flex gap-2 lg:col-span-1">
                            <Input
                                type="date"
                                value={filters.startDate}
                                onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
                                className="h-12 rounded-2xl border-slate-100 dark:border-border bg-white dark:bg-slate-900/50 text-xs font-bold"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-border bg-slate-50/30 dark:bg-slate-800/20">
                                    <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Timestamp</th>
                                    <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Event Type</th>
                                    <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Audit Detail</th>
                                    <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Allocation Method</th>
                                    <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Assigned To</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-border/50">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="p-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                                                <p className="text-sm font-bold text-slate-400">Indexing audit trail...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="p-20 text-center">
                                            <div className="flex flex-col items-center gap-4 opacity-40">
                                                <Activity className="w-12 h-12 text-slate-300" />
                                                <p className="text-sm font-bold text-slate-400">No logs found matching your criteria.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredLogs.map((log) => {
                                        const member = members.find(m => m.id === log.target_user_id)
                                        return (
                                            <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors group">
                                                <td className="p-6 border-transparent">
                                                    <div className="flex flex-col">
                                                        <span className="text-[13px] font-bold text-slate-900 dark:text-foreground">
                                                            {new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                                        </span>
                                                        <span className="text-[11px] font-bold text-slate-400">
                                                            {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    {log.event_type === 'lead_created' && (
                                                        <Badge variant="outline" className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border-0 ring-1 ring-inset bg-emerald-50 text-emerald-600 ring-emerald-100">
                                                            {log.event_type.replace(/_/g, ' ')}
                                                        </Badge>
                                                    )}
                                                    {log.event_type === 'lead_deleted' && (
                                                        <Badge variant="outline" className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border-0 ring-1 ring-inset bg-rose-50 text-rose-600 ring-rose-100">
                                                            {log.event_type.replace(/_/g, ' ')}
                                                        </Badge>
                                                    )}
                                                    {log.event_type === 'lead_forwarded' && (
                                                        <Badge variant="outline" className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border-0 ring-1 ring-inset bg-indigo-50 text-indigo-600 ring-indigo-100">
                                                            {log.event_type.replace(/_/g, ' ')}
                                                        </Badge>
                                                    )}
                                                    {['lead_updated', 'status_changed'].includes(log.event_type) && (
                                                        <Badge variant="outline" className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border-0 ring-1 ring-inset bg-sky-50 text-sky-600 ring-sky-100">
                                                            {log.event_type.replace(/_/g, ' ')}
                                                        </Badge>
                                                    )}
                                                    {log.event_type.includes('duplicate') && (
                                                        <Badge variant="outline" className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border-0 ring-1 ring-inset bg-amber-50 text-amber-600 ring-amber-100">
                                                            {log.event_type.replace(/_/g, ' ')}
                                                        </Badge>
                                                    )}
                                                    {['interaction_logged', 'lead_assignment', 'hygiene_alert'].includes(log.event_type) && (
                                                        <Badge variant="outline" className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border-0 ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200">
                                                            {log.event_type.replace(/_/g, ' ')}
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td className="p-6 max-w-md">
                                                    <p className="text-[13px] font-bold text-slate-700 dark:text-foreground leading-tight">{log.description}</p>
                                                    <div className="flex gap-3 flex-wrap mt-1">
                                                        {log.metadata?.lead_id && (
                                                            <span className="text-[10px] text-slate-400 font-bold uppercase">PID: {log.metadata.lead_id.split('-')[0]}</span>
                                                        )}
                                                        {log.metadata?.new_status && (
                                                            <span className="text-[10px] text-blue-500 font-bold uppercase">To: {log.metadata.new_status}</span>
                                                        )}
                                                        {log.metadata?.field && (
                                                            <span className="text-[10px] text-slate-500 font-bold">Changed: {log.metadata.field}</span>
                                                        )}
                                                        {log.metadata?.new_value && (
                                                            <span className="text-[10px] text-slate-500 font-bold truncate max-w-[150px]">To: {String(log.metadata.new_value)}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    {log.metadata?.mode ? (
                                                        <div className="flex items-center gap-2">
                                                            {log.metadata.mode === 'round_robin' && <Shuffle className="w-3.5 h-3.5 text-indigo-500" />}
                                                            {log.metadata.mode === 'weighted' && <ArrowUpDown className="w-3.5 h-3.5 text-blue-500" />}
                                                            {log.metadata.mode === 'load_based' && <Activity className="w-3.5 h-3.5 text-emerald-500" />}
                                                            {log.metadata.mode === 'rule_based' && <GitBranch className="w-3.5 h-3.5 text-amber-500" />}
                                                            <span className="text-[11px] font-bold uppercase text-slate-500 tracking-tighter">
                                                                {log.metadata.mode.replace('_', ' ')}
                                                            </span>
                                                        </div>
                                                    ) : log.metadata?.method ? (
                                                        <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                                                            {log.metadata.method === 'manual' ? 'Manual Entry' : 'Bulk Import'}
                                                        </span>
                                                    ) : log.event_type.includes('forward') ? (
                                                        <span className="text-[11px] font-bold text-indigo-500 uppercase flex items-center gap-1">
                                                            Manual Forward
                                                        </span>
                                                    ) : (
                                                        <span className="text-[11px] font-bold text-slate-300 italic">SYSTEM DEFAULT</span>
                                                    )}
                                                </td>
                                                <td className="p-6">
                                                    {member ? (
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-7 w-7 rounded-full bg-slate-100 dark:bg-secondary flex items-center justify-center border border-slate-200 dark:border-border">
                                                                <Users className="w-3 h-3 text-slate-500" />
                                                            </div>
                                                            <span className="text-[12px] font-extrabold text-slate-800 dark:text-foreground">{member.full_name}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[11px] font-bold text-slate-300">Unassigned</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
