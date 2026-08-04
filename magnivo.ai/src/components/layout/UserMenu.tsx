'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Settings } from 'lucide-react'

export function UserMenu({ fullName, email }: { fullName?: string | null; email?: string | null }) {
    const [open, setOpen] = useState(false)
    const router = useRouter()
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', onClickOutside)
        return () => document.removeEventListener('mousedown', onClickOutside)
    }, [])

    async function handleLogout() {
        await fetch('/api/auth/logout', { method: 'POST' })
        router.push('/login')
        router.refresh()
    }

    const initial = (fullName || email || '?').charAt(0).toUpperCase()

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((v) => !v)}
                className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-semibold text-white cursor-pointer transition-all duration-200 hover:shadow-md hover:shadow-blue-500/20 active:scale-95"
            >
                {initial}
            </button>
            {open && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl border border-border/40 bg-card shadow-lg shadow-black/5 py-1 z-50 animate-scale-in">
                    {(fullName || email) && (
                        <div className="px-3 py-2.5 border-b border-border/20">
                            {fullName && <p className="text-sm font-medium text-foreground truncate">{fullName}</p>}
                            {email && <p className="text-xs text-muted-foreground truncate mt-0.5">{email}</p>}
                        </div>
                    )}
                    <button
                        onClick={() => { setOpen(false); router.push('/settings') }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                    >
                        <Settings className="h-4 w-4" />
                        Settings
                    </button>
                    <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign out
                    </button>
                </div>
            )}
        </div>
    )
}
