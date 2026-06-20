'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Building, Phone, Calendar as CalendarIcon, ArrowLeft, Mail, MessageSquare, Activity, ListTodo, MoreHorizontal, User, MapPin, Globe, CheckCircle2, Circle, Send, Share2, Trash2, ArrowRight, BookOpen, Megaphone, GraduationCap, Clock } from "lucide-react"
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import ActivityFeed from '@/components/dashboard/ActivityFeed'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { toast } from 'sonner'
import { format } from 'date-fns'
import { toggleTaskCompletion, logLeadInteraction, addTask, forwardLead, deleteLead, getOrgMembers, updateLeadField } from '@/app/actions/crm'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter } from 'next/navigation'
import { sendWhatsAppMessage, getMessages } from '@/app/actions/interakt'
import { useEffect } from 'react'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { formatPhoneUS } from '@/lib/formatters'

export default function LeadDetailClient({
    lead,
    activities: initialActivities,
    tasks: initialTasks,
    members = [],
    leadStatuses = []
}: {
    lead: any,
    activities: any[],
    tasks: any[],
    members?: any[],
    leadStatuses?: any[]
}) {
    const { userRole, permissions } = useWorkspace()
    const router = useRouter()

    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const canDelete = isCoreAdmin || permissions?.leads?.delete !== false
    const [noteText, setNoteText] = useState('')
    const [emailSubject, setEmailSubject] = useState('')
    const [emailText, setEmailText] = useState('')
    const [waText, setWaText] = useState('')
    const [tasks, setTasks] = useState(initialTasks || [])
    const [activities, setActivities] = useState(initialActivities || [])
    const [isFollowUpOpen, setIsFollowUpOpen] = useState(false)
    const [isSubmittingTask, setIsSubmittingTask] = useState(false)

    // Forward state
    const [forwardDialogOpen, setForwardDialogOpen] = useState(false)
    const [forwardMembers, setForwardMembers] = useState<any[]>([])
    const [forwardToUserId, setForwardToUserId] = useState('')
    const [forwardNote, setForwardNote] = useState('')
    const [isForwarding, setIsForwarding] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [leadStatus, setLeadStatus] = useState(lead.status || 'New')
    const [messages, setMessages] = useState<any[]>([])
    const [isLoadingMessages, setIsLoadingMessages] = useState(false)

    useEffect(() => {
        const fetchMessages = async () => {
            if (lead.id) {
                setIsLoadingMessages(true)
                try {
                    // We need a conversation ID. For now, let's fetch by lead.
                    // Improving getMessages to handle leadId or conversationId would be better.
                    // But our interakt.ts getMessages needs conversationId.
                    // Let's assume lead.id can be used to find conversation first.
                    // To keep it simple for now, I'll just use the activity log as a fallback 
                    // OR I will update LeadDetailPage to pass initial messages.
                } catch (e) {
                    console.error(e)
                } finally {
                    setIsLoadingMessages(false)
                }
            }
        }
        fetchMessages()
    }, [lead.id])

    const openForwardDialog = async () => {
        setForwardToUserId('')
        setForwardNote('')
        if (forwardMembers.length === 0) {
            const members = await getOrgMembers()
            setForwardMembers(members)
        }
        setForwardDialogOpen(true)
    }

    const handleForwardLead = async () => {
        if (!forwardToUserId) { toast.error('Please select a team member'); return }
        setIsForwarding(true)
        const res = await forwardLead(lead.id, forwardToUserId, forwardNote || undefined)
        if (res?.error) toast.error(res.error)
        else {
            toast.success(`"${lead.name}" forwarded successfully!`)
            setForwardDialogOpen(false)
        }
        setIsForwarding(false)
    }

    const handleDeleteLead = async () => {
        if (!confirm(`Are you sure you want to permanently delete "${lead.name}" and all its data? This cannot be undone.`)) return
        setIsDeleting(true)
        const res = await deleteLead(lead.id)
        if (res?.success) {
            toast.success('Lead deleted successfully')
            router.push('/leads')
        } else {
            toast.error(res?.error || 'Failed to delete lead')
            setIsDeleting(false)
        }
    }

    const EMAIL_TEMPLATES = [
        {
            label: '📩 Introduction',
            subject: `Introduction — ${lead.name}`,
            body: `Hi ${lead.contact_person || 'there'},\n\nI wanted to reach out and introduce myself. We help B2B teams like yours streamline their sales process.\n\nWould you be open to a quick 15-minute call to explore how we might help ${lead.name}?\n\nLooking forward to connecting!\n\nBest regards`
        },
        {
            label: '🔁 Follow-Up',
            subject: `Following up — ${lead.name}`,
            body: `Hi ${lead.contact_person || 'there'},\n\nJust following up on our previous conversation. I wanted to check if you had any questions or if there was anything I could help clarify.\n\nPlease let me know a good time to connect.\n\nBest regards`
        },
        {
            label: '📄 Proposal Sent',
            subject: `Proposal for ${lead.name}`,
            body: `Hi ${lead.contact_person || 'there'},\n\nThank you for your time earlier. As discussed, I'm sharing the proposal for your review.\n\nPlease find the details attached. I'd love to walk you through it on a call — let me know your availability.\n\nBest regards`
        },
        {
            label: '📅 Meeting Reminder',
            subject: `Reminder: Our upcoming meeting — ${lead.name}`,
            body: `Hi ${lead.contact_person || 'there'},\n\nThis is a friendly reminder about our scheduled meeting. Looking forward to our conversation!\n\nPlease feel free to reach out if you'd like to reschedule.\n\nBest regards`
        },
        {
            label: '✅ Deal Closed',
            subject: `Welcome aboard — ${lead.name}!`,
            body: `Hi ${lead.contact_person || 'there'},\n\nWe're thrilled to confirm your onboarding with us! Our team will be in touch shortly to get everything set up.\n\nThank you for choosing us — we're looking forward to working together.\n\nBest regards`
        }
    ]

    const WA_TEMPLATES = [
        { label: '👋 Introduction', body: `Hi ${lead.contact_person || 'there'}! This is [Your Name] from [Company]. We help businesses like ${lead.name} grow faster. Would you be open to a quick chat? 🙏` },
        { label: '🔁 Follow-Up', body: `Hi ${lead.contact_person || 'there'}! Just checking in from our last conversation. Any questions I can help with? 😊` },
        { label: '📄 Proposal Ready', body: `Hi! Our proposal for ${lead.name} is ready. Can I share it with you? Should only take a quick look 👀` },
        { label: '📅 Meeting Tomorrow', body: `Hi ${lead.contact_person || 'there'}! Just a quick reminder — we have a meeting scheduled tomorrow. Looking forward to it! 🗓️` }
    ]

    const pushActivity = (type: string, content: string) => {
        const newLog = {
            id: Math.random().toString(),
            action: type,
            details: `A team member ${content}`,
            created_at: new Date().toISOString(),
            leads: [{ name: lead.name }],
            deals: []
        }
        setActivities((prev: any[]) => [newLog, ...prev])
    }

    const handleLogInteraction = async (type: 'note' | 'email' | 'whatsapp', content: string) => {
        if (!content.trim()) return

        try {
            await logLeadInteraction(lead.id, type, content)
            toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} logged successfully!`)
            pushActivity(type, content)
        } catch (error) {
            toast.error('Failed to log interaction')
        }

        if (type === 'note') setNoteText('')
        if (type === 'email') {
            window.open(`mailto:${lead.email || ''}?subject=Connecting with ${lead.name}&body=${encodeURIComponent(content)}`, '_blank')
            setEmailText('')
        }
        if (type === 'whatsapp') {
            if (lead.phone_number) {
                try {
                    const res = await sendWhatsAppMessage(lead.id, content)
                    if (res.success) {
                        toast.success('WhatsApp message sent via Interakt!')
                        setWaText('')
                        pushActivity('whatsapp', content)
                    }
                } catch (error) {
                    toast.error('Failed to send WhatsApp message')
                }
            } else {
                toast.error('No phone number available to send WhatsApp')
            }
        }
    }

    const handleCreateFollowUp = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsSubmittingTask(true)
        const formData = new FormData(e.currentTarget)
        formData.append('lead_id', lead.id)

        try {
            await addTask(formData)
            toast.success("Follow-up scheduled successfully!")
            setIsFollowUpOpen(false)
            // Ideally we'd refresh the tasks prop here from the server or push to local state
            // Next.js server actions revalidatePath might be enough if router.refresh() triggers it.
            // For immediate UI update, we can push a fake task:
            const newTask = {
                id: Math.random().toString(),
                title: formData.get('title') as string,
                due_date: formData.get('due_date') as string,
                priority: formData.get('priority') as string,
                status: 'pending'
            }
            setTasks([...tasks, newTask])
        } catch (error) {
            toast.error("Failed to schedule follow-up")
        } finally {
            setIsSubmittingTask(false)
        }
    }

    const handleToggleTask = async (taskId: string, currentStatus: string) => {
        const newStatus = currentStatus === 'completed' ? 'pending' : 'completed'
        setTasks(tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
        try {
            await toggleTaskCompletion(taskId, newStatus === 'completed')
            toast.success(`Task marked as ${newStatus}`)
        } catch (error) {
            toast.error('Failed to update task')
            setTasks(tasks.map(t => t.id === taskId ? { ...t, status: currentStatus } : t))
        }
    }

    const handleForwardLeadStub = handleForwardLead // alias — handled above

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-12">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-4">
                    <Link href="/leads">
                        <Button variant="ghost" size="icon" className="hover:bg-slate-100 dark:hover:bg-slate-800">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
                            {lead.name}
                            <Badge variant="outline" className={`
                                ${lead.temperature === 'hot' ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400' : ''}
                                ${lead.temperature === 'warm' ? 'border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950 dark:text-orange-400' : ''}
                                ${lead.temperature === 'cold' ? 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-400' : ''}
                            `}>
                                {lead.temperature || 'Unknown'}
                            </Badge>
                        </h1>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
                            <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {lead.contact_person || 'No Contact'}</span>
                            <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {formatPhoneUS(lead.phone_number) || 'No Phone'}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {/* Clickable status selector */}
                    <div className="relative">
                        <select
                            value={leadStatus}
                            onChange={async (e) => {
                                const newStatus = e.target.value
                                setLeadStatus(newStatus)
                                const res = await updateLeadField(lead.id, 'status', newStatus as any)
                                if (res?.error) {
                                    toast.error('Failed to update status')
                                    setLeadStatus(lead.status)
                                } else {
                                    toast.success(`Status updated to "${newStatus}"`)
                                }
                            }}
                            className={`
                                appearance-none text-sm font-semibold px-4 py-1.5 pr-8 rounded-full border cursor-pointer
                                focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors
                            `}
                            style={{
                                backgroundColor: leadStatuses.find(s => s.label === leadStatus)?.color || '#94a3b8',
                                color: 'white'
                            }}
                            title="Click to change status"
                        >
                            {leadStatuses.map(s => {
                                const label = s.label.toLowerCase()
                                let emoji = ''
                                if (label === 'new') emoji = '✨ '
                                if (label === 'contacted') emoji = '📞 '
                                if (label === 'qualified') emoji = '✅ '
                                if (label === 'proposal sent') emoji = '📄 '
                                if (label === 'won') emoji = '🏆 '
                                if (label === 'lost') emoji = '❌ '
                                return (
                                    <option key={s.id} value={s.label} className="bg-white text-slate-900">{emoji}{s.label}</option>
                                )
                            })}
                        </select>
                        <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-current opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                    {lead.health_score !== undefined && (
                        <div className="flex items-center gap-2 bg-white dark:bg-card border border-slate-200 dark:border-border px-3 py-1.5 rounded-full text-sm font-medium shadow-sm">
                            <span className="text-slate-500">Score</span>
                            <span className={lead.health_score >= 70 ? 'text-green-600' : lead.health_score >= 40 ? 'text-orange-500' : 'text-red-500'}>
                                {lead.health_score}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Master Navigation Tabs */}
            <Tabs defaultValue="basic" className="w-full">
                <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent p-0 overflow-x-auto flex-nowrap hide-scrollbar">
                    <TabsTrigger value="basic" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
                        Basic Info
                    </TabsTrigger>
                    <TabsTrigger value="followups" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
                        Follow-ups
                    </TabsTrigger>
                    <TabsTrigger value="communication" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
                        Communication
                    </TabsTrigger>
                    <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
                        Activity Log
                    </TabsTrigger>
                    <TabsTrigger value="other" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
                        Other / Actions
                    </TabsTrigger>
                </TabsList>

                <div className="mt-6">
                    {/* TAB 1: BASIC INFORMATION */}
                    <TabsContent value="basic" className="m-0 space-y-6 animate-in fade-in-50 duration-300">
                        <div className="grid gap-6 md:grid-cols-2">
                            <Card className="shadow-sm border-slate-200 dark:border-border">
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2"><Building className="h-5 w-5 text-indigo-500" /> Company Profile</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Company Name</div>
                                        <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground">{lead.name || '-'}</div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Location</div>
                                        <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                            <MapPin className="h-3.5 w-3.5 text-slate-400" /> {lead.location || 'Not specified'}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Source</div>
                                        <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                            <Globe className="h-3.5 w-3.5 text-slate-400" /> {lead.source || 'Website'}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Created On</div>
                                        <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                            <CalendarIcon className="h-3.5 w-3.5 text-slate-400" /> {format(new Date(lead.created_at), 'PPP')}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="shadow-sm border-slate-200 dark:border-border">
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5 text-blue-500" /> Primary Contact</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Full Name</div>
                                        <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground">{lead.contact_person || '-'}</div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Phone Number</div>
                                        <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                            <Phone className="h-3.5 w-3.5 text-slate-400" /> {formatPhoneUS(lead.phone_number) || '-'}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Email</div>
                                        <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                            <Mail className="h-3.5 w-3.5 text-slate-400" /> {lead.email ? (
                                                <a href={`mailto:${lead.email}`} className="text-blue-600 dark:text-blue-400 hover:underline">{lead.email}</a>
                                            ) : '-'}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Tags</div>
                                        <div className="col-span-2 flex flex-wrap gap-2">
                                            {lead.tags && lead.tags.length > 0 ? (
                                                lead.tags.map((tag: string, i: number) => (
                                                    <Badge key={i} variant="outline" className="bg-slate-50 dark:bg-secondary">
                                                        {tag}
                                                    </Badge>
                                                ))
                                            ) : (
                                                <span className="text-sm text-slate-400 italic">No tags</span>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {(lead.subject || lead.campaign || lead.grade_level || lead.demo_date || lead.demo_time_slot || (lead.utm_metadata && Object.keys(lead.utm_metadata).length > 0)) && (
                                <Card className="shadow-sm border-slate-200 dark:border-border">
                                    <CardHeader>
                                        <CardTitle className="text-lg flex items-center gap-2"><Megaphone className="h-5 w-5 text-amber-500" /> Landing / Campaign</CardTitle>
                                        <CardDescription>Subject, campaign, demo scheduling and UTM data from the landing page.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {lead.subject && (
                                            <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                                <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Subject</div>
                                                <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                                    <BookOpen className="h-3.5 w-3.5 text-slate-400" /> {lead.subject}
                                                </div>
                                            </div>
                                        )}
                                        {lead.campaign && (
                                            <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                                <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Campaign</div>
                                                <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                                    <Megaphone className="h-3.5 w-3.5 text-slate-400" /> {lead.campaign}
                                                </div>
                                            </div>
                                        )}
                                        {lead.grade_level && (
                                            <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                                <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Grade Level</div>
                                                <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                                    <GraduationCap className="h-3.5 w-3.5 text-slate-400" /> {lead.grade_level}
                                                </div>
                                            </div>
                                        )}
                                        {lead.demo_date && (
                                            <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                                <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Demo Date</div>
                                                <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                                    <CalendarIcon className="h-3.5 w-3.5 text-slate-400" /> {format(new Date(lead.demo_date), 'PPP')}
                                                </div>
                                            </div>
                                        )}
                                        {lead.demo_time_slot && (
                                            <div className="grid grid-cols-3 gap-4 border-b dark:border-border pb-4">
                                                <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">Time Slot</div>
                                                <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground flex items-center gap-2">
                                                    <Clock className="h-3.5 w-3.5 text-slate-400" /> {lead.demo_time_slot}
                                                </div>
                                            </div>
                                        )}
                                        {lead.utm_metadata && typeof lead.utm_metadata === 'object' && Object.keys(lead.utm_metadata).length > 0 && (
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="col-span-1 text-sm text-slate-500 dark:text-muted-foreground">UTM / Campaign Metadata</div>
                                                <div className="col-span-2 text-sm font-medium text-slate-900 dark:text-foreground">
                                                    <pre className="text-xs bg-slate-50 dark:bg-secondary/50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{JSON.stringify(lead.utm_metadata, null, 2)}</pre>
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            )}
                        </div>

                        <Card className="shadow-sm border-slate-200 dark:border-border">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg">Associated Deals</CardTitle>
                                    <CardDescription>Pipeline opportunities linked to this lead.</CardDescription>
                                </div>
                                <Link href="/deals"><Button size="sm" variant="outline"><ListTodo className="h-4 w-4 mr-2" /> View Pipeline</Button></Link>
                            </CardHeader>
                            <CardContent>
                                {lead.deals && lead.deals.length > 0 ? (
                                    <div className="rounded-xl border dark:border-border overflow-hidden">
                                        <div className="grid grid-cols-12 bg-slate-50 dark:bg-secondary/50 p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            <div className="col-span-5">Deal Title</div>
                                            <div className="col-span-3">Stage</div>
                                            <div className="col-span-2">Value</div>
                                            <div className="col-span-2 text-right">Date</div>
                                        </div>
                                        <div className="divide-y dark:divide-slate-800">
                                            {lead.deals.map((deal: any) => (
                                                <div key={deal.id} className="grid grid-cols-12 p-4 text-sm items-center hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                    <div className="col-span-5 font-medium text-slate-900 dark:text-foreground">{deal.title}</div>
                                                    <div className="col-span-3">
                                                        <Badge
                                                            variant="secondary"
                                                            style={{
                                                                backgroundColor: leadStatuses.find(s => s.label === deal.status)?.color || '#94a3b8',
                                                                color: 'white'
                                                            }}
                                                            className="capitalize"
                                                        >
                                                            {deal.status}
                                                        </Badge>
                                                    </div>
                                                    <div className="col-span-2 font-bold text-green-600 dark:text-green-500">${Number(deal.value).toLocaleString()}</div>
                                                    <div className="col-span-2 text-right text-slate-500">{format(new Date(deal.created_at), 'MMM d, yy')}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-10 bg-slate-50 dark:bg-card/30 border border-dashed border-slate-200 dark:border-border rounded-xl">
                                        <div className="mx-auto w-12 h-12 bg-slate-100 dark:bg-secondary rounded-full flex items-center justify-center mb-3">
                                            <Building className="h-6 w-6 text-slate-400" />
                                        </div>
                                        <h3 className="text-sm font-medium text-slate-900 dark:text-foreground">No active deals</h3>
                                        <p className="text-sm text-slate-500 mb-4 mt-1">There are no pipeline opportunities associated with this lead yet.</p>
                                        <Link href="/deals">
                                            <Button size="sm">Create a Deal</Button>
                                        </Link>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TAB 2: FOLLOW-UPS */}
                    <TabsContent value="followups" className="m-0 animate-in fade-in-50 duration-300">
                        <Card className="shadow-sm border-slate-200 dark:border-border min-h-[500px]">
                            <CardHeader className="flex flex-row items-center justify-between border-b dark:border-border pb-6">
                                <div>
                                    <CardTitle className="text-lg flex items-center gap-2"><ListTodo className="h-5 w-5 text-purple-500" /> Scheduled Follow-ups</CardTitle>
                                    <CardDescription>Manage tasks and scheduled calls for this lead.</CardDescription>
                                </div>
                                <Dialog open={isFollowUpOpen} onOpenChange={setIsFollowUpOpen}>
                                    <DialogTrigger asChild>
                                        <Button size="sm">Schedule Follow-up</Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-[480px]">
                                        <DialogHeader>
                                            <DialogTitle>Schedule a Follow-up</DialogTitle>
                                        </DialogHeader>
                                        <form onSubmit={handleCreateFollowUp} className="space-y-4 mt-2">
                                            <div className="space-y-1">
                                                <Label htmlFor="followup-title">Task Title</Label>
                                                <Input id="followup-title" name="title" placeholder="e.g., Call to check on proposal" required />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="followup-desc">Description (optional)</Label>
                                                <Textarea id="followup-desc" name="description" placeholder="Any notes for this task..." className="resize-none min-h-[80px]" />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1">
                                                    <Label htmlFor="followup-due">Due Date</Label>
                                                    <Input id="followup-due" name="due_date" type="datetime-local" required />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label htmlFor="followup-priority">Priority</Label>
                                                    <Select name="priority" defaultValue="medium">
                                                        <SelectTrigger id="followup-priority">
                                                            <SelectValue placeholder="Select priority" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="high">High</SelectItem>
                                                            <SelectItem value="medium">Medium</SelectItem>
                                                            <SelectItem value="low">Low</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="space-y-1">
                                                <Label htmlFor="assigned_to">Assign To</Label>
                                                <Select name="assigned_to" defaultValue="none">
                                                    <SelectTrigger id="assigned_to">
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

                                            <Button type="submit" className="w-full" disabled={isSubmittingTask}>
                                                {isSubmittingTask ? 'Scheduling...' : 'Schedule Follow-up'}
                                            </Button>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            </CardHeader>
                            <CardContent className="p-0">
                                {tasks.length > 0 ? (
                                    <div className="divide-y dark:divide-slate-800">
                                        {tasks.map((task: any) => (
                                            <div key={task.id} className="p-4 flex items-center space-x-4 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                                                <button
                                                    onClick={() => handleToggleTask(task.id, task.status)}
                                                    className="flex-shrink-0 focus:outline-none"
                                                >
                                                    {task.status === 'completed' ? (
                                                        <CheckCircle2 className="h-6 w-6 text-green-500" />
                                                    ) : (
                                                        <Circle className="h-6 w-6 text-slate-300 dark:text-slate-600 hover:text-slate-400" />
                                                    )}
                                                </button>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-sm font-medium ${task.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-900 dark:text-foreground'}`}>
                                                        {task.title}
                                                    </p>
                                                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                                                        <span className={new Date(task.due_date) < new Date() && task.status !== 'completed' ? 'text-red-500 font-medium' : ''}>
                                                            Due: {format(new Date(task.due_date), 'PPP')}
                                                        </span>
                                                        {task.priority && (
                                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 lowercase
                                                                ${task.priority === 'high' ? 'border-red-500 text-red-500' : ''}
                                                                ${task.priority === 'medium' ? 'border-orange-500 text-orange-500' : ''}
                                                            `}>
                                                                {task.priority}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-20 text-center">
                                        <div className="h-16 w-16 bg-slate-100 dark:bg-secondary rounded-full flex items-center justify-center mb-4">
                                            <ListTodo className="h-8 w-8 text-slate-400" />
                                        </div>
                                        <h3 className="text-base font-semibold text-slate-900 dark:text-foreground mb-2">No follow-ups scheduled</h3>
                                        <p className="text-sm text-slate-500 max-w-sm mb-6">Stay on top of this lead by scheduling a call, email, or meeting.</p>
                                        <Button variant="outline" onClick={() => setIsFollowUpOpen(true)}>Schedule your first follow-up</Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TAB 3: COMMUNICATION */}
                    <TabsContent value="communication" className="m-0 animate-in fade-in-50 duration-300 space-y-6">

                        {/* COMPOSER CARD */}
                        <Card className="shadow-sm border-slate-200 dark:border-border">
                            <CardHeader className="border-b dark:border-border pb-4">
                                <CardTitle className="text-lg flex items-center gap-2"><Send className="h-5 w-5 text-blue-500" /> New Message</CardTitle>
                                <CardDescription>Log an internal note, send a WhatsApp, or compose an email.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6">
                                <Tabs defaultValue="note" className="w-full">
                                    <TabsList className="grid w-full grid-cols-3 mb-6 bg-slate-100 dark:bg-secondary p-1 rounded-xl">
                                        <TabsTrigger value="note" className="rounded-lg"><Activity className="h-4 w-4 mr-2" /> Note</TabsTrigger>
                                        <TabsTrigger value="whatsapp" className="rounded-lg"><MessageSquare className="h-4 w-4 mr-2" /> WhatsApp</TabsTrigger>
                                        <TabsTrigger value="email" className="rounded-lg"><Mail className="h-4 w-4 mr-2" /> Email</TabsTrigger>
                                    </TabsList>
                                    <div className="bg-slate-50 dark:bg-card/30 border dark:border-border rounded-xl p-4">

                                        {/* INTERNAL NOTE */}
                                        <TabsContent value="note" className="m-0 space-y-3">
                                            <p className="text-xs text-slate-500">Internal notes are visible only to your team and are saved to the activity log.</p>
                                            <Textarea
                                                placeholder="Add a quick internal note about this prospect..."
                                                className="min-h-[120px] text-sm border-slate-200 dark:border-border resize-none bg-white dark:bg-card"
                                                value={noteText}
                                                onChange={(e) => setNoteText(e.target.value)}
                                            />
                                            <div className="flex justify-end">
                                                <Button onClick={() => handleLogInteraction('note', noteText)}>Save Note</Button>
                                            </div>
                                        </TabsContent>

                                        {/* WHATSAPP */}
                                        <TabsContent value="whatsapp" className="m-0 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs text-slate-500">Opens WhatsApp Web with {formatPhoneUS(lead.phone_number) || 'this lead'} pre-filled.</p>
                                                <Select onValueChange={(val) => { const t = WA_TEMPLATES.find(t => t.label === val); if (t) setWaText(t.body) }}>
                                                    <SelectTrigger className="w-auto h-8 text-xs">
                                                        <SelectValue placeholder="Use Template" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {WA_TEMPLATES.map(t => (
                                                            <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <Textarea
                                                placeholder="Hi there, checking in on..."
                                                className="min-h-[120px] text-sm border-slate-200 dark:border-border resize-none bg-white dark:bg-card"
                                                value={waText}
                                                onChange={(e) => setWaText(e.target.value)}
                                            />
                                            <div className="flex justify-end gap-3">
                                                <Button variant="outline" onClick={() => handleLogInteraction('whatsapp', waText)}>Log Only</Button>
                                                <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleLogInteraction('whatsapp', waText)}>Send via WhatsApp</Button>
                                            </div>
                                        </TabsContent>

                                        {/* EMAIL */}
                                        <TabsContent value="email" className="m-0 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs text-slate-500">Opens your default mail client with the body pre-filled.</p>
                                                <Select onValueChange={(val) => { const t = EMAIL_TEMPLATES.find(t => t.label === val); if (t) { setEmailSubject(t.subject); setEmailText(t.body) } }}>
                                                    <SelectTrigger className="w-auto h-8 text-xs">
                                                        <SelectValue placeholder="Use Template" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {EMAIL_TEMPLATES.map(t => (
                                                            <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs text-slate-500">Subject</Label>
                                                <Input
                                                    placeholder={`Re: ${lead.name}`}
                                                    className="text-sm bg-white dark:bg-card"
                                                    value={emailSubject}
                                                    onChange={(e) => setEmailSubject(e.target.value)}
                                                />
                                            </div>
                                            <Textarea
                                                placeholder="Dear Prospect,"
                                                className="min-h-[150px] text-sm border-slate-200 dark:border-border resize-none bg-white dark:bg-card"
                                                value={emailText}
                                                onChange={(e) => setEmailText(e.target.value)}
                                            />
                                            <div className="flex justify-end gap-3">
                                                <Button variant="outline" onClick={() => handleLogInteraction('email', `Subject: ${emailSubject}\n\n${emailText}`)}>Log Only</Button>
                                                <Button onClick={() => {
                                                    handleLogInteraction('email', `Subject: ${emailSubject}\n\n${emailText}`)
                                                    window.open(`mailto:${lead.email || ''}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailText)}`, '_blank')
                                                }}>Open Mail Client</Button>
                                            </div>
                                        </TabsContent>
                                    </div>
                                </Tabs>
                            </CardContent>
                        </Card>

                        {/* COMMUNICATION HISTORY CARD */}
                        <Card className="shadow-sm border-slate-200 dark:border-border">
                            <CardHeader className="border-b dark:border-border pb-4">
                                <CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5 text-slate-500" /> Communication History</CardTitle>
                                <CardDescription>All messages, emails and notes logged with this lead.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-4">
                                {(() => {
                                    const commTypes = ['note', 'email', 'whatsapp']
                                    const commLogs = activities.filter((a: any) => commTypes.includes(a.action?.toLowerCase()))
                                    if (commLogs.length === 0) return (
                                        <div className="text-center py-12 text-slate-400 text-sm">
                                            <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                                            No communication logged yet. Send a note, WhatsApp or email above.
                                        </div>
                                    )
                                    return (
                                        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                                            {commLogs.map((log: any) => {
                                                const type = log.action?.toLowerCase()
                                                const isNote = type === 'note'
                                                const isEmail = type === 'email'
                                                const isWA = type === 'whatsapp'
                                                return (
                                                    <div key={log.id} className={`flex gap-3 items-start rounded-xl p-3 ${isNote ? 'bg-slate-100 dark:bg-secondary/60' :
                                                        isEmail ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40' :
                                                            'bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-900/40'
                                                        }`}>
                                                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${isNote ? 'bg-slate-500' :
                                                            isEmail ? 'bg-blue-500' :
                                                                'bg-green-500'
                                                            }`}>
                                                            {isNote ? '📝' : isEmail ? '📧' : '💬'}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className={`text-xs font-semibold uppercase tracking-wide ${isNote ? 'text-slate-500' :
                                                                    isEmail ? 'text-blue-600 dark:text-blue-400' :
                                                                        'text-green-600 dark:text-green-400'
                                                                    }`}>
                                                                    {isNote ? 'Internal Note' : isEmail ? 'Email' : 'WhatsApp'}
                                                                </span>
                                                                <span className="text-xs text-slate-400">
                                                                    {format(new Date(log.created_at), 'MMM d, h:mm a')}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-slate-700 dark:text-muted-foreground whitespace-pre-wrap">{log.details}</p>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )
                                })()}
                            </CardContent>
                        </Card>

                    </TabsContent>

                    {/* TAB 4: ACTIVITY LOG */}
                    <TabsContent value="activity" className="m-0 animate-in fade-in-50 duration-300">
                        <Card className="shadow-sm border-slate-200 dark:border-border">
                            <CardHeader className="border-b dark:border-border">
                                <CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5 text-orange-500" /> Activity History</CardTitle>
                                <CardDescription>A complete timeline of everything that has happened with this lead.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6">
                                <ActivityFeed
                                    activities={activities}
                                    title=""
                                    description=""
                                />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TAB 5: OTHER / ACTIONS */}
                    <TabsContent value="other" className="m-0 space-y-6 animate-in fade-in-50 duration-300">
                        <Card className="shadow-sm border-slate-200 dark:border-border">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2"><MoreHorizontal className="h-5 w-5 text-slate-500" /> Operational Actions</CardTitle>
                                <CardDescription>Advanced actions and forwarding rules for this prospect.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">

                                {/* Forward Lead */}
                                <div className="p-5 border dark:border-border rounded-xl bg-slate-50 dark:bg-card/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div>
                                        <h4 className="font-semibold text-slate-900 dark:text-foreground">Forward Lead</h4>
                                        <p className="text-sm text-slate-500 mt-1">Send this lead to a team member with an optional note.</p>
                                    </div>
                                    <Button onClick={openForwardDialog} className="gap-2 shrink-0">
                                        <Share2 className="h-4 w-4" /> Forward Lead
                                    </Button>
                                </div>

                                {/* Delete Lead */}
                                {canDelete && (
                                    <div className="p-5 border border-red-100 dark:border-red-900/30 rounded-xl bg-red-50/50 dark:bg-red-950/20 flex flex-col sm:flex-row items-center justify-between gap-4">
                                        <div>
                                            <h4 className="font-semibold text-red-700 dark:text-red-400">Danger Zone</h4>
                                            <p className="text-sm text-red-500/80 mt-1">Permanently delete this lead and all associated data.</p>
                                        </div>
                                        <Button variant="destructive" onClick={handleDeleteLead} disabled={isDeleting} className="gap-2 shrink-0">
                                            <Trash2 className="h-4 w-4" />
                                            {isDeleting ? 'Deleting...' : 'Delete Lead'}
                                        </Button>
                                    </div>
                                )}

                            </CardContent>
                        </Card>
                    </TabsContent>

                </div>
            </Tabs>

            {/* Forward Lead Dialog */}
            <Dialog open={forwardDialogOpen} onOpenChange={setForwardDialogOpen}>
                <DialogContent className="sm:max-w-[440px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Share2 className="h-5 w-5 text-blue-500" /> Forward: {lead.name}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 mt-2">
                        <div className="space-y-1">
                            <Label>Forward To <span className="text-red-500">*</span></Label>
                            <Select value={forwardToUserId} onValueChange={setForwardToUserId}>
                                <SelectTrigger><SelectValue placeholder="Select team member..." /></SelectTrigger>
                                <SelectContent>
                                    {forwardMembers.length === 0 && (
                                        <SelectItem value="__loading__" disabled>Loading members...</SelectItem>
                                    )}
                                    {forwardMembers.map(m => (
                                        <SelectItem key={m.id} value={m.id}>
                                            {m.full_name || 'Unnamed'} · {m.role}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Note (optional)</Label>
                            <Textarea
                                placeholder="Any context for the recipient..."
                                className="resize-none"
                                rows={3}
                                value={forwardNote}
                                onChange={e => setForwardNote(e.target.value)}
                            />
                        </div>
                        <Button
                            onClick={handleForwardLead}
                            disabled={isForwarding || !forwardToUserId}
                            className="w-full gap-2"
                        >
                            <ArrowRight className="h-4 w-4" />
                            {isForwarding ? 'Forwarding...' : 'Forward Lead'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

