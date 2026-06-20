'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users, DollarSign, Target, Briefcase, Activity as ActivityIcon, CheckSquare, Plus, ArrowUpRight, Clock, MapPin } from "lucide-react"
import { Area, AreaChart, Pie, PieChart, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import { motion } from "framer-motion"
import ActivityFeed from "./ActivityFeed"
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { formatCurrency } from '@/lib/formatters'
import Link from "next/link"
import { format, isToday, isTomorrow, isPast } from "date-fns"

// Brand Colors for Recharts
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b']

// Generates the last `count` month labels (current month + prior months),
// e.g. with count=6 in June -> [Jan, Feb, Mar, Apr, May, Jun]. No fabricated data.
function lastMonthLabels(count: number): string[] {
    const now = new Date()
    const labels: string[] = []
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        labels.push(d.toLocaleString('default', { month: 'short' }))
    }
    return labels
}

export default function DashboardClient({
    user,
    deals = [],
    leads = [],
    activities = [],
    analytics,
    upcomingTasks = [],
    teamStatus = []
}: {
    user: any,
    deals: any[],
    leads: any[],
    activities?: any[],
    analytics?: any,
    upcomingTasks?: any[],
    teamStatus?: any[]
}) {
    const { currency, permissions, isCoreAdmin } = useWorkspace()

    // --- Data Formatting & Fallbacks ---

    // 1. Revenue Over Time (Area Chart)
    const monthlyDataMap = deals.reduce((acc, deal) => {
        const date = new Date(deal.created_at)
        const month = date.toLocaleString('default', { month: 'short' })
        if (!acc[month]) acc[month] = 0
        acc[month] += Number(deal.value) || 0
        return acc
    }, {} as Record<string, number>)

    const revenueChartData = Object.keys(monthlyDataMap).length > 0
        ? Object.keys(monthlyDataMap).map(month => ({ name: month, total: monthlyDataMap[month] }))
        : lastMonthLabels(6).map(month => ({ name: month, total: 0 }))

    // 2. Open Pipeline (Funnel mapping)
    const pipelineData = analytics?.pipelineData || []
    const openPipelineValue = deals
        .filter(d => !['won', 'lost'].includes(String(d.status || '').toLowerCase()))
        .reduce((sum, d) => sum + (Number(d.value) || 0), 0)

    // 3. Lead Sources (Donut Chart) - real data only; empty when DB has none.
    const leadSources: { name: string; value: number }[] = analytics?.leadsBySource || []

    // 4. Tasks Setup
    const pendingTasks = upcomingTasks.filter(t => t.status !== 'completed')
    const overdueTasksCount = analytics?.operationalPulse?.overdue || 0
    const topTasks = pendingTasks.slice(0, 5)

    // Helper: Dynamic greeting
    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const firstName = user?.full_name?.split(' ')[0] || 'User'

    return (
        <div className="flex-1 space-y-6 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header & Quick Actions */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-black tracking-tight text-slate-900 dark:text-foreground">
                        {greeting}, {firstName}.
                    </h2>
                    <p className="text-slate-500 dark:text-muted-foreground mt-1">
                        Here's what's happening with your pipeline today, {format(new Date(), 'MMMM do')}.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {permissions.leads?.create && (
                        <Link href="/leads?new=true" className="flex items-center gap-2 bg-white dark:bg-card border border-gray-200 dark:border-border text-slate-700 dark:text-foreground hover:bg-gray-50 dark:hover:bg-muted px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm">
                            <Plus className="w-4 h-4" />
                            Add Lead
                        </Link>
                    )}
                    {permissions.deals?.create && (
                        <Link href="/deals?new=true" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-blue-500/20">
                            <Plus className="w-4 h-4" />
                            New Deal
                        </Link>
                    )}
                </div>
            </div>

            {/* KPI ROW - 6 Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {[
                    {
                        title: "Total Revenue",
                        value: formatCurrency(analytics?.financials?.totalRevenue || 0, currency),
                        subtitle: "Won Deals (30d)",
                        icon: DollarSign,
                        color: "from-emerald-400 to-green-600",
                        bg: "bg-emerald-50 dark:bg-emerald-500/10",
                        textColor: "text-emerald-700 dark:text-emerald-400",
                        trendIcon: ArrowUpRight,
                        delay: 0.1
                    },
                    {
                        title: "Win Rate",
                        value: `${analytics?.financials?.winRate || 0}%`,
                        subtitle: "Closing efficiency",
                        icon: Target,
                        color: "from-blue-400 to-indigo-600",
                        bg: "bg-blue-50 dark:bg-blue-500/10",
                        textColor: "text-blue-700 dark:text-blue-400",
                        delay: 0.2
                    },
                    {
                        title: "Active Leads",
                        value: leads.length,
                        subtitle: analytics?.financials?.newLeadsCount > 0 ? (
                            <><span className="text-purple-600 dark:text-purple-400 font-bold">+{analytics.financials.newLeadsCount} new</span> Total in system</>
                        ) : "Total in system",
                        icon: Users,
                        color: "from-purple-400 to-fuchsia-600",
                        bg: "bg-purple-50 dark:bg-purple-500/10",
                        textColor: "text-purple-700 dark:text-purple-400",
                        delay: 0.3
                    },
                    {
                        title: "Open Pipeline",
                        value: formatCurrency(openPipelineValue, currency),
                        subtitle: "Potential value",
                        icon: Briefcase,
                        color: "from-sky-400 to-blue-500",
                        bg: "bg-sky-50 dark:bg-sky-500/10",
                        textColor: "text-sky-700 dark:text-sky-400",
                        glow: true,
                        delay: 0.4
                    },
                    {
                        title: "Tasks Pending",
                        value: pendingTasks.length,
                        subtitle: overdueTasksCount > 0 ? (
                            <span className="text-red-600 dark:text-red-400 font-bold">{overdueTasksCount} overdue</span>
                        ) : "No overdue tasks",
                        icon: CheckSquare,
                        color: overdueTasksCount > 0 ? "from-red-400 to-rose-600" : "from-orange-400 to-amber-600",
                        bg: overdueTasksCount > 0 ? "bg-red-50 dark:bg-red-500/10" : "bg-orange-50 dark:bg-orange-500/10",
                        textColor: overdueTasksCount > 0 ? "text-red-700 dark:text-red-400" : "text-orange-700 dark:text-orange-400",
                        delay: 0.5
                    },
                    {
                        title: "Avg Deal Size",
                        value: formatCurrency(analytics?.financials?.avgDealSize || 0, currency),
                        subtitle: "Based on won deals",
                        icon: ActivityIcon,
                        color: "from-slate-400 to-gray-600",
                        bg: "bg-slate-50 dark:bg-slate-500/10",
                        textColor: "text-slate-700 dark:text-slate-400",
                        delay: 0.6
                    }
                ].map((stat, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: stat.delay, duration: 0.4, ease: "easeOut" }}
                    >
                        <Card className={`relative overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 border-gray-200/50 dark:border-white/10 bg-white/60 dark:bg-card/40 backdrop-blur-xl ${stat.glow ? 'ring-1 ring-sky-500/20 shadow-[0_0_15px_rgba(14,165,233,0.1)]' : ''}`}>
                            {/* Decorative Background Gradient Blob */}
                            <div className={`absolute -right-6 -top-6 w-24 h-24 bg-gradient-to-br ${stat.color} opacity-[0.08] dark:opacity-[0.15] blur-2xl rounded-full pointer-events-none`} />

                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                                <CardTitle className="text-sm font-semibold text-slate-600 dark:text-slate-300">{stat.title}</CardTitle>
                                <div className={`p-2 rounded-xl bg-gradient-to-br ${stat.color} shadow-sm`}>
                                    <stat.icon className="h-4 w-4 text-white" />
                                </div>
                            </CardHeader>
                            <CardContent className="relative z-10">
                                <div className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white">
                                    {stat.value}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1.5 flex items-center gap-1">
                                    {stat.trendIcon && <stat.trendIcon className={`w-3.5 h-3.5 ${stat.textColor}`} />}
                                    {stat.subtitle}
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>
                ))}
            </div>

            {/* MAIN CHARTS ROW */}
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
                {/* Revenue Area Chart */}
                <Card className="col-span-full lg:col-span-4 shadow-sm border-gray-200/50 dark:border-white/10 bg-white/60 dark:bg-card/40 backdrop-blur-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 dark:bg-blue-500/10 blur-3xl rounded-full pointer-events-none -mr-32 -mt-32" />
                    <CardHeader className="relative z-10 pb-0">
                        <CardTitle className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            Revenue Forecast
                            <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                        </CardTitle>
                        <CardDescription className="text-slate-500 dark:text-slate-400 font-medium">Pipeline values aggregated over the last 6 months.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-0 pb-4 relative z-10 mt-4">
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={revenueChartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4} />
                                            <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                                        </linearGradient>
                                        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                            <feGaussianBlur stdDeviation="4" result="blur" />
                                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                        </filter>
                                    </defs>
                                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} className="dark:stroke-slate-800" />
                                    <XAxis
                                        dataKey="name"
                                        stroke="#64748b"
                                        fontSize={12}
                                        fontWeight={500}
                                        tickLine={false}
                                        axisLine={false}
                                        dy={15}
                                    />
                                    <YAxis
                                        stroke="#64748b"
                                        fontSize={12}
                                        fontWeight={500}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => formatCurrency(value, currency).replace(/\.00$/, '')}
                                        dx={-15}
                                    />
                                    <Tooltip
                                        cursor={{ stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '4 4' }}
                                        contentStyle={{ borderRadius: '16px', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)', backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(10px)' }}
                                        labelStyle={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}
                                        itemStyle={{ fontWeight: 600, color: '#3b82f6' }}
                                        formatter={((value: number) => [formatCurrency(value, currency), 'Pipeline Value']) as any}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="total"
                                        stroke="#4f46e5"
                                        strokeWidth={4}
                                        fillOpacity={1}
                                        fill="url(#colorTotal)"
                                        activeDot={{ r: 6, strokeWidth: 3, fill: '#ffffff', stroke: '#4f46e5', filter: 'url(#glow)' }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Pipeline Funnel */}
                <Card className="col-span-full md:col-span-1 lg:col-span-3 shadow-sm border-gray-200/50 dark:border-white/10 bg-white/60 dark:bg-card/40 backdrop-blur-xl relative overflow-hidden">
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/5 dark:bg-purple-500/10 blur-3xl rounded-full pointer-events-none -ml-24 -mb-24" />
                    <CardHeader className="relative z-10 pb-0">
                        <CardTitle className="text-lg font-bold text-slate-800 dark:text-slate-100">Pipeline Health</CardTitle>
                        <CardDescription className="text-slate-500 dark:text-slate-400 font-medium">Deal progression across stages.</CardDescription>
                    </CardHeader>
                    <CardContent className="relative z-10 mt-4">
                        <div className="space-y-4 pt-2">
                            {pipelineData.map((stage: any, i: number) => {
                                // Calculate width percentage based on max value to create a funnel effect
                                const maxVal = Math.max(...pipelineData.map((d: any) => d.value), 1)
                                const percentage = Math.max((stage.value / maxVal) * 100, 5) // At least 5% width so it's visible

                                return (
                                    <div key={stage.name} className="flex items-center gap-4 group">
                                        <div className="w-24 text-sm font-semibold text-slate-600 dark:text-slate-300 truncate group-hover:text-slate-900 dark:group-hover:text-white transition-colors" title={stage.name}>
                                            {stage.name}
                                        </div>
                                        <div className="flex-1 h-10 bg-slate-100/50 dark:bg-secondary/30 rounded-2xl overflow-hidden relative shadow-inner border border-white/20 dark:border-white/5">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${percentage}%` }}
                                                transition={{ duration: 1, delay: i * 0.1, ease: "easeOut" }}
                                                className="absolute top-0 left-0 h-full rounded-2xl transition-colors"
                                                style={{
                                                    background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}dd, ${COLORS[i % COLORS.length]})`,
                                                    opacity: stage.value === 0 ? 0.3 : 1,
                                                    boxShadow: stage.value > 0 ? `inset -2px 0 10px rgba(0,0,0,0.1), 0 0 10px ${COLORS[i % COLORS.length]}40` : 'none'
                                                }}
                                            />
                                            <span className="absolute inset-0 flex items-center px-4 text-sm font-bold drop-shadow-md font-mono text-white z-10 mix-blend-overlay">
                                                {stage.value}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* BOTTOM ROW */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">

                {/* 1. Lead Sources Donut */}
                <Card className="shadow-sm border-gray-200/50 dark:border-white/10 bg-white/60 dark:bg-card/40 backdrop-blur-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-32 h-32 bg-amber-500/5 dark:bg-amber-500/10 blur-3xl rounded-full pointer-events-none -ml-16 -mt-16" />
                    <CardHeader className="pb-2 relative z-10">
                        <CardTitle className="text-lg font-bold text-slate-800 dark:text-slate-100">Lead Sources</CardTitle>
                        <CardDescription className="text-slate-500 font-medium">Where your volume is generating.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center items-center relative z-10">
                        <div className="h-[220px] w-full">
                            {leadSources.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={leadSources}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {leadSources.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} style={{ filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.1))' }} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ borderRadius: '12px', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(10px)' }}
                                            itemStyle={{ fontWeight: 600 }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 dark:text-slate-400">
                                    <Users className="w-8 h-8 mb-3 opacity-40" />
                                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No lead source data yet</p>
                                    <p className="text-xs mt-1">Sources appear once leads are captured.</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Upcoming Tasks */}
                <Card className="shadow-sm border-gray-200/50 dark:border-white/10 bg-white/60 dark:bg-card/40 backdrop-blur-xl flex flex-col h-[330px] relative overflow-hidden">
                    <div className="absolute -bottom-16 -right-16 w-40 h-40 bg-orange-500/10 dark:bg-orange-500/20 blur-3xl rounded-full pointer-events-none" />
                    <CardHeader className="pb-2 shrink-0 relative z-10">
                        <CardTitle className="text-lg font-bold text-slate-800 dark:text-slate-100">Upcoming Tasks</CardTitle>
                        <CardDescription className="text-slate-500 font-medium">Your next 5 action items.</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-y-auto pr-2 scrollbar-thin relative z-10 flex-1">
                        {topTasks.length > 0 ? (
                            <div className="space-y-4">
                                {topTasks.map(task => {
                                    const date = task.due_date ? new Date(task.due_date) : null
                                    const isLate = date && isPast(date) && !isToday(date)
                                    const dateLabel = !date ? 'No date' : isToday(date) ? 'Today' : isTomorrow(date) ? 'Tomorrow' : format(date, 'MMM d')

                                    return (
                                        <div key={task.id} className="flex gap-3 pb-4 border-b border-gray-100 dark:border-border/50 last:border-0 last:pb-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 p-2 -mx-2 rounded-lg transition-colors">
                                            <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 shadow-sm ${isLate ? 'bg-red-500 shadow-red-500/40' : 'bg-blue-500 shadow-blue-500/40'}`} />
                                            <div className="flex-1 space-y-1 min-w-0">
                                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={task.title}>
                                                    {task.title}
                                                </p>
                                                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-medium">
                                                    <span className={`flex items-center gap-1 ${isLate ? 'text-red-600 dark:text-red-400 font-bold' : ''}`}>
                                                        <Clock className="w-3 h-3" />
                                                        {dateLabel}
                                                    </span>
                                                    {task.users && (
                                                        <span className="flex items-center gap-1">
                                                            <UserIcon className="w-3 h-3" />
                                                            {task.users.full_name?.split(' ')[0]}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                                <motion.div
                                    animate={{ y: [0, -10, 0] }}
                                    transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                                >
                                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4 mx-auto rotate-12 shadow-sm border border-white dark:border-slate-700">
                                        <CheckSquare className="w-8 h-8 text-green-500 drop-shadow-sm -rotate-12" />
                                    </div>
                                </motion.div>
                                <p className="font-semibold text-slate-700 dark:text-slate-300">All caught up!</p>
                                <p className="text-xs mt-1">Take a breather, or generate new leads.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* 3. Activity Feed OR Team Status */}
                {isCoreAdmin && teamStatus.length > 0 ? (
                    <Card className="shadow-sm border-gray-200/50 dark:border-white/10 bg-white/60 dark:bg-card/40 backdrop-blur-xl flex flex-col h-[330px]">
                        <CardHeader className="pb-2 shrink-0 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-lg font-bold text-slate-800 dark:text-slate-100">Team Status</CardTitle>
                                <CardDescription className="text-slate-500 font-medium">Live availability & daily KPIs</CardDescription>
                            </div>
                            <Link href="/attendance" className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-800/50 px-3 py-1.5 rounded-full transition-colors">
                                View Full
                            </Link>
                        </CardHeader>
                        <CardContent className="overflow-y-auto pr-2 scrollbar-thin flex-1">
                            <div className="space-y-3">
                                {teamStatus.map(member => (
                                    <div key={member.id} className="flex items-center justify-between p-3 rounded-xl bg-white/50 dark:bg-secondary/20 shadow-sm border border-gray-100 dark:border-white/5 hover:border-blue-200 dark:hover:border-blue-900/50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-800 dark:from-blue-900/50 dark:to-indigo-900/50 dark:text-blue-200 rounded-full flex items-center justify-center font-bold text-sm ring-2 ring-white dark:ring-background shadow-inner">
                                                    {(member.name || '?').charAt(0)}
                                                </div>
                                                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-background shadow-sm ${member.status === 'Online' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-900 dark:text-foreground">{member.name}</p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 capitalize bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full inline-block mt-0.5">{String(member.role || '').replace('_', ' ')}</p>
                                            </div>
                                        </div>

                                        <div className="flex gap-4 text-center mr-1">
                                            <div>
                                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Leads</p>
                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{member.KPIs?.leads ?? 0}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Tasks</p>
                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{member.KPIs?.tasks ?? 0}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="h-[330px]">
                        <ActivityFeed activities={activities} title="Recent Activity" description="Latest movements across the team." />
                    </div>
                )}
            </div>
        </div>
    )
}

// Simple internal icon for tasks
function UserIcon(props: any) {
    return (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
    )
}
