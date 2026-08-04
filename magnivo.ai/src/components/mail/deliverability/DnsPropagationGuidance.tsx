'use client'

import { Clock, RefreshCw, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * DNS propagation guidance (PRD §6.2.16).
 * Shown after failed/partial verify so operators know when to re-check.
 */
export function DnsPropagationGuidance({
  lastCheckedAt,
  onRecheck,
  busy,
  failedRecords,
}: {
  lastCheckedAt?: string | null
  onRecheck?: () => void
  busy?: boolean
  failedRecords?: string[]
}) {
  const last = lastCheckedAt ? new Date(lastCheckedAt) : null
  const minutesAgo = last ? Math.max(0, Math.round((Date.now() - last.getTime()) / 60_000)) : null
  const suggestWait = minutesAgo != null && minutesAgo < 15

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600" />
          DNS propagation guidance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          DNS changes often take <strong className="text-foreground">5–60 minutes</strong> (sometimes up to
          24–48 hours) depending on TTL and your registrar. Magnivo re-checks live DNS — cached results at
          your ISP may lag.
        </p>
        {failedRecords && failedRecords.length > 0 && (
          <p className="text-xs">
            Still pending or invalid:{' '}
            <span className="font-medium">{failedRecords.join(', ')}</span>
          </p>
        )}
        <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
          <li>Confirm records exactly match Magnivo’s recommended host/value (no extra spaces).</li>
          <li>Set TTL to 300–3600 seconds while onboarding, then raise after verification.</li>
          <li>Wait at least 15 minutes after publishing before expecting a green verify.</li>
          <li>Use Retry / Verify DNS after your registrar shows the record as active.</li>
        </ul>
        {suggestWait && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-background/60 px-3 py-2 text-xs">
            <Info className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
            Last check was {minutesAgo} minute{minutesAgo === 1 ? '' : 's'} ago. If you just published
            records, wait a bit longer before retrying.
          </div>
        )}
        {onRecheck && (
          <Button size="sm" variant="outline" disabled={busy || suggestWait} onClick={onRecheck}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? 'animate-spin' : ''}`} />
            {suggestWait ? 'Wait before re-check' : 'Re-check DNS now'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
