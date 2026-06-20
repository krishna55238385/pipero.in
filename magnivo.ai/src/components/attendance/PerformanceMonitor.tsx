'use client'

import { useEffect, useState } from 'react'
import {
    Users,
    Zap,
    Target,
    CheckCircle2,
    Trophy,
    Activity,
    UserCircle,
    ArrowUpRight,
    Calendar,
    Clock as ClockIcon,
    MapPin,
    ChevronRight,
    X,
    BarChart3,
    TrendingUp,
    AlertCircle,
    FileText,
    Loader2
} from 'lucide-react'
import { format, differenceInMinutes } from 'date-fns'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { getHistoricalAttendance } from '@/app/actions/crm'

type Rep = {
    id: string
    name: string
    role: string
    status: string
    checkIn?: string
    checkOut?: string
    KPIs: { leads: number, deals: number, tasks: number }
}

type AttendanceLog = {
    id: string
    check_in_time: string
    check_out_time: string | null
    location?: { lat: number, lng: number } | null
}

function formatDuration(checkIn: string, checkOut: string | null) {
    if (!checkOut) return 'In Progress'
    const mins = differenceInMinutes(new Date(checkOut), new Date(checkIn))
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
}

function RepDetailDialog({ rep, onClose }: { rep: Rep, onClose: () => void }) {
    const [filter, setFilter] = useState<'weekly' | 'monthly' | 'yearly' | 'all'>('monthly')
    const [logs, setLogs] = useState<AttendanceLog[]>([])
    const [loading, setLoading] = useState(false)

    const loadLogs = async (newFilter: typeof filter) => {
        setLoading(true)
        const data = await getHistoricalAttendance(newFilter, rep.id)
        setLogs(data as AttendanceLog[])
        setLoading(false)
    }

    // Auto-load once when the dialog opens — in an effect, NEVER during render.
    // Calling a server action + setState mid-render triggers React's
    // "Cannot update a component while rendering a different component" error.
    useEffect(() => {
        loadLogs(filter)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleFilterChange = (val: string) => {
        const f = val as typeof filter
        setFilter(f)
        loadLogs(f)
    }

    const totalShifts = logs.length
    const completedShifts = logs.filter(l => l.check_out_time).length
    const totalMins = logs.reduce((acc, log) => {
        if (!log.check_out_time) return acc
        return acc + differenceInMinutes(new Date(log.check_out_time), new Date(log.check_in_time))
    }, 0)
    const avgHours = completedShifts > 0 ? (totalMins / completedShifts / 60).toFixed(1) : '0'
    const totalHours = (totalMins / 60).toFixed(1)

    return (
        <Dialog open onOpenChange={() => onClose()}>
            <DialogContent className="max-w-3xl bg-white dark:bg-background border-slate-100 dark:border-border rounded-3xl p-0 overflow-hidden max-h-[90vh] flex flex-col">
                <DialogHeader className="p-8 pb-0 shrink-0">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                                <span className="text-2xl font-bold text-blue-600">{rep.name.charAt(0)}</span>
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-bold tracking-tight">{rep.name}</DialogTitle>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">{rep.role}</p>
                            </div>
                        </div>
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${rep.status === 'Online' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : rep.status === 'Checked Out' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' : 'bg-rose-50 text-rose-500 dark:bg-rose-500/10'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${rep.status === 'Online' ? 'bg-emerald-500 animate-pulse' : rep.status === 'Checked Out' ? 'bg-slate-400' : 'bg-slate-300'}`} />
                            {rep.status}
                        </div>
                    </div>

                    {/* Today's KPI Strip */}
                    <div className="grid grid-cols-3 gap-4 mt-6">
                        <div className="bg-blue-50 dark:bg-blue-500/10 rounded-2xl p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-1">Leads Today</p>
                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{rep.KPIs.leads}</p>
                        </div>
                        <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1">Tasks Done</p>
                            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{rep.KPIs.tasks}</p>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-2xl p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-1">Deals Won</p>
                            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{rep.KPIs.deals}</p>
                        </div>
                    </div>

                    {/* Shift Info */}
                    {rep.checkIn && (
                        <div className="flex items-center gap-6 mt-4 p-4 bg-slate-50 dark:bg-card rounded-2xl border border-slate-100 dark:border-border">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Today's Check In</p>
                                <p className="text-sm font-bold text-slate-900 dark:text-foreground font-mono">{format(new Date(rep.checkIn), 'HH:mm:ss')}</p>
                            </div>
                            <div className="w-px h-8 bg-slate-200 dark:bg-border" />
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Check Out</p>
                                <p className="text-sm font-bold text-slate-900 dark:text-foreground font-mono">{rep.checkOut ? format(new Date(rep.checkOut), 'HH:mm:ss') : '--:--:--'}</p>
                            </div>
                            <div className="w-px h-8 bg-slate-200 dark:bg-border" />
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Duration</p>
                                <p className="text-sm font-bold text-slate-900 dark:text-foreground">{formatDuration(rep.checkIn, rep.checkOut || null)}</p>
                            </div>
                        </div>
                    )}
                </DialogHeader>

                {/* Attendance History */}
                <div className="flex-1 overflow-y-auto p-8 pt-6 space-y-5">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-600 dark:text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                            <FileText className="w-4 h-4" /> Attendance History
                        </h3>
                        <Select value={filter} onValueChange={handleFilterChange}>
                            <SelectTrigger className="w-[140px] rounded-2xl border-slate-100 dark:border-border h-9 font-bold text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-slate-100 dark:border-border">
                                <SelectItem value="weekly">This Week</SelectItem>
                                <SelectItem value="monthly">This Month</SelectItem>
                                <SelectItem value="yearly">This Year</SelectItem>
                                <SelectItem value="all">All Time</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Summary Stats */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="p-4 bg-slate-50 dark:bg-card rounded-2xl border border-slate-100 dark:border-border text-center">
                            <p className="text-2xl font-bold text-slate-900 dark:text-foreground">{totalShifts}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Total Shifts</p>
                        </div>
                        <div className="p-4 bg-slate-50 dark:bg-card rounded-2xl border border-slate-100 dark:border-border text-center">
                            <p className="text-2xl font-bold text-slate-900 dark:text-foreground">{totalHours}h</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Total Hours</p>
                        </div>
                        <div className="p-4 bg-slate-50 dark:bg-card rounded-2xl border border-slate-100 dark:border-border text-center">
                            <p className="text-2xl font-bold text-slate-900 dark:text-foreground">{avgHours}h</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Avg Per Shift</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="py-12 text-center space-y-3">
                            <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
                            <p className="text-sm font-bold text-slate-400">No attendance records for this period.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {logs.map((log) => (
                                <div key={log.id} className="flex items-center justify-between p-4 bg-white dark:bg-card rounded-2xl border border-slate-100 dark:border-border hover:border-blue-200 dark:hover:border-blue-500/20 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-secondary flex items-center justify-center text-sm font-bold text-slate-500">
                                            {format(new Date(log.check_in_time), 'dd')}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900 dark:text-foreground">
                                                {format(new Date(log.check_in_time), 'EEEE, MMM d, yyyy')}
                                            </p>
                                            <div className="flex items-center gap-3 text-xs text-slate-500 font-medium mt-0.5">
                                                <span className="font-mono">{format(new Date(log.check_in_time), 'HH:mm')} → {log.check_out_time ? format(new Date(log.check_out_time), 'HH:mm') : 'Live'}</span>
                                                {log.location && (
                                                    <a href={`https://www.google.com/maps?q=${log.location.lat},${log.location.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                                                        <MapPin className="w-3 h-3" /> View Map
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-bold text-slate-600 dark:text-muted-foreground">{formatDuration(log.check_in_time, log.check_out_time)}</span>
                                        <Badge className={`rounded-lg text-[10px] px-2 font-bold border-0 ${log.check_out_time ? 'bg-slate-100 text-slate-600 dark:bg-secondary dark:text-muted-foreground' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'}`}>
                                            {log.check_out_time ? 'Done' : 'Live'}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default function PerformanceMonitor({ teamData }: { teamData: Rep[] }) {
    const [selectedRep, setSelectedRep] = useState<Rep | null>(null)

    if (!teamData) return null

    const onlineCount = teamData.filter(u => u.status === 'Online').length
    const checkedOutCount = teamData.filter(u => u.status === 'Checked Out').length
    const offlineCount = teamData.filter(u => u.status === 'Offline').length

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Admin Header Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-2">
                            <Users className="w-5 h-5 text-blue-600" />
                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-0">{onlineCount} Live</Badge>
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-foreground">{teamData.length}</h3>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Total Team Force</p>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-2">
                            <Target className="w-5 h-5 text-emerald-600" />
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-0">Today</Badge>
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-foreground">
                            {teamData.reduce((acc, u) => acc + u.KPIs.leads, 0)}
                        </h3>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Leads Generated</p>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-2">
                            <CheckCircle2 className="w-5 h-5 text-amber-600" />
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-0">Today</Badge>
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-foreground">
                            {teamData.reduce((acc, u) => acc + u.KPIs.tasks, 0)}
                        </h3>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Tasks Completed</p>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-2">
                            <Zap className="w-5 h-5 text-purple-600" />
                            <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 border-0">Today</Badge>
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-foreground">
                            {teamData.reduce((acc, u) => acc + u.KPIs.deals, 0)}
                        </h3>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Deals Won</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Leaderboard */}
                <Card className="lg:col-span-1 bg-white dark:bg-background border-gray-200 dark:border-border rounded-3xl shadow-sm overflow-hidden">
                    <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-gray-100 dark:border-border">
                        <div className="flex items-center gap-3">
                            <Trophy className="w-6 h-6 text-amber-500" />
                            <CardTitle className="text-xl font-bold">Top Performers</CardTitle>
                        </div>
                        <CardDescription className="text-xs font-bold text-slate-400 tracking-wider mt-1">Ranked by today's activity score</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y divide-gray-100 dark:divide-slate-800/50">
                            {[...teamData].sort((a, b) => (b.KPIs.leads + b.KPIs.tasks) - (a.KPIs.leads + a.KPIs.tasks)).slice(0, 5).map((rep, idx) => (
                                <button
                                    key={rep.id}
                                    onClick={() => setSelectedRep(rep)}
                                    className="w-full p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-all text-left"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${idx === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' : idx === 1 ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'}`}>#{idx + 1}</div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900 dark:text-foreground">{rep.name}</p>
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{rep.role}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{(rep.KPIs.leads + rep.KPIs.tasks) * 10} pts</div>
                                            <div className="text-[10px] font-bold text-slate-400">Activity</div>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-slate-300" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Team Roster - Main Table */}
                <Card className="lg:col-span-2 bg-white dark:bg-background border-gray-200 dark:border-border rounded-3xl shadow-sm overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0 pt-7 px-8">
                        <div>
                            <CardTitle className="text-xl font-bold flex items-center gap-2">
                                <Activity className="w-5 h-5 text-blue-500" /> Team Pulse Monitor
                            </CardTitle>
                            <CardDescription className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Real-time attendance & live tracking</CardDescription>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-4 text-xs font-bold text-slate-500">
                                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />{onlineCount} Online</span>
                                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-400" />{checkedOutCount} Done</span>
                                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />{offlineCount} Offline</span>
                            </div>
                            <Link href="/attendance/logs">
                                <Button variant="outline" size="sm" className="rounded-xl border-gray-200 dark:border-border h-9 font-bold text-xs">
                                    Full Log <ArrowUpRight className="w-4 h-4 ml-2" />
                                </Button>
                            </Link>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 mt-4">
                        <Table>
                            <TableHeader className="bg-slate-50 dark:bg-card/50 h-10">
                                <TableRow>
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider pl-8">Member</TableHead>
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider">Status</TableHead>
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider">Check In</TableHead>
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider">Productivity</TableHead>
                                    <TableHead className="text-right pr-8" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {teamData.map((rep) => (
                                    <TableRow key={rep.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 border-gray-100 dark:border-border">
                                        <TableCell className="pl-8 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center font-bold text-blue-600 dark:text-blue-400 text-sm">
                                                    {rep.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-900 dark:text-foreground">{rep.name}</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{rep.role}</p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${rep.status === 'Online' ? 'bg-emerald-500 shadow-sm shadow-emerald-500 animate-pulse' : rep.status === 'Checked Out' ? 'bg-slate-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
                                                <span className={`text-xs font-bold ${rep.status === 'Online' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>{rep.status}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs font-mono text-slate-500 font-bold">
                                            {rep.checkIn ? format(new Date(rep.checkIn), 'HH:mm') : '--:--'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="flex flex-col gap-1 w-20">
                                                    <div className="flex justify-between text-[10px] font-bold text-slate-400">
                                                        <span>TASKS</span>
                                                        <span>{Math.min(rep.KPIs.tasks * 20, 100)}%</span>
                                                    </div>
                                                    <Progress value={Math.min(rep.KPIs.tasks * 20, 100)} className="h-1 bg-slate-100 dark:bg-secondary" />
                                                </div>
                                                <div className="flex gap-1.5">
                                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-blue-200 text-blue-600 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/50 font-bold">{rep.KPIs.leads}L</Badge>
                                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-emerald-200 text-emerald-600 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/50 font-bold">{rep.KPIs.tasks}T</Badge>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right pr-8">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSelectedRep(rep)}
                                                className="rounded-xl h-8 px-3 font-bold text-[10px] uppercase tracking-wider border-slate-200 dark:border-border hover:border-blue-300 hover:text-blue-600 transition-colors"
                                            >
                                                View Report <ChevronRight className="w-3 h-3 ml-1" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Rep Detail Dialog */}
            {selectedRep && (
                <RepDetailDialog rep={selectedRep} onClose={() => setSelectedRep(null)} />
            )}
        </div>
    )
}
