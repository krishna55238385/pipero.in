'use client'

import { useEffect, useState } from 'react'
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
import { HugeiconsIcon } from '@hugeicons/react'
import {
    UserMultipleIcon,
    ZapIcon,
    Target01Icon,
    CircleCheckIcon,
    Award01Icon,
    Activity01Icon,
    ArrowUpRight01Icon,
    Calendar01Icon,
    MapPinIcon,
    ChevronRightIcon,
    File01Icon,
    Loading02Icon,
} from '@hugeicons/core-free-icons'

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
            <DialogContent className="max-w-3xl bg-white dark:bg-background border-slate-100 dark:border-border rounded-2xl p-0 overflow-hidden max-h-[90vh] flex flex-col">
                <DialogHeader className="p-6 pb-0 shrink-0">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                                <span className="text-xl font-bold text-blue-600">{rep.name.charAt(0)}</span>
                            </div>
                            <div>
                                <DialogTitle className="text-xl font-bold tracking-tight">{rep.name}</DialogTitle>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{rep.role}</p>
                            </div>
                        </div>
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold ${rep.status === 'Online' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : rep.status === 'Checked Out' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' : 'bg-rose-50 text-rose-500 dark:bg-rose-500/10'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${rep.status === 'Online' ? 'bg-emerald-500 animate-pulse' : rep.status === 'Checked Out' ? 'bg-slate-400' : 'bg-slate-300'}`} />
                            {rep.status}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mt-5">
                        <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-3">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-blue-400 mb-0.5">Leads Today</p>
                            <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{rep.KPIs.leads}</p>
                        </div>
                        <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-3">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 mb-0.5">Tasks Done</p>
                            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{rep.KPIs.tasks}</p>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-3">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400 mb-0.5">Deals Won</p>
                            <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{rep.KPIs.deals}</p>
                        </div>
                    </div>

                    {rep.checkIn && (
                        <div className="flex items-center gap-4 mt-4 p-3 bg-slate-50 dark:bg-card rounded-xl border border-slate-100 dark:border-border">
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Check In</p>
                                <p className="text-xs font-bold text-slate-900 dark:text-foreground font-mono">{format(new Date(rep.checkIn), 'HH:mm:ss')}</p>
                            </div>
                            <div className="w-px h-6 bg-slate-200 dark:bg-border" />
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Check Out</p>
                                <p className="text-xs font-bold text-slate-900 dark:text-foreground font-mono">{rep.checkOut ? format(new Date(rep.checkOut), 'HH:mm:ss') : '--:--:--'}</p>
                            </div>
                            <div className="w-px h-6 bg-slate-200 dark:bg-border" />
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Duration</p>
                                <p className="text-xs font-bold text-slate-900 dark:text-foreground">{formatDuration(rep.checkIn, rep.checkOut || null)}</p>
                            </div>
                        </div>
                    )}
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-600 dark:text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                            <HugeiconsIcon icon={File01Icon} size={14} className="text-slate-400" /> Attendance History
                        </h3>
                        <Select value={filter} onValueChange={handleFilterChange}>
                            <SelectTrigger className="w-[130px] rounded-lg border-slate-100 dark:border-border h-8 font-bold text-[11px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-slate-100 dark:border-border">
                                <SelectItem value="weekly">This Week</SelectItem>
                                <SelectItem value="monthly">This Month</SelectItem>
                                <SelectItem value="yearly">This Year</SelectItem>
                                <SelectItem value="all">All Time</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div className="p-3 bg-slate-50 dark:bg-card rounded-xl border border-slate-100 dark:border-border text-center">
                            <p className="text-xl font-bold text-slate-900 dark:text-foreground">{totalShifts}</p>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Total Shifts</p>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-card rounded-xl border border-slate-100 dark:border-border text-center">
                            <p className="text-xl font-bold text-slate-900 dark:text-foreground">{totalHours}h</p>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Total Hours</p>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-card rounded-xl border border-slate-100 dark:border-border text-center">
                            <p className="text-xl font-bold text-slate-900 dark:text-foreground">{avgHours}h</p>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Avg Per Shift</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-10">
                            <HugeiconsIcon icon={Loading02Icon} size={28} className="text-blue-600 animate-spin" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="py-10 text-center space-y-2">
                            <HugeiconsIcon icon={Calendar01Icon} size={28} className="text-slate-300 mx-auto" />
                            <p className="text-xs font-bold text-slate-400">No attendance records for this period.</p>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {logs.map((log) => (
                                <div key={log.id} className="flex items-center justify-between p-3 bg-white dark:bg-card rounded-xl border border-slate-100 dark:border-border hover:border-blue-200 dark:hover:border-blue-500/20 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-secondary flex items-center justify-center text-[11px] font-bold text-slate-500">
                                            {format(new Date(log.check_in_time), 'dd')}
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-slate-900 dark:text-foreground">
                                                {format(new Date(log.check_in_time), 'EEEE, MMM d, yyyy')}
                                            </p>
                                            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium mt-0.5">
                                                <span className="font-mono">{format(new Date(log.check_in_time), 'HH:mm')} → {log.check_out_time ? format(new Date(log.check_out_time), 'HH:mm') : 'Live'}</span>
                                                {log.location && (
                                                    <a href={`https://www.google.com/maps?q=${log.location.lat},${log.location.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-blue-500 hover:underline">
                                                        <HugeiconsIcon icon={MapPinIcon} size={10} className="text-blue-500" /> Map
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground">{formatDuration(log.check_in_time, log.check_out_time)}</span>
                                        <Badge className={`rounded-md text-[9px] px-1.5 font-bold border-0 ${log.check_out_time ? 'bg-slate-100 text-slate-600 dark:bg-secondary dark:text-muted-foreground' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'}`}>
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

    const totalLeads = teamData.reduce((acc, u) => acc + u.KPIs.leads, 0)
    const totalTasks = teamData.reduce((acc, u) => acc + u.KPIs.tasks, 0)
    const totalDeals = teamData.reduce((acc, u) => acc + u.KPIs.deals, 0)

    return (
        <div className="space-y-5 animate-in fade-in duration-500">
            {/* Admin Header Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-xl shadow-sm">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                <HugeiconsIcon icon={UserMultipleIcon} size={16} className="text-blue-600 dark:text-blue-400" />
                            </div>
                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-0 text-[9px] font-bold">{onlineCount} Live</Badge>
                        </div>
                        <p className="text-3xl font-black text-slate-900 dark:text-foreground leading-none">{teamData.length}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">Total Team Force</p>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-xl shadow-sm">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                                <HugeiconsIcon icon={Target01Icon} size={16} className="text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-0 text-[9px] font-bold">Today</Badge>
                        </div>
                        <p className="text-3xl font-black text-slate-900 dark:text-foreground leading-none">{totalLeads}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">Leads Generated</p>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-xl shadow-sm">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                                <HugeiconsIcon icon={CircleCheckIcon} size={16} className="text-amber-600 dark:text-amber-400" />
                            </div>
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-0 text-[9px] font-bold">Today</Badge>
                        </div>
                        <p className="text-3xl font-black text-slate-900 dark:text-foreground leading-none">{totalTasks}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">Tasks Completed</p>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-xl shadow-sm">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-1.5 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                                <HugeiconsIcon icon={ZapIcon} size={16} className="text-purple-600 dark:text-purple-400" />
                            </div>
                            <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 border-0 text-[9px] font-bold">Today</Badge>
                        </div>
                        <p className="text-3xl font-black text-slate-900 dark:text-foreground leading-none">{totalDeals}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">Deals Won</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Leaderboard */}
                <Card className="lg:col-span-1 bg-white dark:bg-background border-gray-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
                    <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-gray-100 dark:border-border py-3 px-5">
                        <div className="flex items-center gap-2">
                            <HugeiconsIcon icon={Award01Icon} size={20} className="text-amber-500" />
                            <CardTitle className="text-sm font-bold">Top Performers</CardTitle>
                        </div>
                        <CardDescription className="text-[10px] font-bold text-slate-400 tracking-wider mt-0.5">Ranked by today&apos;s activity score</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y divide-gray-100 dark:divide-slate-800/50">
                            {[...teamData].sort((a, b) => (b.KPIs.leads + b.KPIs.tasks) - (a.KPIs.leads + a.KPIs.tasks)).slice(0, 5).map((rep, idx) => (
                                <button
                                    key={rep.id}
                                    onClick={() => setSelectedRep(rep)}
                                    className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-all text-left"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] ${idx === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' : idx === 1 ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'}`}>#{idx + 1}</div>
                                        <div>
                                            <p className="text-xs font-bold text-slate-900 dark:text-foreground">{rep.name}</p>
                                            <p className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">{rep.role}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="text-right">
                                            <div className="text-sm font-bold text-blue-600 dark:text-blue-400">{(rep.KPIs.leads + rep.KPIs.tasks) * 10} pts</div>
                                            <div className="text-[9px] font-bold text-slate-400">Activity</div>
                                        </div>
                                        <HugeiconsIcon icon={ChevronRightIcon} size={14} className="text-slate-300" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Team Roster */}
                <Card className="lg:col-span-2 bg-white dark:bg-background border-gray-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3 px-5">
                        <div>
                            <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                                <HugeiconsIcon icon={Activity01Icon} size={16} className="text-blue-500" /> Team Pulse Monitor
                            </CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Real-time attendance & live tracking</CardDescription>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500">
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{onlineCount} Online</span>
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />{checkedOutCount} Done</span>
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700" />{offlineCount} Offline</span>
                            </div>
                            <Link href="/attendance/logs">
                                <Button variant="outline" size="sm" className="rounded-lg border-gray-200 dark:border-border h-8 font-bold text-[10px]">
                                    Full Log <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} className="ml-1 text-slate-400" />
                                </Button>
                            </Link>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 mt-2">
                        <Table>
                            <TableHeader className="bg-slate-50 dark:bg-card/50 h-9">
                                <TableRow>
                                    <TableHead className="font-bold text-[10px] uppercase tracking-wider pl-5">Member</TableHead>
                                    <TableHead className="font-bold text-[10px] uppercase tracking-wider">Status</TableHead>
                                    <TableHead className="font-bold text-[10px] uppercase tracking-wider">Check In</TableHead>
                                    <TableHead className="font-bold text-[10px] uppercase tracking-wider">Productivity</TableHead>
                                    <TableHead className="text-right pr-5" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {teamData.map((rep) => (
                                    <TableRow key={rep.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 border-gray-100 dark:border-border">
                                        <TableCell className="pl-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center font-bold text-blue-600 dark:text-blue-400 text-xs">
                                                    {rep.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-bold text-slate-900 dark:text-foreground">{rep.name}</p>
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">{rep.role}</p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1.5">
                                                <div className={`w-1.5 h-1.5 rounded-full ${rep.status === 'Online' ? 'bg-emerald-500 animate-pulse' : rep.status === 'Checked Out' ? 'bg-slate-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
                                                <span className={`text-[10px] font-bold ${rep.status === 'Online' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>{rep.status}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-[10px] font-mono text-slate-500 font-bold">
                                            {rep.checkIn ? format(new Date(rep.checkIn), 'HH:mm') : '--:--'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2.5">
                                                <div className="flex flex-col gap-0.5 w-16">
                                                    <div className="flex justify-between text-[9px] font-bold text-slate-400">
                                                        <span>TASKS</span>
                                                        <span>{Math.min(rep.KPIs.tasks * 20, 100)}%</span>
                                                    </div>
                                                    <Progress value={Math.min(rep.KPIs.tasks * 20, 100)} className="h-1 bg-slate-100 dark:bg-secondary" />
                                                </div>
                                                <div className="flex gap-1">
                                                    <Badge variant="outline" className="h-4 px-1 text-[9px] border-blue-200 text-blue-600 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/50 font-bold">{rep.KPIs.leads}L</Badge>
                                                    <Badge variant="outline" className="h-4 px-1 text-[9px] border-emerald-200 text-emerald-600 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/50 font-bold">{rep.KPIs.tasks}T</Badge>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right pr-5">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSelectedRep(rep)}
                                                className="rounded-lg h-7 px-2.5 font-bold text-[9px] uppercase tracking-wider border-slate-200 dark:border-border hover:border-blue-300 hover:text-blue-600 transition-colors"
                                            >
                                                View Report <HugeiconsIcon icon={ChevronRightIcon} size={10} className="ml-0.5 text-slate-400" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {selectedRep && (
                <RepDetailDialog rep={selectedRep} onClose={() => setSelectedRep(null)} />
            )}
        </div>
    )
}
