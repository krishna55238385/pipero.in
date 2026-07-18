'use client'

import { useState, useEffect } from 'react'
import { format, differenceInMinutes } from 'date-fns'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { checkIn, checkOut } from '@/app/actions/crm'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { HugeiconsIcon } from '@hugeicons/react'
import {
    Clock01Icon,
    PlayIcon,
    CircleCheckIcon,
    HistoryIcon,
    Calendar01Icon,
    ZapIcon,
    Target01Icon,
    Timer01Icon,
    Coffee01Icon,
    PauseIcon,
    Logout01Icon,
    Login01Icon,
    MapPinIcon,
    File01Icon,
    AlertCircleIcon,
} from '@hugeicons/core-free-icons'

export default function AttendanceClient({ status }: { status: { current: any, user: any, history: any[] } | null }) {
    const router = useRouter()
    const [currentTime, setCurrentTime] = useState<Date | null>(null)
    const [loading, setLoading] = useState(false)
    const [manualStatus, setManualStatus] = useState<'available' | 'on_break' | 'in_meeting' | null>(null)

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000)
        return () => clearInterval(timer)
    }, [])

    const isCheckedIn = status?.current && !status.current.check_out_time
    const isCheckedOut = status?.current?.check_out_time

    const workStatus: 'available' | 'on_break' | 'in_meeting' | 'offline' = isCheckedIn ? (manualStatus || 'available') : 'offline'

    const checkInTime = status?.current?.check_in_time ? new Date(status.current.check_in_time) : null
    const elapsedMinutes = (checkInTime && currentTime) ? differenceInMinutes(currentTime, checkInTime) : 0
    const elapsedH = Math.floor(elapsedMinutes / 60)
    const elapsedM = elapsedMinutes % 60
    const elapsedHours = `${elapsedH}h ${elapsedM}m`

    const expectedCheckout = checkInTime ? new Date(checkInTime.getTime() + 8 * 60 * 60 * 1000) : null
    const remainingMinutes = expectedCheckout && currentTime ? Math.max(0, differenceInMinutes(expectedCheckout, currentTime)) : 480
    const remainingH = Math.floor(remainingMinutes / 60)
    const remainingM = remainingMinutes % 60
    const remainingHours = `${remainingH}h ${remainingM}m`

    const progressPercent = Math.min(100, Math.round((elapsedMinutes / 480) * 100))

    const statusConfig = {
        available: { label: 'Available', color: 'bg-emerald-500', textColor: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-500/10', borderColor: 'border-emerald-200 dark:border-emerald-500/20' },
        on_break: { label: 'On Break', color: 'bg-amber-500', textColor: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-500/10', borderColor: 'border-amber-200 dark:border-amber-500/20' },
        in_meeting: { label: 'In Meeting', color: 'bg-blue-500', textColor: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-500/10', borderColor: 'border-blue-200 dark:border-blue-500/20' },
        offline: { label: 'Offline', color: 'bg-slate-400', textColor: 'text-slate-500', bgColor: 'bg-slate-50 dark:bg-slate-500/10', borderColor: 'border-slate-200 dark:border-slate-500/20' },
    }

    async function handleCheckIn() {
        setLoading(true)
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const location = { lat: position.coords.latitude, lng: position.coords.longitude }
                    executeCheckIn(location)
                },
                async () => {
                    toast.warning("Location access denied. Checking in without location.")
                    executeCheckIn()
                },
                { timeout: 10000 }
            )
        } else {
            executeCheckIn()
        }
    }

    async function executeCheckIn(location?: { lat: number, lng: number }) {
        const res = await checkIn(location)
        if (res.error) toast.error(res.error)
        else {
            toast.success("Checked in successfully!")
            router.refresh()
        }
        setLoading(false)
    }

    async function handleCheckOut() {
        setLoading(true)
        const res = await checkOut()
        if (res.error) toast.error(res.error)
        else {
            toast.success("Checked out successfully!")
            router.refresh()
        }
        setLoading(false)
    }

    const st = statusConfig[workStatus]

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Clock & Shift Controls */}
                <Card className="lg:col-span-1 bg-gradient-to-br from-slate-900 to-slate-950 border-slate-800 rounded-2xl overflow-hidden shadow-lg relative group">
                    <div className="absolute top-0 right-0 p-6 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity">
                        <HugeiconsIcon icon={Clock01Icon} size={160} className="text-white" />
                    </div>
                    <CardHeader className="relative z-10 text-center pb-1">
                        <CardTitle className="text-slate-400 text-[11px] font-bold uppercase tracking-widest">Global Terminal Time</CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10 flex flex-col items-center p-6 pt-2">
                        <div className="text-5xl font-black text-white mb-1 font-mono tabular-nums tracking-tighter">
                            {currentTime ? format(currentTime, 'HH:mm:ss') : '--:--:--'}
                        </div>
                        <div className="text-blue-400 text-xs font-medium mb-6 flex items-center gap-1.5">
                            <HugeiconsIcon icon={Calendar01Icon} size={14} className="text-blue-400" />
                            {currentTime ? format(currentTime, 'EEEE, MMMM do') : 'Loading...'}
                        </div>

                        {/* Work Status Indicator */}
                        {isCheckedIn && (
                            <div className={`w-full mb-5 px-3 py-2 rounded-xl border ${st.bgColor} ${st.borderColor} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${st.color} ${workStatus === 'available' ? 'animate-pulse' : ''}`} />
                                    <span className={`text-xs font-bold ${st.textColor}`}>{st.label}</span>
                                </div>
                                <div className="flex gap-1">
                                    {(['available', 'on_break', 'in_meeting'] as const).map(s => (
                                        <button
                                            key={s}
                                            onClick={() => setManualStatus(s === workStatus ? null : s)}
                                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${workStatus === s ? `${statusConfig[s].bgColor} ${statusConfig[s].textColor}` : 'text-slate-600 hover:text-slate-400'}`}
                                            title={statusConfig[s].label}
                                        >
                                            <HugeiconsIcon
                                                icon={s === 'available' ? PlayIcon : s === 'on_break' ? Coffee01Icon : PauseIcon}
                                                size={12}
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        {!isCheckedIn && !isCheckedOut && (
                            <Button
                                onClick={handleCheckIn}
                                disabled={loading}
                                className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-lg font-bold shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.01] active:scale-[0.98] gap-2"
                            >
                                <HugeiconsIcon icon={Login01Icon} size={20} className="text-white" />
                                Start Shift
                            </Button>
                        )}

                        {isCheckedIn && (
                            <Button
                                onClick={handleCheckOut}
                                disabled={loading}
                                variant="destructive"
                                className="w-full h-14 bg-red-600 hover:bg-red-500 text-white rounded-xl text-base font-bold shadow-lg shadow-red-500/20 transition-all hover:scale-[1.01] active:scale-[0.98] gap-2"
                            >
                                <HugeiconsIcon icon={Logout01Icon} size={18} className="text-white" />
                                End Shift
                            </Button>
                        )}

                        {isCheckedOut && (
                            <div className="w-full space-y-2">
                                <div className="w-full h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center gap-2 text-emerald-400 font-bold text-sm">
                                    <HugeiconsIcon icon={CircleCheckIcon} size={16} className="text-emerald-400" />
                                    Shift Completed
                                </div>
                                <Button
                                    onClick={handleCheckIn}
                                    disabled={loading}
                                    className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.01] active:scale-[0.98] gap-2"
                                >
                                    <HugeiconsIcon icon={PlayIcon} size={16} className="text-white" />
                                    Start New Shift
                                </Button>
                            </div>
                        )}

                        {/* Shift Details */}
                        {isCheckedIn && (
                            <div className="mt-5 w-full space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-white/5 rounded-xl p-3 text-center">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Checked In</p>
                                        <p className="text-sm font-bold text-white font-mono">{status?.current?.check_in_time ? format(new Date(status.current.check_in_time), 'HH:mm') : '--:--'}</p>
                                    </div>
                                    <div className="bg-white/5 rounded-xl p-3 text-center">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Expected Out</p>
                                        <p className="text-sm font-bold text-white font-mono">{expectedCheckout ? format(expectedCheckout, 'HH:mm') : '--:--'}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-white/5 rounded-xl p-3 text-center">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Worked</p>
                                        <p className="text-sm font-bold text-white">{elapsedHours}</p>
                                    </div>
                                    <div className="bg-white/5 rounded-xl p-3 text-center">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Remaining</p>
                                        <p className="text-sm font-bold text-blue-400">{remainingHours}</p>
                                    </div>
                                </div>
                                {/* Progress Bar */}
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                                        <span>Shift Progress</span>
                                        <span>{progressPercent}%</span>
                                    </div>
                                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-1000"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {!isCheckedIn && !isCheckedOut && (
                            <div className="mt-5 flex gap-4 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                <div className="flex flex-col items-center gap-1">
                                    <span>Checked In</span>
                                    <span className="text-slate-300 text-xs">--:--</span>
                                </div>
                                <div className="w-px h-6 bg-slate-800" />
                                <div className="flex flex-col items-center gap-1">
                                    <span>Checked Out</span>
                                    <span className="text-slate-300 text-xs">--:--</span>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Right Column */}
                <div className="lg:col-span-2 space-y-5">
                    {/* Productivity KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card className="rounded-xl">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                        <HugeiconsIcon icon={Timer01Icon} size={16} className="text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Working Hours</span>
                                </div>
                                <p className="text-xl font-black text-foreground font-mono">{isCheckedIn ? elapsedHours : '--h'}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">of 8h target</p>
                            </CardContent>
                        </Card>
                        <Card className="rounded-xl">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                                        <HugeiconsIcon icon={Coffee01Icon} size={16} className="text-amber-600 dark:text-amber-400" />
                                    </div>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Break Time</span>
                                </div>
                                <p className="text-xl font-black text-foreground font-mono">0m</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">No breaks taken</p>
                            </CardContent>
                        </Card>
                        <Card className="rounded-xl">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                                        <HugeiconsIcon icon={ZapIcon} size={16} className="text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tasks Done</span>
                                </div>
                                <p className="text-xl font-black text-foreground">0</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Today&apos;s completions</p>
                            </CardContent>
                        </Card>
                        <Card className="rounded-xl">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                                        <HugeiconsIcon icon={Target01Icon} size={16} className="text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Leads Today</span>
                                </div>
                                <p className="text-xl font-black text-foreground">0</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Captured this shift</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Quick Actions */}
                    {isCheckedIn && (
                        <Card className="rounded-xl">
                            <CardContent className="p-4">
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</p>
                                <div className="flex flex-wrap gap-2">
                                    <button className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors">
                                        <HugeiconsIcon icon={Coffee01Icon} size={14} className="text-amber-600 dark:text-amber-400" />
                                        Start Break
                                    </button>
                                    <button className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
                                        <HugeiconsIcon icon={PlayIcon} size={14} className="text-emerald-600 dark:text-emerald-400" />
                                        End Break
                                    </button>
                                    <button className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg text-xs font-bold text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors">
                                        <HugeiconsIcon icon={File01Icon} size={14} className="text-blue-600 dark:text-blue-400" />
                                        Request Leave
                                    </button>
                                    <button className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-500/10 border border-slate-200 dark:border-slate-500/20 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-500/20 transition-colors">
                                        <HugeiconsIcon icon={AlertCircleIcon} size={14} className="text-slate-500 dark:text-slate-400" />
                                        Regularize
                                    </button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Recent Activity */}
                    <Card className="rounded-xl overflow-hidden">
                        <CardHeader className="border-b border-border/30 py-3 px-5">
                            <div className="flex items-center gap-2">
                                <HugeiconsIcon icon={HistoryIcon} size={18} className="text-muted-foreground" />
                                <CardTitle className="text-sm font-bold">Recent Activity Logs</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-border/30">
                                {status?.history && status.history.length > 0 ? status.history.slice(0, 5).map((log: { id: string, check_in_time: string, check_out_time: string | null, location?: { lat: number, lng: number } }) => (
                                    <div key={log.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-[10px] font-bold">
                                                {format(new Date(log.check_in_time), 'dd')}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-foreground">Shift - {format(new Date(log.check_in_time), 'MMM d, yyyy')}</p>
                                                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                                                    <span>{format(new Date(log.check_in_time), 'HH:mm')} - {log.check_out_time ? format(new Date(log.check_out_time), 'HH:mm') : 'Active'}</span>
                                                    {log.location && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="flex items-center gap-0.5 text-blue-500 font-medium">
                                                                <HugeiconsIcon icon={MapPinIcon} size={10} className="text-blue-500" /> Location
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className={`px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-tighter ${log.check_out_time ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'}`}>
                                            {log.check_out_time ? 'Completed' : 'Live'}
                                        </div>
                                    </div>
                                )) : (
                                    <div className="px-5 py-10 text-center">
                                        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                                            <HugeiconsIcon icon={HistoryIcon} size={20} className="text-primary/40" />
                                        </div>
                                        <p className="text-sm font-bold text-foreground">No attendance history yet</p>
                                        <p className="text-[11px] text-muted-foreground mt-1">Start your first shift to begin tracking your work hours.</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
