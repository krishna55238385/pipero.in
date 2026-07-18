'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, Check } from 'lucide-react'
import { markAsRead, getNotifications } from '@/app/actions/notifications'
import Link from 'next/link'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

export function NotificationBell({ initialNotifications, userId }: { initialNotifications: any[], userId?: string }) {
    const [notifications, setNotifications] = useState(initialNotifications)
    const [isOpen, setIsOpen] = useState(false)
    const popoverRef = useRef<HTMLDivElement>(null)
    const router = useRouter()

    const unreadCount = notifications.filter(n => !n.read_at).length
    const displayList = notifications.slice(0, 5)

    useEffect(() => {
        setNotifications(initialNotifications)
    }, [initialNotifications])

    useEffect(() => {
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

        const interval = setInterval(async () => {
            const latest = await getNotifications()
            setNotifications(prev => {
                const prevIds = new Set(prev.map(n => n.id))
                const fresh = latest.filter(n => !prevIds.has(n.id))
                fresh.forEach(n => {
                    toast(n.title, {
                        description: n.content,
                        action: n.link_url ? {
                            label: 'View',
                            onClick: () => router.push(n.link_url)
                        } : undefined
                    })
                })
                return latest
            })
        }, 30000)

        return () => clearInterval(interval)
    }, [userId, router])

    const handleMarkAsRead = async (e: React.MouseEvent, id: string) => {
        e.preventDefault()
        e.stopPropagation()
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
                className="relative flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 hover:bg-accent cursor-pointer"
                aria-label="Notifications"
            >
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500 px-[3px] text-[8px] font-bold text-white ring-1 ring-background">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-card rounded-xl border border-border/40 shadow-lg shadow-black/5 overflow-hidden z-50 animate-scale-in">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
                        <h3 className="font-semibold text-foreground flex items-center gap-2 text-sm">
                            Notifications
                            {unreadCount > 0 && (
                                <span className="bg-primary/10 text-primary text-[10px] px-2 py-0.5 rounded-full font-semibold">
                                    {unreadCount} new
                                </span>
                            )}
                        </h3>
                        <Link
                            href="/notifications"
                            className="text-xs text-primary hover:underline font-medium"
                            onClick={() => setIsOpen(false)}
                        >
                            View all
                        </Link>
                    </div>

                    <div className="max-h-[min(calc(100vh-120px),400px)] overflow-y-auto">
                        {displayList.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                You have no notifications.
                            </div>
                        ) : (
                            displayList.map((notif) => (
                                <div
                                    key={notif.id}
                                    onClick={() => handleItemClick(notif.link_url)}
                                    className={`group flex gap-3 p-4 hover:bg-accent/50 transition-colors border-b border-border/10 last:border-0 cursor-pointer ${!notif.read_at ? 'bg-primary/5' : ''}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm ${!notif.read_at ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                                            {notif.title}
                                        </p>
                                        {notif.content && (
                                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                                                {notif.content}
                                            </p>
                                        )}
                                        <p className="text-xs text-muted-foreground/60 mt-1.5">
                                            {new Date(notif.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    <div className="flex items-start gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {!notif.read_at && (
                                            <button
                                                onClick={(e) => handleMarkAsRead(e, notif.id)}
                                                className="p-1.5 text-primary hover:bg-primary/10 rounded-md transition-colors cursor-pointer"
                                                title="Mark as read"
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {displayList.length > 0 && notifications.length > 5 && (
                        <div className="p-2 border-t border-border/20 bg-muted/30 text-center">
                            <Link
                                href="/notifications"
                                className="text-xs text-muted-foreground hover:text-foreground font-medium block py-1.5"
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
