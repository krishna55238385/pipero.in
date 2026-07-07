'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

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
                className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-semibold text-white"
            >
                {initial}
            </button>
            {open && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-gray-200 dark:border-border bg-white dark:bg-card shadow-lg py-1 z-50">
                    {(fullName || email) && (
                        <div className="px-3 py-2 border-b border-gray-100 dark:border-border">
                            {fullName && <p className="text-sm font-medium text-gray-900 dark:text-foreground truncate">{fullName}</p>}
                            {email && <p className="text-xs text-gray-500 dark:text-muted-foreground truncate">{email}</p>}
                        </div>
                    )}
                    <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-foreground hover:bg-gray-50 dark:hover:bg-muted"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign out
                    </button>
                </div>
            )}
        </div>
    )
}
