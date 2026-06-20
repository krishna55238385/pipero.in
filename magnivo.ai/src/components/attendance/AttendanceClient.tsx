'use client'

import { useState, useEffect } from 'react'
import {
    Clock,
    Play,
    Square,
    CheckCircle2,
    History,
    Calendar,
    Zap,
    Target,
} from 'lucide-react'
import { format } from 'date-fns'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { checkIn, checkOut } from '@/app/actions/crm'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

export default function AttendanceClient({ status }: { status: { current: any, user: any, history: any[] } | null }) {
    const router = useRouter()
    const [currentTime, setCurrentTime] = useState<Date | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        setCurrentTime(new Date())
        const timer = setInterval(() => setCurrentTime(new Date()), 1000)
        return () => clearInterval(timer)
    }, [])

    const isCheckedIn = status?.current && !status.current.check_out_time
    const isCheckedOut = status?.current?.check_out_time

    async function handleCheckIn() {
        setLoading(true)

        // Try to get geolocation
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const location = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    executeCheckIn(location);
                },
                async (error) => {
                    console.warn("Geolocation denied or error:", error);
                    toast.warning("Location access denied. Checking in without location.");
                    executeCheckIn(); // Proceeds without location
                },
                { timeout: 10000 }
            );
        } else {
            executeCheckIn();
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

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Check In/Out Section */}
                <Card className="lg:col-span-1 bg-gradient-to-br from-slate-900 to-slate-950 border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Clock className="w-48 h-48 text-white" />
                    </div>
                    <CardHeader className="relative z-10 text-center pb-2">
                        <CardTitle className="text-slate-400 text-sm font-bold uppercase tracking-widest">Global Terminal Time</CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10 flex flex-col items-center p-8 pt-2">
                        <div className="text-6xl font-black text-white mb-2 font-mono tabular-nums tracking-tighter">
                            {currentTime ? format(currentTime, 'HH:mm:ss') : '--:--:--'}
                        </div>
                        <div className="text-blue-400 font-medium mb-10 flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            {currentTime ? format(currentTime, 'EEEE, MMMM do') : 'Loading...'}
                        </div>

                        {!isCheckedIn && !isCheckedOut && (
                            <Button
                                onClick={handleCheckIn}
                                disabled={loading}
                                className="w-full h-20 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xl font-bold shadow-xl shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-95 gap-3"
                            >
                                <Play className="w-6 h-6 fill-current" />
                                Start Shift
                            </Button>
                        )}

                        {isCheckedIn && (
                            <Button
                                onClick={handleCheckOut}
                                disabled={loading}
                                variant="destructive"
                                className="w-full h-20 bg-red-600 hover:bg-red-500 text-white rounded-2xl text-xl font-bold shadow-xl shadow-red-500/20 transition-all hover:scale-[1.02] active:scale-95 gap-3"
                            >
                                <Square className="w-6 h-6 fill-current" />
                                End Shift
                            </Button>
                        )}

                        {isCheckedOut && (
                            <div className="w-full space-y-3">
                                <div className="w-full h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center gap-3 text-emerald-400 font-bold text-lg">
                                    <CheckCircle2 className="w-5 h-5" />
                                    Shift Completed
                                </div>
                                <Button
                                    onClick={handleCheckIn}
                                    disabled={loading}
                                    className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-lg font-bold shadow-xl shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-95 gap-3"
                                >
                                    <Play className="w-5 h-5 fill-current" />
                                    Start New Shift
                                </Button>
                            </div>
                        )}

                        <div className="mt-8 flex gap-6 text-slate-400 text-xs font-bold uppercase tracking-wider">
                            <div className="flex flex-col items-center gap-1">
                                <span>Checked In</span>
                                <span className="text-slate-100 text-sm">{status?.current?.check_in_time ? format(new Date(status.current.check_in_time), 'HH:mm') : '--:--'}</span>
                            </div>
                            <div className="w-px h-8 bg-slate-800" />
                            <div className="flex flex-col items-center gap-1">
                                <span>Checked Out</span>
                                <span className="text-slate-100 text-sm">{status?.current?.check_out_time ? format(new Date(status.current.check_out_time), 'HH:mm') : '--:--'}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Performance Snapshot */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm">
                            <CardContent className="p-6">
                                <div className="p-2 w-fit bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-4">
                                    <Target className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                </div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Leads Today</p>
                                <h4 className="text-2xl font-bold text-slate-900 dark:text-foreground">0</h4>
                            </CardContent>
                        </Card>
                        <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm">
                            <CardContent className="p-6">
                                <div className="p-2 w-fit bg-emerald-50 dark:bg-emerald-900/20 rounded-lg mb-4">
                                    <Zap className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Tasks Done</p>
                                <h4 className="text-2xl font-bold text-slate-900 dark:text-foreground">0</h4>
                            </CardContent>
                        </Card>
                        <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm">
                            <CardContent className="p-6">
                                <div className="p-2 w-fit bg-purple-50 dark:bg-purple-900/20 rounded-lg mb-4">
                                    <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                </div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Hours Logged</p>
                                <h4 className="text-2xl font-bold text-slate-900 dark:text-foreground">--h</h4>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm overflow-hidden">
                        <CardHeader className="border-b border-gray-100 dark:border-border/50">
                            <div className="flex items-center gap-3">
                                <History className="w-5 h-5 text-slate-400" />
                                <CardTitle className="text-lg font-bold">Recent Activity Logs</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                {status?.history && status.history.length > 0 ? status.history.map((log: { id: string, check_in_time: string, check_out_time: string | null, location?: { lat: number, lng: number } }) => (
                                    <div key={log.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-secondary flex items-center justify-center text-slate-500 text-xs font-bold">
                                                {format(new Date(log.check_in_time), 'dd')}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-900 dark:text-foreground">Shift - {format(new Date(log.check_in_time), 'MMM d, yyyy')}</p>
                                                <div className="text-xs text-slate-500 dark:text-muted-foreground flex items-center gap-2">
                                                    <span>{format(new Date(log.check_in_time), 'HH:mm')} - {log.check_out_time ? format(new Date(log.check_out_time), 'HH:mm') : 'Active'}</span>
                                                    {log.location && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="flex items-center gap-1 text-blue-500 font-medium" title={`Lat: ${log.location.lat}, Lng: ${log.location.lng}`}>
                                                                <Target className="w-3 h-3" /> Location Captured
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${log.check_out_time ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'}`}>
                                            {log.check_out_time ? 'Completed' : 'Live'}
                                        </div>
                                    </div>
                                )) : (
                                    <div className="p-12 text-center">
                                        <p className="text-slate-400 font-medium italic">No attendance history found.</p>
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

