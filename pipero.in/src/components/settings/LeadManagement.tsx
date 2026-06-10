'use client'

import { useState, useEffect } from 'react'
import {
    Plus,
    Trash2,
    GripVertical,
    Settings2,
    Users,
    ShieldCheck,
    AlertCircle,
    Check,
    Save,
    MapPin,
    Hash,
    Layers,
    Shuffle,
    GitBranch,
    Clock,
    UserPlus,
    Search,
    Copy,
    CheckCircle2,
    Activity,
    ArrowUpDown,
    Globe,
    Building2
} from 'lucide-react'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    getLeadStatuses, addLeadStatus, deleteLeadStatus,
    getPipelineStages, addPipelineStage, deletePipelineStage,
    getLeadManagementSettings, updateLeadRoutingSettings, updateLeadHygieneSettings,
    getLeadRoutingRules, addLeadRoutingRule, deleteLeadRoutingRule,
    updateUserRoutingSettings,
    getLeadAuditLogs, getLeadAssignmentStats
} from '@/app/actions/lead-management'
import { getOrgMembers } from '@/app/actions/crm'

export default function LeadManagement() {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'

    const [activeSubTab, setActiveSubTab] = useState('pipeline')
    const [loading, setLoading] = useState(true)
    const [statuses, setStatuses] = useState<any[]>([])
    const [stages, setStages] = useState<any[]>([])
    const [settings, setSettings] = useState<any>(null)

    // New item states
    const [newStatus, setNewStatus] = useState({ label: '', color: '#94a3b8' })
    const [newStage, setNewStage] = useState({ label: '', probability: 10 })
    const [rules, setRules] = useState<any[]>([])
    const [members, setMembers] = useState<any[]>([])
    const [isSavingRule, setIsSavingRule] = useState(false)
    const [logs, setLogs] = useState<any[]>([])
    const [stats, setStats] = useState<any>(null)
    const [activeModeOverride, setActiveModeOverride] = useState<string | null>(null)
    const [newRule, setNewRule] = useState({
        name: '',
        conditions: [{ field: 'location', op: 'equals', val: '' }],
        assignTo: ''
    })

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        setLoading(true)
        const [statusData, stageData, settingsData, rulesData, memberData, logsData, statsData] = await Promise.all([
            getLeadStatuses(),
            getPipelineStages(),
            getLeadManagementSettings(),
            getLeadRoutingRules(),
            getOrgMembers(),
            getLeadAuditLogs(),
            getLeadAssignmentStats()
        ])
        setStatuses(statusData)
        setStages(stageData)
        setSettings(settingsData)
        setRules(rulesData)
        setMembers(memberData)
        setLogs(logsData)
        setStats(statsData)
        setLoading(false)
    }

    async function handleModeUpdate(mode: string) {
        setActiveModeOverride(mode)
        toast.promise(updateLeadRoutingSettings({ assignment_mode: mode }), {
            loading: 'Updating assignment mode...',
            success: () => {
                loadData()
                setActiveModeOverride(null)
                return `Assignment mode set to ${mode.replace('_', ' ')}`
            },
            error: (err) => {
                setActiveModeOverride(null)
                return `Failed to update: ${err.message || err}`
            }
        })
    }

    async function handleAddStatus() {
        if (!newStatus.label) return
        const res = await addLeadStatus(newStatus.label, newStatus.color)
        if (res.error) toast.error(res.error)
        else {
            toast.success('Status added')
            setNewStatus({ label: '', color: '#94a3b8' })
            loadData()
        }
    }

    async function handleAddStage() {
        if (!newStage.label) return
        const res = await addPipelineStage(newStage.label, newStage.probability)
        if (res.error) toast.error(res.error)
        else {
            toast.success('Stage added')
            setNewStage({ label: '', probability: 10 })
            loadData()
        }
    }

    if (loading) {
        return (
            <div className="h-96 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
            </div>
        )
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">Lead Management</h2>
                <p className="text-sm text-slate-500 dark:text-muted-foreground font-medium">Configure how leads are processed, assigned, and structured.</p>
            </div>

            <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
                <TabsList className="grid w-full grid-cols-4 bg-slate-100/50 dark:bg-card/50 p-1 rounded-2xl h-12">
                    <TabsTrigger value="pipeline" className="rounded-xl font-bold text-xs uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-secondary data-[state=active]:shadow-sm">
                        <Layers className="w-4 h-4 mr-2" /> Pipeline
                    </TabsTrigger>
                    <TabsTrigger value="assignment" className="rounded-xl font-bold text-xs uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-secondary data-[state=active]:shadow-sm">
                        <Shuffle className="w-4 h-4 mr-2" /> Assignment
                    </TabsTrigger>
                    <TabsTrigger value="hygiene" className="rounded-xl font-bold text-xs uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-secondary data-[state=active]:shadow-sm">
                        <ShieldCheck className="w-4 h-4 mr-2" /> Hygiene
                    </TabsTrigger>
                    <TabsTrigger value="insights" className="rounded-xl font-bold text-xs uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-secondary data-[state=active]:shadow-sm">
                        <Activity className="w-4 h-4 mr-2" /> Insights
                    </TabsTrigger>
                </TabsList>

                {/* Status & Pipeline Tab */}
                <TabsContent value="pipeline" className="mt-8 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Lead Statuses */}
                        <Card className="rounded-3xl border-slate-100 dark:border-border shadow-sm overflow-hidden border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                            <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border p-6">
                                <CardTitle className="text-lg font-bold flex items-center gap-2">
                                    <MapPin className="w-5 h-5 text-blue-500" /> Lead Statuses
                                </CardTitle>
                                <CardDescription>Define current status for every lead in the system.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div className="space-y-3">
                                    {statuses.map((s) => (
                                        <div key={s.id} className="flex items-center justify-between p-3 rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-100 dark:border-border group">
                                            <div className="flex items-center gap-3">
                                                <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-slate-400 cursor-grab" />
                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                                                <span className="text-sm font-bold text-slate-700 dark:text-muted-foreground">{s.label}</span>
                                            </div>
                                            {isCoreAdmin && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => deleteLeadStatus(s.id).then(loadData)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-600 hover:bg-red-50 rounded-xl"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {isCoreAdmin && (
                                    <div className="pt-4 border-t border-slate-100 dark:border-border flex gap-2">
                                        <Input
                                            placeholder="New status..."
                                            value={newStatus.label}
                                            onChange={(e) => setNewStatus({ ...newStatus, label: e.target.value })}
                                            className="rounded-xl border-slate-100 h-10 text-sm font-medium"
                                        />
                                        <Input
                                            type="color"
                                            value={newStatus.color}
                                            onChange={(e) => setNewStatus({ ...newStatus, color: e.target.value })}
                                            className="w-12 h-10 p-1 rounded-xl border-slate-100 cursor-pointer"
                                        />
                                        <Button size="icon" onClick={handleAddStatus} className="h-10 w-10 rounded-xl shrink-0">
                                            <Plus className="w-5 h-5" />
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Pipeline Stages */}
                        <Card className="rounded-3xl border-slate-100 dark:border-border shadow-sm overflow-hidden border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                            <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border p-6">
                                <CardTitle className="text-lg font-bold flex items-center gap-2">
                                    <Layers className="w-5 h-5 text-indigo-500" /> Pipeline Stages
                                </CardTitle>
                                <CardDescription>Stages for deals moving through your funnel.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div className="space-y-3">
                                    {stages.map((s) => (
                                        <div key={s.id} className="flex items-center justify-between p-3 rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-100 dark:border-border group">
                                            <div className="flex items-center gap-3">
                                                <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-slate-400 cursor-grab" />
                                                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-black border-slate-200">{s.probability}%</Badge>
                                                <span className="text-sm font-bold text-slate-700 dark:text-muted-foreground">{s.label}</span>
                                            </div>
                                            {isCoreAdmin && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => deletePipelineStage(s.id).then(loadData)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-600 hover:bg-red-50 rounded-xl"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {isCoreAdmin && (
                                    <div className="pt-4 border-t border-slate-100 dark:border-border flex gap-2">
                                        <Input
                                            placeholder="New stage..."
                                            value={newStage.label}
                                            onChange={(e) => setNewStage({ ...newStage, label: e.target.value })}
                                            className="rounded-xl border-slate-100 h-10 text-sm font-medium"
                                        />
                                        <Input
                                            type="number"
                                            placeholder="%"
                                            value={newStage.probability}
                                            onChange={(e) => setNewStage({ ...newStage, probability: parseInt(e.target.value) })}
                                            className="w-20 h-10 rounded-xl border-slate-100"
                                        />
                                        <Button size="icon" onClick={handleAddStage} className="h-10 w-10 rounded-xl shrink-0">
                                            <Plus className="w-5 h-5" />
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Assignment Tab */}
                <TabsContent value="assignment" className="mt-8 space-y-8">
                    <Card className="rounded-3xl border-slate-100 dark:border-border shadow-sm overflow-hidden border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                        <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border p-8">
                            <CardTitle className="text-xl font-bold flex items-center gap-3">
                                <Shuffle className="w-6 h-6 text-blue-600" /> Lead Routing Rules
                            </CardTitle>
                            <CardDescription>Master control for automatic lead distribution and re-allocation.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-8 space-y-12">
                            {/* Mode Selection */}
                            <div className="space-y-4">
                                <Label className="text-sm font-black uppercase tracking-widest text-slate-400">Assignment Mode</Label>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {['manual', 'round_robin', 'weighted', 'load_based', 'rule_based'].map((mode) => {
                                        const isActive = (activeModeOverride || settings?.routing?.assignment_mode) === mode
                                        return (
                                            <button
                                                key={mode}
                                                onClick={() => isCoreAdmin && handleModeUpdate(mode)}
                                                disabled={!isCoreAdmin}
                                                className={`flex flex-col p-6 rounded-3xl border transition-all text-left group ${isActive
                                                    ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20'
                                                    : 'bg-white dark:bg-slate-900/50 border-slate-100 dark:border-border text-slate-600 hover:border-blue-200'}`}
                                            >
                                                <div className="flex items-center justify-between mb-4">
                                                    {mode === 'manual' && <UserPlus className={`w-8 h-8 ${isActive ? 'text-blue-200' : 'text-slate-400'}`} />}
                                                    {mode === 'round_robin' && <Shuffle className={`w-8 h-8 ${isActive ? 'text-blue-200' : 'text-slate-400'}`} />}
                                                    {mode === 'weighted' && <ArrowUpDown className={`w-8 h-8 ${isActive ? 'text-blue-200' : 'text-slate-400'}`} />}
                                                    {mode === 'load_based' && <Activity className={`w-8 h-8 ${isActive ? 'text-blue-200' : 'text-slate-400'}`} />}
                                                    {mode === 'rule_based' && <GitBranch className={`w-8 h-8 ${isActive ? 'text-blue-200' : 'text-slate-400'}`} />}
                                                    {isActive && <CheckCircle2 className="w-6 h-6 text-white" />}
                                                </div>
                                                <span className="text-base font-bold capitalize mb-1">{mode.replace('_', ' ')}</span>
                                                <p className={`text-xs ${isActive ? 'text-blue-100/80' : 'text-slate-400'}`}>
                                                    {mode === 'manual' && 'All leads remain unassigned until manually picked up.'}
                                                    {mode === 'round_robin' && 'Leads are distributed equally among active team members.'}
                                                    {mode === 'weighted' && 'Top performers get more leads based on assigned weights.'}
                                                    {mode === 'load_based' && 'Assigns leads to reps with the lightest current workload.'}
                                                    {mode === 'rule_based' && 'Leads are assigned based on complex conditional logic.'}
                                                </p>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Untouched Reassignment */}
                            <div className="pt-8 border-t border-slate-100 dark:border-border flex flex-col md:flex-row md:items-center justify-between gap-6">
                                <div className="space-y-1">
                                    <h4 className="font-bold flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-amber-500" /> Untouched Lead Re-allocation
                                    </h4>
                                    <p className="text-xs text-slate-500">Automatically move leads if not contacted within threshold.</p>
                                </div>
                                <div className="flex items-center gap-4 bg-slate-50 dark:bg-secondary/50 p-2 rounded-2xl border border-slate-100 dark:border-border">
                                    <div className="flex items-center gap-2 px-2 border-r border-slate-200">
                                        <Label className="text-[10px] font-black text-slate-400 uppercase">Days</Label>
                                        <Input
                                            type="number"
                                            defaultValue={settings?.routing?.untouched_reassignment_days || 3}
                                            className="w-12 h-8 text-xs font-bold rounded-lg border-slate-200"
                                            disabled={!isCoreAdmin}
                                            onBlur={(e) => isCoreAdmin && updateLeadRoutingSettings({ untouched_reassignment_days: parseInt(e.target.value) }).then(loadData)}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 px-2">
                                        <Label className="text-[10px] font-black text-slate-400 uppercase">Min</Label>
                                        <Input
                                            type="number"
                                            defaultValue={settings?.routing?.untouched_reassignment_minutes || 60}
                                            className="w-16 h-8 text-xs font-bold rounded-lg border-slate-200"
                                            onBlur={(e) => updateLeadRoutingSettings({ untouched_reassignment_minutes: parseInt(e.target.value) }).then(loadData)}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Load Balancing Switch */}
                            <div className="pt-8 border-t border-slate-100 dark:border-border flex items-center justify-between p-6 bg-blue-50/30 dark:bg-blue-500/5 rounded-3xl border border-blue-100/50 dark:border-blue-500/10">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white">
                                        <Activity className="w-5 h-5" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-bold text-slate-900 dark:text-foreground">Intelligent Workload Balancing</p>
                                        <p className="text-xs text-slate-500">Automatically skip team members who have reached their lead capacity.</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6">
                                    {settings?.routing?.load_balancing_enabled && (
                                        <div className="flex items-center gap-3">
                                            <Label className="text-[10px] font-black text-slate-400 uppercase">Limit</Label>
                                            <Input
                                                type="number"
                                                defaultValue={settings?.routing?.max_leads_per_user || 20}
                                                className="w-16 h-8 text-xs font-bold rounded-lg border-blue-200"
                                                onBlur={(e) => updateLeadRoutingSettings({ max_leads_per_user: parseInt(e.target.value) })}
                                            />
                                        </div>
                                    )}
                                    <Switch
                                        checked={settings?.routing?.load_balancing_enabled}
                                        onCheckedChange={(v) => updateLeadRoutingSettings({ load_balancing_enabled: v }).then(loadData)}
                                    />
                                </div>
                            </div>

                            {/* Rule Builder */}
                            {settings?.routing?.assignment_mode === 'rule_based' && (
                                <div className="pt-8 border-t border-slate-100 dark:border-border space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <h4 className="font-black text-xs uppercase tracking-widest text-slate-400">Allocation Rules Queue</h4>
                                            <p className="text-[10px] text-slate-400">Rules are evaluated from top to bottom.</p>
                                        </div>
                                        {isCoreAdmin && (
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <Button className="rounded-xl h-9 text-xs font-bold gap-2 bg-blue-600 hover:bg-blue-700">
                                                        <Plus className="w-4 h-4" /> Add New Rule
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="rounded-3xl border-0 shadow-2xl max-w-lg">
                                                    <DialogHeader>
                                                        <DialogTitle className="text-xl font-bold">New Routing Rule</DialogTitle>
                                                        <DialogDescription>Define criteria for automatic lead matching.</DialogDescription>
                                                    </DialogHeader>
                                                    <div className="space-y-6 py-4">
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-bold">Rule Name</Label>
                                                            <Input placeholder="e.g. High Value Leads" value={newRule.name} onChange={e => setNewRule({ ...newRule, name: e.target.value })} className="rounded-xl h-12" />
                                                        </div>
                                                        <div className="space-y-4">
                                                            <Label className="text-xs font-bold">If Lead matches...</Label>
                                                            {newRule.conditions.map((c, i) => (
                                                                <div key={i} className="flex gap-2">
                                                                    <Select value={c.field} onValueChange={v => {
                                                                        const next = [...newRule.conditions]; next[i].field = v; setNewRule({ ...newRule, conditions: next })
                                                                    }}>
                                                                        <SelectTrigger className="rounded-xl h-10 text-xs font-semibold"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="location">Location (State/Country)</SelectItem>
                                                                            <SelectItem value="zip_code">Zip Code</SelectItem>
                                                                            <SelectItem value="industry">Industry</SelectItem>
                                                                            <SelectItem value="source">Lead Source</SelectItem>
                                                                            <SelectItem value="value">Lead Value</SelectItem>
                                                                            <SelectItem value="temperature">Temperature</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Select value={c.op} onValueChange={v => {
                                                                        const next = [...newRule.conditions]; next[i].op = v; setNewRule({ ...newRule, conditions: next })
                                                                    }}>
                                                                        <SelectTrigger className="rounded-xl h-10 text-xs font-semibold w-[120px]"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="equals">Equals</SelectItem>
                                                                            <SelectItem value="contains">Contains</SelectItem>
                                                                            <SelectItem value="starts_with">Starts with</SelectItem>
                                                                            <SelectItem value="greater_than">Greater than</SelectItem>
                                                                            <SelectItem value="in_list">In List (Comma Sep)</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Input placeholder="Value" value={c.val} onChange={e => {
                                                                        const next = [...newRule.conditions]; next[i].val = e.target.value; setNewRule({ ...newRule, conditions: next })
                                                                    }} className="rounded-xl h-10 text-xs" />
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-bold">Then Assign To</Label>
                                                            <Select value={newRule.assignTo} onValueChange={v => setNewRule({ ...newRule, assignTo: v })}>
                                                                <SelectTrigger className="rounded-xl h-12 font-bold"><SelectValue placeholder="Select Team Member" /></SelectTrigger>
                                                                <SelectContent>
                                                                    {members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button variant="ghost" className="rounded-xl">Cancel</Button>
                                                        <Button onClick={async () => {
                                                            if (!newRule.name || !newRule.assignTo) { toast.error('Name and assignee required'); return }
                                                            const res = await addLeadRoutingRule(newRule.name, newRule.conditions, newRule.assignTo)
                                                            if (res.error) toast.error(res.error)
                                                            else { toast.success('Rule created!'); loadData() }
                                                        }} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-8">Save Rule</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>

                                    <div className="space-y-3">
                                        {rules.length === 0 ? (
                                            <div className="text-center p-12 bg-slate-50/50 dark:bg-card/50 rounded-3xl border-2 border-dashed border-slate-100 dark:border-border">
                                                <p className="text-sm font-medium text-slate-400">No active rules. Define criteria to triage leads to experts.</p>
                                            </div>
                                        ) : (
                                            rules.map((rule, idx) => (
                                                <div key={rule.id} className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-border rounded-2xl group transition-all hover:border-blue-200">
                                                    <div className="flex items-center gap-4">
                                                        <div className="h-8 w-8 rounded-full bg-slate-50 dark:bg-secondary flex items-center justify-center text-xs font-black text-slate-400">{idx + 1}</div>
                                                        <div className="space-y-0.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-bold text-slate-900 dark:text-foreground">{rule.name}</span>
                                                                <Badge variant="secondary" className="bg-blue-50 text-blue-600 text-[9px] h-4 px-1">{rule.assign_to_user?.full_name}</Badge>
                                                            </div>
                                                            <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                                                {rule.conditions.map((c: any, i: number) => (
                                                                    <span key={i} className="flex items-center gap-1">
                                                                        <span className="capitalize">{c.field}</span>
                                                                        <span className="opacity-60">{c.op}</span>
                                                                        <span className="font-bold text-slate-600">{c.val}</span>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {isCoreAdmin && (
                                                        <Button variant="ghost" size="sm" onClick={() => deleteLeadRoutingRule(rule.id).then(loadData)} className="rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Team Performance & Capacity (Weighted/Load-based settings) */}
                            {(settings?.routing?.assignment_mode === 'weighted' || settings?.routing?.assignment_mode === 'load_based' || settings?.routing?.assignment_mode === 'round_robin') && (
                                <div className="pt-8 border-t border-slate-100 dark:border-border space-y-6">
                                    <div className="space-y-1">
                                        <h4 className="font-black text-xs uppercase tracking-widest text-slate-400">Team Allocation Weights & Availability</h4>
                                        <p className="text-[10px] text-slate-400">Manage individual rep capacity and distribution priority.</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {members.map(member => (
                                            <div key={member.id} className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-border rounded-2xl flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-2 w-2 rounded-full ${member.availability_status ? 'bg-green-500' : 'bg-slate-300 animate-pulse'}`} />
                                                    <div className="space-y-0.5">
                                                        <p className="text-sm font-bold">{member.full_name}</p>
                                                        <p className="text-[10px] text-slate-400">{member.role}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    {settings?.routing?.assignment_mode === 'weighted' && (
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-[9px] font-black text-slate-400 uppercase">Weight</Label>
                                                            <Input
                                                                type="number"
                                                                defaultValue={member.lead_weight || 100}
                                                                className="w-14 h-8 text-xs font-bold rounded-lg"
                                                                onBlur={(e) => updateUserRoutingSettings(member.id, { lead_weight: parseInt(e.target.value) }).then(loadData)}
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-[9px] font-black text-slate-400 uppercase">{member.availability_status ? 'Online' : 'Away'}</Label>
                                                        <Switch
                                                            checked={member.availability_status}
                                                            onCheckedChange={(v) => updateUserRoutingSettings(member.id, { availability_status: v }).then(loadData)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Hygiene Tab */}
                <TabsContent value="hygiene" className="mt-8 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <Card className="md:col-span-2 rounded-3xl border-slate-100 dark:border-border shadow-sm overflow-hidden border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                            <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border p-8">
                                <CardTitle className="text-xl font-bold flex items-center gap-3">
                                    <ShieldCheck className="w-6 h-6 text-emerald-600" /> Deduplication Control
                                </CardTitle>
                                <CardDescription>Identify and resolve ghost/duplicate entries instantly.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-8 space-y-8">
                                <div className="space-y-6">
                                    <Label className="text-xs font-black uppercase tracking-widest text-slate-400">Master Identity Fields</Label>
                                    <div className="flex flex-wrap gap-3">
                                        {['email', 'phone_number', 'company_name', 'full_name'].map((field) => {
                                            const isSelected = settings?.hygiene?.duplicate_fields?.includes(field)
                                            return (
                                                <button
                                                    key={field}
                                                    disabled={!isCoreAdmin}
                                                    onClick={() => {
                                                        if (!isCoreAdmin) return
                                                        const current = settings?.hygiene?.duplicate_fields || []
                                                        const next = isSelected
                                                            ? current.filter((f: string) => f !== field)
                                                            : [...current, field]
                                                        updateLeadHygieneSettings({ duplicate_fields: next }).then(loadData)
                                                    }}
                                                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${isSelected
                                                        ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-500/10 dark:border-blue-500/30'
                                                        : 'bg-white dark:bg-slate-900/50 border-slate-100 dark:border-border text-slate-400'
                                                        } ${!isCoreAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                    {field.replace('_', ' ').toUpperCase()}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                <div className="pt-8 border-t border-slate-100 dark:border-border space-y-8">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <Label className="font-bold">Collision Strategy</Label>
                                            <p className="text-xs text-slate-500">How should the system behave when a match is found?</p>
                                        </div>
                                        <Select
                                            value={settings?.hygiene?.merge_strategy || 'manual'}
                                            disabled={!isCoreAdmin}
                                            onValueChange={(v) => isCoreAdmin && updateLeadHygieneSettings({ merge_strategy: v }).then(loadData)}
                                        >
                                            <SelectTrigger className="w-[180px] rounded-xl border-slate-100 h-10 font-bold text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xl border-slate-100">
                                                <SelectItem value="manual">Manual Approval</SelectItem>
                                                <SelectItem value="auto">Auto-Merge (Safe Fields)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="flex items-center justify-between p-6 bg-amber-50/50 dark:bg-amber-500/5 rounded-2xl border border-amber-100/50 dark:border-amber-500/10">
                                        <div className="flex items-center gap-3">
                                            <AlertCircle className="w-5 h-5 text-amber-500" />
                                            <div className="space-y-1">
                                                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Admin Notifications</p>
                                                <p className="text-xs text-amber-600/80">Notify relevant owners when duplicates are blocked.</p>
                                            </div>
                                        </div>
                                        <Switch
                                            checked={settings?.hygiene?.notify_admin}
                                            disabled={!isCoreAdmin}
                                            onCheckedChange={(v) => isCoreAdmin && updateLeadHygieneSettings({ notify_admin: v }).then(loadData)}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="rounded-3xl border-slate-100 dark:border-border shadow-sm overflow-hidden bg-white dark:bg-slate-900/50 border-0 ring-1 ring-slate-100 dark:ring-slate-800">
                            <CardHeader className="p-6">
                                <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-400">Hygiene Score</CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <div className="relative w-32 h-32 flex items-center justify-center">
                                    <svg className="w-full h-full transform -rotate-90">
                                        <circle cx="64" cy="64" r="56" fill="transparent" stroke="currentColor" strokeWidth="8" className="text-slate-100 dark:text-slate-800" />
                                        <circle cx="64" cy="64" r="56" fill="transparent" stroke="currentColor" strokeWidth="8" strokeDasharray={351.8} strokeDashoffset={351.8 * 0.12} strokeLinecap="round" className="text-emerald-500" />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-3xl font-black italic">88%</span>
                                        <span className="text-[10px] font-bold text-slate-400">STELLAR</span>
                                    </div>
                                </div>
                                <p className="text-center text-xs font-medium text-slate-500 mt-6 px-6">Your data is looking healthy. deduplication is active across 2 core fields.</p>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="insights" className="mt-8 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Card className="rounded-3xl border-0 shadow-sm ring-1 ring-slate-100 dark:ring-slate-800 bg-white dark:bg-slate-900/50">
                            <CardHeader className="p-6">
                                <CardTitle className="text-xs font-black uppercase text-slate-400">Leads Today</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0">
                                <p className="text-4xl font-black italic">{stats?.todayTotal || 0}</p>
                                <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-tighter">New entries captured</p>
                            </CardContent>
                        </Card>
                        <Card className="rounded-3xl border-0 shadow-sm ring-1 ring-slate-100 dark:ring-slate-800 bg-white dark:bg-slate-900/50 md:col-span-2">
                            <CardHeader className="p-6">
                                <CardTitle className="text-xs font-black uppercase text-slate-400">Today's Distribution</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0">
                                <div className="flex gap-4 overflow-x-auto pb-2">
                                    {members.map(m => {
                                        const count = stats?.leadsToday?.filter((l: any) => l.owner_id === m.id).length || 0
                                        return (
                                            <div key={m.id} className="min-w-[120px] p-3 rounded-2xl bg-slate-50 dark:bg-card border border-slate-100 dark:border-border text-center">
                                                <p className="text-[10px] font-black uppercase text-slate-400 truncate">{m.full_name}</p>
                                                <p className="text-xl font-black mt-1">{count}</p>
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="rounded-3xl border-0 shadow-sm ring-1 ring-slate-100 dark:ring-slate-800 overflow-hidden">
                        <CardHeader className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border p-8">
                            <CardTitle className="text-xl font-bold flex items-center gap-3">
                                <Activity className="w-6 h-6 text-emerald-600" /> Audit Log
                            </CardTitle>
                            <CardDescription>Track every assignment and hygiene event recorded by the system.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-slate-100 dark:divide-border max-h-[500px] overflow-y-auto">
                                {logs.length === 0 ? (
                                    <div className="p-12 text-center text-slate-400 text-sm italic font-medium">No activity recorded today.</div>
                                ) : (
                                    logs.map((log) => (
                                        <div key={log.id} className="p-6 flex items-start justify-between hover:bg-slate-50/50 transition-colors">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className={`text-[10px] uppercase font-black ${log.event_type.includes('duplicate') ? 'text-amber-600 border-amber-200' : 'text-blue-600 border-blue-200'
                                                        }`}>
                                                        {log.event_type.replace(/_/g, ' ')}
                                                    </Badge>
                                                    <span className="text-xs text-slate-400 font-bold">{new Date(log.created_at).toLocaleTimeString()}</span>
                                                </div>
                                                <p className="text-sm font-bold text-slate-700 dark:text-foreground">{log.description}</p>
                                                {log.metadata?.mode && (
                                                    <p className="text-[10px] text-slate-400 italic">Method: {log.metadata.mode}</p>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] text-slate-300 font-black uppercase">Source</p>
                                                <p className="text-[10px] font-bold text-slate-500">SYSTEM</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
