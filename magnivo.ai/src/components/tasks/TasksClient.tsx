'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Plus, Calendar, AlertCircle, Clock, CheckCircle2, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { addTask, toggleTaskCompletion, updateTask, deleteTask } from '@/app/actions/crm'
import { toast } from 'sonner'
import { format, isToday, isPast } from 'date-fns'
import { useSupabaseRealtime } from '@/hooks/useSupabaseRealtime'
import { useRouter } from 'next/navigation'

export default function TasksClient({ initialTasks, leads, deals, members = [], isAdmin = false, currentRepId }: { initialTasks: any[], leads: any[], deals: any[], members?: any[], isAdmin?: boolean, currentRepId?: string }) {
    const { permissions, userRole } = useWorkspace()
    
    useSupabaseRealtime('tasks')
    const [tasks, setTasks] = useState(initialTasks || [])
    const router = useRouter()

    const isCoreAdmin = userRole === 'admin' || userRole === 'Admin' || userRole === 'Super Admin' || isAdmin
    const canCreate = isCoreAdmin || permissions?.tasks?.create !== false
    const canEdit = isCoreAdmin || permissions?.tasks?.edit !== false

    useEffect(() => {
        setTasks(initialTasks || [])
    }, [initialTasks])

    const [isOpen, setIsOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<'focus' | 'today' | 'upcoming' | 'overdue'>('focus')
    const [editingTask, setEditingTask] = useState<any | null>(null)

    function toLocalInput(value?: string | null) {
        if (!value) return ''
        const d = new Date(value)
        if (isNaN(d.getTime())) return ''
        // Convert to local datetime-local value (YYYY-MM-DDTHH:mm)
        const off = d.getTimezoneOffset()
        return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
    }

    async function onEditSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!editingTask) return
        const formData = new FormData(e.currentTarget)
        const title = (formData.get('title') as string)?.trim()
        const priority = formData.get('priority') as string
        const dueRaw = formData.get('due_date') as string
        const updates = {
            title,
            priority: priority || 'normal',
            due_date: dueRaw ? new Date(dueRaw).toISOString() : null,
        }
        // Optimistic update
        const prevTasks = tasks
        setTasks(tasks.map(t => t.id === editingTask.id ? { ...t, ...updates } : t))
        setEditingTask(null)
        toast.loading('Saving task...', { id: 'edit-task' })
        const res = await updateTask(editingTask.id, updates)
        if (res.error) {
            toast.error(res.error || 'Failed to update task', { id: 'edit-task' })
            setTasks(prevTasks)
        } else {
            toast.success('Task updated!', { id: 'edit-task' })
            router.refresh()
        }
    }

    async function handleDelete(taskId: string) {
        if (!canEdit) {
            toast.error("You don't have permission to delete tasks.")
            return
        }
        if (!confirm('Delete this task? This cannot be undone.')) return
        const prevTasks = tasks
        setTasks(tasks.filter(t => t.id !== taskId))
        toast.loading('Deleting task...', { id: 'delete-task' })
        const res = await deleteTask(taskId)
        if (res.error) {
            toast.error(res.error || 'Failed to delete task', { id: 'delete-task' })
            setTasks(prevTasks)
        } else {
            toast.success('Task deleted', { id: 'delete-task' })
            router.refresh()
        }
    }

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        toast.loading('Saving task...', { id: 'save-task' })
        try {
            const res = await addTask(formData)
            if (res.success) {
                toast.success('Task created successfully!', { id: 'save-task' })
                setIsOpen(false)
                window.location.reload()
            } else {
                toast.error(res.error || 'Failed to create task', { id: 'save-task' })
            }
        } catch (err: any) {
            toast.error(err.message || 'An error occurred', { id: 'save-task' })
        }
    }

    async function handleToggle(taskId: string, currentStatus: string) {
        if (!canEdit) {
            toast.error("You don't have permission to edit tasks.")
            return
        }
        
        const isCompleted = currentStatus !== 'completed'

        const newTasks = tasks.map(t =>
            t.id === taskId ? { ...t, status: isCompleted ? 'completed' : 'pending' } : t
        )
        setTasks(newTasks)

        const res = await toggleTaskCompletion(taskId, isCompleted)
        if (res.error) {
            toast.error(res.error || 'Failed to update task status')
            setTasks(tasks)
        }
    }

    const activeTasks = tasks.filter(t => t.status !== 'completed')

    // Filter active tasks by the selected tab so the tabs actually switch views.
    const tabbedTasks = activeTasks.filter(t => {
        if (activeTab === 'focus') return true
        const due = t.due_date ? new Date(t.due_date) : null
        if (!due || isNaN(due.getTime())) return false
        if (activeTab === 'today') return isToday(due)
        if (activeTab === 'overdue') return isPast(due) && !isToday(due)
        if (activeTab === 'upcoming') return !isPast(due) && !isToday(due)
        return true
    })

    // Sort tasks logically (focus/high priority first)
    const displayTasks = [...tabbedTasks].sort((a, b) => {
        if (a.priority === 'high' && b.priority !== 'high') return -1;
        if (a.priority !== 'high' && b.priority === 'high') return 1;
        return 0;
    })

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground">Tasks Command Center</h1>
                    <div className="flex items-center gap-6 mt-3 text-sm font-medium text-slate-500 dark:text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
                            <span className="text-slate-900 dark:text-foreground">{activeTasks.length}</span> tasks active
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-600 dark:text-blue-500" />
                            <span className="text-slate-900 dark:text-foreground">~{activeTasks.length * 0.5}h</span> estimated
                        </div>
                    </div>
                </div>
                {canCreate && (
                    <Dialog open={isOpen} onOpenChange={setIsOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 rounded-xl">
                                <Plus className="mr-2 h-4 w-4" /> Add Task
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-card border-gray-200 dark:border-border text-slate-900 dark:text-foreground shadow-xl rounded-2xl">
                        <DialogHeader>
                            <DialogTitle>Create New Task</DialogTitle>
                            <DialogDescription className="text-slate-500 dark:text-muted-foreground">
                                Schedule a follow-up or internal to-do.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={onSubmit}>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="title" className="text-right font-medium">Title</Label>
                                    <Input id="title" name="title" placeholder="Call client back" className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border focus:ring-blue-500 rounded-xl" required />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="due_date" className="text-right font-medium">Due Date</Label>
                                    <Input id="due_date" name="due_date" type="datetime-local" className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border focus:ring-blue-500 rounded-xl [color-scheme:light] dark:[color-scheme:dark]" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="priority" className="text-right font-medium">Priority</Label>
                                    <Select name="priority" defaultValue="normal">
                                        <SelectTrigger className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border rounded-xl focus:ring-blue-500">
                                            <SelectValue placeholder="Select Priority" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white dark:bg-secondary border-gray-200 dark:border-border text-slate-900 dark:text-foreground rounded-xl">
                                            <SelectItem value="low">Low</SelectItem>
                                            <SelectItem value="normal">Normal</SelectItem>
                                            <SelectItem value="high">High</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="lead_id" className="text-right font-medium">Lead</Label>
                                    <Select name="lead_id">
                                        <SelectTrigger className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border rounded-xl focus:ring-blue-500">
                                            <SelectValue placeholder="Select a Lead (Optional)" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white dark:bg-secondary border-gray-200 dark:border-border text-slate-900 dark:text-foreground rounded-xl">
                                            {leads.map(lead => (
                                                <SelectItem key={lead.id} value={lead.id}>{lead.name}</SelectItem>
                                            ))}
                                            <SelectItem value="none">None</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="assigned_to" className="text-right font-medium">Assign To</Label>
                                    <Select name="assigned_to" defaultValue="none">
                                        <SelectTrigger className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border rounded-xl focus:ring-blue-500">
                                            <SelectValue placeholder="Select a Rep (Optional)" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white dark:bg-secondary border-gray-200 dark:border-border text-slate-900 dark:text-foreground rounded-xl">
                                            {members.map(member => (
                                                <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>
                                            ))}
                                            <SelectItem value="none">Unassigned / Self</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md">Save Task</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
                )}
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-2 border-b border-gray-200 dark:border-border pb-px mt-8">
                <button
                    className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'focus' ? 'border-blue-600 dark:border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-700'}`}
                    onClick={() => setActiveTab('focus')}
                >
                    Focus Now
                </button>
                <button
                    className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'today' ? 'border-amber-600 dark:border-amber-500 text-amber-600 dark:text-amber-500' : 'border-transparent text-slate-500 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-700'}`}
                    onClick={() => setActiveTab('today')}
                >
                    Today
                </button>
                <button
                    className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'upcoming' ? 'border-cyan-600 dark:border-cyan-500 text-cyan-600 dark:text-cyan-500' : 'border-transparent text-slate-500 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-700'}`}
                    onClick={() => setActiveTab('upcoming')}
                >
                    Upcoming
                </button>
                <button
                    className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'overdue' ? 'border-red-600 dark:border-red-500 text-red-600 dark:text-red-500' : 'border-transparent text-slate-500 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-700'}`}
                    onClick={() => setActiveTab('overdue')}
                >
                    Overdue
                </button>
            </div>

            {isAdmin && (
                <div className="flex items-center gap-3 pt-2">
                    <span className="text-sm font-medium text-slate-500 dark:text-muted-foreground">Admin Filter:</span>
                    <Select defaultValue={currentRepId || 'all'} onValueChange={(val) => {
                        const newParams = new URLSearchParams(window.location.search)
                        if (val === 'all') {
                            newParams.delete('repId')
                        } else {
                            newParams.set('repId', val)
                        }
                        router.push(`/tasks?${newParams.toString()}`)
                    }}>
                        <SelectTrigger className="w-[200px] h-9 bg-white dark:bg-card border-gray-200 dark:border-border rounded-lg">
                            <SelectValue placeholder="All Reps" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-secondary border-gray-200 dark:border-border">
                            <SelectItem value="all">All Reps</SelectItem>
                            {members.map(member => (
                                <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="grid gap-3 pt-4">
                {displayTasks.length === 0 ? (
                    <div className="text-center py-16 text-slate-500 dark:text-muted-foreground border border-dashed border-gray-300 dark:border-border rounded-2xl bg-gray-50/50 dark:bg-secondary/20">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-500/50" />
                        No tasks in this view. You're all caught up!
                    </div>
                ) : (
                    displayTasks.map(task => (
                        <Card key={task.id} className="shadow-sm transition-all bg-white dark:bg-card/40 border-gray-200 dark:border-border hover:border-gray-300 dark:hover:border-white/10 rounded-2xl">
                            <CardContent className="p-4 flex items-start gap-4">
                                <Checkbox
                                    id={`task-${task.id}`}
                                    checked={false}
                                    onCheckedChange={() => handleToggle(task.id, task.status)}
                                    className="mt-1 w-5 h-5 rounded-md border-gray-300 dark:border-slate-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 shadow-sm"
                                />
                                <div className="flex-1 space-y-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <label
                                            htmlFor={`task-${task.id}`}
                                            className="text-base font-semibold leading-none cursor-pointer flex items-center gap-2 min-w-0 text-slate-900 dark:text-foreground"
                                        >
                                            <span className="truncate">{task.title}</span>
                                            {task.priority === 'high' && <Badge variant="destructive" className="shrink-0 bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-500/20 text-[10px] h-5 px-2 uppercase font-bold tracking-wider rounded-md shadow-sm border-0"><AlertCircle className="w-3 h-3 mr-1" /> High</Badge>}
                                        </label>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className="text-xs font-semibold text-slate-500 dark:text-muted-foreground flex items-center gap-1.5 bg-gray-100 dark:bg-secondary/80 px-2.5 py-1 rounded-lg">
                                                <Clock className="w-3.5 h-3.5" /> 30m
                                            </div>
                                            {canEdit && (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-slate-500 dark:text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400"
                                                        onClick={() => setEditingTask(task)}
                                                        aria-label="Edit task"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-slate-500 dark:text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                                                        onClick={() => handleDelete(task.id)}
                                                        aria-label="Delete task"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-muted-foreground pt-1">
                                        {task.due_date && (
                                            <span className={`flex items-center gap-1.5 ${new Date(task.due_date) < new Date() ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>
                                                <Calendar className="w-3.5 h-3.5" />
                                                {format(new Date(task.due_date), "MMM d, h:mm a")}
                                            </span>
                                        )}
                                        {task.leads && <span><span className="text-slate-400 dark:text-muted-foreground mr-1">Lead:</span><span className="text-blue-600 dark:text-blue-400 hover:underline font-medium">{task.leads.name}</span></span>}
                                        {task.deals && <span><span className="text-slate-400 dark:text-muted-foreground mr-1">Deal:</span><span className="text-blue-600 dark:text-blue-400 hover:underline font-medium">{task.deals.title}</span></span>}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            <Dialog open={!!editingTask} onOpenChange={(open) => { if (!open) setEditingTask(null) }}>
                <DialogContent className="sm:max-w-[425px] bg-white dark:bg-card border-gray-200 dark:border-border text-slate-900 dark:text-foreground shadow-xl rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Edit Task</DialogTitle>
                        <DialogDescription className="text-slate-500 dark:text-muted-foreground">
                            Update the title, due date, or priority.
                        </DialogDescription>
                    </DialogHeader>
                    {editingTask && (
                        <form onSubmit={onEditSubmit}>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-title" className="text-right font-medium">Title</Label>
                                    <Input id="edit-title" name="title" defaultValue={editingTask.title || ''} className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border focus:ring-blue-500 rounded-xl" required />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-due_date" className="text-right font-medium">Due Date</Label>
                                    <Input id="edit-due_date" name="due_date" type="datetime-local" defaultValue={toLocalInput(editingTask.due_date)} className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border focus:ring-blue-500 rounded-xl [color-scheme:light] dark:[color-scheme:dark]" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-priority" className="text-right font-medium">Priority</Label>
                                    <Select name="priority" defaultValue={editingTask.priority || 'normal'}>
                                        <SelectTrigger className="col-span-3 bg-gray-50 dark:bg-secondary/50 border-gray-200 dark:border-border rounded-xl focus:ring-blue-500">
                                            <SelectValue placeholder="Select Priority" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white dark:bg-secondary border-gray-200 dark:border-border text-slate-900 dark:text-foreground rounded-xl">
                                            <SelectItem value="low">Low</SelectItem>
                                            <SelectItem value="normal">Normal</SelectItem>
                                            <SelectItem value="high">High</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setEditingTask(null)} className="rounded-xl">Cancel</Button>
                                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md">Save Changes</Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

