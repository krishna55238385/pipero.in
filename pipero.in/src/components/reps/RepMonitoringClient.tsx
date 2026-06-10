'use client'

import { useState, useEffect } from 'react'
import {
    Users,
    Target,
    BarChart3,
    AlertCircle,
    Settings2,
    Trophy,
    TrendingUp,
    Briefcase,
    CheckCircle2,
    Loader2,
    Search,
    ChevronRight,
    ArrowUpRight,
    PhoneCall,
    Mail,
    Plus,
    X
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog"
import { getRepPerformanceData, setUserTarget } from '@/app/actions/crm'
import { toast } from 'sonner'
import Link from 'next/link'

export default function RepMonitoringClient({ initialData }: { initialData: any[] }) {
    const [reps, setReps] = useState<any[]>(initialData)
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [selectedRep, setSelectedRep] = useState<any>(null)
    const [targets, setTargets] = useState({ revenue: 0, leads: 0, tasks: 0 })

    const refreshData = async () => {
        setLoading(true)
        const data = await getRepPerformanceData()
        setReps(data)
        setLoading(false)
    }

    const filteredReps = reps.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.role.toLowerCase().includes(search.toLowerCase())
    )

    const handleSetTargets = async () => {
        try {
            await setUserTarget(selectedRep.id, targets)
            toast.success(`Targets updated for ${selectedRep.name}`)
            setSelectedRep(null)
            refreshData()
        } catch (error) {
            toast.error("Failed to update targets")
        }
    }

    const getPerformanceColor = (percent: number) => {
        if (percent >= 100) return 'text-emerald-500'
        if (percent >= 70) return 'text-blue-500'
        if (percent >= 40) return 'text-amber-500'
        return 'text-rose-500'
    }

    const getProgressColor = (percent: number) => {
        if (percent >= 100) return 'bg-emerald-500'
        if (percent >= 70) return 'bg-blue-500'
        if (percent >= 40) return 'bg-amber-500'
        return 'bg-rose-500'
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-foreground flex items-center gap-3">
                        <Users className="w-8 h-8 text-blue-600" /> Executive Rep Monitor
                    </h1>
                    <p className="text-slate-500 dark:text-muted-foreground font-medium tracking-tight">Real-time performance auditing and resource allocation.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                            placeholder="Find a rep..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 rounded-2xl border-slate-200 dark:border-border h-11 bg-white dark:bg-background font-medium"
                        />
                    </div>
                    <Button onClick={refreshData} disabled={loading} variant="outline" className="rounded-2xl border-slate-200 dark:border-border h-11 aspect-square p-0">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                    </Button>
                </div>
            </div>

            {/* Rep Cards Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-20">
                {filteredReps.map((rep) => (
                    <Card key={rep.id} className="relative overflow-hidden bg-white dark:bg-background border-0 shadow-sm ring-1 ring-slate-100 dark:ring-slate-800 rounded-[32px] hover:ring-blue-500/30 transition-all group">
                        {/* Status Accents */}
                        {rep.barriers.count > 0 && (
                            <div className="absolute top-6 right-6 flex items-center gap-2">
                                <Badge variant="destructive" className="rounded-full px-3 py-1 bg-rose-500/10 text-rose-500 border-rose-500/20 font-bold text-[10px] uppercase tracking-widest backdrop-blur-md">
                                    <AlertCircle className="w-3 h-3 mr-1" /> {rep.barriers.count} Barriers
                                </Badge>
                            </div>
                        )}

                        <CardContent className="p-8">
                            <div className="flex items-start gap-6">
                                {/* Avatar/Badge */}
                                <div className="w-20 h-20 rounded-[28px] bg-slate-50 dark:bg-card flex items-center justify-center border border-slate-100 dark:border-border relative shadow-inner overflow-hidden">
                                    <span className="text-3xl font-bold text-blue-600 dark:text-blue-500">{rep.name.charAt(0)}</span>
                                    {rep.performance.conversionRate > 20 && (
                                        <div className="absolute -bottom-1 -right-1 p-1 bg-emerald-500 rounded-lg shadow-lg">
                                            <Trophy className="w-3 h-3 text-white" />
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 space-y-4">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-2xl font-bold text-slate-900 dark:text-foreground tracking-tight">{rep.name}</h3>
                                            <Badge variant="outline" className="rounded-full text-[10px] font-bold uppercase tracking-tighter border-slate-200 dark:border-border">{rep.role}</Badge>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs font-bold text-slate-400">
                                            <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {rep.workload.activeDeals} Active Deals</span>
                                            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {rep.performance.taskCompletionRate.toFixed(0)}% Efficiency</span>
                                        </div>
                                    </div>

                                    {/* Performance Slices */}
                                    <div className="grid grid-cols-3 gap-4 pt-2">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Leads Allocated</p>
                                            <div className="flex items-end gap-1.5">
                                                <span className="text-xl font-bold text-slate-900 dark:text-foreground leading-none">{rep.leads.total}</span>
                                                <span className="text-[10px] font-bold text-emerald-500 mb-1">+{rep.leads.new} new</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Workload</p>
                                            <div className="flex items-end gap-1.5">
                                                <span className="text-xl font-bold text-slate-900 dark:text-foreground leading-none">{rep.workload.pendingTasks}</span>
                                                <span className="text-[10px] font-bold text-slate-500 mb-1">tasks</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Revenue (Won)</p>
                                            <div className="flex items-end gap-1.5">
                                                <span className="text-xl font-bold text-slate-900 dark:text-foreground leading-none">₹{rep.performance.revenue.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Targets Section */}
                            <div className="mt-8 pt-8 border-t border-slate-100 dark:border-border space-y-6">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                                        <Target className="w-3.5 h-3.5" /> Growth Targets
                                    </h4>
                                    <Dialog open={selectedRep?.id === rep.id} onOpenChange={(open) => {
                                        if (open) {
                                            setSelectedRep(rep)
                                            setTargets({
                                                revenue: rep.targets.revenue,
                                                leads: rep.targets.leads,
                                                tasks: rep.targets.tasks
                                            })
                                        } else setSelectedRep(null)
                                    }}>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="sm" className="h-8 px-3 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 font-bold text-[10px] uppercase tracking-widest transition-colors">
                                                <Settings2 className="w-3.5 h-3.5 mr-2" /> Set Targets
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-md bg-white dark:bg-background border-slate-100 dark:border-border rounded-[32px]">
                                            <DialogHeader>
                                                <DialogTitle className="text-2xl font-bold tracking-tight">Set Performance Targets</DialogTitle>
                                                <DialogDescription className="font-medium text-slate-500">Configure monthly goals for {rep.name}.</DialogDescription>
                                            </DialogHeader>
                                            <div className="space-y-6 py-6">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Revenue Target (₹)</label>
                                                    <Input
                                                        type="number"
                                                        value={targets.revenue}
                                                        onChange={(e) => setTargets({ ...targets, revenue: Number(e.target.value) })}
                                                        className="rounded-2xl border-slate-100 dark:border-border h-12 font-bold text-lg"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Leads Target</label>
                                                        <Input
                                                            type="number"
                                                            value={targets.leads}
                                                            onChange={(e) => setTargets({ ...targets, leads: Number(e.target.value) })}
                                                            className="rounded-2xl border-slate-100 dark:border-border h-12 font-bold"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tasks Target</label>
                                                        <Input
                                                            type="number"
                                                            value={targets.tasks}
                                                            onChange={(e) => setTargets({ ...targets, tasks: Number(e.target.value) })}
                                                            className="rounded-2xl border-slate-100 dark:border-border h-12 font-bold"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <DialogFooter className="sm:justify-start">
                                                <Button onClick={handleSetTargets} className="rounded-2xl bg-blue-600 hover:bg-blue-700 h-12 px-8 font-bold uppercase tracking-widest text-xs">Save Targets</Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Revenue Target */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-slate-400">Revenue Contribution</span>
                                            <span className={`text-[10px] font-bold ${getPerformanceColor(rep.targets.revenue > 0 ? (rep.performance.revenue / rep.targets.revenue) * 100 : 0)}`}>
                                                {rep.targets.revenue > 0 ? ((rep.performance.revenue / rep.targets.revenue) * 100).toFixed(0) : 0}%
                                            </span>
                                        </div>
                                        <Progress value={rep.targets.revenue > 0 ? (rep.performance.revenue / rep.targets.revenue) * 100 : 0} className="h-1.5 bg-slate-100 dark:bg-card" />
                                        <div className="flex justify-between text-[10px] font-bold">
                                            <span className="text-slate-900 dark:text-foreground">₹{rep.performance.revenue.toLocaleString()}</span>
                                            <span className="text-slate-400">Target: ₹{rep.targets.revenue.toLocaleString()}</span>
                                        </div>
                                    </div>

                                    {/* Completion Multi-Stat */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-slate-50/50 dark:bg-card/50 p-4 rounded-3xl border border-slate-100 dark:border-border/50">
                                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Leads Goal</p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-slate-900 dark:text-foreground">{rep.leads.total}/{rep.targets.leads}</span>
                                                <div className={`w-1.5 h-1.5 rounded-full ${getProgressColor(rep.targets.leads > 0 ? (rep.leads.total / rep.targets.leads) * 100 : 0)}`} />
                                            </div>
                                        </div>
                                        <div className="bg-slate-50/50 dark:bg-card/50 p-4 rounded-3xl border border-slate-100 dark:border-border/50">
                                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Efficiency</p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-slate-900 dark:text-foreground">{rep.performance.taskCompletionRate.toFixed(0)}%</span>
                                                <div className={`w-1.5 h-1.5 rounded-full ${getProgressColor(rep.performance.taskCompletionRate)}`} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Barrier Drilldown */}
                            {rep.barriers.count > 0 && (
                                <div className="mt-6 p-4 rounded-3xl bg-rose-500/5 border border-rose-500/10 space-y-3">
                                    <h5 className="text-[10px] font-bold uppercase tracking-widest text-rose-500 flex items-center gap-2">
                                        <AlertCircle className="w-3.5 h-3.5" /> Performance Barriers Detected
                                    </h5>
                                    <div className="flex gap-4">
                                        {rep.barriers.overdueTasks > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground">{rep.barriers.overdueTasks} Overdue Tasks</span>
                                            </div>
                                        )}
                                        {rep.barriers.staleLeads > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground">{rep.barriers.staleLeads} Stale Leads</span>
                                            </div>
                                        )}
                                    </div>
                                    <Button variant="ghost" className="w-full justify-between h-9 px-4 rounded-xl text-rose-600 hover:bg-rose-600/10 text-[10px] font-bold uppercase tracking-widest">
                                        Analyze Barriers <ChevronRight className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            )}

                            {/* Actions Footer */}
                            <div className="mt-8 flex items-center gap-3">
                                <Button variant="outline" className="flex-1 rounded-2xl border-slate-100 dark:border-border h-11 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-900">
                                    <PhoneCall className="w-3.5 h-3.5 mr-2" /> Call Rep
                                </Button>
                                <Button variant="outline" className="flex-1 rounded-2xl border-slate-100 dark:border-border h-11 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-900">
                                    <Mail className="w-3.5 h-3.5 mr-2" /> Send Brief
                                </Button>
                                <Link href={`/activity-log?userId=${rep.id}`} className="shrink-0">
                                    <Button variant="outline" className="rounded-2xl border-slate-100 dark:border-border h-11 w-11 p-0 hover:bg-slate-50 dark:hover:bg-slate-900">
                                        <ArrowUpRight className="w-4 h-4" />
                                    </Button>
                                </Link>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Empty State */}
            {filteredReps.length === 0 && (
                <div className="h-[500px] flex flex-col items-center justify-center space-y-6 border-2 border-dashed border-slate-100 dark:border-border rounded-[64px]">
                    <div className="p-8 bg-slate-50 dark:bg-card rounded-[40px]">
                        <Users className="w-12 h-12 text-slate-300" />
                    </div>
                    <div className="text-center space-y-2">
                        <p className="text-2xl font-bold tracking-tight text-slate-400">No sales representatives found.</p>
                        <p className="text-sm font-bold text-slate-500">Try adjusting your search query or invite new team members.</p>
                    </div>
                </div>
            )}
        </div>
    )
}

