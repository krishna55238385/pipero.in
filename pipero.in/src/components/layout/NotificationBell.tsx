'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { markAsRead } from '@/app/actions/notifications'
import Link from 'next/link'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

export function NotificationBell({ initialNotifications, userId }: { initialNotifications: any[], userId?: string }) {
    const [notifications, setNotifications] = useState(initialNotifications)
    const [isOpen, setIsOpen] = useState(false)
    const popoverRef = useRef<HTMLDivElement>(null)
    const supabase = createClient()
    const router = useRouter()

    const unreadCount = notifications.filter(n => !n.read_at).length
    const displayList = notifications.slice(0, 5)

    useEffect(() => {
        setNotifications(initialNotifications)
    }, [initialNotifications])

    useEffect(() => {
        // Handle click outside to close popover
        function handleClickOutside(event: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
        if (!userId) return

        const channel = supabase.channel('notification_changes')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
                (payload) => {
                    const newNotification = payload.new as any
                    setNotifications(prev => [newNotification, ...prev])
                    toast(newNotification.title, {
                        description: newNotification.content,
                        action: newNotification.link_url ? {
                            label: 'View',
                            onClick: () => router.push(newNotification.link_url)
                        } : undefined
                    })
                }
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
                (payload) => {
                    setNotifications(prev => prev.map(n => n.id === payload.new.id ? { ...n, ...payload.new } : n))
                }
            )
            .on(
                'postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
                (payload) => {
                    setNotifications(prev => prev.filter(n => n.id !== payload.old.id))
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [userId, supabase, router])

    const handleMarkAsRead = async (e: React.MouseEvent, id: string) => {
        e.preventDefault()
        e.stopPropagation()
        // Optimistic update
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
        await markAsRead([id])
    }

    const handleItemClick = (url?: string) => {
        setIsOpen(false)
        if (url) {
            router.push(url)
            router.refresh()
        }
    }

    return (
        <div className="relative" ref={popoverRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative hover:text-gray-900 dark:hover:text-white transition-colors p-1"
                aria-label="Notifications"
            >
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-red-500 px-[4px] text-[9px] font-bold text-white ring-2 ring-white dark:ring-black border-none">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white dark:bg-[#1a2235] rounded-2xl shadow-xl shadow-black/10 border border-gray-200 dark:border-border overflow-hidden z-50">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-border">
                        <h3 className="font-semibold text-gray-900 dark:text-foreground flex items-center gap-2 text-sm">
                            Notifications
                            {unreadCount > 0 && (
                                <span className="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                    {unreadCount} new
                                </span>
                            )}
                        </h3>
                        <Link
                            href="/notifications"
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            onClick={() => setIsOpen(false)}
                        >
                            View all
                        </Link>
                    </div>

                    <div className="max-h-[min(calc(100vh-120px),400px)] overflow-y-auto">
                        {displayList.length === 0 ? (
                            <div className="py-8 text-center text-sm text-gray-500 dark:text-muted-foreground">
                                You have no notifications.
                            </div>
                        ) : (
                            displayList.map((notif) => (
                                <div
                                    key={notif.id}
                                    onClick={() => handleItemClick(notif.link_url)}
                                    className={`group flex gap-3 p-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors border-b border-gray-50 dark:border-border last:border-0 cursor-pointer ${!notif.read_at ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm ${!notif.read_at ? 'font-semibold text-gray-900 dark:text-foreground' : 'text-gray-700 dark:text-muted-foreground'}`}>
                                            {notif.title}
                                        </p>
                                        {notif.content && (
                                            <p className="text-sm text-gray-500 dark:text-muted-foreground truncate mt-0.5">
                                                {notif.content}
                                            </p>
                                        )}
                                        <p className="text-xs text-gray-400 dark:text-muted-foreground mt-1.5">
                                            {new Date(notif.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    <div className="flex items-start gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {!notif.read_at && (
                                            <button
                                                onClick={(e) => handleMarkAsRead(e, notif.id)}
                                                className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                                                title="Mark as read"
                                            >
                                                <Check className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {displayList.length > 0 && notifications.length > 5 && (
                        <div className="p-2 border-t border-gray-100 dark:border-border bg-gray-50 dark:bg-[#1a2235]/50 text-center">
                            <Link
                                href="/notifications"
                                className="text-xs text-gray-600 dark:text-muted-foreground hover:text-gray-900 dark:hover:text-white font-medium block py-1.5"
                                onClick={() => setIsOpen(false)}
                            >
                                See {notifications.length - 5} more notifications
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

