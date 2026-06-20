'use client'

import { useState, useEffect } from 'react'
import { Bell, BellOff, Check, CheckSquare, Trash2, Mail, Users, Star, AlertCircle, Calendar, RefreshCw } from 'lucide-react'
import { markAsRead, markAllAsRead, deleteNotification } from '@/app/actions/notifications'
import Link from 'next/link'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Notification = {
    id: string;
    type: string;
    title: string;
    content: string;
    link_url: string;
    read_at: string | null;
    created_at: string;
    actor?: { id: string; full_name: string; avatar_url: string }
}

const TABS = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'leads', label: 'Leads' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'deals', label: 'Deals' },
    { id: 'system', label: 'System' },
]

function getIcon(type: string) {
    switch (type) {
        case 'assigned_lead': return <Users className="w-4 h-4 text-blue-500" />
        case 'deal_won': return <Star className="w-4 h-4 text-yellow-500" />
        case 'mentions': return <Mail className="w-4 h-4 text-purple-500" />
        case 'task_reminder': return <Calendar className="w-4 h-4 text-orange-500" />
        case 'system_alert': return <AlertCircle className="w-4 h-4 text-red-500" />
        default: return <Bell className="w-4 h-4 text-slate-400" />
    }
}

function getBg(type: string) {
    switch (type) {
        case 'assigned_lead': return 'bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/20'
        case 'deal_won': return 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-100 dark:border-yellow-500/20'
        case 'mentions': return 'bg-purple-50 dark:bg-purple-500/10 border-purple-100 dark:border-purple-500/20'
        case 'task_reminder': return 'bg-orange-50 dark:bg-orange-500/10 border-orange-100 dark:border-orange-500/20'
        case 'system_alert': return 'bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20'
        default: return 'bg-slate-50 dark:bg-secondary/50 border-slate-100 dark:border-border'
    }
}

function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d ago`
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function NotificationsClient({ initialData, userId }: { initialData: Notification[], userId?: string }) {
    const router = useRouter()
    const supabase = createClient()
    const [notifications, setNotifications] = useState(initialData)
    const [selectedTab, setSelectedTab] = useState('all')
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [isRefreshing, setIsRefreshing] = useState(false)

    // Real-time subscription — same as bell but for the full page
    useEffect(() => {
        if (!userId) return
        const channel = supabase.channel('notifications_page')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
                setNotifications(prev => [p.new as Notification, ...prev])
                toast.success((p.new as Notification).title, { description: (p.new as Notification).content })
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
                setNotifications(prev => prev.map(n => n.id === p.new.id ? { ...n, ...p.new } : n))
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
                setNotifications(prev => prev.filter(n => n.id !== p.old.id))
            })
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [userId])

    const filtered = notifications.filter(n => {
        if (selectedTab === 'unread') return !n.read_at
        if (selectedTab === 'leads') return ['assigned_lead', 'mentions'].includes(n.type)
        if (selectedTab === 'tasks') return n.type === 'task_reminder'
        if (selectedTab === 'deals') return n.type === 'deal_won'
        if (selectedTab === 'system') return n.type === 'system_alert'
        return true
    })

    const unreadCount = notifications.filter(n => !n.read_at).length

    const handleMarkAsRead = async (id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
        await markAsRead([id])
    }

    const handleMarkAllRead = async () => {
        setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
        await markAllAsRead()
        toast.success("All notifications marked as read")
    }

    const handleMarkSelectedRead = async () => {
        if (!selectedIds.size) return
        const ids = Array.from(selectedIds)
        setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n))
        await markAsRead(ids)
        setSelectedIds(new Set())
        toast.success(`${ids.length} notification${ids.length > 1 ? 's' : ''} marked as read`)
    }

    const handleDeleteSelected = async () => {
        if (!selectedIds.size) return
        const ids = Array.from(selectedIds)
        setNotifications(prev => prev.filter(n => !ids.includes(n.id)))
        setSelectedIds(new Set())
        await Promise.all(ids.map(id => deleteNotification(id)))
        toast.success(`${ids.length} notification${ids.length > 1 ? 's' : ''} deleted`)
    }

    const handleRefresh = async () => {
        setIsRefreshing(true)
        router.refresh()
        setTimeout(() => setIsRefreshing(false), 800)
    }

    const toggleSelection = (id: string) => {
        const s = new Set(selectedIds)
        s.has(id) ? s.delete(id) : s.add(id)
        setSelectedIds(s)
    }

    const allSelected = filtered.length > 0 && selectedIds.size === filtered.length

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-12">

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200 dark:border-border">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground flex items-center gap-3">
                        <Bell className="h-7 w-7 text-indigo-500 fill-indigo-100 dark:fill-indigo-500/20" />
                        Notifications
                        {unreadCount > 0 && (
                            <span className="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 text-sm px-2.5 py-0.5 rounded-full font-bold">
                                {unreadCount} new
                            </span>
                        )}
                    </h1>
                    <p className="text-slate-500 dark:text-muted-foreground text-sm mt-1">Alerts, mentions, and system updates — updated live.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleRefresh} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-secondary text-slate-500 dark:text-muted-foreground transition-colors">
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                    {unreadCount > 0 && (
                        <button onClick={handleMarkAllRead} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-500/20 transition-colors">
                            <CheckSquare className="w-4 h-4" /> Mark all read
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
                {TABS.map(tab => {
                    const count = tab.id === 'unread' ? unreadCount : tab.id === 'all' ? notifications.length : notifications.filter(n => {
                        if (tab.id === 'leads') return ['assigned_lead', 'mentions'].includes(n.type)
                        if (tab.id === 'tasks') return n.type === 'task_reminder'
                        if (tab.id === 'deals') return n.type === 'deal_won'
                        if (tab.id === 'system') return n.type === 'system_alert'
                        return false
                    }).length
                    return (
                        <button key={tab.id} onClick={() => setSelectedTab(tab.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${selectedTab === tab.id
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-600 dark:text-muted-foreground hover:bg-slate-100 dark:hover:bg-secondary'
                                }`}
                        >
                            {tab.label}
                            {count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${selectedTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-secondary/80 text-slate-600 dark:text-muted-foreground'}`}>{count}</span>}
                        </button>
                    )
                })}
            </div>

            {/* Bulk Actions Bar */}
            {filtered.length > 0 && (
                <div className="flex items-center justify-between bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl px-4 py-2.5 shadow-sm">
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(filtered.map(n => n.id)))}
                            className="rounded border-slate-300 dark:border-border text-indigo-600" />
                        <span className="text-sm text-slate-600 dark:text-muted-foreground font-medium">
                            {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select all ${filtered.length}`}
                        </span>
                    </label>
                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-2">
                            <button onClick={handleMarkSelectedRead} className="text-xs font-semibold text-slate-700 dark:text-muted-foreground hover:bg-slate-100 dark:hover:bg-secondary px-3 py-1.5 rounded-lg border border-slate-200 dark:border-border transition-colors flex items-center gap-1.5">
                                <Check className="w-3.5 h-3.5" /> Mark read
                            </button>
                            <button onClick={handleDeleteSelected} className="text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/20 transition-colors flex items-center gap-1.5">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Notification List */}
            <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-2xl shadow-sm overflow-hidden">
                {filtered.length === 0 ? (
                    <div className="py-20 text-center">
                        <div className="w-16 h-16 bg-slate-50 dark:bg-secondary/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100 dark:border-border">
                            <BellOff className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                        </div>
                        <p className="text-slate-500 dark:text-muted-foreground font-medium">No notifications here</p>
                        <p className="text-xs text-slate-400 dark:text-muted-foreground/60 mt-1">New notifications will appear here in real time</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-white/5">
                        {filtered.map((notif) => (
                            <div key={notif.id}
                                className={`group flex items-start gap-4 p-4 lg:p-5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03] ${!notif.read_at ? 'bg-indigo-50/30 dark:bg-indigo-900/[0.08]' : ''}`}
                            >
                                {/* Checkbox */}
                                <div className="pt-0.5 shrink-0">
                                    <input type="checkbox" checked={selectedIds.has(notif.id)} onChange={() => toggleSelection(notif.id)}
                                        className="rounded border-slate-300 dark:border-border text-indigo-600" />
                                </div>

                                {/* Icon */}
                                <div className={`shrink-0 mt-0.5 w-9 h-9 rounded-xl border flex items-center justify-center ${getBg(notif.type)}`}>
                                    {getIcon(notif.type)}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 break-words">
                                            {!notif.read_at && (
                                                <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full mr-2 mb-0.5 align-middle" />
                                            )}
                                            <span className={`text-sm ${!notif.read_at ? 'font-semibold text-slate-900 dark:text-foreground' : 'text-slate-700 dark:text-muted-foreground'}`}>
                                                {notif.link_url ? (
                                                    <Link href={notif.link_url} className="hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">
                                                        {notif.title}
                                                    </Link>
                                                ) : notif.title}
                                            </span>
                                        </div>
                                        <span className="text-[11px] text-slate-400 dark:text-muted-foreground whitespace-nowrap shrink-0">
                                            {timeAgo(notif.created_at)}
                                        </span>
                                    </div>
                                    {notif.content && (
                                        <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground leading-relaxed">{notif.content}</p>
                                    )}
                                    {notif.actor?.full_name && (
                                        <p className="mt-1 text-[11px] text-slate-400 dark:text-muted-foreground/60 flex items-center gap-1">
                                            by {notif.actor.full_name}
                                        </p>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {!notif.read_at && (
                                        <button onClick={() => handleMarkAsRead(notif.id)}
                                            className="p-1.5 text-indigo-600 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-500/20 rounded-md transition-colors"
                                            title="Mark as read"
                                        >
                                            <Check className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button onClick={async () => {
                                        setNotifications(prev => prev.filter(n => n.id !== notif.id))
                                        await deleteNotification(notif.id)
                                    }}
                                        className="p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 rounded-md transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
