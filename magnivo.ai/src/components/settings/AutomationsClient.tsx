'use client'

import { useState, useEffect } from 'react'
import {
    Zap,
    Play,
    Plus,
    Trash2,
    CheckCircle,
    AlertCircle,
    Clock,
    Filter,
    ArrowRight,
    Bot,
    Mail,
    Bell,
    MoreVertical,
    Save,
    X,
    Activity,
    UserCircle,
    Building2,
    Calendar,
    ChevronDown,
    Settings,
    Layout
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from 'sonner'
import { addFlow, deleteFlow, getAutomationRuns } from '@/app/actions/automation'
import { format } from 'date-fns'

const TRIGGER_OPTIONS = [
    { value: 'lead_created', label: 'New Lead Created', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-900/30' },
    { value: 'status_changed', label: 'Lead Status Changed', icon: Activity, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/30' },
    { value: 'deal_won', label: 'Deal Marked Won', icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
    { value: 'stage_changed', label: 'Deal Stage Changed', icon: Layout, color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900/30' }
]

const ACTION_OPTIONS = [
    { value: 'ai_enrich', label: 'Enrich with AI', icon: Bot, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
    { value: 'update_field', label: 'Update Field Automatically', icon: Settings, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
    { value: 'send_notification', label: 'Send Alert to Team', icon: Bell, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' }
]

export default function AutomationsClient({ initialFlows, initialRuns }: { initialFlows: any[], initialRuns: any[] }) {
    const [activeTab, setActiveTab] = useState('flows')
    const [flows, setFlows] = useState(initialFlows)
    const [runs, setRuns] = useState(initialRuns)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [loading, setLoading] = useState(false)

    // Flow Builder State
    const [newFlow, setNewFlow] = useState({
        name: '',
        trigger_type: 'lead_created',
        conditions: [] as any[],
        actions: [] as any[],
    })

    const handleAddFlow = async () => {
        if (!newFlow.name) {
            toast.error('Flow name is required')
            return
        }
        if (newFlow.actions.length === 0) {
            toast.error('At least one action is required')
            return
        }

        setLoading(true)
        const res = await addFlow(newFlow)
        if (res.success) {
            toast.success('Automation flow created!')
            setIsCreateOpen(false)
            setNewFlow({ name: '', trigger_type: 'lead_created', conditions: [], actions: [] })
            // Refresh flows
            window.location.reload()
        } else {
            toast.error(res.error || 'Failed to create flow')
        }
        setLoading(false)
    }

    const handleDeleteFlow = async (id: string) => {
        if (!confirm('Are you sure you want to delete this flow?')) return
        const res = await deleteFlow(id)
        if (res.success) {
            toast.success('Flow deleted')
            setFlows(prev => prev.filter(f => f.id !== id))
        } else {
            toast.error('Failed to delete flow')
        }
    }

    const addCondition = () => {
        setNewFlow(prev => ({
            ...prev,
            conditions: [...prev.conditions, { field: 'source', op: 'equals', val: '' }]
        }))
    }

    const addAction = (type: string) => {
        let actionPayload = { type } as any
        if (type === 'update_field') actionPayload = { ...actionPayload, field: 'status', value: 'Priority' }
        if (type === 'send_notification') actionPayload = { ...actionPayload, message: 'Priority lead needs attention!' }

        setNewFlow(prev => ({
            ...prev,
            actions: [...prev.actions, actionPayload]
        }))
    }

    return (
        <div className="space-y-8 max-w-7xl mx-auto pb-12">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
                        CRM Automation Hub
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">Design AI-driven workflows and eliminate manual tasks.</p>
                </div>
                <div className="flex gap-3">
                    <Button
                        onClick={() => setIsCreateOpen(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 dark:shadow-none transition-all hover:scale-105"
                    >
                        <Plus className="mr-2 h-4 w-4" /> New Automation
                    </Button>
                </div>
            </header>

            <Tabs defaultValue="flows" onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-slate-100 dark:bg-slate-900 border-none p-1 gap-2 mb-6">
                    <TabsTrigger value="flows" className="data-[state=active]:bg-white dark:data-[state=active]:bg-indigo-600 data-[state=active]:shadow-sm rounded-md px-6 py-2">
                        My Workflows
                    </TabsTrigger>
                    <TabsTrigger value="runs" className="data-[state=active]:bg-white dark:data-[state=active]:bg-indigo-600 data-[state=active]:shadow-sm rounded-md px-6 py-2">
                        Execution Logs
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="flows" className="m-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {flows.map(flow => {
                            const trigger = TRIGGER_OPTIONS.find(t => t.value === flow.trigger_type)
                            return (
                                <Card key={flow.id} className="group overflow-hidden border-slate-200 dark:border-border hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                                    <CardHeader className="pb-3 border-b dark:border-border bg-slate-50/50 dark:bg-card/30">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className={`p-2 rounded-lg ${trigger?.bg} ${trigger?.color}`}>
                                                {trigger && <trigger.icon className="h-5 w-5" />}
                                            </div>
                                            <Badge variant={flow.is_active ? 'secondary' : 'outline'} className={flow.is_active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : ''}>
                                                {flow.is_active ? 'Active' : 'Paused'}
                                            </Badge>
                                        </div>
                                        <CardTitle className="text-xl group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                            {flow.name}
                                        </CardTitle>
                                        <CardDescription>{trigger?.label}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="pt-4">
                                        <div className="space-y-4">
                                            <div className="text-xs font-semibold px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded inline-block uppercase tracking-wider text-slate-500">
                                                {flow.actions.length} Actions
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {flow.actions.map((action: any, i: number) => {
                                                    const icon = ACTION_OPTIONS.find(a => a.value === action.type)
                                                    return (
                                                        <Badge key={i} variant="outline" className="flex items-center gap-1.5 py-1 px-2 border-slate-200">
                                                            {icon && <icon.icon className="h-3.5 w-3.5" />}
                                                            {icon?.label.split(' ')[0]}
                                                        </Badge>
                                                    )
                                                })}
                                            </div>
                                            <div className="flex items-center justify-between pt-4 border-t dark:border-border">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                                    onClick={() => handleDeleteFlow(flow.id)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                                                </Button>
                                                <Button variant="ghost" size="sm">
                                                    Configure <ArrowRight className="ml-2 h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}

                        {flows.length === 0 && (
                            <div className="col-span-full py-20 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-border">
                                <Bot className="h-16 w-16 mx-auto text-slate-300 mb-4" />
                                <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300">No Automations Yet</h3>
                                <p className="text-slate-500 max-w-sm mx-auto mt-2">Create your first AI-powered flow to start automating your pipeline.</p>
                                <Button onClick={() => setIsCreateOpen(true)} className="mt-8">
                                    <Plus className="mr-2 h-4 w-4" /> Get Started
                                </Button>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="runs" className="m-0">
                    <Card className="border-slate-200 dark:border-border overflow-hidden">
                        <CardHeader className="bg-slate-50/50 dark:bg-card/30">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <History className="h-5 w-5 text-indigo-500" /> Automation History
                            </CardTitle>
                            <CardDescription>Track every execution and result of your CRM workflows.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50/50 dark:bg-slate-800/50 border-y dark:border-border">
                                        <tr>
                                            <th className="text-left p-4 font-semibold text-slate-500">Timestamp</th>
                                            <th className="text-left p-4 font-semibold text-slate-500">Flow Name</th>
                                            <th className="text-left p-4 font-semibold text-slate-500">Entity</th>
                                            <th className="text-left p-4 font-semibold text-slate-500">Status</th>
                                            <th className="text-left p-4 font-semibold text-slate-500">Log Details</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y dark:divide-border">
                                        {runs.map(run => (
                                            <tr key={run.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                <td className="p-4 whitespace-nowrap text-slate-500">
                                                    {format(new Date(run.started_at), 'MMM d, HH:mm:ss')}
                                                </td>
                                                <td className="p-4 font-medium text-indigo-600 dark:text-indigo-400">
                                                    {flows.find(f => f.id === run.flow_id)?.name || 'Unknown Flow'}
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        {run.entity_type === 'lead' ? <UserCircle className="h-4 w-4 text-amber-500" /> : <Building2 className="h-4 w-4 text-blue-500" />}
                                                        <span className="capitalize">{run.entity_type}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <Badge variant="outline" className={`
                                                        ${run.status === 'success' ? 'border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400' : ''}
                                                        ${run.status === 'failed' ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400' : ''}
                                                        ${run.status === 'running' ? 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-400' : ''}
                                                    `}>
                                                        {run.status.toUpperCase()}
                                                    </Badge>
                                                </td>
                                                <td className="p-4 max-w-xs overflow-hidden">
                                                    <div className="flex flex-col gap-1">
                                                        {run.logs.slice(-1).map((log: any, i: number) => (
                                                            <span key={i} className="text-xs truncate text-slate-600 dark:text-slate-400 italic">
                                                                "{log.message}"
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Create Flow Dialog */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-bold flex items-center gap-3">
                            <Bot className="h-6 w-6 text-indigo-600" /> Design New Automation
                        </DialogTitle>
                        <DialogDescription>
                            Define a trigger, optional conditions, and the series of actions to perform.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-8 py-4">
                        {/* Name Section */}
                        <div className="space-y-3">
                            <Label htmlFor="flow-name" className="text-sm font-bold uppercase tracking-wider text-slate-500">1. Automation Name</Label>
                            <Input
                                id="flow-name"
                                placeholder="e.g. AI Enrichment for Facebook Leads"
                                value={newFlow.name}
                                onChange={e => setNewFlow({ ...newFlow, name: e.target.value })}
                                className="border-2 focus:border-indigo-500"
                            />
                        </div>

                        {/* Trigger Section */}
                        <div className="space-y-3">
                            <Label className="text-sm font-bold uppercase tracking-wider text-slate-500">2. When this happens (Trigger)</Label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {TRIGGER_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setNewFlow({ ...newFlow, trigger_type: opt.value })}
                                        className={`
                                            flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left
                                            ${newFlow.trigger_type === opt.value
                                                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/30'
                                                : 'border-slate-100 hover:border-slate-200 dark:border-border'}
                                        `}
                                    >
                                        <div className={`p-2 rounded-lg ${opt.bg} ${opt.color}`}>
                                            <opt.icon className="h-5 w-5" />
                                        </div>
                                        <span className="font-semibold">{opt.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Conditions Section */}
                        <div className="p-6 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-slate-100 dark:border-border space-y-4">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Filter className="h-4 w-4" /> 3. Filter Conditions (Optional)
                                </Label>
                                <Button variant="ghost" size="sm" onClick={addCondition} className="text-indigo-600 hover:bg-white dark:hover:bg-slate-800">
                                    <Plus className="h-4 w-4 mr-2" /> Add Condition
                                </Button>
                            </div>

                            {newFlow.conditions.map((cond, i) => (
                                <div key={i} className="flex gap-2 items-center bg-white dark:bg-card p-3 rounded-lg shadow-sm border border-slate-100 dark:border-border animate-in zoom-in-95">
                                    <Select
                                        value={cond.field}
                                        onValueChange={v => {
                                            const c = [...newFlow.conditions]
                                            c[i].field = v
                                            setNewFlow({ ...newFlow, conditions: c })
                                        }}
                                    >
                                        <SelectTrigger className="w-[140px] border-none font-medium">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="source">Source</SelectItem>
                                            <SelectItem value="industry">Industry</SelectItem>
                                            <SelectItem value="value">Value</SelectItem>
                                            <SelectItem value="location">Location</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <ArrowRight className="h-4 w-4 text-slate-300" />
                                    <Select
                                        value={cond.op}
                                        onValueChange={v => {
                                            const c = [...newFlow.conditions]
                                            c[i].op = v
                                            setNewFlow({ ...newFlow, conditions: c })
                                        }}
                                    >
                                        <SelectTrigger className="w-[120px] border-none font-medium">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="equals">Equals</SelectItem>
                                            <SelectItem value="contains">Contains</SelectItem>
                                            <SelectItem value="is_not_null">Exists</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        placeholder="Value..."
                                        value={cond.val}
                                        onChange={e => {
                                            const c = [...newFlow.conditions]
                                            c[i].val = e.target.value
                                            setNewFlow({ ...newFlow, conditions: c })
                                        }}
                                        className="border-none bg-slate-50 dark:bg-secondary focus-visible:ring-1"
                                    />
                                    <Button variant="ghost" size="icon" onClick={() => {
                                        const c = newFlow.conditions.filter((_, idx) => idx !== i)
                                        setNewFlow({ ...newFlow, conditions: c })
                                    }}>
                                        <X className="h-4 w-4 text-red-400" />
                                    </Button>
                                </div>
                            ))}
                        </div>

                        {/* Actions Section */}
                        <div className="space-y-4">
                            <Label className="text-sm font-bold uppercase tracking-wider text-slate-500">4. Then perform these actions</Label>

                            <div className="space-y-3">
                                {newFlow.actions.map((action, i) => {
                                    const opt = ACTION_OPTIONS.find(o => o.value === action.type)
                                    return (
                                        <div key={i} className="flex flex-col gap-3 p-4 bg-indigo-50/50 dark:bg-indigo-900/10 border-2 border-indigo-100 dark:border-indigo-900/30 rounded-2xl relative">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className={`p-1.5 rounded-lg ${opt?.bg} ${opt?.color}`}>
                                                        {opt && <opt.icon className="h-4 w-4" />}
                                                    </div>
                                                    <span className="font-bold text-slate-700 dark:text-slate-300">{opt?.label}</span>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-slate-400 hover:text-red-500"
                                                    onClick={() => setNewFlow(prev => ({ ...prev, actions: prev.actions.filter((_, idx) => idx !== i) }))}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>

                                            {action.type === 'update_field' && (
                                                <div className="flex gap-2 items-center bg-white dark:bg-card p-2 rounded-lg mt-1 border border-indigo-50">
                                                    <Input
                                                        value={action.field}
                                                        onChange={e => {
                                                            const a = [...newFlow.actions]
                                                            a[i].field = e.target.value
                                                            setNewFlow({ ...newFlow, actions: a })
                                                        }}
                                                        className="border-none font-medium h-8"
                                                    />
                                                    <ArrowRight className="h-4 w-4 text-slate-300" />
                                                    <Input
                                                        value={action.value}
                                                        onChange={e => {
                                                            const a = [...newFlow.actions]
                                                            a[i].value = e.target.value
                                                            setNewFlow({ ...newFlow, actions: a })
                                                        }}
                                                        className="border-none font-medium text-blue-600 h-8"
                                                    />
                                                </div>
                                            )}

                                            {action.type === 'send_notification' && (
                                                <Input
                                                    value={action.message}
                                                    onChange={e => {
                                                        const a = [...newFlow.actions]
                                                        a[i].message = e.target.value
                                                        setNewFlow({ ...newFlow, actions: a })
                                                    }}
                                                    className="border-none bg-white dark:bg-card font-medium mt-1 h-8"
                                                />
                                            )}
                                        </div>
                                    )
                                })}

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2 bg-slate-100 dark:bg-slate-900 rounded-xl">
                                    {ACTION_OPTIONS.map(opt => (
                                        <Button
                                            key={opt.value}
                                            variant="ghost"
                                            className="h-auto py-3 px-2 flex flex-col gap-1.5 hover:bg-white dark:hover:bg-slate-800"
                                            onClick={() => addAction(opt.value)}
                                        >
                                            <opt.icon className={`h-4 w-4 ${opt.color}`} />
                                            <span className="text-[10px] font-bold uppercase tracking-tighter">{opt.label.split(' ')[0]}</span>
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="bg-slate-50 dark:bg-slate-900/50 p-6 -mx-6 -mb-6 rounded-b-lg border-t dark:border-border">
                        <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button disabled={loading} onClick={handleAddFlow} className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[140px]">
                            {loading ? (
                                <>
                                    <Clock className="mr-2 h-4 w-4 animate-spin" /> Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="mr-2 h-4 w-4" /> Save Automation
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function History(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
        </svg>
    )
}
