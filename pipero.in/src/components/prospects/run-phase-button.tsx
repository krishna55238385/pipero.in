'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getPhaseRun } from '@/app/actions/gtm'
import { lastMeaningfulLine } from '@/components/prospects/PipelineRunsPanel'
import type { RunResult } from '@/types/gtm'

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'secondary'
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

/**
 * Fires a phase-run server action and (optionally) polls phase_runs until the
 * background job finishes, surfacing progress via toasts. Reusable across the
 * ICP, AI-search and outreach surfaces.
 */
export function RunPhaseButton({
  run,
  label,
  runningLabel = 'Starting…',
  icon,
  variant = 'default',
  size = 'sm',
  className,
  poll = true,
  onDone,
}: {
  run: () => Promise<RunResult>
  label: string
  runningLabel?: string
  icon?: React.ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  poll?: boolean
  onDone?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [polling, setPolling] = useState(false)

  async function pollUntilDone(runId: string) {
    setPolling(true)
    const started = Date.now()
    const tick = async () => {
      const r = await getPhaseRun(runId)
      if (!r) return
      if (r.status === 'succeeded') {
        toast.success('Pipeline run finished — refreshing data')
        setPolling(false)
        onDone?.()
        return
      }
      if (r.status === 'failed') {
        const reason = lastMeaningfulLine(r.logs) || r.error || 'see logs'
        toast.error(`Run failed: ${reason}`, {
          description: 'Open this run under “Recent pipeline runs” → View logs for the full output.',
          duration: 10000,
        })
        setPolling(false)
        onDone?.()
        return
      }
      if (Date.now() - started > 1000 * 60 * 20) {
        setPolling(false)
        return
      }
      setTimeout(tick, 4000)
    }
    setTimeout(tick, 4000)
  }

  const busy = pending || polling

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={busy}
      onClick={() =>
        startTransition(async () => {
          const res = await run()
          if (res.ok) {
            toast.success(
              res.runId ? `Pipeline started (${res.runId.slice(0, 8)})` : 'Pipeline started',
            )
            if (poll && res.runId) pollUntilDone(res.runId)
          } else {
            toast.error(res.error || 'Could not start pipeline')
          }
        })
      }
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {busy ? runningLabel : label}
    </Button>
  )
}
