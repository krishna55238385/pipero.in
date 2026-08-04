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
        <div className="space-y-5 max-w-5xl mx-auto">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            <span><strong className="text-foreground">{activeTasks.length}</strong> active</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-blue-500" />
                            <span>~{activeTasks.length * 0.5}h estimated</span>
                        </div>
                    </div>
                </div>
                {canCreate && (
                    <Dialog open={isOpen} onOpenChange={setIsOpen}>
                        <DialogTrigger asChild>
                            <Button className="rounded-lg bg-primary text-primary-foreground shadow-xs">
                                <Plus className="mr-2 h-4 w-4" /> Add Task
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Create New Task</DialogTitle>
                            <DialogDescription className="text-muted-foreground">
                                Schedule a follow-up or internal to-do.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={onSubmit}>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="title" className="text-right font-medium">Title</Label>
                                    <Input id="title" name="title" placeholder="Call client back" className="col-span-3" required />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="due_date" className="text-right font-medium">Due Date</Label>
                                    <Input id="due_date" name="due_date" type="datetime-local" className="col-span-3 [color-scheme:light] dark:[color-scheme:dark]" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="priority" className="text-right font-medium">Priority</Label>
                                    <Select name="priority" defaultValue="normal">
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue placeholder="Select Priority" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="low">Low</SelectItem>
                                            <SelectItem value="normal">Normal</SelectItem>
                                            <SelectItem value="high">High</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="lead_id" className="text-right font-medium">Lead</Label>
                                    <Select name="lead_id">
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue placeholder="Select a Lead (Optional)" />
                                        </SelectTrigger>
                                        <SelectContent>
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
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue placeholder="Select a Rep (Optional)" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {members.map(member => (
                                                <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>
                                            ))}
                                            <SelectItem value="none">Unassigned / Self</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="submit" className="rounded-lg bg-primary text-primary-foreground shadow-xs">Save Task</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
                )}
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-0.5 border-b border-border/50 pb-0 mt-6 bg-muted/50 p-0.5 rounded-lg">
                <button
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'focus' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setActiveTab('focus')}
                >
                    Focus Now
                </button>
                <button
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'today' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setActiveTab('today')}
                >
                    Today
                </button>
                <button
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'upcoming' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setActiveTab('upcoming')}
                >
                    Upcoming
                </button>
                <button
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'overdue' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setActiveTab('overdue')}
                >
                    Overdue
                </button>
            </div>

            {isAdmin && (
                <div className="flex items-center gap-3 pt-2">
                    <span className="text-sm font-medium text-muted-foreground">Admin Filter:</span>
                    <Select defaultValue={currentRepId || 'all'} onValueChange={(val) => {
                        const newParams = new URLSearchParams(window.location.search)
                        if (val === 'all') {
                            newParams.delete('repId')
                        } else {
                            newParams.set('repId', val)
                        }
                        router.push(`/tasks?${newParams.toString()}`)
                    }}>
                        <SelectTrigger className="w-[200px] h-9">
                            <SelectValue placeholder="All Reps" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Reps</SelectItem>
                            {members.map(member => (
                                <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="grid gap-2 pt-2">
                {displayTasks.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground border border-dashed border-border/50 rounded-xl bg-muted/30">
                        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                            <CheckCircle2 className="w-5 h-5 text-primary/40" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">No tasks in this view.</p>
                        <p className="text-xs text-muted-foreground mt-0.5">You&apos;re all caught up!</p>
                    </div>
                ) : (
                    displayTasks.map(task => (
                        <Card key={task.id} className="border-border/50 rounded-xl hover:border-border transition-colors">
                            <CardContent className="p-3 flex items-start gap-3">
                                <Checkbox
                                    id={`task-${task.id}`}
                                    checked={false}
                                    onCheckedChange={() => handleToggle(task.id, task.status)}
                                    className="mt-1"
                                />
                                <div className="flex-1 space-y-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <label
                                            htmlFor={`task-${task.id}`}
                                            className="text-sm font-medium leading-none cursor-pointer flex items-center gap-2 min-w-0 text-foreground"
                                        >
                                            <span className="truncate">{task.title}</span>
                                            {task.priority === 'high' && <Badge variant="destructive" className="shrink-0 text-[10px] h-5 px-1.5 uppercase font-semibold rounded-md border-0"><AlertCircle className="w-3 h-3 mr-0.5" /> High</Badge>}
                                        </label>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <div className="text-xs text-muted-foreground flex items-center gap-1 bg-muted px-2 py-0.5 rounded-md">
                                                <Clock className="w-3 h-3" /> 30m
                                            </div>
                                            {canEdit && (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                        onClick={() => setEditingTask(task)}
                                                        aria-label="Edit task"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                        onClick={() => handleDelete(task.id)}
                                                        aria-label="Delete task"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        {task.due_date && (
                                            <span className={`flex items-center gap-1 ${new Date(task.due_date) < new Date() ? 'text-destructive font-medium' : ''}`}>
                                                <Calendar className="w-3 h-3" />
                                                {format(new Date(task.due_date), "MMM d, h:mm a")}
                                            </span>
                                        )}
                                        {task.leads && <span><span className="mr-1">Lead:</span><span className="text-foreground hover:underline font-medium">{task.leads.name}</span></span>}
                                        {task.deals && <span><span className="mr-1">Deal:</span><span className="text-foreground hover:underline font-medium">{task.deals.title}</span></span>}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            <Dialog open={!!editingTask} onOpenChange={(open) => { if (!open) setEditingTask(null) }}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Edit Task</DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            Update the title, due date, or priority.
                        </DialogDescription>
                    </DialogHeader>
                    {editingTask && (
                        <form onSubmit={onEditSubmit}>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-title" className="text-right font-medium">Title</Label>
                                    <Input id="edit-title" name="title" defaultValue={editingTask.title || ''} className="col-span-3" required />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-due_date" className="text-right font-medium">Due Date</Label>
                                    <Input id="edit-due_date" name="due_date" type="datetime-local" defaultValue={toLocalInput(editingTask.due_date)} className="col-span-3 [color-scheme:light] dark:[color-scheme:dark]" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-priority" className="text-right font-medium">Priority</Label>
                                    <Select name="priority" defaultValue={editingTask.priority || 'normal'}>
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue placeholder="Select Priority" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="low">Low</SelectItem>
                                            <SelectItem value="normal">Normal</SelectItem>
                                            <SelectItem value="high">High</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setEditingTask(null)} className="rounded-lg">Cancel</Button>
                                <Button type="submit" className="rounded-lg bg-primary text-primary-foreground shadow-xs">Save Changes</Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

