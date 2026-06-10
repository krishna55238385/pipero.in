'use client'

import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Search, RefreshCw, MoreVertical } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useEffect, useState, useMemo } from "react"
import { getConversations, syncInteraktData } from "@/app/actions/interakt"
import { format, isToday, isYesterday } from "date-fns"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"

const formatMessageDate = (date: Date) => {
    if (isToday(date)) return format(date, 'HH:mm')
    if (isYesterday(date)) return 'Yesterday'
    return format(date, 'dd/MM/yy')
}

export function ConversationList({ activeId, onSelect }: { activeId?: string, onSelect: (id: string, lead: any) => void }) {
    const [conversations, setConversations] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    const fetch = async () => {
        try {
            const data = await getConversations()
            setConversations(data)
        } catch (e) {
            console.error('ConversationList error:', e)
        } finally {
            setLoading(false)
        }
    }

    const filteredConversations = useMemo(() => {
        if (!searchQuery.trim()) return conversations
        const q = searchQuery.toLowerCase()
        return conversations.filter(c =>
            c.leads?.name?.toLowerCase().includes(q) ||
            c.leads?.phone_number?.includes(q)
        )
    }, [conversations, searchQuery])

    const handleSync = async () => {
        setSyncing(true)
        const res = await syncInteraktData()
        if (res.success) {
            toast.success(`Synced ${res.count} contacts`)
            fetch()
        } else {
            toast.error("Sync failed: " + res.error)
        }
        setSyncing(false)
    }

    useEffect(() => {
        fetch()
        // ... (rest of useEffect)

        const supabase = createClient()
        const channel = supabase
            .channel('realtime_conversations')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'conversations'
                },
                (payload) => {
                    console.log('Realtime change in conversations:', payload)
                    fetch()
                }
            )
            .subscribe()
        const msgChannel = supabase
            .channel('realtime_messages_list')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'messages'
                },
                () => fetch()
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
            supabase.removeChannel(msgChannel)
        }
    }, [])

    return (
        <div className="flex flex-col w-[350px] h-full border-r border-gray-200 bg-[#ffffff] dark:bg-[#111b21] shrink-0 z-20">
            {/* Header */}
            <div className="p-3 border-b border-gray-100 dark:border-white/5 flex flex-col gap-3">
                <div className="flex items-center justify-between px-1">
                    <h2 className="font-bold text-lg tracking-tight text-gray-900 dark:text-white">Chats</h2>
                    <div className="flex items-center gap-0.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleSync}
                            disabled={syncing}
                            className="h-9 w-9 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full"
                        >
                            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                            <MoreVertical className="w-5 h-5" />
                        </Button>
                    </div>
                </div>

                <div className="relative group mx-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 transition-colors group-focus-within:text-green-600" />
                    <Input
                        placeholder="Search for chats"
                        className="pl-11 bg-gray-100 dark:bg-[#202c33] border-none h-10 rounded-full text-sm placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-gray-200 dark:focus-visible:ring-white/10"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
                <div className="flex flex-col">
                    {loading ? (
                        <div className="flex justify-center p-12"><RefreshCw className="animate-spin text-gray-300" /></div>
                    ) : filteredConversations.length === 0 ? (
                        <div className="p-12 text-center flex flex-col items-center gap-3">
                            <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-full">
                                <Search className="w-6 h-6 text-gray-300" />
                            </div>
                            <p className="text-sm text-gray-500 font-medium">No results found</p>
                        </div>
                    ) : (
                        filteredConversations.map((conv) => {
                            const hasUnread = conv.unread_count > 0
                            const lastMsg = conv.last_message
                            const isActive = activeId === conv.id

                            return (
                                <button
                                    key={conv.id}
                                    onClick={() => onSelect(conv.id, conv.leads)}
                                    className={`relative flex items-center gap-4 px-4 py-3 text-left transition-colors border-b border-gray-50/50 dark:border-white/5 ${isActive ? 'bg-gray-100 dark:bg-[#2a3942]' : 'bg-white dark:bg-transparent hover:bg-gray-50 dark:hover:bg-white/5'}`}
                                >
                                    <Avatar className="h-10 w-10 shrink-0 shadow-sm border border-gray-100 dark:border-none">
                                        <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${conv.leads?.name}&backgroundColor=60a5fa`} />
                                        <AvatarFallback className="bg-blue-100 text-blue-600 font-bold text-xs">{conv.leads?.name?.substring(0, 2)}</AvatarFallback>
                                    </Avatar>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className={`font-semibold text-[14px] truncate ${hasUnread ? 'text-black dark:text-white' : 'text-gray-900 dark:text-gray-200'}`}>
                                                {conv.leads?.name}
                                            </span>
                                            <span className={`text-[11px] whitespace-nowrap ml-2 ${hasUnread ? 'text-green-600 font-bold' : 'text-gray-500'}`}>
                                                {mounted && conv.last_customer_message_at ? formatMessageDate(new Date(conv.last_customer_message_at)) : ''}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between gap-2 overflow-hidden">
                                            <p className={`text-[13px] truncate flex-1 leading-tight ${hasUnread ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                                                {lastMsg ? lastMsg.content : 'New conversation'}
                                            </p>
                                            {hasUnread && (
                                                <div className="bg-[#25D366] text-white text-[10px] font-bold h-5 min-w-[20px] px-1.5 rounded-full flex items-center justify-center shadow-sm">
                                                    {conv.unread_count}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-[5px] bg-[#25D366]" />}
                                </button>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    )
}

