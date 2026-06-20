'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

export function MainContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isInbox = pathname?.startsWith('/inbox')

    return (
        <main className={cn(
            "flex-1 overflow-hidden relative",
            !isInbox && "p-4 sm:p-6 lg:p-8 overflow-auto"
        )}>
            <AnimatePresence mode="wait">
                <motion.div
                    key={pathname}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className="h-full"
                >
                    {children}
                </motion.div>
            </AnimatePresence>
        </main>
    )
}
