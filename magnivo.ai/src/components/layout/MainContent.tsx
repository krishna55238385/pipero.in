'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

export function MainContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isInbox = pathname?.startsWith('/inbox')
    const isDialer = pathname?.startsWith('/dialer')

    return (
        <main className={cn(
            "flex-1 overflow-hidden relative",
            !isInbox && !isDialer && "p-4 sm:p-6 lg:p-8 overflow-auto"
        )}>
            <AnimatePresence mode="wait">
                <motion.div
                    key={pathname}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                    className="h-full"
                >
                    {children}
                </motion.div>
            </AnimatePresence>
        </main>
    )
}
