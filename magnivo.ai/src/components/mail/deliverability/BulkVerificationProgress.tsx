'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { bulkVerifyDomains } from '@/app/actions/deliverability'

type BulkResult = {
  domainId: string
  success: boolean
  error?: string
}

type BulkVerificationProgressProps = {
  domainIds: string[]
  domainNames: Record<string, string>
  onComplete: () => void
  onClear: () => void
}

export function BulkVerificationProgress({
  domainIds,
  domainNames,
  onComplete,
  onClear,
}: BulkVerificationProgressProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [results, setResults] = useState<BulkResult[]>([])
  const [progress, setProgress] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  const handleStart = useCallback(async () => {
    if (domainIds.length === 0) return
    setIsRunning(true)
    setResults([])
    setProgress(0)

    try {
      const result = await bulkVerifyDomains({ domainIds })
      if (result.success && result.data) {
        setResults(result.data)
        setProgress(100)
      }
    } catch {
      setResults(domainIds.map((id) => ({ domainId: id, success: false, error: 'Verification failed' })))
      setProgress(100)
    } finally {
      setIsRunning(false)
      setIsComplete(true)
      onComplete()
    }
  }, [domainIds, onComplete])

  const successCount = results.filter((r) => r.success).length
  const failureCount = results.filter((r) => !r.success).length

  if (domainIds.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Bulk Verification</CardTitle>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {domainIds.length} domain{domainIds.length !== 1 ? 's' : ''} selected
            </Badge>
          </div>
          <div className="flex gap-2">
            {!isRunning && !isComplete && (
              <Button size="sm" className="h-6 text-xs" onClick={handleStart}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Verify All
              </Button>
            )}
            {isComplete && (
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onClear}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {isRunning && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verifying {domainIds.length} domains in parallel...
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {isComplete && results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                {successCount} succeeded
              </span>
              {failureCount > 0 && (
                <span className="flex items-center gap-1 text-red-600">
                  <XCircle className="h-3 w-3" />
                  {failureCount} failed
                </span>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {results.map((result) => (
                <div
                  key={result.domainId}
                  className={cn(
                    'flex items-center justify-between text-xs py-1 px-2 rounded',
                    result.success ? 'bg-emerald-500/5' : 'bg-red-500/5'
                  )}
                >
                  <span className="truncate">{domainNames[result.domainId] ?? result.domainId}</span>
                  {result.success ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                  ) : (
                    <span className="text-red-500 text-[10px] shrink-0">{result.error ?? 'Failed'}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
