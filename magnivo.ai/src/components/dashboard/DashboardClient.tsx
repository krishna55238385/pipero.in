'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users, DollarSign, Target, Briefcase, CheckSquare, Plus, Clock, AlertTriangle, TrendingUp } from "lucide-react"
import { Area, AreaChart, Pie, PieChart, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import { motion } from "framer-motion"
import ActivityFeed from "./ActivityFeed"
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { formatCurrency } from '@/lib/formatters'
import Link from "next/link"
import { format, isToday, isTomorrow, isPast, isThisWeek } from "date-fns"

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b']

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

    const pipelineData = analytics?.pipelineData || []
    const openPipelineValue = deals
        .filter(d => !['won', 'lost'].includes(String(d.status || '').toLowerCase()))
        .reduce((sum, d) => sum + (Number(d.value) || 0), 0)

    const leadSources: { name: string; value: number }[] = analytics?.leadsBySource || []

    const pendingTasks = upcomingTasks.filter(t => t.status !== 'completed')
    const overdueTasksCount = analytics?.operationalPulse?.overdue || 0
    const topTasks = pendingTasks.slice(0, 5)
    const dealsAwaitingAction = deals.filter(d => ['proposal', 'negotiation'].includes(String(d.status || '').toLowerCase())).length
    const todayTasksCount = pendingTasks.filter(t => t.due_date && isToday(new Date(t.due_date))).length
    const thisWeekTasksCount = pendingTasks.filter(t => t.due_date && isThisWeek(new Date(t.due_date), { weekStartsOn: 1 })).length

    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const firstName = user?.full_name?.split(' ')[0] || 'User'

    const insights: string[] = []
    if (overdueTasksCount > 0) insights.push(`${overdueTasksCount} overdue follow-up${overdueTasksCount > 1 ? 's' : ''}`)
    if (todayTasksCount > 0) insights.push(`${todayTasksCount} task${todayTasksCount > 1 ? 's' : ''} due today`)
    if (dealsAwaitingAction > 0) insights.push(`${dealsAwaitingAction} deal${dealsAwaitingAction > 1 ? 's' : ''} awaiting action`)
    if (analytics?.financials?.newLeadsCount > 0) insights.push(`${analytics.financials.newLeadsCount} new lead${analytics.financials.newLeadsCount > 1 ? 's' : ''} this week`)

    return (
        <div className="flex-1 space-y-5 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header & Quick Actions */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                        {greeting}, {firstName}.
                    </h2>
                    {insights.length > 0 ? (
                        <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                            {insights.map((insight, i) => {
                                const isOverdue = insight.includes('overdue')
                                return (
                                    <span key={i}>
                                        {i > 0 && <span className="mx-1.5 text-muted-foreground/50">·</span>}
                                        {isOverdue ? (
                                            <span className="text-red-600 dark:text-red-400 font-semibold">{insight}</span>
                                        ) : (
                                            <span>{insight}</span>
                                        )}
                                    </span>
                                )
                            })}
                        </p>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Pipeline looks clear for {format(new Date(), 'MMMM do')}. All caught up.
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {permissions.leads?.create && (
                        <Link href="/leads?new=true" className="flex items-center gap-2 bg-muted border border-border/50 text-foreground hover:bg-accent px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                            Add Lead
                        </Link>
                    )}
                    {permissions.deals?.create && (
                        <Link href="/deals?new=true" className="flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-xs">
                            <Plus className="w-3.5 h-3.5" />
                            New Deal
                        </Link>
                    )}
                </div>
            </div>

            {/* KPI ROW */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {[
                    {
                        title: "Total Revenue",
                        value: formatCurrency(analytics?.financials?.totalRevenue || 0, currency),
                        subtitle: "Won (30d)",
                        icon: DollarSign,
                        color: "from-emerald-400 to-green-600",
                        iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
                        iconColor: "text-emerald-600 dark:text-emerald-400",
                        delay: 0.05,
                        urgent: false,
                        insight: null as string | null,
                    },
                    {
                        title: "Win Rate",
                        value: `${analytics?.financials?.winRate || 0}%`,
                        subtitle: "Closing efficiency",
                        icon: Target,
                        color: "from-blue-400 to-indigo-600",
                        iconBg: "bg-blue-50 dark:bg-blue-500/10",
                        iconColor: "text-blue-600 dark:text-blue-400",
                        delay: 0.1,
                        urgent: false,
                        insight: analytics?.financials?.winRate >= 20 ? "Healthy" : analytics?.financials?.winRate > 0 ? "Needs improvement" : null,
                        insightColor: analytics?.financials?.winRate >= 20 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                    },
                    {
                        title: "Active Leads",
                        value: leads.length,
                        subtitle: analytics?.financials?.newLeadsCount > 0
                            ? `${analytics.financials.newLeadsCount} new this period`
                            : "Total in system",
                        icon: Users,
                        color: "from-purple-400 to-fuchsia-600",
                        iconBg: "bg-purple-50 dark:bg-purple-500/10",
                        iconColor: "text-purple-600 dark:text-purple-400",
                        delay: 0.15,
                        urgent: false,
                        insight: analytics?.financials?.newLeadsCount > 0 ? `+${analytics.financials.newLeadsCount}` : null,
                        insightColor: "text-purple-600 dark:text-purple-400",
                    },
                    {
                        title: "Open Pipeline",
                        value: formatCurrency(openPipelineValue, currency),
                        subtitle: `${dealsAwaitingAction} deal${dealsAwaitingAction !== 1 ? 's' : ''} in progress`,
                        icon: Briefcase,
                        color: "from-sky-400 to-blue-500",
                        iconBg: "bg-sky-50 dark:bg-sky-500/10",
                        iconColor: "text-sky-600 dark:text-sky-400",
                        delay: 0.2,
                        urgent: false,
                        insight: null,
                    },
                    {
                        title: "Tasks",
                        value: pendingTasks.length,
                        subtitle: overdueTasksCount > 0
                            ? `${overdueTasksCount} overdue`
                            : todayTasksCount > 0
                                ? `${todayTasksCount} due today`
                                : thisWeekTasksCount > 0
                                    ? `${thisWeekTasksCount} this week`
                                    : "All on track",
                        icon: overdueTasksCount > 0 ? AlertTriangle : CheckSquare,
                        color: overdueTasksCount > 0 ? "from-red-400 to-rose-600" : "from-orange-400 to-amber-600",
                        iconBg: overdueTasksCount > 0 ? "bg-red-50 dark:bg-red-500/10" : "bg-orange-50 dark:bg-orange-500/10",
                        iconColor: overdueTasksCount > 0 ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400",
                        delay: 0.25,
                        urgent: overdueTasksCount > 0,
                    },
                    {
                        title: "Avg Deal Size",
                        value: formatCurrency(analytics?.financials?.avgDealSize || 0, currency),
                        subtitle: "Based on won deals",
                        icon: TrendingUp,
                        color: "from-slate-400 to-gray-600",
                        iconBg: "bg-slate-50 dark:bg-slate-500/10",
                        iconColor: "text-slate-600 dark:text-slate-400",
                        delay: 0.3,
                        urgent: false,
                        insight: null,
                    }
                ].map((stat, i) => (
                        <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: stat.delay, duration: 0.3, ease: "easeOut" }}
                    >
                        <Card className={`relative overflow-hidden transition-all duration-200 ${
                            stat.urgent
                                ? 'border-red-200/70 dark:border-red-500/20'
                                : 'hover:shadow-sm'
                        }`}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 px-4 pt-3">
                                <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{stat.title}</CardTitle>
                                <div className={`p-1.5 rounded-md ${stat.iconBg}`}>
                                    <stat.icon className={`h-3.5 w-3.5 ${stat.iconColor}`} />
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 pb-3">
                                <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                                    {stat.value}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                    {stat.urgent && (
                                        <span className="flex h-1.5 w-1.5 relative">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                                        </span>
                                    )}
                                    <p className={`text-[11px] font-medium ${stat.urgent ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}`}>
                                        {stat.subtitle}
                                    </p>
                                    {(stat as any).insight && (
                                        <span className={`text-[10px] font-semibold ${(stat as any).insightColor} px-1.5 py-0.5 rounded`}>
                                            {(stat as any).insight}
                                        </span>
                                    )}
                                </div>
                            </CardContent>
                            {stat.urgent && (
                                <div className="absolute inset-0 bg-gradient-to-r from-red-500/[0.03] to-transparent dark:from-red-500/[0.06] pointer-events-none" />
                            )}
                        </Card>
                    </motion.div>
                ))}
            </div>

            {/* MAIN CHARTS ROW */}
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-7">
                {/* Revenue Area Chart */}
                <Card className="col-span-full lg:col-span-4 relative overflow-hidden">
                    <CardHeader className="pb-0 px-5 pt-4">
                        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                            Revenue Forecast
                            <span className="flex h-1.5 w-1.5 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                            </span>
                        </CardTitle>
                        <CardDescription className="text-muted-foreground text-xs">Pipeline values aggregated over the last 6 months.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-0 pb-3 mt-3 px-5">
                        <div className="h-[260px] w-full">
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
                                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                                    <XAxis
                                        dataKey="name"
                                        stroke="#64748b"
                                        fontSize={11}
                                        fontWeight={500}
                                        tickLine={false}
                                        axisLine={false}
                                        dy={12}
                                    />
                                    <YAxis
                                        stroke="#64748b"
                                        fontSize={11}
                                        fontWeight={500}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => formatCurrency(value, currency).replace(/\.00$/, '')}
                                        dx={-12}
                                    />
                                    <Tooltip
                                        cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                        contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)', backgroundColor: 'var(--card)', backdropFilter: 'blur(8px)', fontSize: '12px' }}
                                        labelStyle={{ fontWeight: 700, color: 'var(--foreground)', marginBottom: '2px' }}
                                        itemStyle={{ fontWeight: 600, color: 'var(--primary)' }}
                                        formatter={((value: number) => [formatCurrency(value, currency), 'Pipeline Value']) as any}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="total"
                                        stroke="#4f46e5"
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#colorTotal)"
                                        activeDot={{ r: 5, strokeWidth: 2, fill: '#ffffff', stroke: '#4f46e5', filter: 'url(#glow)' }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Pipeline Funnel */}
                <Card className="col-span-full md:col-span-1 lg:col-span-3 relative overflow-hidden">
                    <CardHeader className="pb-0 px-5 pt-4">
                        <CardTitle className="text-base font-semibold text-foreground">Pipeline Health</CardTitle>
                        <CardDescription className="text-muted-foreground text-xs">Deal progression across stages.</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-3 px-5 pb-4">
                        <div className="space-y-3 pt-1">
                            {pipelineData.map((stage: any, i: number) => {
                                const maxVal = Math.max(...pipelineData.map((d: any) => d.value), 1)
                                const percentage = Math.max((stage.value / maxVal) * 100, 5)
                                const isActive = stage.value > 0

                                return (
                                    <div key={stage.name} className="flex items-center gap-3 group">
                                        <div className="w-22 text-[11px] font-semibold text-muted-foreground truncate group-hover:text-foreground transition-colors" title={stage.name}>
                                            {stage.name}
                                        </div>
                                        <div className="flex-1 h-8 bg-muted/50 rounded-lg overflow-hidden relative">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${percentage}%` }}
                                                transition={{ duration: 0.8, delay: i * 0.08, ease: "easeOut" }}
                                                className="absolute top-0 left-0 h-full rounded-lg"
                                                style={{
                                                    background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}cc, ${COLORS[i % COLORS.length]})`,
                                                    opacity: isActive ? 1 : 0.25,
                                                }}
                                            />
                                            <span className="absolute inset-0 flex items-center px-3 text-[11px] font-bold font-mono text-white z-10 mix-blend-overlay">
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
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">

                {/* Lead Sources Donut */}
                <Card className="relative overflow-hidden">
                    <CardHeader className="pb-1 px-5 pt-4">
                        <CardTitle className="text-base font-semibold text-foreground">Lead Sources</CardTitle>
                        <CardDescription className="text-muted-foreground text-xs">Where your volume is generating.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center items-center px-5 pb-4">
                        <div className="h-[200px] w-full">
                            {leadSources.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={leadSources}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={55}
                                            outerRadius={75}
                                            paddingAngle={5}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {leadSources.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ borderRadius: '10px', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)', backgroundColor: 'var(--card)', backdropFilter: 'blur(8px)', fontSize: '12px' }}
                                            itemStyle={{ fontWeight: 600 }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                                    <Users className="w-7 h-7 mb-2 opacity-30" />
                                    <p className="text-xs font-semibold text-foreground/70">No lead source data yet</p>
                                    <p className="text-[11px] mt-0.5">Sources appear once leads are captured.</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Upcoming Tasks */}
                <Card className={`flex flex-col relative overflow-hidden ${
                    overdueTasksCount > 0
                        ? 'border-red-200/70 dark:border-red-500/20'
                        : ''
                }`}>
                    {overdueTasksCount > 0 && (
                        <div className="absolute inset-0 bg-gradient-to-br from-red-500/[0.03] to-transparent dark:from-red-500/[0.06] pointer-events-none" />
                    )}
                    <CardHeader className="pb-1 shrink-0 px-5 pt-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                                    Upcoming Tasks
                                    {overdueTasksCount > 0 && (
                                        <span className="flex h-1.5 w-1.5 relative">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                                        </span>
                                    )}
                                </CardTitle>
                                <CardDescription className="text-muted-foreground text-xs">
                                    {overdueTasksCount > 0
                                        ? `${overdueTasksCount} overdue, ${pendingTasks.length - overdueTasksCount} remaining`
                                        : "Your next 5 action items."
                                    }
                                </CardDescription>
                            </div>
                            {overdueTasksCount > 0 && (
                                <Link href="/tasks" className="text-[10px] font-bold text-red-600 hover:text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2.5 py-1 rounded-md transition-colors">
                                    View All
                                </Link>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="overflow-y-auto pr-2 flex-1 px-5 pb-4">
                        {topTasks.length > 0 ? (
                            <div className="space-y-1">
                                {topTasks.map(task => {
                                    const date = task.due_date ? new Date(task.due_date) : null
                                    const isLate = date && isPast(date) && !isToday(date)
                                    const dateLabel = !date ? 'No date' : isToday(date) ? 'Today' : isTomorrow(date) ? 'Tomorrow' : format(date, 'MMM d')

                                    return (
                                        <div key={task.id} className={`flex gap-2.5 py-2.5 border-b border-border/30 last:border-0 hover:bg-accent/50 px-2 -mx-2 rounded-lg transition-colors ${isLate ? 'bg-red-50/30 dark:bg-red-500/[0.04]' : ''}`}>
                                            <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${isLate ? 'bg-red-500' : 'bg-primary'}`} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-foreground truncate leading-tight" title={task.title}>
                                                    {task.title}
                                                </p>
                                                <div className="flex items-center gap-2.5 mt-0.5">
                                                    <span className={`flex items-center gap-1 text-[11px] font-medium ${isLate ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}`}>
                                                        <Clock className="w-3 h-3" />
                                                        {dateLabel}
                                                    </span>
                                                    {task.users && (
                                                        <span className="text-[11px] text-muted-foreground font-medium">
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
                            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                                <motion.div
                                    animate={{ y: [0, -6, 0] }}
                                    transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                                >
                                    <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center mb-3 mx-auto">
                                        <CheckSquare className="w-5 h-5 text-emerald-500" />
                                    </div>
                                </motion.div>
                                <p className="font-semibold text-sm text-foreground">All caught up!</p>
                                <p className="text-[11px] mt-0.5">Take a breather, or generate new leads.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Activity Feed OR Team Status */}
                {isCoreAdmin && teamStatus.length > 0 ? (
                    <Card className="flex flex-col">
                        <CardHeader className="pb-1 shrink-0 flex flex-row items-center justify-between px-5 pt-4">
                            <div>
                                <CardTitle className="text-base font-semibold text-foreground">Team Status</CardTitle>
                                <CardDescription className="text-muted-foreground text-xs">Live availability & daily KPIs</CardDescription>
                            </div>
                            <Link href="/attendance" className="text-[10px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-800/50 px-2.5 py-1 rounded-md transition-colors">
                                View Full
                            </Link>
                        </CardHeader>
                        <CardContent className="overflow-y-auto pr-2 flex-1 px-5 pb-4">
                            <div className="space-y-2">
                                {teamStatus.map(member => (
                                    <div key={member.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/30 hover:border-primary/20 transition-colors">
                                        <div className="flex items-center gap-2.5">
                                            <div className="relative">
                                                <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-800 dark:from-blue-900/50 dark:to-indigo-900/50 dark:text-blue-200 rounded-full flex items-center justify-center font-bold text-xs ring-1 ring-white dark:ring-background">
                                                    {(member.name || '?').charAt(0)}
                                                </div>
                                                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px] border-white dark:border-background ${member.status === 'Online' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                            </div>
                                            <div>
                                                <p className="text-xs font-semibold text-foreground leading-tight">{member.name}</p>
                                                <p className="text-[10px] text-muted-foreground capitalize">{String(member.role || '').replace('_', ' ')}</p>
                                            </div>
                                        </div>

                                        <div className="flex gap-3 text-center mr-1">
                                            <div>
                                                <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">Leads</p>
                                                <p className="text-xs font-semibold text-foreground">{member.KPIs?.leads ?? 0}</p>
                                            </div>
                                            <div>
                                                <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">Tasks</p>
                                                <p className="text-xs font-semibold text-foreground">{member.KPIs?.tasks ?? 0}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div>
                        <ActivityFeed activities={activities} title="Recent Activity" description="Latest movements across the team." />
                    </div>
                )}
            </div>
        </div>
    )
}
