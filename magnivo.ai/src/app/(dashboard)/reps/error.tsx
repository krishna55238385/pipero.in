'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function RepMonitorError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error('[RepMonitor] render error:', error)
    }, [error])

    return (
        <div className="p-8 max-w-2xl mx-auto flex flex-col items-center justify-center text-center gap-4 min-h-[60vh]">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-rose-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-foreground">Rep Monitor hit a snag</h2>
            <p className="text-slate-500 dark:text-muted-foreground font-medium">
                Something went wrong loading rep performance data. This has been logged.
            </p>
            <Button onClick={() => reset()} variant="outline" className="rounded-2xl">
                Try again
            </Button>
        </div>
    )
}
