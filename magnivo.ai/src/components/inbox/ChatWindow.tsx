import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Send, Check, CheckCheck, Lightbulb, Paperclip, Smile, MoreVertical, Phone, Video, RefreshCw, ChevronDown, Image as ImageIcon, FileText, Music, PlayCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useEffect, useState, useRef } from "react"
import { getMessages, sendWhatsAppMessage, markAsRead, syncLeadMessages } from "@/app/actions/interakt"
import { format, isToday, isYesterday, isSameDay } from "date-fns"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const COMMON_EMOJIS = ["😊", "😂", "🥰", "👍", "🙏", "❤️", "🔥", "✨", "💯", "🙌", "🤔", "😮", "😢", "🎉", "😎", "🤝", "✅", "❌", "📍", "📞"]

const AttachmentMenu = ({ onSelect }: { onSelect: (type: string) => void }) => (
    <div className="flex flex-col p-2 bg-white dark:bg-[#233138] rounded-2xl shadow-xl border border-gray-100 dark:border-white/5 min-w-[160px] animate-in slide-in-from-bottom-2 duration-200">
        {[
            { id: 'image', icon: ImageIcon, label: 'Photos & Videos', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
            { id: 'document', icon: FileText, label: 'Document', color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/10' },
            { id: 'audio', icon: Music, label: 'Audio', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-500/10' },
            { id: 'video', icon: PlayCircle, label: 'Camera', color: 'text-pink-500', bg: 'bg-pink-50 dark:bg-pink-500/10' },
        ].map((item) => (
            <button
                key={item.id}
                onClick={(e) => {
                    e.preventDefault()
                    onSelect(item.id)
                }}
                className="flex items-center gap-4 w-full p-3 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl transition-colors group"
            >
                <div className={`${item.bg} ${item.color} p-2 rounded-full group-hover:scale-110 transition-transform`}>
                    <item.icon className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-[#e9edef]">{item.label}</span>
            </button>
        ))}
    </div>
)

const MessageBubble = ({ msg, isAgent, mounted }: { msg: any, isAgent: boolean, mounted: boolean }) => {
    const isMedia = msg.message_type !== 'text' && msg.media_url

    return (
        <div className={`flex flex-col mb-1.5 ${isAgent ? 'items-end' : 'items-start'}`}>
            <div className={`relative max-w-[85%] rounded-xl shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] text-[13.5px] ${isAgent
                ? 'bg-[#dcf8c6] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-tr-none'
                : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-tl-none'
                } ${isMedia ? 'p-1' : 'px-3 py-1.5'}`}>

                {isMedia && (
                    <div className="mb-1 overflow-hidden rounded-lg">
                        {msg.message_type === 'image' ? (
                            <img src={msg.media_url} alt="Shared image" className="max-w-full h-auto max-h-64 object-cover cursor-pointer hover:opacity-95 transition-opacity" />
                        ) : msg.message_type === 'video' ? (
                            <div className="relative aspect-video bg-black/10 flex items-center justify-center">
                                <PlayCircle className="w-12 h-12 text-white opacity-80" />
                                <video src={msg.media_url} className="absolute inset-0 w-full h-full object-cover" />
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 bg-black/5 dark:bg-white/5 p-3 rounded-lg border border-black/5 dark:border-white/5 min-w-[200px]">
                                <FileText className="w-8 h-8 text-[#8696a0]" />
                                <div className="flex-1 overflow-hidden">
                                    <p className="font-medium truncate">{msg.media_url.split('/').pop() || 'Document'}</p>
                                    <p className="text-[10px] opacity-60 uppercase">{msg.message_type}</p>
                                </div>
                                <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors">
                                    <ChevronDown className="w-4 h-4 rotate-[-90deg]" />
                                </a>
                            </div>
                        )}
                    </div>
                )}

                {msg.content && <p className={`whitespace-pre-wrap leading-relaxed ${isMedia ? 'px-2 py-1 pb-2' : 'px-0.5'}`}>{msg.content}</p>}

                <div className={`flex items-center justify-end gap-1 mt-1 text-[11px] ${isAgent ? 'text-[#667781] dark:text-[#8696a0]' : 'text-[#667781] dark:text-[#8696a0]'} ${isMedia ? 'px-2' : ''}`}>
                    <span>{mounted && msg.created_at ? format(new Date(msg.created_at), 'HH:mm') : ''}</span>
                    {isAgent && (
                        <span className="ml-1">
                            {msg.status === 'read' ? (
                                <CheckCheck className="w-4 h-4 text-[#53bdeb]" />
                            ) : msg.status === 'sent' ? (
                                <CheckCheck className="w-4 h-4 text-[#8696a0]" />
                            ) : (
                                <Check className="w-4 h-4 text-[#8696a0]" />
                            )}
                        </span>
                    )}
                </div>

                {/* Bubble Tail SVG */}
                <div className={`absolute top-0 w-3 h-3 ${isAgent ? 'right-[-9px]' : 'left-[-9px]'}`}>
                    <svg viewBox="0 0 8 13" fill="none" xmlns="http://www.w3.org/2000/svg" className={`w-3 h-4 ${isAgent ? 'text-[#dcf8c6] dark:text-[#005c4b]' : 'text-white dark:text-[#202c33]'}`}>
                        <path d={isAgent
                            ? "M0 0V13C0 13 0 13 4 13C8 13 8 0 8 0H0Z"
                            : "M8 0V13C8 13 8 13 4 13C0 13 0 0 0 0H8Z"}
                            fill="currentColor"
                        />
                    </svg>
                </div>
            </div>
        </div>
    )
}

export function ChatWindow({ conversationId, leadId, leadName, initialConversation }: { conversationId?: string, leadId?: string, leadName?: string, initialConversation?: any }) {
    const [messages, setMessages] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [inputText, setInputText] = useState('')
    const [sending, setSending] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const [showScrollButton, setShowScrollButton] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [showAttachmentMenu, setShowAttachmentMenu] = useState(false)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [filePreview, setFilePreview] = useState<string | null>(null)
    const [fileType, setFileType] = useState<'image' | 'video' | 'audio' | 'document' | null>(null)

    const MESSAGES_PER_PAGE = 30

    const effectiveLeadId = leadId || initialConversation?.lead_id || initialConversation?.leads?.id

    // Manual Sync
    const handleSync = async () => {
        if (syncing || !effectiveLeadId) return
        setSyncing(true)
        try {
            const result = await syncLeadMessages(effectiveLeadId)
            if (result.success) {
                // Refresh messages after sync
                if (conversationId) {
                    const updatedMsgs = await getMessages(conversationId)
                    setMessages(updatedMsgs)
                }
                toast.success('Messages synced')
            } else {
                toast.error(result.error || 'Failed to sync messages')
            }
        } catch (error) {
            console.error('Sync failed:', error)
            toast.error('An unexpected error occurred during sync')
        } finally {
            setSyncing(false)
        }
    }

    // Auto-polling (every 60s)
    useEffect(() => {
        if (!effectiveLeadId) return
        const interval = setInterval(() => {
            handleSync()
        }, 60000)
        return () => clearInterval(interval)
    }, [effectiveLeadId])

    useEffect(() => {
        setMounted(true)
        if (!conversationId) {
            setMessages([])
            return
        }

        const fetchMessages = async () => {
            setLoading(true)
            try {
                const data = await getMessages(conversationId)
                setMessages(data)
                markAsRead(conversationId)
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        }

        fetchMessages()

        const supabase = createClient()
        const channel = supabase
            .channel(`chat_${conversationId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                (payload) => {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev
                        return [...prev, payload.new]
                    })
                    markAsRead(conversationId)
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [conversationId])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setSelectedFile(file)
        if (file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = (e) => setFilePreview(e.target?.result as string)
            reader.readAsDataURL(file)
        } else {
            setFilePreview(null)
        }
    }

    const clearFile = () => {
        setSelectedFile(null)
        setFilePreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleSend = async () => {
        if (!conversationId || !leadId || sending) return
        if (!inputText.trim() && !selectedFile) return

        setSending(true)
        const content = inputText
        let mediaUrl: string | undefined = undefined
        let messageType: any = 'text'

        try {
            if (selectedFile) {
                const supabase = createClient()
                const fileExt = selectedFile.name.split('.').pop()
                const fileName = `${Math.random()}.${fileExt}`
                const filePath = `${leadId}/${fileName}`

                const { error: uploadError, data } = await supabase.storage
                    .from('chat-attachments')
                    .upload(filePath, selectedFile)

                if (uploadError) throw uploadError

                const { data: { publicUrl } } = supabase.storage
                    .from('chat-attachments')
                    .getPublicUrl(filePath)

                mediaUrl = publicUrl
                messageType = selectedFile.type.startsWith('image/') ? 'image' :
                    selectedFile.type.startsWith('video/') ? 'video' :
                        selectedFile.type.startsWith('audio/') ? 'audio' : 'document'
            }

            const res = await sendWhatsAppMessage(leadId, content, messageType as any, mediaUrl)
            if (res.success) {
                setInputText('')
                clearFile()
            } else {
                toast.error(res.error || "Failed to send message")
            }
        } catch (e: any) {
            toast.error(e.message || "An unexpected error occurred")
        } finally {
            setSending(false)
        }
    }

    const loadMoreMessages = async () => {
        if (loadingMore || !hasMore || !conversationId) return
        setLoadingMore(true)
        try {
            const olderMessages = await getMessages(conversationId, MESSAGES_PER_PAGE, messages.length)
            if (olderMessages.length < MESSAGES_PER_PAGE) setHasMore(false)
            setMessages(prev => [...olderMessages, ...prev])
        } catch (e) {
            console.error(e)
        } finally {
            setLoadingMore(false)
        }
    }

    const scrollToBottom = () => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
        setShowScrollButton(false)
    }

    const handleScroll = (e: any) => {
        const target = e.target
        const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 150
        setShowScrollButton(!isNearBottom)
    }

    if (!conversationId) {
        return (
            <div className="flex-1 flex items-center justify-center bg-[#f0f2f5] dark:bg-[#0b141a] text-gray-400 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-[6px] bg-[#25D366]" />
                <div className="text-center max-w-md px-10">
                    <div className="bg-white/50 dark:bg-[#202c33] p-10 rounded-full mb-8 inline-block shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-gray-100 dark:border-white/5">
                        <Send className="w-16 h-16 text-[#00a884] opacity-20" />
                    </div>
                    <h2 className="text-3xl font-light text-gray-700 dark:text-[#e9edef] mb-3">WhatsApp for Web</h2>
                    <p className="text-sm text-[#667781] dark:text-[#8696a0] leading-relaxed">
                        Send and receive messages without keeping your phone online. Use WhatsApp on up to 4 linked devices and 1 phone at the same time.
                    </p>
                    <div className="mt-12 flex items-center justify-center gap-1.5 text-xs text-[#8696a0]">
                        <Check className="w-3.5 h-3.5" />
                        <span>End-to-end encrypted</span>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 h-full bg-[#efeae2] dark:bg-[#0b141a]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-white/5 z-20">
                <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-gray-100 dark:border-white/5">
                        <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${leadName}&backgroundColor=60a5fa`} />
                        <AvatarFallback className="bg-blue-100 text-blue-600 font-bold">{leadName?.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div className="overflow-hidden">
                        <h3 className="font-semibold text-gray-900 dark:text-[#e9edef] truncate leading-none mb-1">{leadName}</h3>
                        <p className="text-[11px] text-[#667781] dark:text-[#8696a0] font-medium leading-none">WhatsApp Business Account</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-[#54656f] dark:text-[#aebac1]">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleSync}
                        disabled={syncing}
                        className="rounded-full hover:bg-gray-200 dark:hover:bg-white/5"
                    >
                        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-gray-200 dark:hover:bg-white/5"><Video className="w-5 h-5" /></Button>
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-gray-200 dark:hover:bg-white/5"><Phone className="w-4 h-4" /></Button>
                    <div className="w-[1px] h-6 bg-gray-300 dark:bg-white/10 mx-1" />
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-gray-200 dark:hover:bg-white/5"><MoreVertical className="w-5 h-5" /></Button>
                </div>
            </div>

            {/* Messages Area with Tiled Background Overlay */}
            <div className="flex-1 relative overflow-hidden flex flex-col bg-[#efeae2] dark:bg-[#0b141a]">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-[0.25] dark:opacity-[0.06] pointer-events-none z-0"
                    style={{
                        backgroundImage: `url("https://w0.peakpx.com/wallpaper/508/606/HD-wallpaper-whatsapp-l-background-doodle-patterns-thumbnail.jpg")`,
                        backgroundSize: '412px',
                        backgroundRepeat: 'repeat'
                    }}
                />

                {/* Main Messages Scroll Area */}
                <div
                    className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-white/10 scroll-smooth z-10"
                    onScroll={handleScroll}
                >
                    <div className="flex flex-col gap-1 py-6 px-4 sm:px-10 md:px-16 lg:px-24 max-w-5xl mx-auto min-h-full">
                        {hasMore && messages.length >= MESSAGES_PER_PAGE && (
                            <div className="flex justify-center mb-6">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={loadMoreMessages}
                                    disabled={loadingMore}
                                    className="text-[12px] h-8 bg-white/70 dark:bg-[#111b21]/70 border-none rounded-lg hover:bg-white dark:hover:bg-[#111b21] shadow-sm text-[#54656f] dark:text-[#aebac1] px-4"
                                >
                                    {loadingMore ? "Loading..." : "Load Older Messages"}
                                </Button>
                            </div>
                        )}
                        {loading ? (
                            <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-gray-400" /></div>
                        ) : messages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center mt-20 text-center px-6">
                                <div className="bg-white/90 dark:bg-[#202c33] p-6 rounded-2xl shadow-sm scale-90 border border-gray-100 dark:border-white/5">
                                    <Send className="w-8 h-8 text-[#00a884] mx-auto mb-4 opacity-50" />
                                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Encrypted Chat</h3>
                                    <p className="text-xs text-gray-500 max-w-[200px]">
                                        Your messages are securely delivered via Interakt.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            messages.map((msg, idx) => {
                                const isAgent = msg.sender_type === 'agent' || msg.sender_type === 'bot'
                                const prevMsg = messages[idx - 1]
                                const showDateHeader = !prevMsg || !isSameDay(new Date(msg.created_at), new Date(prevMsg.created_at))

                                let dateText = format(new Date(msg.created_at), 'MMMM dd, yyyy')
                                if (isToday(new Date(msg.created_at))) dateText = 'TODAY'
                                else if (isYesterday(new Date(msg.created_at))) dateText = 'YESTERDAY'

                                return (
                                    <div key={msg.id}>
                                        {showDateHeader && (
                                            <div className="flex justify-center my-6 sticky top-2 z-20">
                                                <span className="bg-white/90 dark:bg-[#111b21]/90 backdrop-blur-sm px-3 py-1 rounded-full text-[11px] font-bold shadow-sm uppercase tracking-wider text-[#54656f] dark:text-[#8696a0] border border-gray-100 dark:border-white/5">
                                                    {dateText}
                                                </span>
                                            </div>
                                        )}
                                        <MessageBubble msg={msg} isAgent={isAgent} mounted={mounted} />
                                    </div>
                                )
                            })
                        )}
                        <div ref={scrollRef} className="h-4" />
                    </div>
                </div>

                {/* Scroll to bottom button */}
                {showScrollButton && (
                    <Button
                        size="icon"
                        onClick={scrollToBottom}
                        className="absolute bottom-24 right-8 z-30 h-10 w-10 rounded-full bg-white dark:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] shadow-lg hover:bg-gray-100 dark:hover:bg-[#2a3942] border border-gray-100 dark:border-white/5"
                    >
                        <ChevronDown className="w-5 h-5" />
                    </Button>
                )}

                {/* File Preview Bar */}
                {selectedFile && (
                    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="bg-white/95 dark:bg-[#111b21] p-3 rounded-2xl shadow-2xl border border-gray-100 dark:border-white/5 flex items-center gap-4">
                            {filePreview ? (
                                <img src={filePreview} alt="Preview" className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-white/10" />
                            ) : (
                                <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-white/5 flex items-center justify-center border border-gray-200 dark:border-white/10">
                                    <FileText className="w-8 h-8 text-[#8696a0]" />
                                </div>
                            )}
                            <div className="flex-1 overflow-hidden">
                                <p className="font-semibold text-sm truncate">{selectedFile.name}</p>
                                <p className="text-xs text-[#667781] dark:text-[#8696a0]">
                                    {selectedFile.size < 1024 * 1024
                                        ? `${(selectedFile.size / 1024).toFixed(1)} KB`
                                        : `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                                    } • Ready to send
                                </p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={clearFile} className="rounded-full hover:bg-red-50 text-red-500"><X className="w-5 h-5" /></Button>
                        </div>
                    </div>
                )}

                {/* AI Bottom Suggestion - Sleeker floating design */}
                {!selectedFile && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 group">
                        <div className="bg-white/95 dark:bg-[#111b21] border border-gray-100 dark:border-white/5 rounded-xl px-4 py-2 text-xs flex items-center gap-3 shadow-[0_4px_16px_rgba(0,0,0,0.1)] backdrop-blur-md transform transition-all hover:scale-105 active:scale-95">
                            <div className="bg-yellow-100 dark:bg-yellow-900/30 p-1 rounded-lg">
                                <Lightbulb className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
                            </div>
                            <div className="flex flex-col min-w-[100px]">
                                <span className="text-gray-900 dark:text-[#e9edef] font-bold text-[11px] mb-0.5 leading-tight">AI Suggestion</span>
                                <span className="text-[#667781] dark:text-[#8696a0] italic truncate max-w-[220px] leading-tight text-[11px]">
                                    "Hi {leadName}, let me know if you have any questions!"
                                </span>
                            </div>
                            <Button variant="ghost" size="sm" className="h-7 px-3 text-white bg-[#00a884] hover:bg-[#06cf9c] font-bold rounded-lg shadow-sm text-[11px]">Apply</Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Input Footer */}
            <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33] flex items-center gap-3 border-t border-gray-200 dark:border-white/5 z-30">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                />

                <div className="flex items-center gap-0.5 text-[#54656f] dark:text-[#aebac1]">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-gray-200 dark:hover:bg-white/5"><Smile className="w-6 h-6" /></Button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="start" className="p-2 w-72 bg-white dark:bg-[#233138] rounded-2xl shadow-xl border-none">
                            <div className="grid grid-cols-7 gap-1">
                                {COMMON_EMOJIS.map(e => (
                                    <button
                                        key={e}
                                        onClick={(e) => {
                                            e.preventDefault()
                                            setInputText(prev => prev + e)
                                        }}
                                        className="h-9 w-9 flex items-center justify-center text-xl hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                                    >
                                        {e}
                                    </button>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-gray-200 dark:hover:bg-white/5"><Paperclip className="w-6 h-6" /></Button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="start" className="p-0 border-none bg-transparent shadow-none w-auto">
                            <AttachmentMenu onSelect={() => fileInputRef.current?.click()} />
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="flex-1">
                    <Textarea
                        placeholder="Type a message"
                        className="min-h-[42px] max-h-32 py-2.5 px-4 resize-none border-none shadow-sm focus-visible:ring-0 bg-white dark:bg-[#2a3942] dark:text-[#e9edef] rounded-lg text-[15px] leading-relaxed transition-all"
                        rows={1}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSend()
                            }
                        }}
                    />
                </div>

                <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={sending || (!inputText.trim() && !selectedFile)}
                    className="h-12 w-12 rounded-full shrink-0 bg-[#00a884] hover:bg-[#06cf9c] shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-all active:scale-90"
                >
                    {sending ? (
                        <RefreshCw className="w-5 h-5 text-white animate-spin" />
                    ) : (
                        <Send className="w-5 h-5 text-white" />
                    )}
                </Button>
            </div>
        </div>
    )
}
