'use client'

import { useState, useEffect } from 'react'
import {
    Calendar,
    ArrowLeft,
    FileText,
    Clock as ClockIcon,
    Filter,
    Download,
    BarChart3,
    Activity,
    UserCircle,
    ChevronRight,
    MapPin
} from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getHistoricalAttendance, getOrgMembers } from '@/app/actions/crm'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar
} from 'recharts'

export default function AttendanceLogsClient() {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'

    const [view, setView] = useState<'everything' | 'performance'>('everything')
    const [filter, setFilter] = useState<'weekly' | 'monthly' | 'yearly' | 'all'>('weekly')
    const [selectedUser, setSelectedUser] = useState<string>('all')
    const [logs, setLogs] = useState<any[]>([])
    const [members, setMembers] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!isCoreAdmin) return
        async function init() {
            setLoading(true)
            const [logsData, membersData] = await Promise.all([
                getHistoricalAttendance(filter, selectedUser),
                getOrgMembers()
            ])
            setLogs(logsData)
            setMembers(membersData)
            setLoading(false)
        }
        init()
    }, [filter, selectedUser, isCoreAdmin])

    // Process data for charts
    const chartData = logs.reduce((acc: any[], log) => {
        const date = format(new Date(log.check_in_time), 'MMM d')
        const existing = acc.find(d => d.date === date)
        if (existing) {
            existing.count += 1
        } else {
            acc.push({ date, count: 1 })
        }
        return acc
    }, []).reverse()

    if (!isCoreAdmin) {
        return (
            <div className="p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
                <div className="p-6 bg-rose-50 dark:bg-rose-500/10 rounded-full">
                    <Calendar className="w-12 h-12 text-rose-500" />
                </div>
                <h2 className="text-2xl font-black italic tracking-tighter">Access Denied</h2>
                <p className="text-slate-500 font-medium max-w-md">Attendance Intelligence audits are restricted to administrators. Please contact your manager for performance reports.</p>
                <Link href="/attendance">
                    <Button className="rounded-2xl bg-slate-900 dark:bg-white dark:text-slate-900 font-bold px-8 h-12">Return to Terminal</Button>
                </Link>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <Link
                        href="/attendance"
                        className="flex items-center gap-2 text-xs font-bold text-blue-500 hover:text-blue-600 transition-colors uppercase tracking-widest mb-4"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Terminal
                    </Link>
                    <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 dark:text-foreground flex items-center gap-3">
                        <Activity className="w-8 h-8 text-blue-600" /> Attendance Intelligence
                    </h1>
                    <p className="text-slate-500 dark:text-muted-foreground font-medium tracking-tight">Enterprise auditing and performance analytics archive.</p>
                </div>
                <div className="flex items-center gap-3">
                    {isCoreAdmin && (
                        <Button variant="outline" className="rounded-2xl border-slate-200 dark:border-border h-11 font-bold text-xs">
                            <Download className="w-4 h-4 mr-2" /> Export CSV
                        </Button>
                    )}
                </div>
            </div>

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center gap-4 bg-white dark:bg-background p-4 rounded-3xl border border-slate-100 dark:border-border shadow-sm">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-card/50 rounded-2xl border border-slate-100 dark:border-border">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Filters</span>
                </div>

                <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                    <SelectTrigger className="w-[160px] rounded-2xl border-slate-100 dark:border-border h-10 font-bold text-xs">
                        <SelectValue placeholder="Timeframe" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="weekly">This Week</SelectItem>
                        <SelectItem value="monthly">This Month</SelectItem>
                        <SelectItem value="yearly">This Year</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={selectedUser} onValueChange={setSelectedUser}>
                    <SelectTrigger className="w-[200px] rounded-2xl border-slate-100 dark:border-border h-10 font-bold text-xs">
                        <SelectValue placeholder="Rep Filter" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                        <SelectItem value="all">All Members</SelectItem>
                        {members.map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="h-6 w-[1px] bg-slate-100 dark:bg-secondary mx-2" />

                <div className="flex bg-slate-100 dark:bg-card/80 p-1 rounded-2xl">
                    <Button
                        variant={view === 'everything' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setView('everything')}
                        className={`rounded-xl h-8 px-4 text-xs font-bold transition-all ${view === 'everything' ? 'bg-white dark:bg-secondary text-slate-900 dark:text-foreground shadow-sm hover:bg-white dark:hover:bg-slate-800' : 'text-slate-500'}`}
                    >
                        Everything
                    </Button>
                    <Button
                        variant={view === 'performance' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setView('performance')}
                        className={`rounded-xl h-8 px-4 text-xs font-bold transition-all ${view === 'performance' ? 'bg-white dark:bg-secondary text-slate-900 dark:text-foreground shadow-sm hover:bg-white dark:hover:bg-slate-800' : 'text-slate-500'}`}
                    >
                        Performance
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="h-[60vh] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
                </div>
            ) : view === 'everything' ? (
                /* Everything View: Table */
                <Card className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-3xl shadow-sm overflow-hidden border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                    <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border p-8">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 dark:bg-blue-500/10 rounded-xl">
                                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <CardTitle className="text-xl font-bold">Historical Audit Log</CardTitle>
                        </div>
                    </CardHeader>
                    <Table>
                        <TableHeader className="bg-slate-50 dark:bg-card/50">
                            <TableRow className="border-slate-100 dark:border-border">
                                <TableHead className="font-bold text-[11px] uppercase tracking-wider pl-8 py-4">Member</TableHead>
                                <TableHead className="font-bold text-[11px] uppercase tracking-wider">Date</TableHead>
                                <TableHead className="font-bold text-[11px] uppercase tracking-wider">Check In</TableHead>
                                <TableHead className="font-bold text-[11px] uppercase tracking-wider">Check Out</TableHead>
                                <TableHead className="font-bold text-[11px] uppercase tracking-wider">Location</TableHead>
                                <TableHead className="font-bold text-[11px] uppercase tracking-wider">Duration</TableHead>
                                <TableHead className="font-bold text-[11px] uppercase tracking-wider pr-8 text-right">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.map((log) => (
                                <TableRow key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 border-slate-50 dark:border-slate-900 group">
                                    <TableCell className="pl-8 py-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-secondary flex items-center justify-center ring-1 ring-slate-200/50 dark:ring-slate-700/50">
                                                <UserCircle className="w-6 h-6 text-slate-400" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-900 dark:text-foreground">{log.users?.full_name}</p>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">{log.users?.role}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm font-semibold text-slate-600 dark:text-muted-foreground">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-slate-400" />
                                            {format(new Date(log.check_in_time), 'MMM d, yyyy')}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm font-mono font-bold text-slate-900 dark:text-foreground">
                                        <div className="flex items-center gap-2">
                                            <ClockIcon className="w-4 h-4 text-blue-500" />
                                            {format(new Date(log.check_in_time), 'HH:mm:ss')}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm font-mono font-bold text-slate-500">
                                        {log.check_out_time ? (
                                            <div className="flex items-center gap-2">
                                                <ClockIcon className="w-4 h-4 text-red-500" />
                                                {format(new Date(log.check_out_time), 'HH:mm:ss')}
                                            </div>
                                        ) : (
                                            <Badge variant="outline" className="text-[10px] h-6 px-2 font-black border-emerald-500/20 text-emerald-500 bg-emerald-500/10">Active Now</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm font-medium">
                                        {log.location ? (
                                            <a
                                                href={`https://www.google.com/maps?q=${log.location.lat},${log.location.lng}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-2 text-blue-500 hover:text-blue-600 transition-colors"
                                            >
                                                <MapPin className="w-4 h-4" /> View Map
                                            </a>
                                        ) : (
                                            <span className="text-slate-400">Untracked</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm font-bold text-slate-400">
                                        {log.check_out_time ? (
                                            `${Math.round((new Date(log.check_out_time).getTime() - new Date(log.check_in_time).getTime()) / (1000 * 60 * 60))}h ${Math.round(((new Date(log.check_out_time).getTime() - new Date(log.check_in_time).getTime()) / (1000 * 60)) % 60)}m`
                                        ) : '--'}
                                    </TableCell>
                                    <TableCell className="pr-8 text-right">
                                        <Badge className={`rounded-xl px-3 py-1 font-bold text-[10px] uppercase tracking-wider ${log.check_out_time ? 'bg-slate-100 text-slate-600 dark:bg-secondary dark:text-muted-foreground border-0' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-0'}`}>
                                            {log.check_out_time ? 'Completed' : 'Online'}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            ) : (
                /* Performance View: Charts */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <Card className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-3xl shadow-sm overflow-hidden border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                        <CardHeader className="p-8">
                            <CardTitle className="text-xl font-bold flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-blue-600" /> Attendance Volume
                            </CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest text-slate-400">Team check-ins over timeframe</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[400px] p-8">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData}>
                                    <defs>
                                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#020617', border: 'none', borderRadius: '12px', color: '#fff' }}
                                        itemStyle={{ color: '#60a5fa', fontWeight: 'bold' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="count"
                                        stroke="#2563eb"
                                        strokeWidth={4}
                                        fillOpacity={1}
                                        fill="url(#colorCount)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-3xl shadow-sm overflow-hidden border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                        <CardHeader className="p-8">
                            <CardTitle className="text-xl font-bold flex items-center gap-2">
                                <Trophy className="w-5 h-5 text-amber-500" /> Rep Distribution
                            </CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest text-slate-400">Total logs by sales force</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[400px] p-8">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={members.map(m => ({
                                    name: m.full_name,
                                    count: logs.filter(l => l.user_id === m.id).length
                                }))}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                                    <XAxis
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
                                        contentStyle={{ backgroundColor: '#020617', border: 'none', borderRadius: '12px', color: '#fff' }}
                                    />
                                    <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} barSize={40} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}

const Trophy = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
)

