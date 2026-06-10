'use client'

import { useState } from 'react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    AreaChart,
    Area
} from 'recharts'
import {
    Activity,
    Target,
    Zap,
    TrendingUp,
    Users,
    DollarSign,
    BrainCircuit,
    ArrowUpRight,
    ArrowDownRight,
    Calendar,
    Download
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from 'sonner'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

import { useRouter } from 'next/navigation'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { formatCurrency } from '@/lib/formatters'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

export default function AnalyticsClient({ data, currentDays = '30' }: { data: any, currentDays?: string }) {
    const { currency, userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const router = useRouter()
    const [isExporting, setIsExporting] = useState(false)

    if (!data) return (
        <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-slate-500">Failed to load analytics data.</p>
        </div>
    )

    const { financials, pipelineData, leadsBySource, operationalPulse, summary } = data

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground flex items-center gap-3">
                        <Activity className="h-8 w-8 text-blue-600 dark:text-blue-500" />
                        Analytics & Insights
                    </h1>
                    <p className="text-slate-500 dark:text-muted-foreground mt-2 font-medium">Comprehensive performance overview and AI-driven insights.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Select value={currentDays} onValueChange={(val) => {
                        router.push(`/analytics?days=${val}`)
                    }}>
                        <SelectTrigger className="w-[180px] bg-white dark:bg-card border-gray-200 dark:border-border rounded-xl">
                            <Calendar className="w-4 h-4 mr-2 text-slate-400" />
                            <SelectValue placeholder="Last 30 Days" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-secondary border-gray-200 dark:border-border">
                            <SelectItem value="7">Last 7 Days</SelectItem>
                            <SelectItem value="30">Last 30 Days</SelectItem>
                            <SelectItem value="90">Last 90 Days</SelectItem>
                            <SelectItem value="365">Last Year</SelectItem>
                        </SelectContent>
                    </Select>
                    {isCoreAdmin && (
                        <Button variant="outline" className="rounded-xl border-gray-200 dark:border-border" onClick={() => {
                            toast.success("Preparing export...")
                        }}>
                            <Download className="w-4 h-4 mr-2" /> Export
                        </Button>
                    )}
                </div>
            </div>

            {/* AI Summary Banner */}
            <div className="bg-gradient-to-r from-blue-600/10 to-indigo-600/10 dark:from-blue-900/40 dark:to-indigo-900/40 border border-blue-200 dark:border-blue-800/50 rounded-2xl p-6 relative overflow-hidden shadow-sm backdrop-blur-sm">
                <div className="absolute top-0 right-0 p-6 opacity-10 dark:opacity-20 translate-x-10 -translate-y-10">
                    <BrainCircuit className="w-48 h-48 text-blue-600 dark:text-foreground" />
                </div>
                <div className="flex items-start gap-4 relative z-10">
                    <div className="p-3 bg-blue-600 dark:bg-blue-500 text-white rounded-xl shrink-0 shadow-lg shadow-blue-500/20">
                        <BrainCircuit className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-blue-100 mb-1">Magnivo AI Performance Brief</h3>
                        <p className="text-slate-700 dark:text-blue-100/80 leading-relaxed max-w-4xl text-sm font-medium italic">
                            {summary.isStrong
                                ? "Pipeline health is exceptionally strong. Your win rate is above the 20% benchmark."
                                : "There is room for improvement in your conversion funnel."}
                            {" "}You have {financials.newLeadsCount} new leads this month.
                            {summary.bottlenecks > 0
                                ? ` Focus on moving the ${summary.bottlenecks} bottlenecked deals in 'Proposal' stage.`
                                : " Your pipeline distribution looks balanced."}
                            {" "}The current average deal size is {formatCurrency(financials.avgDealSize, currency)}.
                        </p>
                    </div>
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm transition-all hover:shadow-md hover:border-blue-500/30 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl group-hover:scale-110 transition-transform">
                                <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                            </div>
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-0 flex gap-1">
                                <TrendingUp className="w-3 h-3" /> +12.5%
                            </Badge>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-500 dark:text-muted-foreground">Total Revenue</p>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-foreground">{formatCurrency(financials.totalRevenue, currency)}</h2>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm transition-all hover:shadow-md hover:border-amber-500/30 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2.5 bg-amber-50 dark:bg-amber-500/10 rounded-xl group-hover:scale-110 transition-transform">
                                <Zap className="w-5 h-5 text-amber-500" />
                            </div>
                            <span className="text-xs font-bold text-slate-400">vs 18% avg</span>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-500 dark:text-muted-foreground">Conversion Rate</p>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-foreground">{financials.winRate}%</h2>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm transition-all hover:shadow-md hover:border-blue-500/30 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2.5 bg-blue-50 dark:bg-blue-500/10 rounded-xl group-hover:scale-110 transition-transform">
                                <Target className="w-5 h-5 text-blue-600 dark:text-blue-500" />
                            </div>
                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-0 flex gap-1">
                                <TrendingUp className="w-3 h-3" /> +5%
                            </Badge>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-500 dark:text-muted-foreground">Avg. Deal Size</p>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-foreground">{formatCurrency(financials.avgDealSize, currency)}</h2>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl shadow-sm transition-all hover:shadow-md hover:border-purple-500/30 overflow-hidden group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2.5 bg-purple-50 dark:bg-purple-500/10 rounded-xl group-hover:scale-110 transition-transform">
                                <Users className="w-5 h-5 text-purple-600 dark:text-purple-500" />
                            </div>
                            <span className="text-xs font-bold text-purple-600 dark:text-purple-400">Growing Fast</span>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-500 dark:text-muted-foreground">New Leads (30d)</p>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-foreground">{financials.newLeadsCount}</h2>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Area */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold">Pipeline Distribution</CardTitle>
                        <CardDescription>Deals spread across the sales funnel.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={pipelineData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-800" />
                                    <XAxis
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                        dy={10}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#f1f5f9', opacity: 0.4 }}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Bar
                                        dataKey="value"
                                        fill="#3b82f6"
                                        radius={[6, 6, 0, 0]}
                                        barSize={40}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-white dark:bg-background border-gray-200 dark:border-border rounded-2xl overflow-hidden shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold">Leads by Source</CardTitle>
                        <CardDescription>Performance of marketing channels.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center p-0 pb-6">
                        <div className="h-[300px] w-full lg:w-4/5">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={leadsBySource}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {leadsBySource.map((entry: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="pr-10 space-y-3">
                            {leadsBySource.map((s: any, i: number) => (
                                <div key={s.name} className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                    <span className="text-xs font-semibold text-slate-500 dark:text-muted-foreground capitalize">{s.name}: <span className="text-slate-900 dark:text-foreground">{s.value}</span></span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Operational Pulse */}
            <div className="mt-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-foreground mb-4 px-1">Operational Pulse</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-background border border-gray-200 dark:border-border rounded-2xl p-5 flex items-center justify-between shadow-sm transition-all hover:border-emerald-500/20">
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tasks Completed</p>
                            <h4 className="text-2xl font-bold text-slate-900 dark:text-foreground">{operationalPulse.completed}</h4>
                        </div>
                        <div className="h-10 w-10 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-emerald-600" />
                        </div>
                    </div>
                    <div className="bg-white dark:bg-background border border-gray-200 dark:border-border rounded-2xl p-5 flex items-center justify-between shadow-sm transition-all hover:border-red-500/20">
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Overdue Tasks</p>
                            <h4 className="text-2xl font-bold text-slate-900 dark:text-foreground">{operationalPulse.overdue}</h4>
                        </div>
                        <div className="h-10 w-10 bg-red-50 dark:bg-red-500/10 rounded-xl flex items-center justify-center">
                            <ArrowDownRight className="w-5 h-5 text-red-600" />
                        </div>
                    </div>
                    <div className="bg-white dark:bg-background border border-gray-200 dark:border-border rounded-2xl p-5 flex items-center justify-between shadow-sm transition-all hover:border-blue-500/20">
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Follow-ups Done</p>
                            <h4 className="text-2xl font-bold text-slate-900 dark:text-foreground">{operationalPulse.followups}</h4>
                        </div>
                        <div className="h-10 w-10 bg-blue-50 dark:bg-blue-500/10 rounded-xl flex items-center justify-center">
                            <Target className="w-5 h-5 text-blue-600" />
                        </div>
                    </div>
                    <div className="bg-white dark:bg-background border border-gray-200 dark:border-border rounded-2xl p-5 flex items-center justify-between shadow-sm transition-all hover:border-amber-500/20">
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Pending Action</p>
                            <h4 className="text-2xl font-bold text-slate-900 dark:text-foreground">{operationalPulse.pending}</h4>
                        </div>
                        <div className="h-10 w-10 bg-amber-50 dark:bg-amber-500/10 rounded-xl flex items-center justify-center">
                            <ArrowUpRight className="w-5 h-5 text-amber-500" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${className}`}>
            {children}
        </span>
    )
}

